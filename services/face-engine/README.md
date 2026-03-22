# Face Engine Service (FastAPI)

This is a runnable starter for face verification and matching endpoints.

## Run locally

1. Create a virtual environment and activate it.
2. Install dependencies:
	- `pip install -r requirements.txt`
3. Copy `.env.example` to `.env`.
4. Start server:
	- `bash run.sh`

## Endpoints

- `GET /health`
- `POST /enroll` (requires bearer token)
- `POST /detect-and-embed` (requires bearer token)
- `POST /match` (requires bearer token)

## Notes

- Current implementation uses deterministic stub embeddings.
- Swap in real `insightface` and `onnxruntime` inference in `app/engine.py`.
- Keep response schema stable so web app integration does not break.
