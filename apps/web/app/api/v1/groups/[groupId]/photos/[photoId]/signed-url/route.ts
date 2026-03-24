import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";
import { requireFaceVerification } from "@/lib/face-verification";

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
  context: { params: Promise<{ groupId: string; photoId: string }> }
) {
  try {
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const verification = await requireFaceVerification(userId);
    if (!verification.ok) {
      return NextResponse.json(
        { error: verification.error },
        { status: verification.status }
      );
    }

    const { groupId, photoId } = await context.params;
    const isMember = await checkMembership(groupId, userId);
    if (!isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const supabase = createSupabaseServerClient();

    const { data: photo } = await supabase
      .from("photos")
      .select("storage_key")
      .eq("id", photoId)
      .eq("group_id", groupId)
      .maybeSingle<{ storage_key: string }>();

    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    const { data: signedUrl, error } = await supabase.storage
      .from("photos-private")
      .createSignedUrl(photo.storage_key, 3600); // 1-hour expiry

    if (error || !signedUrl) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to create signed URL" },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: signedUrl.signedUrl });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
