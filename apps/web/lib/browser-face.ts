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
  embedding: number[];
};

const EMBEDDING_SIZE = 512;
const VISION_WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const FACE_LANDMARKER_MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeVector(input: number[]) {
  let squared = 0;
  for (const value of input) {
    squared += value * value;
  }

  if (squared === 0) {
    return input;
  }

  const norm = Math.sqrt(squared);
  return input.map((value) => value / norm);
}

function resampleToEmbeddingSize(raw: number[]) {
  if (raw.length === 0) {
    return new Array(EMBEDDING_SIZE).fill(0);
  }

  if (raw.length === EMBEDDING_SIZE) {
    return normalizeVector(raw);
  }

  const output = new Array<number>(EMBEDDING_SIZE);
  const maxInputIndex = raw.length - 1;

  for (let index = 0; index < EMBEDDING_SIZE; index += 1) {
    const position = (index * maxInputIndex) / (EMBEDDING_SIZE - 1);
    const low = Math.floor(position);
    const high = Math.min(maxInputIndex, Math.ceil(position));
    const weight = position - low;
    output[index] = raw[low] * (1 - weight) + raw[high] * weight;
  }

  return normalizeVector(output);
}

function createEmbedding(
  landmarks: Array<{ x: number; y: number; z: number }> = [],
  blendshapes: Array<{ categoryName: string; score: number }> = []
) {
  const landmarkValues: number[] = [];
  for (const point of landmarks) {
    landmarkValues.push(point.x, point.y, point.z);
  }

  const sortedBlendshapes = [...blendshapes].sort((a, b) =>
    a.categoryName.localeCompare(b.categoryName)
  );
  const blendshapeValues = sortedBlendshapes.map((shape) => shape.score);

  return resampleToEmbeddingSize([...landmarkValues, ...blendshapeValues]);
}

function getPresenceQuality(landmarks: Array<{ visibility?: number; presence?: number }> = []) {
  const values = landmarks
    .map((point) => (typeof point.visibility === "number" ? point.visibility : point.presence))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (values.length === 0) {
    return 0.8;
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return clamp(average, 0, 1);
}

function computeBox(
  landmarks: Array<{ x: number; y: number }>,
  width: number,
  height: number
) {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

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

export async function detectBrowserFaces(file: File): Promise<BrowserFace[]> {
  const image = await createImageFromFile(file);
  const landmarker = await getLandmarker();
  const result = landmarker.detect(image);

  const landmarksPerFace = result.faceLandmarks ?? [];
  const blendshapesPerFace = result.faceBlendshapes ?? [];

  const faces: BrowserFace[] = [];

  for (let index = 0; index < landmarksPerFace.length; index += 1) {
    const landmarks = landmarksPerFace[index] ?? [];
    if (!landmarks.length) {
      continue;
    }

    const blendshapeCategories = blendshapesPerFace[index]?.categories ?? [];
    const qualityScore = getPresenceQuality(landmarks as Array<{ visibility?: number; presence?: number }>);

    faces.push({
      bbox: computeBox(landmarks as Array<{ x: number; y: number }>, image.naturalWidth, image.naturalHeight),
      qualityScore,
      embedding: createEmbedding(
        landmarks as Array<{ x: number; y: number; z: number }>,
        blendshapeCategories as Array<{ categoryName: string; score: number }>
      ),
    });
  }

  return faces;
}
