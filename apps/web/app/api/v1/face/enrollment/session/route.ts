import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { createEnrollmentSession } from "@/lib/enrollment-session";
import { getRequestUserId } from "@/lib/request-user";

export async function POST(request: NextRequest) {
  const userId = await getRequestUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = createEnrollmentSession(userId, 600);
  return NextResponse.json(session);
}
