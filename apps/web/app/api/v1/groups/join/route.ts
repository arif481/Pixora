import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";
import { ensureProfile } from "@/lib/profile";
import { requireFaceVerification } from "@/lib/face-verification";

export async function POST(request: NextRequest) {
  try {
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const verification = await requireFaceVerification(userId);
    if (!verification.ok) {
      return NextResponse.json({ error: verification.error }, { status: verification.status });
    }
    await ensureProfile(userId);

    const body = await request.json();
    const groupId = typeof body?.groupId === "string" ? body.groupId.trim() : "";
    if (!groupId) {
      return NextResponse.json({ error: "groupId is required" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const { data: group } = await supabase
      .from("groups")
      .select("id")
      .eq("id", groupId)
      .maybeSingle();

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const { error: memberError } = await supabase.from("group_members").upsert(
      {
        group_id: groupId,
        user_id: userId,
        role: "member",
        status: "active",
      },
      { onConflict: "group_id,user_id" }
    );

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    return NextResponse.json({ status: "joined", groupId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
