import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { BROWSER_FACE_MODEL_VERSION } from "@/lib/face-model";

export type BrowserFace = {
  bbox: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  qualityScore: number;
  /** Expression-invariant geometric embedding for identity matching */
  embedding: number[];
  liveness: {
    blink: number;
    smile: number;
    mouthOpen: number;
    yaw: number;
  };
};

const EMBEDDING_SIZE = 512;
const VISION_WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const FACE_LANDMARKER_MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/* ─── Vector helpers ─── */

function normalizeVector(input: number[]) {
  let squared = 0;
  for (const value of input) {
    squared += value * value;
  }
  if (squared === 0) return input;
  const norm = Math.sqrt(squared);
  return input.map((v) => v / norm);
}

/* ─── Landmark index sets (MediaPipe 478-point mesh) ─── */

// Key anatomical landmark indices for structural features
const LEFT_EYE_INNER = 133;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;
const NOSE_TIP = 1;
const NOSE_BRIDGE = 6;
const LEFT_MOUTH_CORNER = 61;
const RIGHT_MOUTH_CORNER = 291;
const CHIN = 152;
const FOREHEAD = 10;
const LEFT_CHEEK = 234;
const RIGHT_CHEEK = 454;
const LEFT_EAR = 127;
const RIGHT_EAR = 356;
const UPPER_LIP = 13;
const LOWER_LIP = 14;
const NOSE_LEFT = 98;
const NOSE_RIGHT = 327;
const LEFT_EYEBROW_INNER = 107;
const LEFT_EYEBROW_OUTER = 70;
const RIGHT_EYEBROW_INNER = 336;
const RIGHT_EYEBROW_OUTER = 300;
const LEFT_JAW = 172;
const RIGHT_JAW = 397;

// Structural landmarks (less affected by expression)
const STRUCTURAL_INDICES = [
  // Eye corners (4)
  LEFT_EYE_INNER, LEFT_EYE_OUTER, RIGHT_EYE_INNER, RIGHT_EYE_OUTER,
  // Nose (5)
  NOSE_TIP, NOSE_BRIDGE, NOSE_LEFT, NOSE_RIGHT, 4,
  // Face outline (6)
  CHIN, FOREHEAD, LEFT_CHEEK, RIGHT_CHEEK, LEFT_EAR, RIGHT_EAR,
  // Eyebrows (4)
  LEFT_EYEBROW_INNER, LEFT_EYEBROW_OUTER, RIGHT_EYEBROW_INNER, RIGHT_EYEBROW_OUTER,
  // Jaw (2)
  LEFT_JAW, RIGHT_JAW,
  // Additional structural points around face contour
  21, 54, 103, 67, 109, 10, 338, 297, 332, 284,
  // Forehead & temples
  251, 389, 162, 356, 127,
  // Additional nose bridge
  168, 197, 195, 5,
  // Cheekbone
  116, 345, 123, 352,
  // Chin contour
  150, 149, 176, 148, 377, 378, 400, 379,
];

// Pairs of structural landmarks for distance features
const STRUCTURAL_PAIRS: [number, number][] = [];

function initStructuralPairs() {
  if (STRUCTURAL_PAIRS.length > 0) return;

  // Generate all unique pairs from structural indices
  for (let i = 0; i < STRUCTURAL_INDICES.length; i++) {
    for (let j = i + 1; j < STRUCTURAL_INDICES.length; j++) {
      STRUCTURAL_PAIRS.push([STRUCTURAL_INDICES[i], STRUCTURAL_INDICES[j]]);
    }
  }
}

type P3 = { x: number; y: number; z: number };

function dist3d(a: P3, b: P3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Create an expression-invariant geometric embedding.
 *
 * Strategy:
 * 1. Normalize face: translate to nose origin, scale by inter-eye distance
 * 2. Compute pairwise distances between structural landmarks
 * 3. Compute facial ratios for scale-invariant features
 * 4. Combine, pad/truncate to EMBEDDING_SIZE, L2-normalize
 */
function createGeometricEmbedding(
  landmarks: Array<{ x: number; y: number; z: number }>
): number[] {
  if (landmarks.length < 468) {
    return new Array(EMBEDDING_SIZE).fill(0);
  }

  initStructuralPairs();

  const leftEye = landmarks[LEFT_EYE_OUTER];
  const rightEye = landmarks[RIGHT_EYE_OUTER];
  const noseTip = landmarks[NOSE_TIP];

  // Inter-eye distance as normalization scale
  const interEyeDist = dist3d(leftEye, rightEye);
  if (interEyeDist < 1e-6) {
    return new Array(EMBEDDING_SIZE).fill(0);
  }

  // Translate so nose tip is origin, scale by inter-eye distance
  const norm: P3[] = landmarks.map((p) => ({
    x: (p.x - noseTip.x) / interEyeDist,
    y: (p.y - noseTip.y) / interEyeDist,
    z: (p.z - noseTip.z) / interEyeDist,
  }));

  // Feature 1: Normalized structural landmark positions (x, y, z)
  const posFeatures: number[] = [];
  for (const idx of STRUCTURAL_INDICES) {
    if (idx < norm.length) {
      posFeatures.push(norm[idx].x, norm[idx].y, norm[idx].z);
    }
  }

  // Feature 2: Pairwise distances between structural landmarks (normalized)
  const distFeatures: number[] = [];
  // Take a subset to keep size manageable
  const maxPairs = Math.min(STRUCTURAL_PAIRS.length, 300);
  for (let i = 0; i < maxPairs; i++) {
    const [a, b] = STRUCTURAL_PAIRS[i];
    if (a < norm.length && b < norm.length) {
      distFeatures.push(dist3d(norm[a], norm[b]));
    }
  }

  // Feature 3: Key facial ratios (very identity-discriminative)
  const chin = norm[CHIN];
  const forehead = norm[FOREHEAD];
  const leftCheek = norm[LEFT_CHEEK];
  const rightCheek = norm[RIGHT_CHEEK];
  const leftMouth = norm[LEFT_MOUTH_CORNER];
  const rightMouth = norm[RIGHT_MOUTH_CORNER];
  const noseBridge = norm[NOSE_BRIDGE];

  const faceHeight = dist3d(forehead, chin);
  const faceWidth = dist3d(leftCheek, rightCheek);

  const ratioFeatures: number[] = [];
  if (faceHeight > 1e-6 && faceWidth > 1e-6) {
    ratioFeatures.push(
      faceWidth / faceHeight,                                    // face aspect ratio
      dist3d(norm[LEFT_EYE_INNER], norm[RIGHT_EYE_INNER]) / faceWidth, // inner eye width ratio
      dist3d(noseTip, noseBridge) / faceHeight,                  // nose length ratio
      dist3d(leftMouth, rightMouth) / faceWidth,                 // mouth width ratio
      dist3d(noseTip, chin) / faceHeight,                        // nose-to-chin ratio
      dist3d(forehead, noseBridge) / faceHeight,                 // forehead-to-nose ratio
      dist3d(norm[LEFT_EYEBROW_OUTER], norm[LEFT_EYE_OUTER]) / faceHeight, // eyebrow height left
      dist3d(norm[RIGHT_EYEBROW_OUTER], norm[RIGHT_EYE_OUTER]) / faceHeight, // eyebrow height right
      dist3d(norm[LEFT_JAW], norm[RIGHT_JAW]) / faceWidth,      // jaw width ratio
      dist3d(norm[NOSE_LEFT], norm[NOSE_RIGHT]) / faceWidth,    // nose width ratio
      dist3d(norm[LEFT_EAR], norm[RIGHT_EAR]) / faceWidth,      // ear width ratio
    );
  }

  // Combine all features
  const raw = [...posFeatures, ...distFeatures, ...ratioFeatures];

  // Pad or truncate to EMBEDDING_SIZE
  const embedding = new Array<number>(EMBEDDING_SIZE).fill(0);
  for (let i = 0; i < Math.min(raw.length, EMBEDDING_SIZE); i++) {
    embedding[i] = raw[i];
  }

  return normalizeVector(embedding);
}

/* ─── Quality & bounding box ─── */

/**
 * Compute face quality from structural signals rather than MediaPipe's
 * visibility/presence values (which are near-zero for face landmarks).
 *
 * Signals used:
 *  - Face size relative to image (larger = better)
 *  - Landmark spread (faces that fill the detection area = better)
 *  - Facial symmetry (frontal faces = better)
 *  - Landmark count (more detected = better)
 */
function computeQualityScore(
  landmarks: Array<{ x: number; y: number; z: number }>,
  imageWidth: number,
  imageHeight: number
): number {
  if (landmarks.length < 100) return 0.1;

  // 1. Landmark count score (expect 468+)
  const countScore = clamp(landmarks.length / 468, 0, 1);

  // 2. Face size relative to image
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const faceW = maxX - minX;
  const faceH = maxY - minY;
  const faceArea = faceW * faceH;
  // A face covering ~5-50% of the image is ideal
  const sizeScore = clamp(faceArea / 0.15, 0, 1);

  // 3. Symmetry score (how centered is nose between eyes)
  const leftEye = landmarks[LEFT_EYE_OUTER];
  const rightEye = landmarks[RIGHT_EYE_OUTER];
  const nose = landmarks[NOSE_TIP];
  let symmetryScore = 0.8;
  if (leftEye && rightEye && nose) {
    const midX = (leftEye.x + rightEye.x) / 2;
    const eyeDist = Math.abs(rightEye.x - leftEye.x);
    if (eyeDist > 0.001) {
      const asymmetry = Math.abs(nose.x - midX) / eyeDist;
      symmetryScore = clamp(1 - asymmetry * 2, 0, 1);
    }
  }

  // 4. Face proportions check (aspect ratio sanity)
  const aspectRatio = faceH > 0 ? faceW / faceH : 0;
  const proportionScore = (aspectRatio > 0.5 && aspectRatio < 1.5) ? 1.0 : 0.5;

  // Weighted combination
  const quality =
    countScore * 0.2 +
    sizeScore * 0.35 +
    symmetryScore * 0.3 +
    proportionScore * 0.15;

  return clamp(quality, 0, 1);
}

function computeBox(
  landmarks: Array<{ x: number; y: number }>,
  width: number,
  height: number
) {
  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;

  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const x = Math.round(clamp(minX, 0, 1) * width);
  const y = Math.round(clamp(minY, 0, 1) * height);
  const w = Math.max(1, Math.round((clamp(maxX, 0, 1) - clamp(minX, 0, 1)) * width));
  const h = Math.max(1, Math.round((clamp(maxY, 0, 1) - clamp(minY, 0, 1)) * height));

  return { x, y, w, h };
}

/* ─── Liveness signals (kept separate from identity embedding) ─── */

function getBlendshapeScore(
  blendshapes: Array<{ categoryName: string; score: number }>,
  categoryName: string
) {
  const found = blendshapes.find((s) => s.categoryName === categoryName);
  return clamp(found?.score ?? 0, 0, 1);
}

function estimateYaw(landmarks: Array<{ x: number; y: number }>) {
  const leftEye = landmarks[LEFT_EYE_OUTER];
  const rightEye = landmarks[RIGHT_EYE_OUTER];
  const noseTip = landmarks[NOSE_TIP];

  if (!leftEye || !rightEye || !noseTip) return 0;

  const midEyeX = (leftEye.x + rightEye.x) / 2;
  const eyeDistance = Math.abs(rightEye.x - leftEye.x);
  if (eyeDistance < 0.0001) return 0;

  return clamp((noseTip.x - midEyeX) / eyeDistance, -1, 1);
}

/* ─── Image loading ─── */

async function createImageFromFile(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.crossOrigin = "anonymous";
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Failed to load image"));
      nextImage.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/* ─── Singleton landmarker ─── */

async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(VISION_WASM_PATH);
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: FACE_LANDMARKER_MODEL_PATH,
        },
        runningMode: "IMAGE",
        numFaces: 8,
        outputFaceBlendshapes: true,
      });
    })();
  }
  return landmarkerPromise;
}

/* ─── Main detection function ─── */

export async function detectBrowserFaces(file: File): Promise<BrowserFace[]> {
  const image = await createImageFromFile(file);
  const landmarker = await getLandmarker();
  const result = landmarker.detect(image);

  const landmarksPerFace = result.faceLandmarks ?? [];
  const blendshapesPerFace = result.faceBlendshapes ?? [];

  const faces: BrowserFace[] = [];

  for (let index = 0; index < landmarksPerFace.length; index += 1) {
    const landmarks = landmarksPerFace[index] ?? [];
    if (!landmarks.length) continue;

    const blendshapeCategories = (blendshapesPerFace[index]?.categories ??
      []) as Array<{ categoryName: string; score: number }>;
    const qualityScore = computeQualityScore(
      landmarks as Array<{ x: number; y: number; z: number }>,
      image.naturalWidth,
      image.naturalHeight
    );

    faces.push({
      bbox: computeBox(
        landmarks as Array<{ x: number; y: number }>,
        image.naturalWidth,
        image.naturalHeight
      ),
      qualityScore,
      // NEW: Expression-invariant geometric embedding for identity
      embedding: createGeometricEmbedding(
        landmarks as Array<{ x: number; y: number; z: number }>
      ),
      // Liveness signals stay separate (blendshape-based)
      liveness: {
        blink: Math.max(
          getBlendshapeScore(blendshapeCategories, "eyeBlinkLeft"),
          getBlendshapeScore(blendshapeCategories, "eyeBlinkRight")
        ),
        smile:
          (getBlendshapeScore(blendshapeCategories, "mouthSmileLeft") +
            getBlendshapeScore(blendshapeCategories, "mouthSmileRight")) /
          2,
        mouthOpen: getBlendshapeScore(blendshapeCategories, "jawOpen"),
        yaw: estimateYaw(landmarks as Array<{ x: number; y: number }>),
      },
    });
  }

  return faces;
}
