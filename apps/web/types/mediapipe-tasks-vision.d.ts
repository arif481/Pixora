declare module "@mediapipe/tasks-vision" {
  export type FaceLandmarkerResult = {
    faceLandmarks?: Array<Array<{ x: number; y: number; z: number; visibility?: number; presence?: number }>>;
    faceBlendshapes?: Array<{ categories?: Array<{ categoryName: string; score: number }> }>;
  };

  export class FilesetResolver {
    static forVisionTasks(path: string): Promise<unknown>;
  }

  export class FaceLandmarker {
    static createFromOptions(fileset: unknown, options: unknown): Promise<FaceLandmarker>;
    detect(image: HTMLImageElement): FaceLandmarkerResult;
  }
}