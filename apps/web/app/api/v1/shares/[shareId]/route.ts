import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";
import { requireFaceVerification } from "@/lib/face-verification";

type ShareRow = {
  id: string;
  recipient_user_id: string;
  photo_id: string;
};

type PhotoRow = {
  id: string;
  group_id: string;
  uploader_id: string;
};

async function isGroupAdmin(groupId: string, userId: string) {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("role", "admin")
    .maybeSingle();

  return Boolean(data);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ shareId: string }> }
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

    const { shareId } = await context.params;
    const supabase = createSupabaseServerClient();

    const { data: share, error: shareError } = await supabase
      .from("shares")
      .select("id, recipient_user_id, photo_id")
      .eq("id", shareId)
      .maybeSingle<ShareRow>();

    if (shareError) {
      return NextResponse.json({ error: shareError.message }, { status: 500 });
    }

    if (!share) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    const { data: photo, error: photoError } = await supabase
      .from("photos")
      .select("id, group_id, uploader_id")
      .eq("id", share.photo_id)
      .maybeSingle<PhotoRow>();

    if (photoError) {
      return NextResponse.json({ error: photoError.message }, { status: 500 });
    }

    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    const authorized =
      share.recipient_user_id === userId ||
      photo.uploader_id === userId ||
      (await isGroupAdmin(photo.group_id, userId));

    if (!authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error: updateError } = await supabase
      .from("shares")
      .update({ status: "deleted" })
      .eq("id", shareId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await supabase.from("audit_logs").insert({
      actor_user_id: userId,
      action: "share_deleted",
      entity_type: "share",
      entity_id: shareId,
      metadata: { photoId: share.photo_id },
    });

    return NextResponse.json({ status: "deleted" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
