import { NextRequest, NextResponse } from "next/server";
import { processNextJob } from "@/lib/worker";
import { requireEnv } from "@/lib/server-config";

function isAuthorized(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header) {
    return false;
  }

  const expected = `Bearer ${requireEnv("INTERNAL_WORKER_TOKEN")}`;
  return header === expected;
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await processNextJob();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
