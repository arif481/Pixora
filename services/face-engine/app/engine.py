from __future__ import annotations

import hashlib
import math
import os
from typing import List, Optional, Tuple

import certifi
import httpx
import numpy as np
from fastapi import HTTPException

EMBEDDING_SIZE = 512
REQUEST_TIMEOUT_SECONDS = int(os.getenv("IMAGE_FETCH_TIMEOUT_SECONDS", "30"))
INSIGHTFACE_CTX_ID = int(os.getenv("INSIGHTFACE_CTX_ID", "-1"))
DETECTION_SIZE = int(os.getenv("INSIGHTFACE_DET_SIZE", "320"))

_ANALYZER = None


def _http_client() -> httpx.Client:
  return httpx.Client(
    timeout=REQUEST_TIMEOUT_SECONDS,
    follow_redirects=True,
    verify=certifi.where(),
    headers={
      "User-Agent": "PixoraFaceEngine/1.0",
      "Accept": "image/*,*/*;q=0.8",
    },
  )


def _to_quality(score: float) -> float:
  return max(0.0, min(1.0, float(score)))


def _seed_from_text(value: str) -> int:
  digest = hashlib.sha256(value.encode("utf-8")).digest()
  return int.from_bytes(digest[:8], "big")


def stable_embedding(seed_text: str) -> List[float]:
  rng = np.random.default_rng(_seed_from_text(seed_text))
  vector = rng.normal(size=EMBEDDING_SIZE).astype(np.float32)
  norm = np.linalg.norm(vector)
  if norm == 0:
    return vector.tolist()
  return (vector / norm).tolist()


def fetch_image_bytes(image_url: str, max_image_mb: int) -> bytes:
  max_size = max_image_mb * 1024 * 1024
  try:
    with _http_client() as client:
      response = client.get(image_url)
      response.raise_for_status()
  except Exception as error:
    raise HTTPException(status_code=400, detail=f"Failed to fetch image: {error}") from error

  content_type = response.headers.get("content-type", "")
  if "image" not in content_type:
    raise HTTPException(status_code=400, detail="URL does not point to an image")

  payload = response.content
  if len(payload) > max_size:
    raise HTTPException(status_code=413, detail=f"Image too large (>{max_image_mb}MB)")

  return payload


def decode_image_bytes(payload: bytes) -> np.ndarray:
  try:
    import cv2  # type: ignore
  except Exception as error:
    raise RuntimeError("opencv-python-headless is required for real inference mode") from error

  matrix = np.frombuffer(payload, dtype=np.uint8)
  image = cv2.imdecode(matrix, cv2.IMREAD_COLOR)
  if image is None:
    raise HTTPException(status_code=400, detail="Invalid image bytes")
  return image


def _normalize_embedding(embedding: np.ndarray | List[float]) -> List[float]:
  vector = np.array(embedding, dtype=np.float32)
  norm = float(np.linalg.norm(vector))
  if math.isclose(norm, 0.0):
    return vector.tolist()
  return (vector / norm).tolist()


def _get_analyzer(model_name: str):
  global _ANALYZER
  if _ANALYZER is not None:
    return _ANALYZER

  try:
    from insightface.app import FaceAnalysis  # type: ignore
  except Exception as error:
    raise RuntimeError("insightface is required for real inference mode") from error

  analyzer = FaceAnalysis(
    name=model_name,
    allowed_modules=["detection", "recognition"],
    providers=["CPUExecutionProvider"],
  )
  analyzer.prepare(ctx_id=INSIGHTFACE_CTX_ID, det_size=(DETECTION_SIZE, DETECTION_SIZE))
  _ANALYZER = analyzer
  return _ANALYZER


def detect_faces_real(
  image_url: str,
  model_name: str,
  max_image_mb: int,
) -> List[Tuple[int, int, int, int, float, List[float]]]:
  payload = fetch_image_bytes(image_url, max_image_mb=max_image_mb)
  image = decode_image_bytes(payload)
  try:
    analyzer = _get_analyzer(model_name)
  except Exception as error:
    raise HTTPException(status_code=503, detail=f"Face model initialization failed: {error}") from error

  try:
    faces = analyzer.get(image)
  except Exception as error:
    raise HTTPException(status_code=503, detail=f"Face inference failed: {error}") from error
  detections: List[Tuple[int, int, int, int, float, List[float]]] = []
  for face in faces:
    bbox = getattr(face, "bbox", None)
    if bbox is None or len(bbox) < 4:
      continue

    x1, y1, x2, y2 = [int(round(value)) for value in bbox[:4]]
    width = max(1, x2 - x1)
    height = max(1, y2 - y1)

    raw_embedding = getattr(face, "normed_embedding", None)
    if raw_embedding is None:
      raw_embedding = getattr(face, "embedding", None)
    if raw_embedding is None:
      continue

    quality = _to_quality(float(getattr(face, "det_score", 0.0)))
    detections.append((x1, y1, width, height, quality, _normalize_embedding(raw_embedding)))

  return detections


def cosine_similarity(a: List[float], b: List[float]) -> float:
  va = np.array(a, dtype=np.float32)
  vb = np.array(b, dtype=np.float32)
  denom = np.linalg.norm(va) * np.linalg.norm(vb)
  if denom == 0:
    return 0.0
  return float(np.dot(va, vb) / denom)
