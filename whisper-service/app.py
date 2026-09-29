"""Whisper sidecar — OpenAI-compatible transcription HTTP service.

Contract (consumed by govconnect-ai-service voice-pipeline.ts):
    POST /audio/transcriptions   multipart: file (required), model (optional),
                                 language (optional) -> {"text": "..."}
    GET  /health                 -> {"status","model","device","model_loaded"}

Privacy: the full transcript is NEVER logged. Only duration, detected
language and character length are logged.
"""

from __future__ import annotations

import asyncio
import logging
import os
import secrets

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from engine import is_engine_loaded, resolve_device, transcribe_audio

logger = logging.getLogger("whisper-service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

MAX_AUDIO_BYTES = int(os.environ.get("WHISPER_MAX_AUDIO_MB", "25")) * 1024 * 1024


def _api_key() -> str:
    """Read per call so tests can toggle auth via env without reimport."""
    return os.environ.get("WHISPER_API_KEY", "").strip()


def _configured_model() -> str:
    return os.environ.get("WHISPER_MODEL", "large-v3-turbo").strip()


async def require_auth(request: Request) -> None:
    """Bearer auth, active only when WHISPER_API_KEY is set (non-empty).

    Empty key = local dev mode, no auth required.
    """
    key = _api_key()
    if not key:
        return
    auth = request.headers.get("authorization", "")
    if not secrets.compare_digest(auth, f"Bearer {key}"):
        raise HTTPException(status_code=401, detail="Unauthorized")


app = FastAPI(title="whisper-service", version="1.0.0")


@app.get("/health")
async def health() -> dict:
    # Must NOT lazy-load the model: health stays 200 even before first use.
    return {
        "status": "ok",
        "model": _configured_model(),
        "device": resolve_device(),
        "model_loaded": is_engine_loaded(),
    }


@app.post("/audio/transcriptions", dependencies=[Depends(require_auth)])
async def audio_transcriptions(
    file: UploadFile = File(...),
    model: str | None = Form(None),
    language: str | None = Form(None),
) -> JSONResponse:
    # NOTE: `model` is accepted for OpenAI compatibility but the server always
    # uses the model it was started with. `language`, when provided, is passed
    # through as the hint; when absent the engine auto-detects.
    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio too large (max {MAX_AUDIO_BYTES // (1024 * 1024)} MB)",
        )
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type and not content_type.startswith("audio/"):
        raise HTTPException(
            status_code=400,
            detail=f"Not an audio file (content-type: {file.content_type})",
        )

    lang_hint = (language or "").strip() or None
    try:
        # CPU-bound: keep it off the event loop.
        result = await asyncio.to_thread(transcribe_audio, content, lang_hint)
    except Exception:
        logger.exception("Transcription failed")
        raise HTTPException(status_code=500, detail="Transcription failed")

    # Privacy: log metadata only, never the transcript text.
    logger.info(
        "Transcribed audio",
        extra={
            "bytes": len(content),
            "duration_s": round(result.duration, 2) if result.duration else None,
            "language": result.language,
            "language_probability": (
                round(result.language_probability, 3)
                if result.language_probability is not None
                else None
            ),
            "chars": len(result.text),
        },
    )
    return JSONResponse({"text": result.text})
