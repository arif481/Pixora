import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { createEnrollmentSession } from "@/lib/enrollment-session";
import { getRequestUserId } from "@/lib/request-user";
import { ensureProfile } from "@/lib/profile";

export async function POST(request: NextRequest) {
  try {
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureProfile(userId);
    const session = await createEnrollmentSession(userId, 1800);
    return NextResponse.json(session);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create enrollment session" },
      { status: 500 }
    );
  }
}

