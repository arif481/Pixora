import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
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
    const body = await request.json();

    if (!body?.filename || typeof body.filename !== "string") {
      return NextResponse.json({ error: "filename is required" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const { data: membership } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const safeFilename = sanitizeFilename(body.filename);
    const storageKey = `${groupId}/${userId}/${Date.now()}-${safeFilename}`;
    const { data, error } = await supabase.storage.from("photos-private").createSignedUploadUrl(storageKey);

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? "Failed to create upload URL" }, { status: 500 });
    }

    return NextResponse.json({
      uploadUrl: data.signedUrl,
      token: data.token,
      path: data.path,
      storageKey,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
