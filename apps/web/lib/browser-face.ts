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
  sharpness: number;
  /** 512-d embedding (128-d FaceNet neural descriptor, zero-padded) */
  embedding: number[];
  liveness: { blink: number; smile: number; mouthOpen: number; yaw: number; pitch: number; textureScore: number };
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

/* ═══ Gamma Correction ═══ */

function applyGammaCorrection(imageData: ImageData, gamma: number): void {
  if (Math.abs(gamma - 1.0) < 0.01) return;
  const { data } = imageData;
  const invGamma = 1.0 / gamma;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp(Math.round(255 * ((i / 255) ** invGamma)), 0, 255);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
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

  // Gamma correction for very dark or overexposed images
  if (meanLum < 60) {
    applyGammaCorrection(imageData, 0.6 + (meanLum / 60) * 0.4);
    // Recompute luminance after gamma
    for (let i = 0; i < totalPx; i++) {
      const idx = i * 4;
      lum[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
  } else if (meanLum > 200) {
    applyGammaCorrection(imageData, 1.2 + ((meanLum - 200) / 55) * 0.5);
    for (let i = 0; i < totalPx; i++) {
      const idx = i * 4;
      lum[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
  }

  // Smarter skip: only skip if BOTH global AND local statistics are good
  if (meanLum > 80 && meanLum < 200 && stddev > 40) {
    // Check local patches — if any quadrant has low contrast, still apply CLAHE
    const quadrants = [
      { x0: 0, y0: 0, x1: width >> 1, y1: height >> 1 },
      { x0: width >> 1, y0: 0, x1: width, y1: height >> 1 },
      { x0: 0, y0: height >> 1, x1: width >> 1, y1: height },
      { x0: width >> 1, y0: height >> 1, x1: width, y1: height },
    ];
    let allGood = true;
    for (const q of quadrants) {
      let qSum = 0, qCount = 0;
      for (let y = q.y0; y < q.y1; y++) {
        for (let x = q.x0; x < q.x1; x++) { qSum += lum[y * width + x]; qCount++; }
      }
      const qMean = qSum / Math.max(qCount, 1);
      let qVar = 0;
      for (let y = q.y0; y < q.y1; y++) {
        for (let x = q.x0; x < q.x1; x++) { qVar += (lum[y * width + x] - qMean) ** 2; }
      }
      if (Math.sqrt(qVar / Math.max(qCount, 1)) < 25) { allGood = false; break; }
    }
    if (allGood) return; // all quadrants have good contrast
  }

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

/* ═══ Sharpness Detection (Laplacian Variance) ═══ */

function computeSharpness(
  canvas: HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number }
): number {
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0.5;

  // Extract face region with padding
  const pad = 0.1;
  const fx = Math.max(0, Math.round(box.x - box.width * pad));
  const fy = Math.max(0, Math.round(box.y - box.height * pad));
  const fw = Math.min(canvas.width - fx, Math.round(box.width * (1 + 2 * pad)));
  const fh = Math.min(canvas.height - fy, Math.round(box.height * (1 + 2 * pad)));

  if (fw < 10 || fh < 10) return 0;

  const faceData = ctx.getImageData(fx, fy, fw, fh);
  const gray = new Float32Array(fw * fh);
  for (let i = 0; i < fw * fh; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * faceData.data[idx] + 0.587 * faceData.data[idx + 1] + 0.114 * faceData.data[idx + 2];
  }

  // Laplacian filter: [0,1,0; 1,-4,1; 0,1,0]
  let sumLap = 0;
  let sumLap2 = 0;
  let count = 0;
  for (let y = 1; y < fh - 1; y++) {
    for (let x = 1; x < fw - 1; x++) {
      const lap =
        gray[(y - 1) * fw + x] +
        gray[(y + 1) * fw + x] +
        gray[y * fw + (x - 1)] +
        gray[y * fw + (x + 1)] -
        4 * gray[y * fw + x];
      sumLap += lap;
      sumLap2 += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sumLap / count;
  const variance = sumLap2 / count - mean * mean;

  // Normalize: typical sharp face has variance ~500-2000, blurry ~20-100
  return clamp(variance / 800, 0, 1);
}

/* ═══ LBP Texture Score (anti-spoofing) ═══ */

function computeTextureScore(
  canvas: HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number }
): number {
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0.5;

  const fx = Math.max(0, Math.round(box.x));
  const fy = Math.max(0, Math.round(box.y));
  const fw = Math.min(canvas.width - fx, Math.round(box.width));
  const fh = Math.min(canvas.height - fy, Math.round(box.height));
  if (fw < 16 || fh < 16) return 0;

  const faceData = ctx.getImageData(fx, fy, fw, fh);
  const gray = new Float32Array(fw * fh);
  for (let i = 0; i < fw * fh; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * faceData.data[idx] + 0.587 * faceData.data[idx + 1] + 0.114 * faceData.data[idx + 2];
  }

  // Simplified LBP: compute local binary pattern histogram variance
  const hist = new Float32Array(256);
  let lbpCount = 0;
  const step = Math.max(1, Math.floor(Math.min(fw, fh) / 64)); // sample for speed
  for (let y = 1; y < fh - 1; y += step) {
    for (let x = 1; x < fw - 1; x += step) {
      const center = gray[y * fw + x];
      let pattern = 0;
      if (gray[(y - 1) * fw + (x - 1)] >= center) pattern |= 1;
      if (gray[(y - 1) * fw + x] >= center) pattern |= 2;
      if (gray[(y - 1) * fw + (x + 1)] >= center) pattern |= 4;
      if (gray[y * fw + (x + 1)] >= center) pattern |= 8;
      if (gray[(y + 1) * fw + (x + 1)] >= center) pattern |= 16;
      if (gray[(y + 1) * fw + x] >= center) pattern |= 32;
      if (gray[(y + 1) * fw + (x - 1)] >= center) pattern |= 64;
      if (gray[y * fw + (x - 1)] >= center) pattern |= 128;
      hist[pattern]++;
      lbpCount++;
    }
  }

  if (lbpCount === 0) return 0;

  // Normalize histogram and compute variance
  let histMean = 0;
  for (let i = 0; i < 256; i++) { hist[i] /= lbpCount; histMean += hist[i]; }
  histMean /= 256;
  let histVar = 0;
  for (let i = 0; i < 256; i++) histVar += (hist[i] - histMean) ** 2;
  histVar /= 256;

  // Real 3D faces have higher LBP variance than flat prints/screens
  // Typical real face: 0.0001-0.001, print: 0.00001-0.00005
  return clamp(histVar / 0.0004, 0, 1);
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
  expressions: FaceExpressions,
  canvas: HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number }
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

  // Pitch estimation from nose tip (pt 30) vs nose bridge (pt 27)
  const noseLen = Math.abs(pts[30].y - pts[27].y);
  const faceH = Math.abs(pts[8].y - pts[27].y);
  const pitch = faceH > 0 ? clamp((noseLen / faceH - 0.45) / 0.35, -1, 1) : 0;

  // LBP texture score for anti-spoofing
  const textureScore = computeTextureScore(canvas, box);

  return { blink, smile, mouthOpen, yaw, pitch, textureScore };
}

/* ═══ Quality score ═══ */

function computeQualityScore(
  detection: FaceDetection,
  landmarks: FaceLandmarks68,
  canvasW: number,
  canvasH: number,
  sharpness: number,
  pitch: number
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
  // Penalize extreme pitch (looking up/down)
  const pitchPenalty = clamp(1 - Math.abs(pitch) * 0.8, 0, 1);
  return (
    confScore * 0.28 +
    sizeScore * 0.20 +
    symScore * 0.18 +
    sharpness * 0.15 +
    pitchPenalty * 0.09 +
    (inBounds ? 0.10 : 0.04)
  );
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
    const sharpness = computeSharpness(canvas, box);
    const liveness = extractLiveness(det.landmarks, det.expressions, canvas, box);
    const qualityScore = computeQualityScore(det.detection, det.landmarks, canvas.width, canvas.height, sharpness, liveness.pitch);

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
      sharpness,
      embedding: finalEmb,
      liveness,
    });
  }

  return results;
}

/* ═══ Outlier Filtering (enrollment batches) ═══ */

export function filterOutlierEmbeddings(embeddings: number[][]): number[][] {
  const MIN_KEEP = 3;
  let filtered = [...embeddings];

  // Multi-pass: remove up to (length - MIN_KEEP) outliers
  while (filtered.length > MIN_KEEP) {
    const scores = filtered.map((emb, i) => {
      let totalSim = 0;
      for (let j = 0; j < filtered.length; j++) {
        if (i !== j) totalSim += cosineSim(emb, filtered[j]);
      }
      return totalSim / (filtered.length - 1);
    });

    let worstIdx = 0;
    let worstScore = scores[0];
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] < worstScore) { worstScore = scores[i]; worstIdx = i; }
    }

    const meanScore = scores.reduce((a, b) => a + b) / scores.length;
    // Tighter threshold: 0.08 instead of 0.1
    if (worstScore < meanScore - 0.08) {
      filtered = filtered.filter((_, i) => i !== worstIdx);
    } else {
      break; // no more outliers
    }
  }

  return filtered;
}

/** Compute a confidence metric for enrollment quality (0-1) */
export function computeEnrollmentConfidence(embeddings: number[][]): number {
  if (embeddings.length < 2) return 0;
  let totalSim = 0;
  let pairs = 0;
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      totalSim += cosineSim(embeddings[i], embeddings[j]);
      pairs++;
    }
  }
  return pairs > 0 ? clamp(totalSim / pairs, 0, 1) : 0;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; nA += a[i] ** 2; nB += b[i] ** 2; }
  const d = Math.sqrt(nA) * Math.sqrt(nB);
  return d > 0 ? dot / d : 0;
}
