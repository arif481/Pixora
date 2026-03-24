import { createSupabaseServerClient } from "@/lib/supabase-server";

export function createEnrollmentSession(userId: string, ttlSeconds = 600) {
  const sessionId = crypto.randomUUID();
  const supabase = createSupabaseServerClient();

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  // Fire-and-forget insert — if it fails the session simply won't be found later
  void supabase.from("enrollment_sessions").insert({
    id: sessionId,
    user_id: userId,
    expires_at: expiresAt,
  });

  return { sessionId, expiresInSeconds: ttlSeconds };
}

export async function consumeEnrollmentSession(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const supabase = createSupabaseServerClient();

  const { data: session } = await supabase
    .from("enrollment_sessions")
    .select("id, user_id, expires_at")
    .eq("id", sessionId)
    .maybeSingle<{ id: string; user_id: string; expires_at: string }>();

  if (!session) {
    return false;
  }

  // Always delete after consuming
  await supabase.from("enrollment_sessions").delete().eq("id", sessionId);

  if (session.user_id !== userId) {
    return false;
  }

  return new Date(session.expires_at).getTime() > Date.now();
}
