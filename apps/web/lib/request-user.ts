import { NextRequest } from "next/server";

const DEFAULT_USER_ID = process.env.DEMO_USER_ID ?? "11111111-1111-1111-1111-111111111111";

export function getRequestUserId(request: NextRequest): string {
  const headerValue = request.headers.get("x-user-id");
  if (headerValue && headerValue.length > 10) {
    return headerValue;
  }

  return DEFAULT_USER_ID;
}
