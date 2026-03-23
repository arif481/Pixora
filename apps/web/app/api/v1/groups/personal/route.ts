import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";
import { ensureProfile } from "@/lib/profile";
import { requireFaceVerification } from "@/lib/face-verification";

const PERSONAL_GROUP_NAME = "Personal Memory Vault";

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

    const supabase = createSupabaseServerClient();

    const { data: existing } = await supabase
      .from("groups")
      .select("id, name")
      .eq("owner_id", userId)
      .eq("name", PERSONAL_GROUP_NAME)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let group = existing;

    if (!group) {
      const { data: created, error: createError } = await supabase
        .from("groups")
        .insert({
          name: PERSONAL_GROUP_NAME,
          owner_id: userId,
        })
        .select("id, name")
        .single();

      if (createError || !created) {
        return NextResponse.json({ error: createError?.message ?? "Failed to create personal group" }, { status: 500 });
      }

      group = created;
    }

    const { error: memberError } = await supabase.from("group_members").upsert(
      {
        group_id: group.id,
        user_id: userId,
        role: "admin",
        status: "active",
      },
      { onConflict: "group_id,user_id" }
    );

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    return NextResponse.json({ group });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
