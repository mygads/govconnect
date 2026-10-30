/**
 * W15 face detection (targeted redaction).
 *
 * Runs @vladmandic/face-api (node-wasm build) on the tfjs WASM backend —
 * pure WebAssembly on CPU, no native build, no WebGL required. The
 * 193 KB tiny_face_detector weights are NOT committed to git; they are
 * fetched at setup/test time (see scripts/download-face-models.sh) and
 * resolved via FACE_MODEL_DIR.
 *
 * Design rules (graceful degradation):
 * - detectFaces() NEVER throws into the caller. It returns null when
 *   detection is unavailable/failed → the caller falls back to the
 *   existing whole-image blur. It returns [] when detection ran but found
 *   no faces.
 * - Detection runs on a ≤640px downscale of the input (POC: ~200 ms on
 *   this VM's CPU, 3/3 faces on the group-photo sample); boxes are scaled
 *   back to the original resolution before region blurring.
 * - All heavy imports are lazy so a missing dependency degrades to null
 *   instead of crashing module load.
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

/** Max width (px) of the image fed to the detector. POC-verified. */
const DETECT_MAX_WIDTH = Number(process.env.FACE_DETECT_MAX_WIDTH ?? 640);
/** Score threshold for tiny_face_detector. POC-verified at 0.4. */
const SCORE_THRESHOLD = Number(process.env.FACE_DETECT_SCORE_THRESHOLD ?? 0.4);

function modelDir(): string {
  const fromEnv = process.env.FACE_MODEL_DIR;
  if (fromEnv && fromEnv.trim().length > 0) return path.resolve(fromEnv);
  return path.join(process.cwd(), 'models', 'face');
}

type FaceApiModule = typeof import('@vladmandic/face-api/dist/face-api.node-wasm');

interface DetectorState {
  initialized: boolean;
  available: boolean;
  faceapi: FaceApiModule | null;
  tf: typeof import('@tensorflow/tfjs') | null;
  origWidth: number;
  origHeight: number;
}

const state: DetectorState = {
  initialized: false,
  available: false,
  faceapi: null,
  tf: null,
  origWidth: 0,
  origHeight: 0,
};

let loggedUnavailable = false;
function logUnavailableOnce(reason: string): void {
  if (loggedUnavailable) return;
  loggedUnavailable = true;
  logger.warn('[face-detection] face detection unavailable → whole-image blur fallback', { reason });
}

/**
 * Lazy-init the detector. Returns true when detection is ready.
 * Never throws.
 */
async function ensureReady(): Promise<boolean> {
  if (state.initialized) return state.available;
  state.initialized = true;

  if (process.env.FACE_DETECTION_ENABLED === 'false') {
    logUnavailableOnce('FACE_DETECTION_ENABLED=false');
    return false;
  }

  const dir = modelDir();
  const manifest = path.join(dir, 'tiny_face_detector_model-weights_manifest.json');
  if (!fs.existsSync(manifest)) {
    logUnavailableOnce(`model manifest missing at ${manifest} (run scripts/download-face-models.sh)`);
    return false;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setWasmPaths } = require('@tensorflow/tfjs-backend-wasm') as {
      setWasmPaths: (p: string) => void;
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wasmPkg = require.resolve('@tensorflow/tfjs-backend-wasm/package.json') as string;
    setWasmPaths(path.join(path.dirname(wasmPkg), 'wasm-out/'));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tf = require('@tensorflow/tfjs') as typeof import('@tensorflow/tfjs');
    const backendOk = await tf.setBackend('wasm').catch(() => false);
    if (!backendOk) {
      logUnavailableOnce('tfjs wasm backend failed to initialize');
      return false;
    }
    await tf.ready();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js') as FaceApiModule;
    const t0 = Date.now();
    await faceapi.nets.tinyFaceDetector.loadFromDisk(dir);
    state.faceapi = faceapi;
    state.tf = tf;
    state.available = true;
    logger.info('[face-detection] ready', { modelDir: dir, loadMs: Date.now() - t0 });
    return true;
  } catch (err) {
    logUnavailableOnce(String((err as Error)?.message ?? err).slice(0, 160));
    state.faceapi = null;
    state.tf = null;
    return false;
  }
}

/** True when the detector initialized successfully (after a first detectFaces call). */
export function isFaceDetectionAvailable(): boolean {
  return state.initialized && state.available;
}

/**
 * Detect faces in an image buffer.
 * @returns boxes in ORIGINAL image coordinates, [] when no faces, null when
 *          detection is unavailable or failed (caller must fall back to
 *          whole-image blur). Never throws.
 */
export async function detectFaces(buf: Buffer): Promise<FaceBox[] | null> {
  if (!(await ensureReady())) return null;
  const faceapi = state.faceapi;
  const tf = state.tf;
  if (!faceapi || !tf) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp') as typeof import('sharp');
    const meta = await sharp(buf).metadata();
    const origW = meta.width ?? 0;
    const origH = meta.height ?? 0;
    if (!origW || !origH) return null;

    const scale = origW > DETECT_MAX_WIDTH ? DETECT_MAX_WIDTH / origW : 1;
    const detW = Math.max(1, Math.round(origW * scale));
    const { data, info } = await sharp(buf)
      .resize({ width: detW })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const input = tf.tensor3d(Array.from(data), [info.height, info.width, info.channels], 'int32');
    try {
      const t0 = Date.now();
      const detections = await faceapi.detectAllFaces(
        input,
        new faceapi.TinyFaceDetectorOptions({ scoreThreshold: SCORE_THRESHOLD }),
      );
      const boxes: FaceBox[] = detections.map((d) => ({
        x: Math.max(0, Math.round(d.box.x / scale)),
        y: Math.max(0, Math.round(d.box.y / scale)),
        width: Math.round(d.box.width / scale),
        height: Math.round(d.box.height / scale),
        score: d.score,
      }));
      logger.debug('[face-detection] done', {
        faces: boxes.length,
        ms: Date.now() - t0,
        detectWidth: info.width,
      });
      return boxes;
    } finally {
      input.dispose();
    }
  } catch (err) {
    logger.debug('[face-detection] detection failed → null', {
      error: String((err as Error)?.message ?? err).slice(0, 120),
    });
    return null;
  }
}
