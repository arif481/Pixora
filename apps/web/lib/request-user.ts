import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_USER_ID = process.env.DEMO_USER_ID ?? "11111111-1111-1111-1111-111111111111";
const ALLOW_DEMO_USER = process.env.ALLOW_DEMO_USER === "true";

function getBearerToken(request: NextRequest) {
  const headerValue = request.headers.get("authorization");
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export async function getRequestUserId(request: NextRequest): Promise<string | null> {
  const token = getBearerToken(request);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (token && supabaseUrl && supabaseAnonKey) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data.user?.id) {
      return data.user.id;
    }
  }

  if (ALLOW_DEMO_USER) {
    const headerUserId = request.headers.get("x-user-id");
    if (headerUserId && headerUserId.length > 10) {
      return headerUserId;
    }

    return DEFAULT_USER_ID;
  }

  return null;
}
