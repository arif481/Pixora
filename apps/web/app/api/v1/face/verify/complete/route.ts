import { NextRequest, NextResponse } from "next/server";
import { cosineSimilarity, parseVector } from "@/lib/embeddings";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";

const LOGIN_VERIFY_THRESHOLD = Number(process.env.LOGIN_VERIFY_THRESHOLD ?? 0.62);
const LOGIN_VERIFY_MIN_QUALITY = Number(process.env.LOGIN_VERIFY_MIN_QUALITY ?? 0.55);
const LOGIN_VERIFY_WINDOW_MINUTES = Number(process.env.LOGIN_VERIFY_WINDOW_MINUTES ?? 5);
const LOGIN_VERIFY_MAX_ATTEMPTS = Number(process.env.LOGIN_VERIFY_MAX_ATTEMPTS ?? 8);

function normalizeEmbedding(input: unknown) {
  if (!Array.isArray(input)) {
    return null;
  }

  const values = input.map((value) => Number(value));
  if (values.length !== 512 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return values;
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const probe = normalizeEmbedding(body?.embedding);
    const qualityScore = Number(body?.qualityScore ?? 0);

    if (!probe) {
      return NextResponse.json({ error: "embedding must contain 512 numbers" }, { status: 400 });
    }

    if (!Number.isFinite(qualityScore) || qualityScore < LOGIN_VERIFY_MIN_QUALITY) {
      return NextResponse.json({ error: "Face quality too low for verification" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const attemptWindowStart = new Date(
      Date.now() - Math.max(1, LOGIN_VERIFY_WINDOW_MINUTES) * 60 * 1000
    ).toISOString();

    const { count: recentFailures } = await supabase
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("actor_user_id", userId)
      .eq("action", "login_face_verify_failed")
      .gte("created_at", attemptWindowStart);

    if ((recentFailures ?? 0) >= Math.max(1, LOGIN_VERIFY_MAX_ATTEMPTS)) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please retry shortly." },
        { status: 429 }
      );
    }

    const { data: template } = await supabase
      .from("face_templates")
      .select("embedding")
      .eq("user_id", userId)
      .eq("is_primary", true)
      .maybeSingle<{ embedding: unknown }>();

    if (!template) {
      return NextResponse.json({ error: "Face enrollment required" }, { status: 428 });
    }

    const primary = parseVector(template.embedding);
    if (primary.length !== 512) {
      return NextResponse.json({ error: "Stored face template is invalid" }, { status: 500 });
    }

    const score = cosineSimilarity(probe, primary);
    if (score < LOGIN_VERIFY_THRESHOLD) {
      await supabase.from("audit_logs").insert({
        actor_user_id: userId,
        action: "login_face_verify_failed",
        entity_type: "profile",
        entity_id: userId,
        metadata: {
          score: Number(score.toFixed(5)),
          threshold: LOGIN_VERIFY_THRESHOLD,
          qualityScore,
        },
      });

      return NextResponse.json(
        {
          error: "Face verification failed",
          score: Number(score.toFixed(5)),
        },
        { status: 403 }
      );
    }

    await supabase.from("audit_logs").insert({
      actor_user_id: userId,
      action: "login_face_verified",
      entity_type: "profile",
      entity_id: userId,
      metadata: {
        score: Number(score.toFixed(5)),
        threshold: LOGIN_VERIFY_THRESHOLD,
        qualityScore,
      },
    });

    return NextResponse.json({
      status: "verified",
      score: Number(score.toFixed(5)),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
