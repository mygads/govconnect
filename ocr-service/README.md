# govconnect OCR service (R14)

On-prem KTP OCR sidecar. Runs PaddleOCR locally on CPU; the raw image and
extracted field values never leave this host. Mirrors `whisper-service/`.

## Endpoints

- `GET /health` — no auth, does NOT load the model.
- `POST /ocr/ktp` — multipart `file` (jpeg/png/webp, ≤ `OCR_MAX_IMAGE_MB`,
  default 10). Optional Bearer auth via `OCR_API_KEY` (empty = dev mode).

Response:

```json
{
  "fields": {
    "nik":            {"value": "3273010101900001", "confidence": 0.98},
    "nama":           {"value": "BUDI SANTOSO",     "confidence": 0.95},
    "tempat_lahir":   {"value": "BANDUNG",          "confidence": 0.93},
    "tanggal_lahir":  {"value": "01-01-1990",       "confidence": 0.93},
    "jenis_kelamin":  {"value": "LAKI-LAKI",        "confidence": 0.99},
    "golongan_darah": {"value": "O",                "confidence": 0.90},
    "alamat":         {"value": "JL MERDEKA 1",     "confidence": 0.88},
    "rt":             {"value": "001",              "confidence": 0.97},
    "rw":             {"value": "002",              "confidence": 0.97},
    "kel_desa":       {"value": "SUKAMAJU",         "confidence": 0.91},
    "kecamatan":      {"value": "CICENDO",          "confidence": 0.92},
    "agama":          {"value": "ISLAM",            "confidence": 0.96},
    "status_perkawinan": {"value": "KAWIN",         "confidence": 0.94},
    "pekerjaan":      {"value": "WIRASWASTA",       "confidence": 0.85},
    "kewarganegaraan":{"value": "WNI",               "confidence": 0.98},
    "berlaku_hingga": {"value": "SEUMUR HIDUP",     "confidence": 0.90}
  },
  "overall_confidence": 0.93,
  "engine": "paddleocr"
}
```

Missing fields come back as `{"value": null, "confidence": null}`.

## Privacy (UU PDP)

- Field VALUES are never logged — logs carry field names + confidences only.
- The image is decoded in memory; never written to disk.
- The AI service treats every field as an **unverified pre-fill**:
  - `nik` must be exactly 16 digits or it is dropped,
  - `tanggal_lahir` must parse as `DD-MM-YYYY` or it is dropped,
  - low-confidence fields (`< OCR_MIN_CONFIDENCE`, default 0.6) are dropped,
  - everything that survives is shown to the citizen for **explicit G2
    confirmation** before anything enters the PII vault.

## Env

| Var | Default | Meaning |
|---|---|---|
| `OCR_API_KEY` | "" | Bearer token; empty disables auth (dev only) |
| `OCR_MAX_IMAGE_MB` | 10 | Max upload size |
| `PADDLE_HOME` | — | PaddleOCR model cache dir (set in Docker) |

## Tests

```bash
pip install -r requirements.txt
python -m pytest -m "not slow"     # no model download
python -m pytest -m slow           # real PaddleOCR model (~100 MB)
```

## Status (2026-09-29)

Scaffold + field-mapping tested with stubbed OCR output. Real-model
verification (PaddleOCR install + KTP sample) is still pending — tracked as
an open item until a KTP sample OCR run passes.
