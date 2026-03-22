import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";
import { ensureProfile } from "@/lib/profile";

export async function POST(request: NextRequest) {
  try {
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureProfile(userId);
    const body = await request.json();

    if (body?.biometricConsent !== true || typeof body?.version !== "string") {
      return NextResponse.json({ error: "valid biometric consent is required" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("consent_records")
      .insert({
        user_id: userId,
        biometric_consent: true,
        consent_version: body.version,
      })
      .select("id, biometric_consent, consent_version, created_at")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? "Failed to save consent" }, { status: 500 });
    }

    return NextResponse.json({
      status: "ok",
      consent: {
        id: data.id,
        biometricConsent: data.biometric_consent,
        version: data.consent_version,
        createdAt: data.created_at,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
