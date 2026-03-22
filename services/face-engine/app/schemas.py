from typing import List, Optional
from pydantic import BaseModel, Field


class FaceBox(BaseModel):
    x: int
    y: int
    w: int
    h: int


class FaceEmbedding(BaseModel):
    bbox: FaceBox
    quality_score: float = Field(ge=0, le=1)
    embedding: List[float]


class EnrollResponse(BaseModel):
    model_version: str
    quality_passed: bool
    embedding: Optional[List[float]] = None
    flags: List[str] = []


class DetectEmbedRequest(BaseModel):
    image_url: str


class DetectEmbedResponse(BaseModel):
    model_version: str
    faces: List[FaceEmbedding]


class MatchRequest(BaseModel):
    probe_embedding: List[float]
    candidates: List[List[float]]


class MatchItem(BaseModel):
    candidate_index: int
    confidence: float


class MatchResponse(BaseModel):
    top_matches: List[MatchItem]
