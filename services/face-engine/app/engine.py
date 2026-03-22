from __future__ import annotations

import hashlib
from typing import List, Tuple

import numpy as np

EMBEDDING_SIZE = 512


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


def detect_faces_stub(image_url: str) -> List[Tuple[int, int, int, int, float, List[float]]]:
  base_embedding = stable_embedding(image_url)
  return [
    (120, 80, 190, 190, 0.93, base_embedding),
  ]


def cosine_similarity(a: List[float], b: List[float]) -> float:
  va = np.array(a, dtype=np.float32)
  vb = np.array(b, dtype=np.float32)
  denom = np.linalg.norm(va) * np.linalg.norm(vb)
  if denom == 0:
    return 0.0
  return float(np.dot(va, vb) / denom)
