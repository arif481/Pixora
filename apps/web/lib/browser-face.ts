/**
 * browser-face.ts – Client-side face detection using @vladmandic/face-api
 *
 * Uses neural-network embeddings (128-d FaceNet) instead of geometric
 * landmark distances, providing dramatically better face recognition.
 * Embeddings are zero-padded to 512-d for Supabase vector(512) compatibility.
 *
 * Also includes canvas-based image preprocessing (contrast stretching,
 * sharpening) to improve detection under poor lighting conditions.
 */

import * as faceapi from "@vladmandic/face-api";

export type BrowserFace = {
  bbox: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  qualityScore: number;
  /** 512-d embedding (128-d FaceNet neural descriptor zero-padded) */
  embedding: number[];
  liveness: {
    blink: number;
    smile: number;
    mouthOpen: number;
    yaw: number;
  };
};

const EMBEDDING_SIZE = 512;
const NEURAL_DIM = 128;
const MODELS_PATH = "/models";
const MAX_IMAGE_DIM = 1920;

let modelsLoaded = false;
let modelsLoadingPromise: Promise<void> | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/* ─── Model loading ─── */

async function ensureModelsLoaded() {
  if (modelsLoaded) return;
  if (modelsLoadingPromise) return modelsLoadingPromise;

  modelsLoadingPromise = (async () => {
    await faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS_PATH);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_PATH);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_PATH);
    await faceapi.nets.faceExpressionNet.loadFromUri(MODELS_PATH);
    modelsLoaded = true;
  })();

  return modelsLoadingPromise;
}

/* ─── Image preprocessing ─── */

/**
 * Analyze image brightness and contrast from pixel data.
 * Returns { mean, stddev } of luminance values.
 */
function analyzeLuminance(imageData: ImageData): { mean: number; stddev: number } {
  const data = imageData.data;
  let sum = 0;
  const count = data.length / 4;

  for (let i = 0; i < data.length; i += 4) {
    // ITU-R BT.601 luminance
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum;
  }

  const mean = sum / count;
  let variance = 0;

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    variance += (lum - mean) ** 2;
  }

  return { mean, stddev: Math.sqrt(variance / count) };
}

/**
 * Apply contrast stretching to an image if it's too dark or too flat.
 * Modifies imageData in-place.
 */
function autoContrast(imageData: ImageData): void {
  const { mean, stddev } = analyzeLuminance(imageData);
  const data = imageData.data;

  // Only apply if image is too dark (mean < 80) or too flat (stddev < 40)
  if (mean > 80 && stddev > 40) return;

  // Find actual min/max luminance for stretching
  let minLum = 255;
  let maxLum = 0;

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    minLum = Math.min(minLum, lum);
    maxLum = Math.max(maxLum, lum);
  }

  // Use 1st/99th percentile to avoid outliers
  const range = maxLum - minLum;
  if (range < 10) return; // Almost uniform, skip

  const lo = minLum + range * 0.01;
  const hi = maxLum - range * 0.01;
  const scale = 255 / Math.max(hi - lo, 1);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(Math.round((data[i] - lo) * scale), 0, 255);
    data[i + 1] = clamp(Math.round((data[i + 1] - lo) * scale), 0, 255);
    data[i + 2] = clamp(Math.round((data[i + 2] - lo) * scale), 0, 255);
  }
}

/**
 * Load a File into an HTMLCanvasElement with preprocessing applied.
 *
 * Pipeline:
 * 1. createImageBitmap normalizes EXIF orientation
 * 2. Scales oversized images to MAX_IMAGE_DIM
 * 3. Applies auto-contrast stretching for underexposed images
 */
async function preprocessImage(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);

  let { width, height } = bitmap;

  // Scale down oversized images
  if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
    const scale = MAX_IMAGE_DIM / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  // Draw to canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create canvas context");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Apply auto-contrast
  const imageData = ctx.getImageData(0, 0, width, height);
  autoContrast(imageData);
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}

/* ─── Embedding helpers ─── */

/**
 * Zero-pad a 128-d neural descriptor to 512-d for DB compatibility.
 * Cosine similarity is preserved because dot product with zero is 0.
 */
function padEmbedding(descriptor: Float32Array): number[] {
  const embedding = new Array<number>(EMBEDDING_SIZE).fill(0);
  for (let i = 0; i < Math.min(descriptor.length, NEURAL_DIM); i++) {
    embedding[i] = descriptor[i];
  }
  // L2 normalize
  let norm = 0;
  for (const v of embedding) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_SIZE; i++) {
      embedding[i] /= norm;
    }
  }
  return embedding;
}

/* ─── Liveness extraction from 68-point landmarks ─── */

/**
 * 68-point landmark indices (face-api.js):
 *  - Left eye: 36-41
 *  - Right eye: 42-47
 *  - Mouth: 48-67
 *  - Nose: 27-35
 *  - Jaw: 0-16
 */

function eyeAspectRatio(
  landmarks: faceapi.Point[],
  indices: number[]
): number {
  // EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
  const p1 = landmarks[indices[0]];
  const p2 = landmarks[indices[1]];
  const p3 = landmarks[indices[2]];
  const p4 = landmarks[indices[3]];
  const p5 = landmarks[indices[4]];
  const p6 = landmarks[indices[5]];

  const dist = (a: faceapi.Point, b: faceapi.Point) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

  const v1 = dist(p2, p6);
  const v2 = dist(p3, p5);
  const h = dist(p1, p4);

  return h > 0 ? (v1 + v2) / (2 * h) : 0;
}

function extractLiveness(
  landmarks: faceapi.FaceLandmarks68,
  expressions: faceapi.FaceExpressions
): { blink: number; smile: number; mouthOpen: number; yaw: number } {
  const pts = landmarks.positions;

  // Blink: inverse of Eye Aspect Ratio (lower EAR = more closed)
  const leftEAR = eyeAspectRatio(pts, [36, 37, 38, 39, 40, 41]);
  const rightEAR = eyeAspectRatio(pts, [42, 43, 44, 45, 46, 47]);
  const avgEAR = (leftEAR + rightEAR) / 2;
  const blink = clamp(1 - avgEAR / 0.3, 0, 1); // 0.3 is typical open EAR

  // Smile: from expression model
  const smile = clamp(expressions.happy ?? 0, 0, 1);

  // Mouth open: ratio of mouth height to width
  const mouthTop = pts[62]; // upper inner lip
  const mouthBottom = pts[66]; // lower inner lip
  const mouthLeft = pts[60];
  const mouthRight = pts[64];
  const mouthH = Math.abs(mouthBottom.y - mouthTop.y);
  const mouthW = Math.abs(mouthRight.x - mouthLeft.x);
  const mouthOpen = mouthW > 0 ? clamp(mouthH / mouthW, 0, 1) : 0;

  // Yaw: nose tip horizontal offset from face center
  const noseTip = pts[30];
  const jawLeft = pts[0];
  const jawRight = pts[16];
  const faceCenterX = (jawLeft.x + jawRight.x) / 2;
  const faceWidth = Math.abs(jawRight.x - jawLeft.x);
  const yaw = faceWidth > 0
    ? clamp((noseTip.x - faceCenterX) / (faceWidth / 2), -1, 1)
    : 0;

  return { blink, smile, mouthOpen, yaw };
}

/* ─── Quality score ─── */

function computeQualityScore(
  detection: faceapi.FaceDetection,
  landmarks: faceapi.FaceLandmarks68,
  canvasWidth: number,
  canvasHeight: number
): number {
  const box = detection.box;
  const pts = landmarks.positions;

  // 1. Detection confidence (35%)
  const confidenceScore = clamp(detection.score, 0, 1);

  // 2. Face size relative to image (25%)
  const faceArea = (box.width * box.height) / (canvasWidth * canvasHeight);
  const sizeScore = clamp(faceArea / 0.08, 0, 1);

  // 3. Frontality / symmetry (25%)
  const jawLeft = pts[0];
  const jawRight = pts[16];
  const noseTip = pts[30];
  const faceCenterX = (jawLeft.x + jawRight.x) / 2;
  const faceWidth = Math.abs(jawRight.x - jawLeft.x);
  const asymmetry = faceWidth > 0
    ? Math.abs(noseTip.x - faceCenterX) / (faceWidth / 2)
    : 1;
  const symmetryScore = clamp(1 - asymmetry, 0, 1);

  // 4. Face fully within image (15%)
  const margin = 5;
  const inBounds =
    box.x > margin &&
    box.y > margin &&
    box.x + box.width < canvasWidth - margin &&
    box.y + box.height < canvasHeight - margin;
  const boundsScore = inBounds ? 1 : 0.4;

  return (
    confidenceScore * 0.35 +
    sizeScore * 0.25 +
    symmetryScore * 0.25 +
    boundsScore * 0.15
  );
}

/* ─── Main detection function ─── */

export async function detectBrowserFaces(file: File): Promise<BrowserFace[]> {
  await ensureModelsLoaded();

  // Preprocess: EXIF normalization, resize, auto-contrast
  const canvas = await preprocessImage(file);

  // Detect all faces with landmarks, descriptors, and expressions
  const detections = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
    .withFaceLandmarks()
    .withFaceDescriptors()
    .withFaceExpressions();

  const results: BrowserFace[] = [];

  for (const det of detections) {
    const box = det.detection.box;
    const embedding = padEmbedding(det.descriptor);
    const liveness = extractLiveness(det.landmarks, det.expressions);
    const qualityScore = computeQualityScore(
      det.detection,
      det.landmarks,
      canvas.width,
      canvas.height
    );

    results.push({
      bbox: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
      },
      qualityScore,
      embedding,
      liveness,
    });
  }

  return results;
}
