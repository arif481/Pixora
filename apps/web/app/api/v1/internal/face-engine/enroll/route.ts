import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "@/lib/server-config";
import { stableEmbedding } from "@/lib/face-engine-stub";

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

    const url = new URL(request.url);
    const imageUrl = url.searchParams.get("image_url");
    if (!imageUrl) {
      return NextResponse.json({ error: "image_url is required" }, { status: 400 });
    }

    return NextResponse.json({
      model_version: "stub-v1",
      quality_passed: true,
      embedding: stableEmbedding(`enroll:${imageUrl}`),
      flags: [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
