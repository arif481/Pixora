import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function ensureProfile(userId: string) {
  const supabase = createSupabaseServerClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (profile) {
    return;
  }

  const username = `user_${userId.slice(0, 8)}`;
  await supabase.from("profiles").insert({
    id: userId,
    username,
    display_name: username,
  });
}
