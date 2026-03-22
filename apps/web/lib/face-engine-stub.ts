import { createHash } from "node:crypto";

const EMBEDDING_SIZE = 512;

function seedFromText(text: string): number {
  const digest = createHash("sha256").update(text).digest();
  return digest.readUInt32BE(0);
}

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return function next() {
    value += 0x6d2b79f5;
    let temp = Math.imul(value ^ (value >>> 15), 1 | value);
    temp ^= temp + Math.imul(temp ^ (temp >>> 7), 61 | temp);
    return ((temp ^ (temp >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(vector: number[]): number[] {
  let norm = 0;
  for (const item of vector) {
    norm += item * item;
  }

  if (norm === 0) {
    return vector;
  }

  const scale = Math.sqrt(norm);
  return vector.map((item) => item / scale);
}

export function stableEmbedding(seedText: string): number[] {
  const rng = mulberry32(seedFromText(seedText));
  const vector: number[] = [];

  for (let index = 0; index < EMBEDDING_SIZE; index += 1) {
    vector.push(rng() * 2 - 1);
  }

  return normalize(vector);
}

export function detectFacesStub(imageUrl: string) {
  return [
    {
      bbox: { x: 120, y: 80, w: 190, h: 190 },
      quality_score: 0.93,
      embedding: stableEmbedding(imageUrl),
    },
  ];
}
