import { cosineSimilarity, parseVector } from "@/lib/embeddings";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getThresholds } from "@/lib/server-config";

type BackfillResult = {
  scannedFaces: number;
  matchesCreated: number;
  sharesCreated: number;
};

type UserTemplateRow = {
  embedding: unknown;
};

type PhotoFaceRow = {
  id: string;
  photo_id: string;
  embedding: unknown;
};

function rounded(value: number) {
  return Number(value.toFixed(5));
}

export async function backfillSharesForUser(userId: string): Promise<BackfillResult> {
  const supabase = createSupabaseServerClient();
  const { autoShare, reviewMin } = getThresholds();

  const { data: templateRow } = await supabase
    .from("face_templates")
    .select("embedding")
    .eq("user_id", userId)
    .eq("is_primary", true)
    .maybeSingle<UserTemplateRow>();

  if (!templateRow) {
    return { scannedFaces: 0, matchesCreated: 0, sharesCreated: 0 };
  }

  const templateEmbedding = parseVector(templateRow.embedding);
  if (templateEmbedding.length !== 512) {
    return { scannedFaces: 0, matchesCreated: 0, sharesCreated: 0 };
  }

  const { data: photoFaces, error: faceError } = await supabase
    .from("photo_faces")
    .select("id, photo_id, embedding")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (faceError) {
    throw new Error(faceError.message);
  }

  const faces = (photoFaces ?? []) as PhotoFaceRow[];
  let matchesCreated = 0;
  let sharesCreated = 0;

  for (const face of faces) {
    const probe = parseVector(face.embedding);
    if (probe.length !== 512) {
      continue;
    }

    const score = cosineSimilarity(probe, templateEmbedding);
    if (score < reviewMin) {
      continue;
    }

    const decision = score >= autoShare ? "auto_shared" : "pending_review";
    const { data: matchRow, error: matchError } = await supabase
      .from("face_matches")
      .upsert(
        {
          photo_face_id: face.id,
          user_id: userId,
          confidence: rounded(score),
          decision,
        },
        { onConflict: "photo_face_id,user_id" }
      )
      .select("id")
      .single();

    if (matchError || !matchRow) {
      continue;
    }

    matchesCreated += 1;

    if (decision === "auto_shared") {
      const { error: shareError } = await supabase.from("shares").upsert(
        {
          photo_id: face.photo_id,
          recipient_user_id: userId,
          source_match_id: matchRow.id,
          status: "active",
        },
        { onConflict: "photo_id,recipient_user_id" }
      );

      if (!shareError) {
        sharesCreated += 1;
      }
    }
  }

  return {
    scannedFaces: faces.length,
    matchesCreated,
    sharesCreated,
  };
}
