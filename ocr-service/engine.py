"""PaddleOCR engine wrapper for KTP field extraction.

- Lazy singleton: the OCR models download on first use (or at docker build
  time, like whisper-service).
- The raw image is decoded in memory only — never written to disk.
- Field mapping is heuristic (label-adjacent lines); accuracy is NOT
  guaranteed. Every field carries a confidence and the pipeline must
  present all pre-filled fields for explicit citizen confirmation (G2)
  before storing anything in the PII vault.
"""

from __future__ import annotations

import io
import logging
import threading
from dataclasses import dataclass, field

logger = logging.getLogger("ocr-service")

# Field names in the stable API contract.
FIELD_NAMES = [
    "nik",
    "nama",
    "tempat_lahir",
    "tanggal_lahir",
    "jenis_kelamin",
    "golongan_darah",
    "alamat",
    "rt",
    "rw",
    "kel_desa",
    "kecamatan",
    "agama",
    "status_perkawinan",
    "pekerjaan",
    "kewarganegaraan",
    "berlaku_hingga",
]

# KTP printed labels -> contract field. Order matters: longer labels first
# where one label is a prefix of another ("RT/RW" before "RT").
LABEL_MAP: list[tuple[str, str]] = [
    ("NIK", "nik"),
    ("TEMPAT/TGL LAHIR", "tempat_tgl_lahir"),
    ("TEMPAT/TGL. LAHIR", "tempat_tgl_lahir"),
    ("TEMPAT/TGL.LAHIR", "tempat_tgl_lahir"),
    ("TEMPAT / TGL LAHIR", "tempat_tgl_lahir"),
    ("TGL LAHIR", "tempat_tgl_lahir"),
    ("JENIS KELAMIN", "jenis_kelamin"),
    ("GOL. DARAH", "golongan_darah"),
    ("GOL DARAH", "golongan_darah"),
    ("RT/RW", "rt_rw"),
    ("KEL/DESA", "kel_desa"),
    ("KECAMATAN", "kecamatan"),
    ("STATUS PERKAWINAN", "status_perkawinan"),
    ("KEWARGANEGARAAN", "kewarganegaraan"),
    ("BERLAKU HINGGA", "berlaku_hingga"),
    ("NAMA", "nama"),
    ("ALAMAT", "alamat"),
    ("AGAMA", "agama"),
    ("PEKERJAAN", "pekerjaan"),
]


@dataclass
class FieldResult:
    value: str | None
    confidence: float | None


@dataclass
class KtpExtractionResult:
    fields: dict[str, FieldResult] = field(default_factory=dict)
    overall_confidence: float | None = None


_ocr = None
_ocr_lock = threading.Lock()


def get_device() -> str:
    return "cpu"


def is_model_loaded() -> bool:
    return _ocr is not None


def _get_ocr():
    """Lazy-load PaddleOCR. Raises RuntimeError (never ImportError) so the
    HTTP layer can answer 503 with a clear message."""
    global _ocr
    if _ocr is None:
        with _ocr_lock:
            if _ocr is None:
                try:
                    from paddleocr import PaddleOCR
                except ImportError as e:
                    raise RuntimeError(
                        "paddleocr is not installed; install requirements.txt "
                        "or set OCR_MODE=stub for tests"
                    ) from e
                logger.info("loading PaddleOCR (lang=id), this may download models...")
                _ocr = PaddleOCR(use_angle_cls=True, lang="id")
                logger.info("PaddleOCR loaded")
    return _ocr


def _ocr_lines(image_bytes: bytes) -> list[tuple[str, float]]:
    """Run OCR and flatten to (text, confidence) lines, sorted top-to-bottom."""
    import numpy as np

    try:
        import cv2
    except ImportError as e:
        raise RuntimeError("opencv-python is not installed") from e

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("could not decode image bytes")

    ocr = _get_ocr()
    raw = ocr.ocr(img, cls=True)
    lines: list[tuple[str, float, float]] = []  # (text, conf, y_center)
    for page in raw or []:
        for box, (text, conf) in page:
            ys = [p[1] for p in box]
            lines.append((text.strip(), float(conf), sum(ys) / len(ys)))
    lines.sort(key=lambda t: t[2])
    return [(text, conf) for text, conf, _ in lines if text]


def _value_after_colon(line: str) -> str:
    if ":" in line:
        return line.split(":", 1)[1].strip()
    return ""


def map_ktp_fields(lines: list[tuple[str, float]]) -> dict[str, FieldResult]:
    """Pure, unit-testable mapping from OCR (text, confidence) lines to KTP
    fields. Heuristic: a KTP label is followed by ': value' on the same line,
    or the value sits on the next non-label line."""
    out: dict[str, FieldResult] = {name: FieldResult(None, None) for name in FIELD_NAMES}

    def label_of(upper: str) -> str | None:
        for label, key in LABEL_MAP:
            if label in upper:
                return key
        return None

    used_next_line = False
    i = 0
    while i < len(lines):
        text, conf = lines[i]
        upper = text.upper()
        key = label_of(upper)
        i += 1
        if key is None:
            continue
        value = _value_after_colon(text)
        value_conf = conf
        if not value and i < len(lines):
            nxt, nxt_conf = lines[i]
            if label_of(nxt.upper()) is None:
                value, value_conf = nxt.strip(), min(conf, nxt_conf)
                i += 1
                used_next_line = True
        value = value.strip(" :.-")
        if not value:
            continue
        _assign(out, key, value, value_conf)
    return out


def _assign(out: dict[str, FieldResult], key: str, value: str, conf: float) -> None:
    if key == "nik":
        digits = "".join(ch for ch in value if ch.isdigit())
        out["nik"] = FieldResult(digits or None, conf)
    elif key == "tempat_tgl_lahir":
        # "KOTA, 01-01-1990" or "KOTA 01-01-1990"
        parts = [p.strip() for p in value.replace(";", ",").split(",") if p.strip()]
        if len(parts) >= 2:
            out["tempat_lahir"] = FieldResult(parts[0], conf)
            out["tanggal_lahir"] = FieldResult(parts[-1], conf)
        else:
            out["tempat_lahir"] = FieldResult(value, conf)
    elif key == "rt_rw":
        parts = [p.strip() for p in value.replace(" ", "").split("/") if p.strip()]
        if len(parts) >= 2:
            out["rt"] = FieldResult(parts[0], conf)
            out["rw"] = FieldResult(parts[1], conf)
    else:
        out[key] = FieldResult(value, conf)


def extract_ktp_fields(image_bytes: bytes) -> KtpExtractionResult:
    """Full pipeline: OCR -> field mapping -> overall confidence."""
    lines = _ocr_lines(image_bytes)
    fields = map_ktp_fields(lines)
    confs = [f.confidence for f in fields.values() if f.value and f.confidence is not None]
    overall = sum(confs) / len(confs) if confs else None
    return KtpExtractionResult(fields=fields, overall_confidence=overall)
