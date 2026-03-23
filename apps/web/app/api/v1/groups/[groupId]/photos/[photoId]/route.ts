import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";
import { requireFaceVerification } from "@/lib/face-verification";

type PhotoRow = {
  id: string;
  group_id: string;
  uploader_id: string;
};

async function isAdmin(groupId: string, userId: string) {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("role", "admin")
    .maybeSingle();

  return Boolean(data);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ groupId: string; photoId: string }> }
) {
  try {
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const verification = await requireFaceVerification(userId);
    if (!verification.ok) {
      return NextResponse.json({ error: verification.error }, { status: verification.status });
    }

    const { groupId, photoId } = await context.params;
    const supabase = createSupabaseServerClient();

    const { data: photo, error: photoError } = await supabase
      .from("photos")
      .select("id, group_id, uploader_id")
      .eq("id", photoId)
      .eq("group_id", groupId)
      .maybeSingle<PhotoRow>();

    if (photoError) {
      return NextResponse.json({ error: photoError.message }, { status: 500 });
    }

    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    const canDelete = photo.uploader_id === userId || (await isAdmin(groupId, userId));
    if (!canDelete) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error: deleteError } = await supabase
      .from("photos")
      .delete()
      .eq("id", photoId)
      .eq("group_id", groupId);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    await supabase.from("audit_logs").insert({
      actor_user_id: userId,
      action: "photo_deleted",
      entity_type: "photo",
      entity_id: photoId,
      metadata: { groupId },
    });

    return NextResponse.json({ status: "deleted" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
