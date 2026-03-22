import { NextRequest, NextResponse } from "next/server";
import { consumeEnrollmentSession } from "@/lib/enrollment-session";
import { getRequestUserId } from "@/lib/request-user";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { requireEnv } from "@/lib/server-config";
import { ensureProfile } from "@/lib/profile";

type EngineEnrollResponse = {
  model_version: string;
  quality_passed: boolean;
  embedding?: number[];
  flags?: string[];
};

function vectorLiteral(values: number[]) {
  return `[${values.join(",")}]`;
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    await ensureProfile(userId);
    const body = await request.json();
    if (!body?.sessionId || !body?.imageUrl) {
      return NextResponse.json({ error: "sessionId and imageUrl are required" }, { status: 400 });
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

    const faceEngineUrl = requireEnv("FACE_ENGINE_URL");
    const faceEngineToken = requireEnv("FACE_ENGINE_TOKEN");
    const enrollUrl = `${faceEngineUrl.replace(/\/$/, "")}/enroll?image_url=${encodeURIComponent(body.imageUrl)}`;
    const enrollResponse = await fetch(enrollUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${faceEngineToken}`,
      },
    });

    if (!enrollResponse.ok) {
      const errorText = await enrollResponse.text();
      return NextResponse.json(
        { error: `Face engine enroll failed: ${errorText}` },
        { status: 502 }
      );
    }

    const enrollment = (await enrollResponse.json()) as EngineEnrollResponse;
    if (!enrollment.quality_passed || !enrollment.embedding?.length) {
      return NextResponse.json(
        { error: "Enrollment quality check failed", flags: enrollment.flags ?? [] },
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
        embedding: vectorLiteral(enrollment.embedding),
        model_version: enrollment.model_version,
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
      modelVersion: enrollment.model_version,
      templateId: template.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
