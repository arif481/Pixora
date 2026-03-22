import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getRequestUserId } from "@/lib/request-user";
import { ensureProfile } from "@/lib/profile";

export async function GET(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    const supabase = createSupabaseServerClient();

    const { data, error } = await supabase
      .from("group_members")
      .select("group_id, groups(id, name)")
      .eq("user_id", userId)
      .eq("status", "active");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const groups = (data ?? []).flatMap((item) => {
      if (!item.groups) {
        return [];
      }

      return Array.isArray(item.groups) ? item.groups : [item.groups];
    });

    return NextResponse.json({ groups });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getRequestUserId(request);
    await ensureProfile(userId);

    const body = await request.json();
    if (!body?.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const trimmedName = body.name.trim();
    if (!trimmedName) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { data: group, error: groupError } = await supabase
      .from("groups")
      .insert({
        name: trimmedName,
        owner_id: userId,
      })
      .select("id, name")
      .single();

    if (groupError || !group) {
      return NextResponse.json({ error: groupError?.message ?? "Failed to create group" }, { status: 500 });
    }

    const { error: memberError } = await supabase.from("group_members").insert({
      group_id: group.id,
      user_id: userId,
      role: "admin",
      status: "active",
    });

    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }

    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
