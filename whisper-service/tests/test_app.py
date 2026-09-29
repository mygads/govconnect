"""Tests for whisper-service.

No test downloads a real model. The engine is stubbed via monkeypatching
``app.transcribe_audio``. One opt-in slow test (marked ``slow``) exercises a
real tiny model and is skipped unless WHISPER_RUN_SLOW_TESTS=1.
"""

import os

import pytest
from fastapi.testclient import TestClient

import app
import engine
from engine import TranscriptionResult

TEST_KEY = "test-secret-key"
SAMPLE_OGG = b"OggS" + bytes(4096)  # fake but non-empty audio payload


def make_client() -> TestClient:
    return TestClient(app.app)


def stub_transcribe(monkeypatch, calls: dict, text: str = "jalan rusak di rt dua") -> None:
    def fake(audio_bytes: bytes, language=None):
        calls["audio_len"] = len(audio_bytes)
        calls["language"] = language
        return TranscriptionResult(
            text=text, language="id", language_probability=0.97, duration=3.2
        )

    monkeypatch.setattr(app, "transcribe_audio", fake)


def auth_headers():
    return {"Authorization": f"Bearer {TEST_KEY}"}


# ---------------------------------------------------------------- health ---

def test_health_ok_without_model_loaded():
    client = make_client()
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model"] == os.environ.get("WHISPER_MODEL", "large-v3-turbo")
    assert body["device"] in ("cpu", "cuda")
    assert body["model_loaded"] is False  # no lazy load on health


def test_health_no_auth_required_even_when_key_set(monkeypatch):
    monkeypatch.setenv("WHISPER_API_KEY", TEST_KEY)
    client = make_client()
    r = client.get("/health")
    assert r.status_code == 200


# ------------------------------------------------------------------ auth ---

def test_transcribe_401_without_header_when_key_set(monkeypatch):
    monkeypatch.setenv("WHISPER_API_KEY", TEST_KEY)
    client = make_client()
    r = client.post(
        "/audio/transcriptions",
        files={"file": ("voice.ogg", SAMPLE_OGG, "audio/ogg")},
        data={"model": "whisper-1"},
    )
    assert r.status_code == 401


def test_transcribe_401_with_wrong_key(monkeypatch):
    monkeypatch.setenv("WHISPER_API_KEY", TEST_KEY)
    client = make_client()
    r = client.post(
        "/audio/transcriptions",
        files={"file": ("voice.ogg", SAMPLE_OGG, "audio/ogg")},
        headers={"Authorization": "Bearer wrong-key"},
    )
    assert r.status_code == 401


def test_transcribe_ok_with_correct_key(monkeypatch):
    monkeypatch.setenv("WHISPER_API_KEY", TEST_KEY)
    calls: dict = {}
    stub_transcribe(monkeypatch, calls)
    client = make_client()
    r = client.post(
        "/audio/transcriptions",
        files={"file": ("voice.ogg", SAMPLE_OGG, "audio/ogg")},
        data={"model": "whisper-1"},
        headers=auth_headers(),
    )
    assert r.status_code == 200
    assert r.json() == {"text": "jalan rusak di rt dua"}
    assert calls["audio_len"] == len(SAMPLE_OGG)


def test_transcribe_no_auth_when_key_empty(monkeypatch):
    monkeypatch.setenv("WHISPER_API_KEY", "")
    calls: dict = {}
    stub_transcribe(monkeypatch, calls)
    client = make_client()
    r = client.post(
        "/audio/transcriptions",
        files={"file": ("voice.ogg", SAMPLE_OGG, "audio/ogg")},
        data={"model": "whisper-1"},
    )
    assert r.status_code == 200
    assert r.json()["text"]


# ------------------------------------------------------- multipart contract ---

def test_language_hint_forwarded_when_provided(monkeypatch):
    """Mirrors the ai-service client when WHISPER_LANGUAGE is configured."""
    monkeypatch.delenv("WHISPER_API_KEY", raising=False)
    calls: dict = {}
    stub_transcribe(monkeypatch, calls)
    client = make_client()
    r = client.post(
        "/audio/transcriptions",
        files={"file": ("voice.ogg", SAMPLE_OGG, "audio/ogg")},
        data={"model": "whisper-1", "language": "id"},
    )
    assert r.status_code == 200
    assert calls["language"] == "id"


def test_language_none_when_not_provided(monkeypatch):
    """Mirrors the ai-service client default: no language field -> auto-detect."""
    monkeypatch.delenv("WHISPER_API_KEY", raising=False)
    calls: dict = {}
    stub_transcribe(monkeypatch, calls)
    client = make_client()
    r = client.post(
        "/audio/transcriptions",
        files={"file": ("voice.ogg", SAMPLE_OGG, "audio/ogg")},
        data={"model": "whisper-1"},
    )
    assert r.status_code == 200
    assert calls["language"] is None


def test_model_field_accepted_but_ignored(monkeypatch):
    """Server always uses its loaded model; the field exists for compatibility."""
    monkeypatch.delenv("WHISPER_API_KEY", raising=False)
    calls: dict = {}
    stub_transcribe(monkeypatch, calls)
    client = make_client()
    r = client.post(
        "/audio/transcriptions",
        files={"file": ("voice.ogg", SAMPLE_OGG, "audio/ogg")},
        data={"model": "some-other-model"},
    )
    assert r.status_code == 200
    assert r.json()["text"]


def test_empty_file_400(monkeypatch):
    monkeypatch.delenv("WHISPER_API_KEY", raising=False)
    client = make_client()
    r = client.post(
        "/audio/transcriptions",
        files={"file": ("voice.ogg", b"", "audio/ogg")},
        data={"model": "whisper-1"},
    )
    assert r.status_code == 400


def test_non_audio_content_type_400(monkeypatch):
    monkeypatch.delenv("WHISPER_API_KEY", raising=False)
    client = make_client()
    r = client.post(
        "/audio/transcriptions",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
        data={"model": "whisper-1"},
    )
    assert r.status_code == 400


def test_oversize_413(monkeypatch):
    monkeypatch.delenv("WHISPER_API_KEY", raising=False)
    monkeypatch.setattr(app, "MAX_AUDIO_BYTES", 16)  # tiny limit for the test
    client = make_client()
    r = client.post(
        "/audio/transcriptions",
        files={"file": ("voice.ogg", b"OggS" + bytes(64), "audio/ogg")},
        data={"model": "whisper-1"},
    )
    assert r.status_code == 413


def test_engine_error_500(monkeypatch):
    monkeypatch.delenv("WHISPER_API_KEY", raising=False)

    def boom(audio_bytes: bytes, language=None):
        raise RuntimeError("engine exploded")

    monkeypatch.setattr(app, "transcribe_audio", boom)
    client = make_client()
    r = client.post(
        "/audio/transcriptions",
        files={"file": ("voice.ogg", SAMPLE_OGG, "audio/ogg")},
        data={"model": "whisper-1"},
    )
    assert r.status_code == 500


# ------------------------------------------------------- engine unit tests ---

def test_resolve_device_cpu_default(monkeypatch):
    monkeypatch.delenv("WHISPER_DEVICE", raising=False)
    # VM has no CUDA; auto must resolve to cpu.
    assert engine.resolve_device() == "cpu"


def test_resolve_device_explicit(monkeypatch):
    monkeypatch.setenv("WHISPER_DEVICE", "cpu")
    assert engine.resolve_device() == "cpu"


def test_resolve_compute_type_defaults(monkeypatch):
    monkeypatch.delenv("WHISPER_COMPUTE_TYPE", raising=False)
    assert engine.resolve_compute_type("cpu") == "int8"
    assert engine.resolve_compute_type("cuda") == "float16"


def test_resolve_compute_type_override(monkeypatch):
    monkeypatch.setenv("WHISPER_COMPUTE_TYPE", "int8_float32")
    assert engine.resolve_compute_type("cuda") == "int8_float32"


# ------------------------------------------------- slow integration (opt-in) ---

@pytest.mark.slow
def test_transcribe_real_tiny_model(tmp_path):
    """Opt-in only: WHISPER_RUN_SLOW_TESTS=1. Downloads the tiny model (~75MB)."""
    if os.environ.get("WHISPER_RUN_SLOW_TESTS") != "1":
        pytest.skip("set WHISPER_RUN_SLOW_TESTS=1 to run the real-model test")
    import math
    import struct
    import wave

    wav_path = tmp_path / "tone.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        frames = b"".join(
            struct.pack(
                "<h",
                int(math.sin(2 * math.pi * 440 * i / 16000) * 16000),
            )
            for i in range(16000)
        )
        w.writeframes(frames)

    from faster_whisper import WhisperModel

    model = WhisperModel("tiny", device="cpu", compute_type="int8")
    segments, info = model.transcribe(str(wav_path), vad_filter=True)
    text = "".join(s.text for s in segments).strip()
    assert isinstance(text, str)
    assert info.duration is not None
