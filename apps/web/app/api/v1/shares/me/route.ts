import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextRequest } from "next/server";
import { getRequestUserId } from "@/lib/request-user";

export async function GET(request: NextRequest) {
  try {
    const userId = await getRequestUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("shares")
      .select("id, photo_id, recipient_user_id, status, created_at")
      .eq("recipient_user_id", userId)
      .neq("status", "deleted")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const shares = (data ?? []).map((share) => ({
      id: share.id,
      photoId: share.photo_id,
      recipientUserId: share.recipient_user_id,
      status: share.status,
      createdAt: share.created_at,
    }));

    return NextResponse.json({ shares });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
