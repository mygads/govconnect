# W15 targeted face blur — POC result & decision (2026-10-01)

Status: **PASS — integrated** (graceful degradation kept).

## Candidates evaluated

| # | Candidate | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | MediaPipe face detection (WASM) | NOT FEASIBLE | Previous worker: fails inside WASM — needs WebGL2 (`_emscripten_webgl_do_create_context` error). |
| 2 | `@vladmandic/face-api` node-wasm + tfjs WASM backend | **FEASIBLE — chosen** | POC below. Pure WASM on CPU, no native build, no WebGL. |
| 3 | opencv4nodejs | NOT EVALUATED FURTHER (deemed not layak) | Needs heavy native build (~100 MB+, node-gyp toolchain); overkill when #2 works. Noted only. |
| 4 | Vision-LLM bounding-box round-trip | REJECTED | 1 extra LLM call per image — cost/latency not approved for the MVP path. |
| 5 | `@xenova/transformers` face model | REJECTED | ~100 MB+ model download; heavier than needed when #2 works. |

## POC results (candidate #2)

- Packages: `@vladmandic/face-api@1.7.15` + `@tensorflow/tfjs-backend-wasm@4.22.0` + `@tensorflow/tfjs@4.22.0`
  (the node-wasm bundle `require()`s the umbrella `@tensorflow/tfjs` package — it must be
  installed explicitly; backend-wasm alone is NOT enough).
- Model: `tiny_face_detector` weights, 193 KB (manifest + 1 shard), fetched at setup time from
  github.com/vladmandic/face-api — **never committed to git** (`.gitignore`: `models/`).
- Accuracy (rough, 2 samples): Lena 512×512 → 1/1 face, score 0.773; generated village
  group photo 1920×1280 (3 people) → 3/3 faces, scores 0.83–0.95, boxes verified
  visually to sit tightly on the faces (annotated check done during POC).
- Latency on this VM's CPU (tfjs WASM backend):
  - full-res 1920px: ~800–1700 ms (first run includes warmup)
  - detection downscale to 640px: **~200 ms warmed**, still 3/3 faces
  - 416px: ~210–480 ms, 3/3 faces
- Design choice: detect on ≤640px downscale, scale boxes back to original resolution,
  blur each region with 20% padding via sharp. Added intake latency ≈ 200–500 ms per image.

## Integration

- `govconnect-ai-service/src/pipeline/face-detection.ts` — lazy singleton `detectFaces()`.
  Returns `FaceBox[]` (original-res coords), `[]` when no faces, **`null` on any failure**
  (missing model, backend failure, undecodable image) — never throws.
- `blurImageRegions()` in `src/pipeline/media-perceptual.ts` — sharp region blur with
  padding + clamping; fails soft to null.
- `media-pipeline.ts` (INGRESS, `MEDIA_REDACT_MODE=blur`): tries targeted face blur first;
  on null/empty/blur-failure falls back to the existing whole-image `blurImage()`.
  Audit payload now records `redactDetail: 'targeted_faces' | 'whole_image' | 'none'`
  and `faceCount` so the fallback is observable, not silent.
- KTP/identity documents remain NEVER blurred (unchanged).
- Model setup: `scripts/download-face-models.sh` (default dir `<service>/models/face`,
  overridable via `FACE_MODEL_DIR`; kill-switch via `FACE_DETECTION_ENABLED=false`).
- Tests: `src/pipeline/__tests__/face-detection.test.ts` — 6/6 pass (model-dependent
  tests skip gracefully when `FACE_MODEL_DIR` is absent).

## What is still NOT done

- **License-plate detection**: no plate model vetted; plates still rely on whole-image blur.
  Upgrade criterion: vet a WASM/ONNX plate detector (e.g. a small YOLO-license-plate ONNX
  via onnxruntime-node) with a real-photo accuracy check like this one.
- **Upgrade criterion for the face side**: if a future model beats tiny_face_detector on
  small/angled faces at ≤300 ms CPU with ≤5 MB weights, swap `detectFaces()`'s backend —
  the pipeline contract (`FaceBox[] | null`) stays the same.
