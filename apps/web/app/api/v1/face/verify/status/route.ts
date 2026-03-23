import { NextRequest, NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/request-user";
import { getFaceVerificationState } from "@/lib/face-verification";

export async function GET(request: NextRequest) {
  try {
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const state = await getFaceVerificationState(userId);
    return NextResponse.json({ verification: state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
