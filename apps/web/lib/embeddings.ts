export function vectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export function parseVector(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item));
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.startsWith("[") && normalized.endsWith("]")) {
      const content = normalized.slice(1, -1).trim();
      if (!content) {
        return [];
      }

      return content.split(",").map((item) => Number(item.trim()));
    }
  }

  return [];
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const size = Math.min(a.length, b.length);
  if (size === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < size; index += 1) {
    const va = a[index];
    const vb = b[index];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
