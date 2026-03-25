// Static type-only import — doesn't emit JS, safe for SSR
import type {
  FaceDetection,
  FaceLandmarks68,
  FaceExpressions,
  Point,
  Box,
  WithFaceExpressions,
  WithFaceDescriptor,
  WithFaceLandmarks,
} from "@vladmandic/face-api";

// Runtime module loaded dynamically to avoid SSR TextEncoder crash
let faceapi: typeof import("@vladmandic/face-api") | null = null;

export type BrowserFace = {
  bbox: { x: number; y: number; w: number; h: number };
  qualityScore: number;
  /** 512-d embedding (128-d FaceNet neural descriptor, zero-padded) */
  embedding: number[];
  liveness: { blink: number; smile: number; mouthOpen: number; yaw: number };
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

function api() {
  if (!faceapi) throw new Error("face-api not loaded");
  return faceapi;
}

/* ═══ Model loading ═══ */

async function ensureModelsLoaded() {
  if (modelsLoaded && faceapi) return;
  if (modelsLoadingPromise) return modelsLoadingPromise;

  modelsLoadingPromise = (async () => {
    const mod = await import("@vladmandic/face-api");
    faceapi = mod;
    await Promise.all([
      mod.nets.ssdMobilenetv1.loadFromUri(MODELS_PATH),
      mod.nets.tinyFaceDetector.loadFromUri(MODELS_PATH),
      mod.nets.faceLandmark68Net.loadFromUri(MODELS_PATH),
      mod.nets.faceRecognitionNet.loadFromUri(MODELS_PATH),
      mod.nets.faceExpressionNet.loadFromUri(MODELS_PATH),
    ]);
    modelsLoaded = true;
  })();

  return modelsLoadingPromise;
}

/* ═══ CLAHE-style Adaptive Histogram Equalization ═══ */

function adaptiveHistogramEqualization(
  imageData: ImageData,
  tileGridX = 8,
  tileGridY = 8,
  clipLimit = 2.5
): void {
  const { width, height, data } = imageData;
  const tileW = Math.ceil(width / tileGridX);
  const tileH = Math.ceil(height / tileGridY);
  const totalPx = width * height;

  const lum = new Float32Array(totalPx);
  for (let i = 0; i < totalPx; i++) {
    const idx = i * 4;
    lum[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  let sumLum = 0;
  for (let i = 0; i < totalPx; i++) sumLum += lum[i];
  const meanLum = sumLum / totalPx;
  let variance = 0;
  for (let i = 0; i < totalPx; i++) variance += (lum[i] - meanLum) ** 2;
  const stddev = Math.sqrt(variance / totalPx);

  if (meanLum > 90 && stddev > 45) return; // image is fine

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

      if (count > 0) {
        const limit = Math.max(1, Math.round((clipLimit * count) / 256));
        let excess = 0;
        for (let i = 0; i < 256; i++) {
          if (hist[i] > limit) { excess += hist[i] - limit; hist[i] = limit; }
        }
        const bonus = excess / 256;
        for (let i = 0; i < 256; i++) hist[i] += bonus;
      }

      const cdf = new Float32Array(256);
      cdf[0] = hist[0];
      for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
      const cdfMin = cdf.find((v) => v > 0) ?? 0;
      const denom = Math.max(count - cdfMin, 1);
      for (let i = 0; i < 256; i++) cdf[i] = ((cdf[i] - cdfMin) / denom) * 255;
      cdfs[ty][tx] = cdf;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const lumVal = Math.round(clamp(lum[y * width + x], 0, 255));
      const tcx = (x / tileW) - 0.5;
      const tcy = (y / tileH) - 0.5;
      const tx0 = clamp(Math.floor(tcx), 0, tileGridX - 1);
      const ty0 = clamp(Math.floor(tcy), 0, tileGridY - 1);
      const tx1 = clamp(tx0 + 1, 0, tileGridX - 1);
      const ty1 = clamp(ty0 + 1, 0, tileGridY - 1);
      const fx = clamp(tcx - tx0, 0, 1);
      const fy = clamp(tcy - ty0, 0, 1);

      const newLum =
        cdfs[ty0][tx0][lumVal] * (1 - fx) * (1 - fy) +
        cdfs[ty0][tx1][lumVal] * fx * (1 - fy) +
        cdfs[ty1][tx0][lumVal] * (1 - fx) * fy +
        cdfs[ty1][tx1][lumVal] * fx * fy;

      const oldLum = lum[y * width + x];
      const scale = oldLum > 0 ? newLum / oldLum : 1;
      data[idx] = clamp(Math.round(data[idx] * scale), 0, 255);
      data[idx + 1] = clamp(Math.round(data[idx + 1] * scale), 0, 255);
      data[idx + 2] = clamp(Math.round(data[idx + 2] * scale), 0, 255);
    }
  }
}

/* ═══ Image Preprocessing ═══ */

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
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, width, height);
  adaptiveHistogramEqualization(imageData);
  ctx.putImageData(imageData, 0, 0);

  return canvas;
}

/* ═══ Face Alignment ═══ */

function alignFaceCanvas(
  sourceCanvas: HTMLCanvasElement,
  landmarks: FaceLandmarks68,
  box: Box
): HTMLCanvasElement {
  const pts = landmarks.positions;
  const leftEyeCenter = { x: (pts[36].x + pts[39].x) / 2, y: (pts[36].y + pts[39].y) / 2 };
  const rightEyeCenter = { x: (pts[42].x + pts[45].x) / 2, y: (pts[42].y + pts[45].y) / 2 };
  const angle = Math.atan2(rightEyeCenter.y - leftEyeCenter.y, rightEyeCenter.x - leftEyeCenter.x);

  if (Math.abs(angle) < 0.05) {
    const pad = 0.3;
    const x = Math.max(0, Math.round(box.x - box.width * pad));
    const y = Math.max(0, Math.round(box.y - box.height * pad));
    const w = Math.min(sourceCanvas.width - x, Math.round(box.width * (1 + 2 * pad)));
    const h = Math.min(sourceCanvas.height - y, Math.round(box.height * (1 + 2 * pad)));
    const crop = document.createElement("canvas");
    crop.width = w; crop.height = h;
    crop.getContext("2d")?.drawImage(sourceCanvas, x, y, w, h, 0, 0, w, h);
    return crop;
  }

  const cx = (leftEyeCenter.x + rightEyeCenter.x) / 2;
  const cy = (leftEyeCenter.y + rightEyeCenter.y) / 2;
  const size = Math.max(box.width, box.height) * 1.8;
  const outSize = Math.round(size);
  const aligned = document.createElement("canvas");
  aligned.width = outSize; aligned.height = outSize;
  const aCtx = aligned.getContext("2d");
  if (!aCtx) return sourceCanvas;
  aCtx.translate(outSize / 2, outSize / 2);
  aCtx.rotate(-angle);
  aCtx.translate(-cx, -cy);
  aCtx.drawImage(sourceCanvas, 0, 0);
  return aligned;
}

/* ═══ Mirror Canvas ═══ */

function mirrorCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const m = document.createElement("canvas");
  m.width = canvas.width; m.height = canvas.height;
  const ctx = m.getContext("2d");
  if (!ctx) return canvas;
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(canvas, 0, 0);
  return m;
}

/* ═══ Embedding helpers ═══ */

function padEmbedding(descriptor: Float32Array): number[] {
  const emb = new Array<number>(EMBEDDING_SIZE).fill(0);
  for (let i = 0; i < Math.min(descriptor.length, NEURAL_DIM); i++) emb[i] = descriptor[i];
  let norm = 0;
  for (const v of emb) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBEDDING_SIZE; i++) emb[i] /= norm;
  return emb;
}

function averageEmbeddings(a: number[], b: number[]): number[] {
  const avg = new Array<number>(EMBEDDING_SIZE);
  for (let i = 0; i < EMBEDDING_SIZE; i++) avg[i] = (a[i] + b[i]) / 2;
  let norm = 0;
  for (const v of avg) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBEDDING_SIZE; i++) avg[i] /= norm;
  return avg;
}

/* ═══ Liveness from 68 landmarks + expressions ═══ */

function ear(pts: Point[], indices: number[]): number {
  const dist = (a: Point, b: Point) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  const v1 = dist(pts[indices[1]], pts[indices[5]]);
  const v2 = dist(pts[indices[2]], pts[indices[4]]);
  const h = dist(pts[indices[0]], pts[indices[3]]);
  return h > 0 ? (v1 + v2) / (2 * h) : 0;
}

function extractLiveness(
  landmarks: FaceLandmarks68,
  expressions: FaceExpressions
): BrowserFace["liveness"] {
  const pts = landmarks.positions;
  const leftEAR = ear(pts, [36, 37, 38, 39, 40, 41]);
  const rightEAR = ear(pts, [42, 43, 44, 45, 46, 47]);
  const blink = clamp(1 - ((leftEAR + rightEAR) / 2) / 0.3, 0, 1);
  const smile = clamp(expressions.happy ?? 0, 0, 1);
  const mouthH = Math.abs(pts[66].y - pts[62].y);
  const mouthW = Math.abs(pts[64].x - pts[60].x);
  const mouthOpen = mouthW > 0 ? clamp(mouthH / mouthW, 0, 1) : 0;
  const faceCX = (pts[0].x + pts[16].x) / 2;
  const faceW = Math.abs(pts[16].x - pts[0].x);
  const yaw = faceW > 0 ? clamp((pts[30].x - faceCX) / (faceW / 2), -1, 1) : 0;
  return { blink, smile, mouthOpen, yaw };
}

/* ═══ Quality score ═══ */

function computeQualityScore(
  detection: FaceDetection,
  landmarks: FaceLandmarks68,
  canvasW: number,
  canvasH: number
): number {
  const box = detection.box;
  const pts = landmarks.positions;
  const confScore = clamp(detection.score, 0, 1);
  const sizeScore = clamp((box.width * box.height) / (canvasW * canvasH) / 0.08, 0, 1);
  const faceCX = (pts[0].x + pts[16].x) / 2;
  const faceW = Math.abs(pts[16].x - pts[0].x);
  const symScore = faceW > 0 ? clamp(1 - Math.abs(pts[30].x - faceCX) / (faceW / 2), 0, 1) : 0;
  const m = 5;
  const inBounds = box.x > m && box.y > m && box.x + box.width < canvasW - m && box.y + box.height < canvasH - m;
  return confScore * 0.35 + sizeScore * 0.25 + symScore * 0.25 + (inBounds ? 0.15 : 0.06);
}

/* ═══ Robust Multi-Strategy Detection ═══ */

type FullDetection = WithFaceExpressions<
  WithFaceDescriptor<WithFaceLandmarks<{ detection: FaceDetection }>>
>;

async function robustDetect(canvas: HTMLCanvasElement): Promise<FullDetection[]> {
  const fa = api();

  // 1) SSD MobileNet
  let results = await fa
    .detectAllFaces(canvas, new fa.SsdMobilenetv1Options({ minConfidence: 0.3 }))
    .withFaceLandmarks().withFaceDescriptors().withFaceExpressions();
  if (results.length > 0) return results;

  // 2) TinyFaceDetector fallback
  results = await fa
    .detectAllFaces(canvas, new fa.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }))
    .withFaceLandmarks().withFaceDescriptors().withFaceExpressions();
  if (results.length > 0) return results;

  // 3) Upscale small images
  if (canvas.width < 640 || canvas.height < 640) {
    const scale = 640 / Math.min(canvas.width, canvas.height);
    const up = document.createElement("canvas");
    up.width = Math.round(canvas.width * scale);
    up.height = Math.round(canvas.height * scale);
    up.getContext("2d")?.drawImage(canvas, 0, 0, up.width, up.height);
    results = await fa
      .detectAllFaces(up, new fa.SsdMobilenetv1Options({ minConfidence: 0.2 }))
      .withFaceLandmarks().withFaceDescriptors().withFaceExpressions();
    if (results.length > 0) return results;
  }

  // 4) Downscale large images
  if (canvas.width > 1200 || canvas.height > 1200) {
    const scale = 800 / Math.max(canvas.width, canvas.height);
    const dn = document.createElement("canvas");
    dn.width = Math.round(canvas.width * scale);
    dn.height = Math.round(canvas.height * scale);
    dn.getContext("2d")?.drawImage(canvas, 0, 0, dn.width, dn.height);
    results = await fa
      .detectAllFaces(dn, new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 }))
      .withFaceLandmarks().withFaceDescriptors().withFaceExpressions();
  }

  return results;
}

/* ═══ Main Detection ═══ */

export async function detectBrowserFaces(file: File): Promise<BrowserFace[]> {
  await ensureModelsLoaded();
  const fa = api();

  const canvas = await preprocessImage(file);
  const detections = await robustDetect(canvas);
  const results: BrowserFace[] = [];

  for (const det of detections) {
    const box = det.detection.box;
    const liveness = extractLiveness(det.landmarks, det.expressions);
    const qualityScore = computeQualityScore(det.detection, det.landmarks, canvas.width, canvas.height);

    // Face alignment
    const alignedCanvas = alignFaceCanvas(canvas, det.landmarks, box);
    const alignedDet = await fa
      .detectSingleFace(alignedCanvas, new fa.SsdMobilenetv1Options({ minConfidence: 0.15 }))
      .withFaceLandmarks().withFaceDescriptor();

    const descriptor = alignedDet?.descriptor ?? det.descriptor;
    const originalEmb = padEmbedding(descriptor);

    // Mirror augmentation
    const mirrored = mirrorCanvas(alignedDet ? alignedCanvas : canvas);
    const mirrorDet = await fa
      .detectSingleFace(mirrored, new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.15 }))
      .withFaceLandmarks().withFaceDescriptor();

    const finalEmb = mirrorDet
      ? averageEmbeddings(originalEmb, padEmbedding(mirrorDet.descriptor))
      : originalEmb;

    results.push({
      bbox: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
      qualityScore,
      embedding: finalEmb,
      liveness,
    });
  }

  return results;
}

/* ═══ Outlier Filtering (enrollment batches) ═══ */

export function filterOutlierEmbeddings(embeddings: number[][]): number[][] {
  if (embeddings.length <= 2) return embeddings;

  const scores = embeddings.map((emb, i) => {
    let totalSim = 0;
    for (let j = 0; j < embeddings.length; j++) {
      if (i !== j) totalSim += cosineSim(emb, embeddings[j]);
    }
    return totalSim / (embeddings.length - 1);
  });

  let worstIdx = 0;
  let worstScore = scores[0];
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] < worstScore) { worstScore = scores[i]; worstIdx = i; }
  }

  const meanScore = scores.reduce((a, b) => a + b) / scores.length;
  if (worstScore < meanScore - 0.1) {
    return embeddings.filter((_, i) => i !== worstIdx);
  }
  return embeddings;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] ** 2; nB += b[i] ** 2; }
  const d = Math.sqrt(nA) * Math.sqrt(nB);
  return d > 0 ? dot / d : 0;
}
