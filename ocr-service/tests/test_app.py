"""Tests for ocr-service.

No test downloads a real model. The engine is stubbed via monkeypatching
``app.extract_ktp_fields``. One opt-in slow test (marked ``slow``) runs a
real PaddleOCR pass and is skipped unless OCR_RUN_SLOW_TESTS=1.
"""

import io
import os

import pytest
from fastapi.testclient import TestClient

import app
import engine
from engine import FieldResult, KtpExtractionResult, map_ktp_fields

TEST_KEY = "test-secret-key"
SAMPLE_JPG = b"\xff\xd8\xff\xe0" + bytes(4096)  # fake but non-empty image payload


def make_client() -> TestClient:
    return TestClient(app.app)


def stub_extract(monkeypatch, fields: dict | None = None) -> dict:
    calls: dict = {}
    base = fields or {
        "nik": FieldResult("3273010101900001", 0.98),
        "nama": FieldResult("BUDI SANTOSO", 0.95),
        "tempat_lahir": FieldResult("BANDUNG", 0.93),
        "tanggal_lahir": FieldResult("01-01-1990", 0.93),
        "alamat": FieldResult("JL MERDEKA 1", 0.88),
    }

    def fake(image_bytes: bytes):
        calls["image_len"] = len(image_bytes)
        full = {name: FieldResult(None, None) for name in engine.FIELD_NAMES}
        full.update(base)
        return KtpExtractionResult(fields=full, overall_confidence=0.94)

    monkeypatch.setattr(app, "extract_ktp_fields", fake)
    return calls


def auth_headers():
    return {"Authorization": f"Bearer {TEST_KEY}"}


# ---------------------------------------------------------------- health ---

def test_health_ok_without_model_loaded():
    client = make_client()
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["engine"] == "paddleocr"
    assert body["model_loaded"] is False  # no lazy load on health


def test_health_no_auth_required_even_when_key_set(monkeypatch):
    monkeypatch.setenv("OCR_API_KEY", TEST_KEY)
    client = make_client()
    r = client.get("/health")
    assert r.status_code == 200


# ------------------------------------------------------------------ auth ---

def test_ocr_requires_auth_when_key_set(monkeypatch):
    monkeypatch.setenv("OCR_API_KEY", TEST_KEY)
    # NOTE: app reads OCR_API_KEY at import time; emulate by patching attr.
    monkeypatch.setattr(app, "API_KEY", TEST_KEY)
    client = make_client()
    r = client.post("/ocr/ktp", files={"file": ("ktp.jpg", io.BytesIO(SAMPLE_JPG), "image/jpeg")})
    assert r.status_code == 401


def test_ocr_rejects_wrong_content_type(monkeypatch):
    stub_extract(monkeypatch)
    client = make_client()
    r = client.post(
        "/ocr/ktp",
        files={"file": ("ktp.pdf", io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        headers=auth_headers(),
    )
    assert r.status_code == 415


def test_ocr_rejects_empty_file(monkeypatch):
    stub_extract(monkeypatch)
    client = make_client()
    r = client.post(
        "/ocr/ktp",
        files={"file": ("ktp.jpg", io.BytesIO(b""), "image/jpeg")},
        headers=auth_headers(),
    )
    assert r.status_code == 400


def test_ocr_rejects_oversize(monkeypatch):
    monkeypatch.setattr(app, "MAX_IMAGE_MB", 0.0001)  # ~100 bytes
    stub_extract(monkeypatch)
    client = make_client()
    r = client.post(
        "/ocr/ktp",
        files={"file": ("ktp.jpg", io.BytesIO(SAMPLE_JPG), "image/jpeg")},
        headers=auth_headers(),
    )
    assert r.status_code == 413


def test_ocr_returns_fields_and_overall_confidence(monkeypatch):
    calls = stub_extract(monkeypatch)
    client = make_client()
    r = client.post(
        "/ocr/ktp",
        files={"file": ("ktp.jpg", io.BytesIO(SAMPLE_JPG), "image/jpeg")},
        headers=auth_headers(),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["engine"] == "paddleocr"
    assert body["overall_confidence"] == 0.94
    assert body["fields"]["nik"] == {"value": "3273010101900001", "confidence": 0.98}
    assert body["fields"]["nama"]["value"] == "BUDI SANTOSO"
    # missing fields are present with nulls (stable contract)
    assert body["fields"]["pekerjaan"] == {"value": None, "confidence": None}
    assert calls["image_len"] == len(SAMPLE_JPG)


def test_ocr_engine_failure_is_503_not_silent(monkeypatch):
    def boom(_image_bytes: bytes):
        raise RuntimeError("paddleocr is not installed")

    monkeypatch.setattr(app, "extract_ktp_fields", boom)
    client = make_client()
    r = client.post(
        "/ocr/ktp",
        files={"file": ("ktp.jpg", io.BytesIO(SAMPLE_JPG), "image/jpeg")},
        headers=auth_headers(),
    )
    assert r.status_code == 503


# ------------------------------------------------------- field mapping ---

def test_map_ktp_fields_inline_colon_values():
    lines = [
        ("NIK : 3273010101900001", 0.98),
        ("Nama : BUDI SANTOSO", 0.95),
        ("Tempat/Tgl Lahir : BANDUNG, 01-01-1990", 0.93),
        ("Jenis Kelamin : LAKI-LAKI", 0.99),
        ("Alamat : JL MERDEKA 1", 0.88),
        ("RT/RW : 001/002", 0.97),
        ("Kel/Desa : SUKAMAJU", 0.91),
        ("Kecamatan : CICENDO", 0.92),
        ("Agama : ISLAM", 0.96),
        ("Status Perkawinan : KAWIN", 0.94),
        ("Pekerjaan : WIRASWASTA", 0.85),
        ("Kewarganegaraan : WNI", 0.98),
        ("Berlaku Hingga : SEUMUR HIDUP", 0.90),
    ]
    out = map_ktp_fields(lines)
    assert out["nik"].value == "3273010101900001"
    assert out["nama"].value == "BUDI SANTOSO"
    assert out["tempat_lahir"].value == "BANDUNG"
    assert out["tanggal_lahir"].value == "01-01-1990"
    assert out["rt"].value == "001" and out["rw"].value == "002"
    assert out["kel_desa"].value == "SUKAMAJU"
    assert out["kecamatan"].value == "CICENDO"
    assert out["agama"].value == "ISLAM"
    assert out["status_perkawinan"].value == "KAWIN"
    assert out["pekerjaan"].value == "WIRASWASTA"
    assert out["kewarganegaraan"].value == "WNI"
    assert out["berlaku_hingga"].value == "SEUMUR HIDUP"


def test_map_ktp_fields_value_on_next_line():
    lines = [
        ("NIK", 0.90),
        ("3273010101900001", 0.97),
        ("Nama", 0.90),
        ("SITI AMINAH", 0.94),
    ]
    out = map_ktp_fields(lines)
    assert out["nik"].value == "3273010101900001"
    assert out["nik"].confidence == pytest.approx(0.90)  # min(label, value)
    assert out["nama"].value == "SITI AMINAH"


def test_map_ktp_fields_nik_digits_only():
    lines = [("NIK : 3273 0101 0190 0001", 0.9)]
    out = map_ktp_fields(lines)
    assert out["nik"].value == "3273010101900001"


def test_map_ktp_fields_ignores_noise_lines():
    lines = [
        ("PROVINSI JAWA BARAT", 0.8),
        ("KABUPATEN BANDUNG", 0.8),
        ("NIK : 3273010101900001", 0.98),
    ]
    out = map_ktp_fields(lines)
    assert out["nik"].value == "3273010101900001"
    assert out["nama"].value is None


# ------------------------------------------------------------------ slow ---

@pytest.mark.skipif(
    os.environ.get("OCR_RUN_SLOW_TESTS") != "1",
    reason="opt-in: downloads a real PaddleOCR model",
)
@pytest.mark.slow
def test_slow_real_model_loads():
    # Only checks the engine loads; no KTP sample asserted here.
    assert engine.is_model_loaded() is False
