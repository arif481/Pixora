import { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "@/lib/server-config";
import { detectFacesSimulated } from "@/lib/face-engine-sim";

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
    if (!body?.image_url || typeof body.image_url !== "string") {
      return NextResponse.json({ error: "image_url is required" }, { status: 400 });
    }

    return NextResponse.json({
      model_version: "sim-v1",
      faces: detectFacesSimulated(body.image_url),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
