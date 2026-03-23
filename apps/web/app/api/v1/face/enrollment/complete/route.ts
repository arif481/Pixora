import { NextRequest, NextResponse } from "next/server";
import { consumeEnrollmentSession } from "@/lib/enrollment-session";
import { getRequestUserId } from "@/lib/request-user";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { BROWSER_FACE_MODEL_VERSION } from "@/lib/face-model";
import { ensureProfile } from "@/lib/profile";

const MIN_ENROLL_QUALITY = Number(process.env.MIN_ENROLL_QUALITY ?? 0.5);

function vectorLiteral(values: number[]) {
  return `[${values.join(",")}]`;
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureProfile(userId);
    const body = await request.json();
    if (!body?.sessionId || !Array.isArray(body?.embedding)) {
      return NextResponse.json(
        { error: "sessionId and embedding are required" },
        { status: 400 }
      );
    }

    if (!consumeEnrollmentSession(body.sessionId, userId)) {
      return NextResponse.json({ error: "Invalid or expired enrollment session" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const { data: consent } = await supabase
      .from("consent_records")
      .select("id, biometric_consent")
      .eq("user_id", userId)
      .eq("biometric_consent", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!consent) {
      return NextResponse.json({ error: "Biometric consent required" }, { status: 400 });
    }

    const embedding = body.embedding
      .map((value: unknown) => Number(value))
      .filter((value: number) => Number.isFinite(value));

    if (embedding.length !== 512) {
      return NextResponse.json({ error: "embedding must contain 512 numbers" }, { status: 400 });
    }

    const qualityScore = Number(body.qualityScore ?? 0);
    const qualityPassed = Number.isFinite(qualityScore) && qualityScore >= MIN_ENROLL_QUALITY;

    if (!qualityPassed) {
      return NextResponse.json(
        {
          error: "Enrollment quality check failed",
          flags: Array.isArray(body.flags) ? body.flags : ["low-face-quality"],
        },
        { status: 400 }
      );
    }

    await supabase
      .from("face_templates")
      .update({ is_primary: false })
      .eq("user_id", userId)
      .eq("is_primary", true);

    const { data: template, error: templateError } = await supabase
      .from("face_templates")
      .insert({
        user_id: userId,
        embedding: vectorLiteral(embedding),
        model_version:
          typeof body.modelVersion === "string" && body.modelVersion.length > 0
            ? body.modelVersion
            : BROWSER_FACE_MODEL_VERSION,
        is_primary: true,
      })
      .select("id")
      .single();

    if (templateError || !template) {
      return NextResponse.json(
        { error: templateError?.message ?? "Failed to save template" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "enrolled",
      modelVersion:
        typeof body.modelVersion === "string" && body.modelVersion.length > 0
          ? body.modelVersion
          : BROWSER_FACE_MODEL_VERSION,
      templateId: template.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
