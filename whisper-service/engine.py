"""Transcription engine — faster-whisper wrapper.

Separated from the HTTP layer (app.py) so unit tests can stub
``transcribe_audio`` / ``get_engine`` without downloading any model.
"""

from __future__ import annotations

import io
import logging
import os
import threading
from dataclasses import dataclass

logger = logging.getLogger("whisper-service.engine")


@dataclass
class TranscriptionResult:
    text: str
    language: str | None
    language_probability: float | None
    duration: float | None


_engine = None
_engine_lock = threading.Lock()


def resolve_device() -> str:
    """Resolve the effective device: env override, else CUDA if present, else CPU."""
    requested = os.environ.get("WHISPER_DEVICE", "auto").strip().lower()
    if requested in ("cpu", "cuda"):
        return requested
    # "auto": prefer CUDA when available.
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda"
    except Exception:  # pragma: no cover - defensive
        logger.debug("CUDA detection failed, falling back to cpu", exc_info=True)
    return "cpu"


def resolve_compute_type(device: str) -> str:
    """Sane default per device; explicit env always wins."""
    override = os.environ.get("WHISPER_COMPUTE_TYPE", "").strip()
    if override:
        return override
    return "float16" if device == "cuda" else "int8"


def get_engine():
    """Thread-safe lazy singleton. Loads the model exactly once."""
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                from faster_whisper import WhisperModel

                model_name = os.environ.get("WHISPER_MODEL", "large-v3-turbo").strip()
                device = resolve_device()
                compute_type = resolve_compute_type(device)
                download_root = os.environ.get("WHISPER_DOWNLOAD_ROOT") or None
                logger.info(
                    "Loading faster-whisper model",
                    extra={
                        "model": model_name,
                        "device": device,
                        "compute_type": compute_type,
                    },
                )
                _engine = WhisperModel(
                    model_name,
                    device=device,
                    compute_type=compute_type,
                    download_root=download_root,
                )
                logger.info("faster-whisper model loaded")
    return _engine


def is_engine_loaded() -> bool:
    return _engine is not None


def transcribe_audio(audio_bytes: bytes, language: str | None = None) -> TranscriptionResult:
    """Transcribe raw audio bytes.

    ``language``: ISO-639-1 hint (e.g. "id"). When None, faster-whisper
    auto-detects the language — this is the correct default for voice notes
    that may be in Indonesian or a regional language.
    """
    model = get_engine()
    segments, info = model.transcribe(
        io.BytesIO(audio_bytes),
        language=language,
        vad_filter=True,  # drop silence; voice notes are rarely clean audio
    )
    text = "".join(seg.text for seg in segments).strip()
    # Privacy: never log the transcript content here; the caller logs metadata only.
    return TranscriptionResult(
        text=text,
        language=getattr(info, "language", None),
        language_probability=getattr(info, "language_probability", None),
        duration=getattr(info, "duration", None),
    )
