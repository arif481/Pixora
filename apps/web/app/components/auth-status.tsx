"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/components/auth-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export function AuthStatus() {
  const { user } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");

  async function signOut() {
    setError("");
    const supabase = getSupabaseBrowserClient();
    const { error: err } = await supabase.auth.signOut();
    if (err) {
      setError(err.message);
      return;
    }
    router.replace("/login");
  }

  if (!user) return null;

  return (
    <div className="auth-shell">
      <div className="auth-user">
        <span className="auth-email">
          <span style={{ fontSize: 14 }}>👤</span>
          {user.email}
        </span>
        <button className="btn-sm btn-danger" type="button" onClick={() => void signOut()}>
          Sign Out
        </button>
      </div>
      {error && (
        <p
          className="status-error"
          style={{ marginTop: 8, fontSize: 12, padding: "6px 10px" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
