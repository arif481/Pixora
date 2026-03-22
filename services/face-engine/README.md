# Face Engine Service (FastAPI)

Runnable face verification and matching service.

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

## Recommended production configuration

- Set `ENGINE_MODE=real`
- Keep `MODEL_NAME=buffalo_l`
- Tune `MIN_ENROLL_QUALITY` (default `0.5`) based on real image quality requirements

## Notes

- Real mode downloads image URLs and validates size/content type before inference.
- Keep response schema stable so web app integration does not break.
