import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";
import { ensureProfile } from "@/lib/profile";
import { vectorLiteral } from "@/lib/embeddings";
import { requireFaceVerification } from "@/lib/face-verification";

type PrecomputedFacePayload = {
  bboxX: number;
  bboxY: number;
  bboxW: number;
  bboxH: number;
  qualityScore?: number;
  embedding: number[];
};

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

async function checkMembership(groupId: string, userId: string) {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  return Boolean(data);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  try {
    const { groupId } = await context.params;
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const verification = await requireFaceVerification(userId);
    if (!verification.ok) {
      return NextResponse.json({ error: verification.error }, { status: verification.status });
    }
    const isMember = await checkMembership(groupId, userId);
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("photos")
      .select("id, group_id, uploader_id, status, storage_key, created_at")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const photos = (data ?? []).map((photo) => ({
      id: photo.id,
      groupId: photo.group_id,
      uploaderId: photo.uploader_id,
      status: photo.status,
      storageKey: photo.storage_key,
      createdAt: photo.created_at,
    }));

    return NextResponse.json({ photos });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> }
) {
  try {
    const { groupId } = await context.params;
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const verification = await requireFaceVerification(userId);
    if (!verification.ok) {
      return NextResponse.json({ error: verification.error }, { status: verification.status });
    }
    await ensureProfile(userId);
    const isMember = await checkMembership(groupId, userId);
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();

    if (!body?.storageKey || typeof body.storageKey !== "string") {
      return NextResponse.json({ error: "storageKey is required" }, { status: 400 });
    }

    const precomputedFaces: PrecomputedFacePayload[] = Array.isArray(body?.precomputedFaces)
      ? body.precomputedFaces
      : [];

    const supabase = createSupabaseServerClient();
    const { data: insertedPhoto, error: insertPhotoError } = await supabase
      .from("photos")
      .insert({
        group_id: groupId,
        uploader_id: userId,
        storage_key: body.storageKey,
        captured_at: body.capturedAt ?? null,
        status: "queued",
      })
      .select("id, group_id, uploader_id, status, storage_key, created_at")
      .single();

    if (insertPhotoError || !insertedPhoto) {
      return NextResponse.json(
        { error: insertPhotoError?.message ?? "Failed to register photo" },
        { status: 500 }
      );
    }

    if (precomputedFaces.length > 0) {
      const rows = precomputedFaces
        .map((face) => {
          const embedding = normalizeEmbedding(face.embedding);
          if (!embedding) {
            return null;
          }

          return {
            photo_id: insertedPhoto.id,
            bbox_x: Math.max(0, Math.round(Number(face.bboxX ?? 0))),
            bbox_y: Math.max(0, Math.round(Number(face.bboxY ?? 0))),
            bbox_w: Math.max(1, Math.round(Number(face.bboxW ?? 1))),
            bbox_h: Math.max(1, Math.round(Number(face.bboxH ?? 1))),
            quality_score:
              typeof face.qualityScore === "number" && Number.isFinite(face.qualityScore)
                ? face.qualityScore
                : null,
            embedding: vectorLiteral(embedding),
          };
        })
        .filter((face): face is NonNullable<typeof face> => Boolean(face));

      if (rows.length > 0) {
        const { error: insertFacesError } = await supabase.from("photo_faces").insert(rows);
        if (insertFacesError) {
          return NextResponse.json({ error: insertFacesError.message }, { status: 500 });
        }
      }
    }

    const { error: jobError } = await supabase.from("processing_jobs").upsert(
      {
        photo_id: insertedPhoto.id,
        status: "queued",
        attempts: 0,
      },
      { onConflict: "photo_id" }
    );

    if (jobError) {
      return NextResponse.json({ error: jobError.message }, { status: 500 });
    }

    const photo = {
      id: insertedPhoto.id,
      groupId: insertedPhoto.group_id,
      uploaderId: insertedPhoto.uploader_id,
      status: insertedPhoto.status,
      storageKey: insertedPhoto.storage_key,
      createdAt: insertedPhoto.created_at,
    };

    return NextResponse.json({ photo }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
