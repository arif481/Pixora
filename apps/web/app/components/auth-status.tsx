"use client";

import { FormEvent, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AuthMode = "signin" | "signup";

export function AuthStatus() {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setUserEmail(data.user?.email ?? null))
      .finally(() => setLoading(false));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleAuth(event: FormEvent, authMode: AuthMode) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (authMode === "signin") {
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (err) {
        setError(err.message);
        setSubmitting(false);
        return;
      }
      setMessage("Signed in successfully.");
      setSubmitting(false);
      return;
    }

    const { error: err } = await supabase.auth.signUp({ email, password });
    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }
    setMessage("Account created! Check your email to verify.");
    setSubmitting(false);
  }

  async function signOut() {
    setError("");
    setMessage("");
    const supabase = getSupabaseBrowserClient();
    const { error: err } = await supabase.auth.signOut();
    if (err) {
      setError(err.message);
      return;
    }
    setMessage("Signed out.");
  }

  if (loading) {
    return (
      <div className="auth-shell" style={{ padding: "8px 0" }}>
        <p className="dim text-sm" style={{ margin: 0 }}>
          <span className="spinner" style={{ width: 14, height: 14, marginRight: 8, verticalAlign: "middle" }} />
          Checking auth…
        </p>
      </div>
    );
  }

  if (userEmail) {
    return (
      <div className="auth-shell">
        <div className="auth-user">
          <span className="auth-email">
            <span style={{ fontSize: 14 }}>👤</span>
            {userEmail}
          </span>
          <button className="btn-sm btn-danger" type="button" onClick={signOut}>
            Sign Out
          </button>
        </div>
        {message && <p className="status-success" style={{ marginTop: 8, fontSize: 12, padding: "6px 10px" }}>{message}</p>}
        {error && <p className="status-error" style={{ marginTop: 8, fontSize: 12, padding: "6px 10px" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-tabs">
        <button
          className={mode === "signin" ? "active" : ""}
          type="button"
          onClick={() => setMode("signin")}
        >
          Sign In
        </button>
        <button
          className={mode === "signup" ? "active" : ""}
          type="button"
          onClick={() => setMode("signup")}
        >
          Sign Up
        </button>
      </div>
      <form
        className="form-row"
        onSubmit={(e) => void handleAuth(e, mode)}
        style={{ gap: 8 }}
      >
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ fontSize: 13, padding: "10px 12px" }}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ fontSize: 13, padding: "10px 12px" }}
        />
        <button className="btn-primary" type="submit" disabled={submitting} style={{ fontSize: 13 }}>
          {submitting
            ? mode === "signin"
              ? "Signing in…"
              : "Creating…"
            : mode === "signin"
              ? "Sign In"
              : "Create Account"}
        </button>
      </form>
      {error && <p className="status-error" style={{ marginTop: 8, fontSize: 12, padding: "6px 10px" }}>{error}</p>}
      {message && <p className="status-success" style={{ marginTop: 8, fontSize: 12, padding: "6px 10px" }}>{message}</p>}
    </div>
  );
}
