import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";
import { ensureProfile } from "@/lib/profile";
import { getFaceVerificationState } from "@/lib/face-verification";
import { requireFaceVerification } from "@/lib/face-verification";

export async function GET(request: NextRequest) {
  try {
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const verificationGate = await requireFaceVerification(userId);
    if (!verificationGate.ok) {
      return NextResponse.json({ error: verificationGate.error }, { status: verificationGate.status });
    }

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

    const verification = await getFaceVerificationState(userId);

    return NextResponse.json({
      user: {
        id: profile.id,
        username: profile.username,
        enrollmentStatus: template ? "enrolled" : "not_enrolled",
        verification,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
