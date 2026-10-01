#!/usr/bin/env bash
# W15: download the face-api tiny_face_detector weights (193 KB) for
# targeted face redaction. The weights are NOT committed to git —
# run this at setup (and in CI before media tests).
#
# Usage: bash scripts/download-face-models.sh [target_dir]
# Default target: <service>/models/face (== FACE_MODEL_DIR default)
set -euo pipefail

BASE_URL="${FACE_MODEL_BASE_URL:-https://raw.githubusercontent.com/vladmandic/face-api/master/model}"
TARGET="${1:-$(cd "$(dirname "$0")/.." && pwd)/models/face}"

mkdir -p "$TARGET"
cd "$TARGET"

for f in tiny_face_detector_model-weights_manifest.json tiny_face_detector_model.bin; do
  if [ ! -f "$f" ]; then
    echo "downloading $f ..."
    curl -fsSL --retry 3 -o "$f" "$BASE_URL/$f"
  else
    echo "exists: $f"
  fi
done

python3 - "$TARGET" <<'EOF'
import json, sys
d = sys.argv[1]
m = json.load(open(f"{d}/tiny_face_detector_model-weights_manifest.json"))
assert m[0]["paths"] == ["tiny_face_detector_model.bin"], "unexpected manifest"
print("manifest OK, weights present")
EOF
echo "face models ready in $TARGET"
