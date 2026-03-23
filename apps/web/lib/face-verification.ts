import { createSupabaseServerClient } from "@/lib/supabase-server";

const VERIFY_TTL_MINUTES = Number(process.env.LOGIN_VERIFY_TTL_MINUTES ?? 720);

export type FaceVerificationState = {
  enrolled: boolean;
  verified: boolean;
  verifiedAt: string | null;
};

function isFreshVerification(verifiedAt: string | null) {
  if (!verifiedAt) {
    return false;
  }

  const verifiedTime = Date.parse(verifiedAt);
  if (!Number.isFinite(verifiedTime)) {
    return false;
  }

  const maxAgeMs = Math.max(1, VERIFY_TTL_MINUTES) * 60 * 1000;
  return Date.now() - verifiedTime <= maxAgeMs;
}

export async function getFaceVerificationState(userId: string): Promise<FaceVerificationState> {
  const supabase = createSupabaseServerClient();

  const { data: template } = await supabase
    .from("face_templates")
    .select("id")
    .eq("user_id", userId)
    .eq("is_primary", true)
    .maybeSingle();

  if (!template) {
    return {
      enrolled: false,
      verified: false,
      verifiedAt: null,
    };
  }

  const { data: latestVerification } = await supabase
    .from("audit_logs")
    .select("created_at")
    .eq("actor_user_id", userId)
    .eq("action", "login_face_verified")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();

  const verifiedAt = latestVerification?.created_at ?? null;

  return {
    enrolled: true,
    verified: isFreshVerification(verifiedAt),
    verifiedAt,
  };
}

export async function requireFaceVerification(userId: string) {
  const state = await getFaceVerificationState(userId);
  if (!state.enrolled) {
    return {
      ok: false as const,
      status: 428,
      error: "Face enrollment required before continuing",
    };
  }

  if (!state.verified) {
    return {
      ok: false as const,
      status: 403,
      error: "Live face verification required",
    };
  }

  return {
    ok: true as const,
  };
}
