"""On-prem KTP OCR sidecar.

FastAPI service that runs PaddleOCR locally (CPU) and extracts structured
fields from Indonesian KTP (Kartu Tanda Penduduk) photos.

PRIVACY (UU PDP): the raw image never leaves this host; field VALUES are
never logged — only field names and confidences. The pipeline treats every
extracted field as an UNVERIFIED pre-fill: low-confidence or invalid fields
are dropped, and the citizen must explicitly confirm (G2) before anything
is stored in the PII vault.

API:
  GET  /health   -> {"status","engine","model_loaded"}
  POST /ocr/ktp  (multipart "file") -> {"fields": {nik: {value, confidence}, ...},
                                        "overall_confidence": float|null,
                                        "engine": "paddleocr"}
Auth: optional Bearer token via OCR_API_KEY (empty = dev mode).
"""

from __future__ import annotations

import io
import logging
import os

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from engine import extract_ktp_fields, is_model_loaded, get_device

logger = logging.getLogger("ocr-service")

API_KEY = os.environ.get("OCR_API_KEY", "")
MAX_IMAGE_MB = float(os.environ.get("OCR_MAX_IMAGE_MB", "10"))
ALLOWED_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}

app = FastAPI(title="govconnect-ocr-service", version="0.1.0")
bearer = HTTPBearer(auto_error=False)


def check_auth(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> None:
    if not API_KEY:
        return  # dev mode: auth disabled
    if creds is None or creds.scheme.lower() != "bearer" or creds.credentials != API_KEY:
        raise HTTPException(status_code=401, detail="invalid bearer token")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "engine": "paddleocr",
        "device": get_device(),
        "model_loaded": is_model_loaded(),
    }


@app.post("/ocr/ktp", dependencies=[Depends(check_auth)])
async def ocr_ktp(file: UploadFile = File(...)) -> dict:
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"unsupported content type: {file.content_type}",
        )
    image_bytes = await file.read()
    max_bytes = int(MAX_IMAGE_MB * 1024 * 1024)
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="empty file")
    if len(image_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"image too large: {len(image_bytes)} bytes > {max_bytes}",
        )
    try:
        result = extract_ktp_fields(image_bytes)
    except RuntimeError as e:
        # Engine not installed / model failed to load: 503, not a silent lie.
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:  # noqa: BLE001 - never leak internals
        logger.exception("ocr failed")
        raise HTTPException(status_code=500, detail="ocr failed")

    # PRIVACY: log field NAMES + confidences only — never values.
    present = {k: f.confidence for k, f in result.fields.items() if f.value}
    logger.info(
        "ocr_ktp done: %d/%d fields extracted (names+conf only)",
        len(present),
        len(result.fields),
        extra={"fields": present},
    )
    return {
        "fields": {
            name: {"value": f.value, "confidence": f.confidence}
            for name, f in result.fields.items()
        },
        "overall_confidence": result.overall_confidence,
        "engine": "paddleocr",
    }
