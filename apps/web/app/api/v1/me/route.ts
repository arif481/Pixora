import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";
import { ensureProfile } from "@/lib/profile";

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    await ensureProfile(userId);

    const supabase = createSupabaseServerClient();
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: profileError?.message ?? "Profile not found" }, { status: 500 });
    }

    const { data: template } = await supabase
      .from("face_templates")
      .select("id")
      .eq("user_id", userId)
      .eq("is_primary", true)
      .maybeSingle();

    return NextResponse.json({
      user: {
        id: profile.id,
        username: profile.username,
        enrollmentStatus: template ? "enrolled" : "not_enrolled",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
