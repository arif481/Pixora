import { createSupabaseServerClient } from "@/lib/supabase-server";
import { cosineSimilarity, parseVector } from "@/lib/embeddings";
import { getThresholds } from "@/lib/server-config";

const MAX_FACES_PER_JOB = Number(process.env.MAX_FACES_PER_JOB ?? 40);
const MAX_JOB_ATTEMPTS = 5;
const RETRY_BASE_SECONDS = 300;
const RETRY_MAX_SECONDS = 3600;

type ProcessingJob = {
  id: string;
  photo_id: string;
  attempts: number;
};

type PhotoRecord = {
  id: string;
  group_id: string;
};

type FaceTemplate = {
  user_id: string;
  embedding: unknown;
};

type GroupMember = {
  user_id: string;
};

type PrecomputedPhotoFace = {
  id: string;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  quality_score: number | null;
  embedding: unknown;
};

type WorkerResult = {
  status: "processed" | "idle" | "failed";
  jobId?: string;
  photoId?: string;
  facesDetected?: number;
  matchesCreated?: number;
  sharesCreated?: number;
  reviewCreated?: number;
  error?: string;
};

const MATCH_GAP_THRESHOLD = Number(process.env.MATCH_GAP_THRESHOLD ?? 0.06);

function bestMatch(probe: number[], templates: Array<{ userId: string; embedding: number[] }>) {
  let bestUserId: string | null = null;
  let bestScore = -1;
  let secondBestScore = -1;

  for (const template of templates) {
    const score = cosineSimilarity(probe, template.embedding);
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestUserId = template.userId;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!bestUserId) {
    return null;
  }

  // Reject ambiguous matches — gap between best and second-best is too small
  if (secondBestScore >= 0 && bestScore - secondBestScore < MATCH_GAP_THRESHOLD) {
    return { userId: bestUserId, score: bestScore, ambiguous: true as const };
  }

  return { userId: bestUserId, score: bestScore, ambiguous: false as const };
}

async function claimNextJob() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("processing_jobs")
    .select("id, photo_id, attempts")
    .in("status", ["queued", "failed"])
    .lt("attempts", MAX_JOB_ATTEMPTS)
    .order("scheduled_at", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  const job = (data?.[0] as ProcessingJob | undefined) ?? null;
  if (!job) {
    return null;
  }

  const { data: updated, error: updateError } = await supabase
    .from("processing_jobs")
    .update({ status: "running", attempts: job.attempts + 1, last_error: null })
    .eq("id", job.id)
    .eq("attempts", job.attempts)
    .in("status", ["queued", "failed"])
    .select("id, photo_id, attempts")
    .single();

  if (updateError || !updated) {
    return null;
  }

  return updated as ProcessingJob;
}

function getRetryDelaySeconds(attempts: number) {
  const exponent = Math.max(0, attempts - 1);
  const delay = RETRY_BASE_SECONDS * 2 ** exponent;
  return Math.min(RETRY_MAX_SECONDS, delay);
}

async function failJob(jobId: string, photoId: string, message: string, attempts: number) {
  const supabase = createSupabaseServerClient();
  const delaySeconds = getRetryDelaySeconds(attempts);
  const nextRunAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  await supabase
    .from("processing_jobs")
    .update({
      status: "failed",
      last_error: message,
      scheduled_at: nextRunAt,
    })
    .eq("id", jobId);
  await supabase.from("photos").update({ status: "failed" }).eq("id", photoId);
}

export async function processNextJob(): Promise<WorkerResult> {
  const supabase = createSupabaseServerClient();
  const claimed = await claimNextJob();

  if (!claimed) {
    return { status: "idle" };
  }

  const { autoShare, reviewMin } = getThresholds();

  try {
    const { data: photo, error: photoError } = await supabase
      .from("photos")
      .select("id, group_id")
      .eq("id", claimed.photo_id)
      .single();

    if (photoError || !photo) {
      throw new Error(photoError?.message ?? "Photo not found");
    }

    const photoRecord = photo as PhotoRecord;
    await supabase.from("photos").update({ status: "processing" }).eq("id", photoRecord.id);

    const { data: precomputedFaces, error: precomputedFacesError } = await supabase
      .from("photo_faces")
      .select("id, bbox_x, bbox_y, bbox_w, bbox_h, quality_score, embedding")
      .eq("photo_id", photoRecord.id);

    if (precomputedFacesError) {
      throw new Error(precomputedFacesError.message);
    }

    const faceRows = (precomputedFaces ?? []) as PrecomputedPhotoFace[];
    const faceLimit = Number.isFinite(MAX_FACES_PER_JOB)
      ? Math.max(1, Math.floor(MAX_FACES_PER_JOB))
      : 40;
    const faces = faceRows.slice(0, faceLimit);

    if (faces.length === 0) {
      await supabase.from("photos").update({ status: "processed" }).eq("id", photoRecord.id);
      await supabase.from("processing_jobs").update({ status: "done", last_error: null }).eq("id", claimed.id);

      return {
        status: "processed",
        jobId: claimed.id,
        photoId: photoRecord.id,
        facesDetected: 0,
        matchesCreated: 0,
        sharesCreated: 0,
        reviewCreated: 0,
      };
    }

    const { data: members, error: membersError } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", photoRecord.group_id)
      .eq("status", "active");

    if (membersError) {
      throw new Error(membersError.message);
    }

    const memberIds = ((members ?? []) as GroupMember[]).map((member) => member.user_id);
    if (memberIds.length === 0) {
      await supabase.from("photos").update({ status: "processed" }).eq("id", photoRecord.id);
      await supabase.from("processing_jobs").update({ status: "done", last_error: null }).eq("id", claimed.id);

      return {
        status: "processed",
        jobId: claimed.id,
        photoId: photoRecord.id,
        facesDetected: faces.length,
        matchesCreated: 0,
        sharesCreated: 0,
        reviewCreated: 0,
      };
    }

    const { data: templates, error: templateError } = await supabase
      .from("face_templates")
      .select("user_id, embedding, is_primary")
      .in("user_id", memberIds);

    if (templateError) {
      throw new Error(templateError.message);
    }

    const templateRows = (templates ?? []) as (FaceTemplate & { is_primary: boolean })[];

    // Group templates by user — max score across all templates per user
    const userTemplates = new Map<string, number[][]>();
    for (const row of templateRows) {
      const emb = parseVector(row.embedding);
      if (emb.length === 0) continue;
      if (!userTemplates.has(row.user_id)) userTemplates.set(row.user_id, []);
      userTemplates.get(row.user_id)!.push(emb);
    }

    const candidateTemplates: Array<{ userId: string; embedding: number[] }> = [];
    for (const [userId, embeddings] of userTemplates) {
      for (const emb of embeddings) {
        candidateTemplates.push({ userId, embedding: emb });
      }
    }

    let matchesCreated = 0;
    let sharesCreated = 0;
    let reviewCreated = 0;

    for (const face of faces) {
      const faceEmbedding = parseVector(face.embedding);
      if (faceEmbedding.length !== 512) {
        continue;
      }

      const best = bestMatch(faceEmbedding, candidateTemplates);
      if (!best) {
        continue;
      }

      if (best.score < reviewMin) {
        continue;
      }

      // Skip ambiguous matches — too close between best and second-best
      if (best.ambiguous) {
        await supabase.from("audit_logs").insert({
          action: "ambiguous_match",
          entity_type: "photo_face",
          entity_id: face.id,
          metadata: { score: Number(best.score.toFixed(5)), userId: best.userId },
        });
        continue;
      }

      const decision = best.score >= autoShare ? "auto_shared" : "pending_review";
      const { data: upsertedMatch, error: matchError } = await supabase
        .from("face_matches")
        .upsert(
          {
            photo_face_id: face.id,
            user_id: best.userId,
            confidence: Number(best.score.toFixed(5)),
            decision,
          },
          { onConflict: "photo_face_id,user_id" }
        )
        .select("id")
        .single();

      if (matchError || !upsertedMatch) {
        throw new Error(matchError?.message ?? "Failed to insert face match");
      }

      matchesCreated += 1;

      if (decision === "auto_shared") {
        const { error: shareError } = await supabase.from("shares").upsert(
          {
            photo_id: photoRecord.id,
            recipient_user_id: best.userId,
            source_match_id: upsertedMatch.id,
            status: "active",
          },
          { onConflict: "photo_id,recipient_user_id" }
        );

        if (shareError) {
          throw new Error(shareError.message);
        }

        sharesCreated += 1;
      } else {
        const { error: reviewError } = await supabase.from("review_queue").insert({
          match_id: upsertedMatch.id,
          state: "open",
        });

        if (reviewError) {
          throw new Error(reviewError.message);
        }

        reviewCreated += 1;
      }
    }

    await supabase.from("photos").update({ status: "processed" }).eq("id", photoRecord.id);
    await supabase.from("processing_jobs").update({ status: "done", last_error: null }).eq("id", claimed.id);

    await supabase.from("audit_logs").insert({
      action: "photo_processed",
      entity_type: "photo",
      entity_id: photoRecord.id,
      metadata: {
        facesDetected: faces.length,
        matchesCreated,
        sharesCreated,
        reviewCreated,
      },
    });

    return {
      status: "processed",
      jobId: claimed.id,
      photoId: photoRecord.id,
      facesDetected: faces.length,
      matchesCreated,
      sharesCreated,
      reviewCreated,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    await failJob(claimed.id, claimed.photo_id, message, claimed.attempts);
    return {
      status: "failed",
      jobId: claimed.id,
      photoId: claimed.photo_id,
      error: message,
    };
  }
}
