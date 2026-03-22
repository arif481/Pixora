import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  return NextResponse.json(
    {
      error:
        "Internal face-engine endpoints are disabled. Configure FACE_ENGINE_URL to an external real inference service.",
    },
    { status: 410 }
  );
}
