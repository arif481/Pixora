import os
from fastapi import FastAPI, Header, HTTPException

from .engine import cosine_similarity, detect_faces_sim, stable_embedding
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

MODEL_VERSION = os.getenv("MODEL_NAME", "sim-v1")
ENGINE_AUTH_TOKEN = os.getenv("ENGINE_AUTH_TOKEN", "change-me")


def verify_token(authorization: str | None) -> None:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    expected = f"Bearer {ENGINE_AUTH_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=403, detail="Invalid engine token")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model_version": MODEL_VERSION}


@app.post("/enroll", response_model=EnrollResponse)
def enroll(image_url: str, authorization: str | None = Header(default=None)) -> EnrollResponse:
    verify_token(authorization)
    embedding = stable_embedding(f"enroll:{image_url}")
    return EnrollResponse(
        model_version=MODEL_VERSION,
        quality_passed=True,
        embedding=embedding,
        flags=[],
    )


@app.post("/detect-and-embed", response_model=DetectEmbedResponse)
def detect_and_embed(
    payload: DetectEmbedRequest,
    authorization: str | None = Header(default=None),
) -> DetectEmbedResponse:
    verify_token(authorization)
    faces = []
    for x, y, w, h, quality, embedding in detect_faces_sim(payload.image_url):
        faces.append(
            FaceEmbedding(
                bbox=FaceBox(x=x, y=y, w=w, h=h),
                quality_score=quality,
                embedding=embedding,
            )
        )

    return DetectEmbedResponse(model_version=MODEL_VERSION, faces=faces)


@app.post("/match", response_model=MatchResponse)
def match(payload: MatchRequest, authorization: str | None = Header(default=None)) -> MatchResponse:
    verify_token(authorization)

    scored: list[MatchItem] = []
    for index, candidate in enumerate(payload.candidates):
        confidence = cosine_similarity(payload.probe_embedding, candidate)
        scored.append(MatchItem(candidate_index=index, confidence=confidence))

    scored.sort(key=lambda value: value.confidence, reverse=True)
    return MatchResponse(top_matches=scored[:5])
