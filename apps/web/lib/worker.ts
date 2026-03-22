import { createSupabaseServerClient } from "@/lib/supabase-server";
import { cosineSimilarity, parseVector, vectorLiteral } from "@/lib/embeddings";
import { getThresholds, requireEnv } from "@/lib/server-config";

type ProcessingJob = {
  id: string;
  photo_id: string;
  attempts: number;
};

type PhotoRecord = {
  id: string;
  group_id: string;
  storage_key: string;
};

type GroupMember = {
  user_id: string;
};

type FaceTemplate = {
  user_id: string;
  embedding: unknown;
};

type DetectFace = {
  bbox: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  quality_score: number;
  embedding: number[];
};

type DetectAndEmbedResponse = {
  model_version: string;
  faces: DetectFace[];
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
      .select("id, group_id, storage_key")
      .eq("id", claimed.photo_id)
      .single();

    if (photoError || !photo) {
      throw new Error(photoError?.message ?? "Photo not found");
    }

    const photoRecord = photo as PhotoRecord;
    await supabase.from("photos").update({ status: "processing" }).eq("id", photoRecord.id);

    const { data: signedUrlData, error: signedError } = await supabase.storage
      .from("photos-private")
      .createSignedUrl(photoRecord.storage_key, 120);

    if (signedError || !signedUrlData?.signedUrl) {
      throw new Error(signedError?.message ?? "Failed to create signed read URL");
    }

    const faceEngineUrl = requireEnv("FACE_ENGINE_URL").replace(/\/$/, "");
    const faceEngineToken = requireEnv("FACE_ENGINE_TOKEN");

    const detectResponse = await fetch(`${faceEngineUrl}/detect-and-embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${faceEngineToken}`,
      },
      body: JSON.stringify({ image_url: signedUrlData.signedUrl }),
    });

    if (!detectResponse.ok) {
      throw new Error(`Face engine detect failed (${detectResponse.status})`);
    }

    const detectPayload = (await detectResponse.json()) as DetectAndEmbedResponse;

    const { data: members, error: memberError } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", photoRecord.group_id)
      .eq("status", "active");

    if (memberError) {
      throw new Error(memberError.message);
    }

    const memberIds = ((members ?? []) as GroupMember[]).map((member) => member.user_id);

    let templateRows: FaceTemplate[] = [];
    if (memberIds.length > 0) {
      const { data: templates, error: templateError } = await supabase
        .from("face_templates")
        .select("user_id, embedding")
        .in("user_id", memberIds)
        .eq("is_primary", true);

      if (templateError) {
        throw new Error(templateError.message);
      }

      templateRows = (templates ?? []) as FaceTemplate[];
    }

    const candidateTemplates = templateRows
      .map((row) => ({ userId: row.user_id, embedding: parseVector(row.embedding) }))
      .filter((row) => row.embedding.length > 0);

    let matchesCreated = 0;
    let sharesCreated = 0;
    let reviewCreated = 0;

    for (const face of detectPayload.faces ?? []) {
      const { data: insertedFace, error: faceInsertError } = await supabase
        .from("photo_faces")
        .insert({
          photo_id: photoRecord.id,
          bbox_x: face.bbox.x,
          bbox_y: face.bbox.y,
          bbox_w: face.bbox.w,
          bbox_h: face.bbox.h,
          quality_score: face.quality_score,
          embedding: vectorLiteral(face.embedding),
        })
        .select("id")
        .single();

      if (faceInsertError || !insertedFace) {
        throw new Error(faceInsertError?.message ?? "Failed to insert photo face");
      }

      const best = bestMatch(face.embedding, candidateTemplates);
      if (!best) {
        continue;
      }

      if (best.score < reviewMin) {
        continue;
      }

      const decision = best.score >= autoShare ? "auto_shared" : "pending_review";
      const { data: insertedMatch, error: matchError } = await supabase
        .from("face_matches")
        .insert({
          photo_face_id: insertedFace.id,
          user_id: best.userId,
          confidence: Number(best.score.toFixed(5)),
          decision,
        })
        .select("id")
        .single();

      if (matchError || !insertedMatch) {
        throw new Error(matchError?.message ?? "Failed to insert face match");
      }

      matchesCreated += 1;

      if (decision === "auto_shared") {
        const { error: shareError } = await supabase.from("shares").upsert(
          {
            photo_id: photoRecord.id,
            recipient_user_id: best.userId,
            source_match_id: insertedMatch.id,
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
          match_id: insertedMatch.id,
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
        facesDetected: detectPayload.faces?.length ?? 0,
        matchesCreated,
        sharesCreated,
        reviewCreated,
      },
    });

    return {
      status: "processed",
      jobId: claimed.id,
      photoId: photoRecord.id,
      facesDetected: detectPayload.faces?.length ?? 0,
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
