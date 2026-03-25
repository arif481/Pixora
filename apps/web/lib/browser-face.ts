/**
 * browser-face.ts – Client-side face detection using @vladmandic/face-api
 *
 * Enhanced with:
 *  1. Neural FaceNet embeddings (128-d, zero-padded to 512-d)
 *  2. Fallback TinyFaceDetector when SSD MobileNet misses faces
 *  3. Face alignment (rotation to canonical eye line)
 *  4. CLAHE-style histogram equalization for uneven lighting
 *  5. Multi-scale detection retry
 *  6. Mirror-augmented descriptors (averaged with flipped image)
 *  7. Outlier filtering for enrollment batches
 *
 * All processing is 100% client-side and free.
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
  /** 512-d embedding (128-d FaceNet neural descriptor, zero-padded) */
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

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/* ═══════════════════════════════════════════════════
   Model loading
   ═══════════════════════════════════════════════════ */

async function ensureModelsLoaded() {
  if (modelsLoaded) return;
  if (modelsLoadingPromise) return modelsLoadingPromise;

  modelsLoadingPromise = (async () => {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS_PATH),
      faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_PATH),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_PATH),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_PATH),
      faceapi.nets.faceExpressionNet.loadFromUri(MODELS_PATH),
    ]);
    modelsLoaded = true;
  })();

  return modelsLoadingPromise;
}

/* ═══════════════════════════════════════════════════
   Image Preprocessing
   ═══════════════════════════════════════════════════ */

/**
 * CLAHE-inspired adaptive histogram equalization.
 * Splits the image into tiles and equalizes each tile's histogram,
 * then interpolates to avoid block artifacts.
 * Much better than global contrast stretching for uneven lighting.
 */
function adaptiveHistogramEqualization(
  imageData: ImageData,
  tileGridX = 8,
  tileGridY = 8,
  clipLimit = 2.5
): void {
  const { width, height, data } = imageData;
  const tileW = Math.ceil(width / tileGridX);
  const tileH = Math.ceil(height / tileGridY);

  // Compute luminance channel
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    lum[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // Check if equalization is needed
  let sumLum = 0;
  for (let i = 0; i < lum.length; i++) sumLum += lum[i];
  const meanLum = sumLum / lum.length;
  let variance = 0;
  for (let i = 0; i < lum.length; i++) variance += (lum[i] - meanLum) ** 2;
  const stddev = Math.sqrt(variance / lum.length);

  // Only apply if image needs it (dark or low contrast)
  if (meanLum > 90 && stddev > 45) return;

  // Build CDFs for each tile
  const cdfs: Float32Array[][] = [];
  for (let ty = 0; ty < tileGridY; ty++) {
    cdfs[ty] = [];
    for (let tx = 0; tx < tileGridX; tx++) {
      const hist = new Float32Array(256);
      let count = 0;
      const x0 = tx * tileW;
      const y0 = ty * tileH;

      for (let y = y0; y < Math.min(y0 + tileH, height); y++) {
        for (let x = x0; x < Math.min(x0 + tileW, width); x++) {
          hist[Math.round(clamp(lum[y * width + x], 0, 255))]++;
          count++;
        }
      }

      // Clip histogram (CLAHE)
      if (count > 0) {
        const limit = Math.max(1, Math.round((clipLimit * count) / 256));
        let excess = 0;
        for (let i = 0; i < 256; i++) {
          if (hist[i] > limit) {
            excess += hist[i] - limit;
            hist[i] = limit;
          }
        }
        const bonus = excess / 256;
        for (let i = 0; i < 256; i++) hist[i] += bonus;
      }

      // Build CDF
      const cdf = new Float32Array(256);
      cdf[0] = hist[0];
      for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
      const cdfMin = cdf.find((v) => v > 0) ?? 0;
      const denom = Math.max(count - cdfMin, 1);
      for (let i = 0; i < 256; i++) {
        cdf[i] = ((cdf[i] - cdfMin) / denom) * 255;
      }
      cdfs[ty][tx] = cdf;
    }
  }

  // Apply equalization with bilinear interpolation between tiles
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const lumVal = Math.round(clamp(lum[y * width + x], 0, 255));

      // Find surrounding tile centers
      const tcx = (x / tileW) - 0.5;
      const tcy = (y / tileH) - 0.5;
      const tx0 = clamp(Math.floor(tcx), 0, tileGridX - 1);
      const ty0 = clamp(Math.floor(tcy), 0, tileGridY - 1);
      const tx1 = clamp(tx0 + 1, 0, tileGridX - 1);
      const ty1 = clamp(ty0 + 1, 0, tileGridY - 1);
      const fx = clamp(tcx - tx0, 0, 1);
      const fy = clamp(tcy - ty0, 0, 1);

      // Bilinear interpolation of equalized values
      const v00 = cdfs[ty0][tx0][lumVal];
      const v10 = cdfs[ty0][tx1][lumVal];
      const v01 = cdfs[ty1][tx0][lumVal];
      const v11 = cdfs[ty1][tx1][lumVal];
      const newLum = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) +
                     v01 * (1 - fx) * fy + v11 * fx * fy;

      // Scale RGB proportionally
      const oldLum = lum[y * width + x];
      const scale = oldLum > 0 ? newLum / oldLum : 1;
      data[idx] = clamp(Math.round(data[idx] * scale), 0, 255);
      data[idx + 1] = clamp(Math.round(data[idx + 1] * scale), 0, 255);
      data[idx + 2] = clamp(Math.round(data[idx + 2] * scale), 0, 255);
    }
  }
}

/**
 * Load a File into a preprocessed HTMLCanvasElement.
 *
 * Pipeline:
 * 1. createImageBitmap normalizes EXIF orientation
 * 2. Scales oversized images to MAX_IMAGE_DIM
 * 3. CLAHE-style adaptive histogram equalization
 */
async function preprocessImage(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;

  if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
    const scale = MAX_IMAGE_DIM / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create canvas context");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // CLAHE-style equalization
  const imageData = ctx.getImageData(0, 0, width, height);
  adaptiveHistogramEqualization(imageData);
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}

/* ═══════════════════════════════════════════════════
   Face Alignment
   ═══════════════════════════════════════════════════ */

/**
 * Align a detected face to a canonical orientation by rotating
 * so the eye line is horizontal. This dramatically improves
 * descriptor consistency across head tilts.
 */
function alignFaceCanvas(
  sourceCanvas: HTMLCanvasElement,
  landmarks: faceapi.FaceLandmarks68,
  box: faceapi.Box
): HTMLCanvasElement {
  const pts = landmarks.positions;
  // Eye centers
  const leftEyeCenter = {
    x: (pts[36].x + pts[39].x) / 2,
    y: (pts[36].y + pts[39].y) / 2,
  };
  const rightEyeCenter = {
    x: (pts[42].x + pts[45].x) / 2,
    y: (pts[42].y + pts[45].y) / 2,
  };

  const dy = rightEyeCenter.y - leftEyeCenter.y;
  const dx = rightEyeCenter.x - leftEyeCenter.x;
  const angle = Math.atan2(dy, dx);

  // Only align if tilt is significant (> 3 degrees)
  if (Math.abs(angle) < 0.05) {
    // Return cropped face without rotation
    const pad = 0.3;
    const x = Math.max(0, Math.round(box.x - box.width * pad));
    const y = Math.max(0, Math.round(box.y - box.height * pad));
    const w = Math.min(sourceCanvas.width - x, Math.round(box.width * (1 + 2 * pad)));
    const h = Math.min(sourceCanvas.height - y, Math.round(box.height * (1 + 2 * pad)));

    const crop = document.createElement("canvas");
    crop.width = w;
    crop.height = h;
    const cCtx = crop.getContext("2d");
    if (cCtx) cCtx.drawImage(sourceCanvas, x, y, w, h, 0, 0, w, h);
    return crop;
  }

  // Rotate around face center
  const cx = (leftEyeCenter.x + rightEyeCenter.x) / 2;
  const cy = (leftEyeCenter.y + rightEyeCenter.y) / 2;

  const pad = 0.4;
  const size = Math.max(box.width, box.height) * (1 + 2 * pad);
  const outSize = Math.round(size);

  const aligned = document.createElement("canvas");
  aligned.width = outSize;
  aligned.height = outSize;
  const aCtx = aligned.getContext("2d");
  if (!aCtx) return sourceCanvas;

  aCtx.translate(outSize / 2, outSize / 2);
  aCtx.rotate(-angle);
  aCtx.translate(-cx, -cy);
  aCtx.drawImage(sourceCanvas, 0, 0);

  return aligned;
}

/* ═══════════════════════════════════════════════════
   Mirror Augmentation
   ═══════════════════════════════════════════════════ */

/**
 * Create a horizontally flipped version of a canvas.
 * Used to augment the descriptor with a mirrored view.
 */
function mirrorCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const mirrored = document.createElement("canvas");
  mirrored.width = canvas.width;
  mirrored.height = canvas.height;
  const ctx = mirrored.getContext("2d");
  if (!ctx) return canvas;
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(canvas, 0, 0);
  return mirrored;
}

/* ═══════════════════════════════════════════════════
   Embedding helpers
   ═══════════════════════════════════════════════════ */

/**
 * Zero-pad a 128-d neural descriptor to 512-d for DB compatibility.
 */
function padEmbedding(descriptor: Float32Array): number[] {
  const embedding = new Array<number>(EMBEDDING_SIZE).fill(0);
  for (let i = 0; i < Math.min(descriptor.length, NEURAL_DIM); i++) {
    embedding[i] = descriptor[i];
  }
  let norm = 0;
  for (const v of embedding) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_SIZE; i++) embedding[i] /= norm;
  }
  return embedding;
}

/**
 * Average two embeddings (original + mirror) for better robustness.
 */
function averageEmbeddings(a: number[], b: number[]): number[] {
  const avg = new Array<number>(EMBEDDING_SIZE);
  for (let i = 0; i < EMBEDDING_SIZE; i++) avg[i] = (a[i] + b[i]) / 2;
  // Re-normalize
  let norm = 0;
  for (const v of avg) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBEDDING_SIZE; i++) avg[i] /= norm;
  return avg;
}

/* ═══════════════════════════════════════════════════
   Liveness extraction from 68-point landmarks
   ═══════════════════════════════════════════════════ */

function eyeAspectRatio(
  pts: faceapi.Point[],
  indices: number[]
): number {
  const [i0, i1, i2, i3, i4, i5] = indices;
  const dist = (a: faceapi.Point, b: faceapi.Point) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  const v1 = dist(pts[i1], pts[i5]);
  const v2 = dist(pts[i2], pts[i4]);
  const h = dist(pts[i0], pts[i3]);
  return h > 0 ? (v1 + v2) / (2 * h) : 0;
}

function extractLiveness(
  landmarks: faceapi.FaceLandmarks68,
  expressions: faceapi.FaceExpressions
): { blink: number; smile: number; mouthOpen: number; yaw: number } {
  const pts = landmarks.positions;

  // Blink: inverse of Eye Aspect Ratio
  const leftEAR = eyeAspectRatio(pts, [36, 37, 38, 39, 40, 41]);
  const rightEAR = eyeAspectRatio(pts, [42, 43, 44, 45, 46, 47]);
  const avgEAR = (leftEAR + rightEAR) / 2;
  const blink = clamp(1 - avgEAR / 0.3, 0, 1);

  // Smile from expression model
  const smile = clamp(expressions.happy ?? 0, 0, 1);

  // Mouth open ratio
  const mouthH = Math.abs(pts[66].y - pts[62].y);
  const mouthW = Math.abs(pts[64].x - pts[60].x);
  const mouthOpen = mouthW > 0 ? clamp(mouthH / mouthW, 0, 1) : 0;

  // Yaw: nose offset from face center
  const faceCenterX = (pts[0].x + pts[16].x) / 2;
  const faceWidth = Math.abs(pts[16].x - pts[0].x);
  const yaw = faceWidth > 0
    ? clamp((pts[30].x - faceCenterX) / (faceWidth / 2), -1, 1)
    : 0;

  return { blink, smile, mouthOpen, yaw };
}

/* ═══════════════════════════════════════════════════
   Quality score
   ═══════════════════════════════════════════════════ */

function computeQualityScore(
  detection: faceapi.FaceDetection,
  landmarks: faceapi.FaceLandmarks68,
  canvasW: number,
  canvasH: number
): number {
  const box = detection.box;

  // 1. Detection confidence (35%)
  const confScore = clamp(detection.score, 0, 1);

  // 2. Face size (25%)
  const faceArea = (box.width * box.height) / (canvasW * canvasH);
  const sizeScore = clamp(faceArea / 0.08, 0, 1);

  // 3. Frontality (25%)
  const pts = landmarks.positions;
  const faceCenterX = (pts[0].x + pts[16].x) / 2;
  const faceWidth = Math.abs(pts[16].x - pts[0].x);
  const asymmetry = faceWidth > 0 ? Math.abs(pts[30].x - faceCenterX) / (faceWidth / 2) : 1;
  const symmetryScore = clamp(1 - asymmetry, 0, 1);

  // 4. Face within image bounds (15%)
  const margin = 5;
  const inBounds =
    box.x > margin && box.y > margin &&
    box.x + box.width < canvasW - margin &&
    box.y + box.height < canvasH - margin;

  return confScore * 0.35 + sizeScore * 0.25 + symmetryScore * 0.25 + (inBounds ? 0.15 : 0.06);
}

/* ═══════════════════════════════════════════════════
   Multi-scale + Fallback Detection
   ═══════════════════════════════════════════════════ */

type FullDetection = faceapi.WithFaceExpressions<
  faceapi.WithFaceDescriptor<
    faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }>
  >
>;

/**
 * Detect faces with SSD MobileNet first, fallback to TinyFaceDetector,
 * and retry at a different scale if both fail.
 */
async function robustDetect(canvas: HTMLCanvasElement): Promise<FullDetection[]> {
  // Attempt 1: SSD MobileNet (most accurate)
  let results = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
    .withFaceLandmarks()
    .withFaceDescriptors()
    .withFaceExpressions();

  if (results.length > 0) return results;

  // Attempt 2: TinyFaceDetector (better for small/angled faces)
  results = await faceapi
    .detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }))
    .withFaceLandmarks()
    .withFaceDescriptors()
    .withFaceExpressions();

  if (results.length > 0) return results;

  // Attempt 3: Multi-scale — upscale small images
  if (canvas.width < 640 || canvas.height < 640) {
    const scale = 640 / Math.min(canvas.width, canvas.height);
    const upscaled = document.createElement("canvas");
    upscaled.width = Math.round(canvas.width * scale);
    upscaled.height = Math.round(canvas.height * scale);
    const ctx = upscaled.getContext("2d");
    if (ctx) {
      ctx.drawImage(canvas, 0, 0, upscaled.width, upscaled.height);
      results = await faceapi
        .detectAllFaces(upscaled, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2 }))
        .withFaceLandmarks()
        .withFaceDescriptors()
        .withFaceExpressions();

      if (results.length > 0) return results;
    }
  }

  // Attempt 4: Downscale large high-res images
  if (canvas.width > 1200 || canvas.height > 1200) {
    const scale = 800 / Math.max(canvas.width, canvas.height);
    const downscaled = document.createElement("canvas");
    downscaled.width = Math.round(canvas.width * scale);
    downscaled.height = Math.round(canvas.height * scale);
    const ctx = downscaled.getContext("2d");
    if (ctx) {
      ctx.drawImage(canvas, 0, 0, downscaled.width, downscaled.height);
      results = await faceapi
        .detectAllFaces(downscaled, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 }))
        .withFaceLandmarks()
        .withFaceDescriptors()
        .withFaceExpressions();
    }
  }

  return results;
}

/* ═══════════════════════════════════════════════════
   Main detection function
   ═══════════════════════════════════════════════════ */

export async function detectBrowserFaces(file: File): Promise<BrowserFace[]> {
  await ensureModelsLoaded();

  // Preprocess: EXIF, resize, CLAHE
  const canvas = await preprocessImage(file);

  // Robust multi-strategy detection
  const detections = await robustDetect(canvas);

  const results: BrowserFace[] = [];

  for (const det of detections) {
    const box = det.detection.box;
    const liveness = extractLiveness(det.landmarks, det.expressions);
    const qualityScore = computeQualityScore(
      det.detection, det.landmarks, canvas.width, canvas.height
    );

    // ── Face alignment ──
    const alignedCanvas = alignFaceCanvas(canvas, det.landmarks, box);

    // Get descriptor from aligned face
    const alignedDets = await faceapi
      .detectSingleFace(alignedCanvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.15 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    // Use aligned descriptor if available, otherwise use original
    const descriptor = alignedDets?.descriptor ?? det.descriptor;
    const originalEmbedding = padEmbedding(descriptor);

    // ── Mirror augmentation ──
    const mirrored = mirrorCanvas(alignedDets ? alignedCanvas : canvas);
    const mirrorDet = await faceapi
      .detectSingleFace(mirrored, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.15 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    let finalEmbedding: number[];
    if (mirrorDet) {
      const mirrorEmbedding = padEmbedding(mirrorDet.descriptor);
      finalEmbedding = averageEmbeddings(originalEmbedding, mirrorEmbedding);
    } else {
      finalEmbedding = originalEmbedding;
    }

    results.push({
      bbox: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
      },
      qualityScore,
      embedding: finalEmbedding,
      liveness,
    });
  }

  return results;
}

/* ═══════════════════════════════════════════════════
   Outlier filtering (for enrollment batches)
   ═══════════════════════════════════════════════════ */

/**
 * Given a batch of embeddings (e.g. 5 enrollment selfies),
 * remove the most dissimilar one before averaging.
 * This eliminates bad captures from the final template.
 */
export function filterOutlierEmbeddings(embeddings: number[][]): number[][] {
  if (embeddings.length <= 2) return embeddings;

  // Compute average similarity for each embedding to all others
  const scores = embeddings.map((emb, i) => {
    let totalSim = 0;
    for (let j = 0; j < embeddings.length; j++) {
      if (i === j) continue;
      totalSim += cosineSim(emb, embeddings[j]);
    }
    return totalSim / (embeddings.length - 1);
  });

  // Find the worst one
  let worstIdx = 0;
  let worstScore = scores[0];
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] < worstScore) {
      worstScore = scores[i];
      worstIdx = i;
    }
  }

  // Only remove if it's significantly worse than the mean
  const meanScore = scores.reduce((a, b) => a + b) / scores.length;
  if (worstScore < meanScore - 0.1) {
    return embeddings.filter((_, i) => i !== worstIdx);
  }

  return embeddings;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}
