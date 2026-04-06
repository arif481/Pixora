import { NextRequest, NextResponse } from "next/server";
import { cosineSimilarity, parseVector } from "@/lib/embeddings";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";

const LOGIN_VERIFY_THRESHOLD = Number(process.env.LOGIN_VERIFY_THRESHOLD ?? 0.62);
const LOGIN_VERIFY_MIN_QUALITY = Number(process.env.LOGIN_VERIFY_MIN_QUALITY ?? 0.5);
const LOGIN_VERIFY_WINDOW_MINUTES = Number(process.env.LOGIN_VERIFY_WINDOW_MINUTES ?? 5);
const LOGIN_VERIFY_MAX_ATTEMPTS = Number(process.env.LOGIN_VERIFY_MAX_ATTEMPTS ?? 8);
const WINDOW_SCORE_WEIGHTS = [0.5, 0.3, 0.2];

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

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const probe = normalizeEmbedding(body?.embedding);
    const probeWindow = Array.isArray(body?.embeddings)
      ? body.embeddings
          .map((embedding: unknown) => normalizeEmbedding(embedding))
          .filter((embedding: number[] | null): embedding is number[] => Boolean(embedding))
      : [];
    const probes: number[][] = probeWindow.length > 0 ? probeWindow : probe ? [probe] : [];
    const qualityScores = Array.isArray(body?.qualityScores)
      ? body.qualityScores
          .map((score: unknown) => Number(score))
          .filter((score: number) => Number.isFinite(score))
      : [];
    const qualityScore =
      qualityScores.length > 0
        ? Math.max(...qualityScores)
        : Number(body?.qualityScore ?? 0);

    if (probes.length === 0) {
      return NextResponse.json(
        { error: "embedding must contain 512 numbers" },
        { status: 400 }
      );
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

    const { data: templates } = await supabase
      .from("face_templates")
      .select("embedding")
      .eq("user_id", userId)
      .order("is_primary", { ascending: false });

    if (!templates || templates.length === 0) {
      return NextResponse.json({ error: "Face enrollment required" }, { status: 428 });
    }

    const templateVectors = templates
      .map((template) => parseVector(template.embedding))
      .filter((template) => template.length === 512);

    if (templateVectors.length === 0) {
      return NextResponse.json({ error: "Stored face template is invalid" }, { status: 500 });
    }

    const perProbeScores = probes.map((probeVector) =>
      templateVectors.reduce((bestScore, templateVector) => {
        const score = cosineSimilarity(probeVector, templateVector);
        return Math.max(bestScore, score);
      }, 0)
    );
    const rankedScores = [...perProbeScores].sort((left, right) => right - left);
    const weightedScores = rankedScores.slice(0, WINDOW_SCORE_WEIGHTS.length);
    const appliedWeights = WINDOW_SCORE_WEIGHTS.slice(0, weightedScores.length);
    const weightTotal = appliedWeights.reduce((sum, value) => sum + value, 0) || 1;
    const weightedScore =
      weightedScores.reduce((sum, score, index) => sum + score * appliedWeights[index], 0) /
      weightTotal;
    const bestScore = rankedScores[0] ?? 0;
    const weightedThreshold = Math.max(0, LOGIN_VERIFY_THRESHOLD - 0.03);

    if (bestScore < LOGIN_VERIFY_THRESHOLD || weightedScore < weightedThreshold) {
      await supabase.from("audit_logs").insert({
        actor_user_id: userId,
        action: "login_face_verify_failed",
        entity_type: "profile",
        entity_id: userId,
        metadata: {
          score: Number(weightedScore.toFixed(5)),
          bestScore: Number(bestScore.toFixed(5)),
          threshold: LOGIN_VERIFY_THRESHOLD,
          qualityScore,
          probeCount: probes.length,
          verificationMode: body?.verificationMode ?? "unknown",
        },
      });

      return NextResponse.json(
        {
          error: "Face verification failed",
          score: Number(weightedScore.toFixed(5)),
          bestScore: Number(bestScore.toFixed(5)),
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
        score: Number(weightedScore.toFixed(5)),
        bestScore: Number(bestScore.toFixed(5)),
        threshold: LOGIN_VERIFY_THRESHOLD,
        qualityScore,
        probeCount: probes.length,
        verificationMode: body?.verificationMode ?? "unknown",
      },
    });

    return NextResponse.json({
      status: "verified",
      score: Number(weightedScore.toFixed(5)),
      bestScore: Number(bestScore.toFixed(5)),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
