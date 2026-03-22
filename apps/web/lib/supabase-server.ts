import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/server-config";

export function createSupabaseServerClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
