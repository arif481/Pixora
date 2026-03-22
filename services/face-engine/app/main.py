import os
from fastapi import FastAPI, Header, HTTPException

from .engine import cosine_similarity, detect_faces_real, detect_faces_sim
from .schemas import (
    DetectEmbedRequest,
    DetectEmbedResponse,
    EnrollResponse,
    FaceBox,
    FaceEmbedding,
    MatchItem,
    MatchRequest,
    MatchResponse,
)

app = FastAPI(title="Pixora Face Engine", version="0.1.0")

MODEL_VERSION = os.getenv("MODEL_NAME", "buffalo_l")
ENGINE_AUTH_TOKEN = os.getenv("ENGINE_AUTH_TOKEN", "change-me")
ENGINE_MODE = os.getenv("ENGINE_MODE", "simulated").strip().lower()
MAX_IMAGE_MB = int(os.getenv("MAX_IMAGE_MB", "15"))
ALLOW_SIM_FALLBACK = os.getenv("ALLOW_SIM_FALLBACK", "true").strip().lower() == "true"
MIN_ENROLL_QUALITY = float(os.getenv("MIN_ENROLL_QUALITY", "0.5"))


def _detect_faces(image_url: str):
    if ENGINE_MODE in {"real", "production", "insightface"}:
        try:
            return detect_faces_real(image_url=image_url, model_name=MODEL_VERSION, max_image_mb=MAX_IMAGE_MB), "real"
        except Exception:
            if not ALLOW_SIM_FALLBACK:
                raise
            return detect_faces_sim(image_url), "simulated-fallback"

    return detect_faces_sim(image_url), "simulated"


def verify_token(authorization: str | None) -> None:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    expected = f"Bearer {ENGINE_AUTH_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=403, detail="Invalid engine token")


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "model_version": MODEL_VERSION,
        "engine_mode": ENGINE_MODE,
        "allow_sim_fallback": ALLOW_SIM_FALLBACK,
        "max_image_mb": MAX_IMAGE_MB,
    }


@app.post("/enroll", response_model=EnrollResponse)
def enroll(image_url: str, authorization: str | None = Header(default=None)) -> EnrollResponse:
    verify_token(authorization)
    detected_faces, mode_used = _detect_faces(image_url)
    if not detected_faces:
        return EnrollResponse(
            model_version=MODEL_VERSION,
            quality_passed=False,
            embedding=None,
            flags=["no-face-detected"],
        )

    detected_faces.sort(key=lambda item: (item[2] * item[3], item[4]), reverse=True)
    _x, _y, _w, _h, quality, embedding = detected_faces[0]

    flags: list[str] = []
    if len(detected_faces) > 1:
        flags.append("multiple-faces-detected")
    if quality < MIN_ENROLL_QUALITY:
        flags.append("low-face-quality")

    return EnrollResponse(
        model_version=f"{MODEL_VERSION}:{mode_used}",
        quality_passed=quality >= MIN_ENROLL_QUALITY,
        embedding=embedding,
        flags=flags,
    )


@app.post("/detect-and-embed", response_model=DetectEmbedResponse)
def detect_and_embed(
    payload: DetectEmbedRequest,
    authorization: str | None = Header(default=None),
) -> DetectEmbedResponse:
    verify_token(authorization)
    faces = []
    detections, mode_used = _detect_faces(payload.image_url)
    for x, y, w, h, quality, embedding in detections:
        faces.append(
            FaceEmbedding(
                bbox=FaceBox(x=x, y=y, w=w, h=h),
                quality_score=quality,
                embedding=embedding,
            )
        )

    return DetectEmbedResponse(model_version=f"{MODEL_VERSION}:{mode_used}", faces=faces)


@app.post("/match", response_model=MatchResponse)
def match(payload: MatchRequest, authorization: str | None = Header(default=None)) -> MatchResponse:
    verify_token(authorization)

    scored: list[MatchItem] = []
    for index, candidate in enumerate(payload.candidates):
        confidence = cosine_similarity(payload.probe_embedding, candidate)
        scored.append(MatchItem(candidate_index=index, confidence=confidence))

    scored.sort(key=lambda value: value.confidence, reverse=True)
    return MatchResponse(top_matches=scored[:5])
