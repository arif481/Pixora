import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "@/lib/server-config";
import { cosineSimilarity } from "@/lib/embeddings";

function verifyToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  const expected = `Bearer ${requireEnv("FACE_ENGINE_TOKEN")}`;
  return header === expected;
}

export async function POST(request: NextRequest) {
  try {
    if (!verifyToken(request)) {
      return NextResponse.json({ error: "Invalid engine token" }, { status: 403 });
    }

    const body = await request.json();
    if (!Array.isArray(body?.probe_embedding) || !Array.isArray(body?.candidates)) {
      return NextResponse.json({ error: "probe_embedding and candidates are required" }, { status: 400 });
    }

    const scored = body.candidates
      .map((candidate: number[], index: number) => ({
        candidate_index: index,
        confidence: cosineSimilarity(body.probe_embedding, candidate),
      }))
      .sort((a: { confidence: number }, b: { confidence: number }) => b.confidence - a.confidence)
      .slice(0, 5);

    return NextResponse.json({ top_matches: scored });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
