import { createSupabaseServerClient } from "@/lib/supabase-server";
import { cosineSimilarity, parseVector } from "@/lib/embeddings";
import { getThresholds } from "@/lib/server-config";

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

function bestMatch(probe: number[], templates: Array<{ userId: string; embedding: number[] }>) {
  let bestUserId: string | null = null;
  let bestScore = -1;

  for (const template of templates) {
    const score = cosineSimilarity(probe, template.embedding);
    if (score > bestScore) {
      bestScore = score;
      bestUserId = template.userId;
    }
  }

  if (!bestUserId) {
    return null;
  }

  return { userId: bestUserId, score: bestScore };
}

async function claimNextJob() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("processing_jobs")
    .select("id, photo_id, attempts")
    .in("status", ["queued", "failed"])
    .lt("attempts", 5)
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
    .select("id, photo_id, attempts")
    .single();

  if (updateError || !updated) {
    return null;
  }

  return updated as ProcessingJob;
}

async function failJob(jobId: string, photoId: string, message: string) {
  const supabase = createSupabaseServerClient();
  await supabase.from("processing_jobs").update({ status: "failed", last_error: message }).eq("id", jobId);
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

    const faces = (precomputedFaces ?? []) as PrecomputedPhotoFace[];

    const { data: templates, error: templateError } = await supabase
      .from("face_templates")
      .select("user_id, embedding")
      .eq("is_primary", true);

    if (templateError) {
      throw new Error(templateError.message);
    }

    const templateRows = (templates ?? []) as FaceTemplate[];

    const candidateTemplates = templateRows
      .map((row) => ({ userId: row.user_id, embedding: parseVector(row.embedding) }))
      .filter((row) => row.embedding.length > 0);

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
    await failJob(claimed.id, claimed.photo_id, message);
    return {
      status: "failed",
      jobId: claimed.id,
      photoId: claimed.photo_id,
      error: message,
    };
  }
}
