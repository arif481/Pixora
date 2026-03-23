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
      .then(({ data }) => {
        setUserEmail(data.user?.email ?? null);
      })
      .finally(() => setLoading(false));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function handleAuth(event: FormEvent, mode: AuthMode) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);

    const supabase = getSupabaseBrowserClient();
    if (mode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        setSubmitting(false);
        return;
      }
      setMessage("Signed in successfully.");
      setSubmitting(false);
      return;
    }

    const { error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) {
      setError(signUpError.message);
      setSubmitting(false);
      return;
    }

    setMessage("Sign-up complete. If email confirmation is enabled, verify your inbox before signing in.");
    setSubmitting(false);
  }

  async function signOut() {
    setError("");
    setMessage("");
    const supabase = getSupabaseBrowserClient();
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      return;
    }
    setMessage("Signed out.");
  }

  if (loading) {
    return <p className="muted" style={{ margin: 0 }}>Checking auth...</p>;
  }

  if (userEmail) {
    return (
      <div className="card auth-shell" style={{ marginBottom: 0 }}>
        <div className="auth-user">
          <span className="auth-email">Signed in: {userEmail}</span>
          <button type="button" onClick={signOut}>Sign Out</button>
        </div>
        {message ? <p className="status-success">{message}</p> : null}
        {error ? <p className="status-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="card auth-shell" style={{ marginBottom: 0 }}>
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
      <form className="form-row" onSubmit={(event) => void handleAuth(event, mode)}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button className="btn-primary" type="submit" disabled={submitting}>
          {submitting
            ? mode === "signin"
              ? "Signing in..."
              : "Creating account..."
            : mode === "signin"
              ? "Sign In"
              : "Create Account"}
        </button>
      </form>
      {error ? <p className="status-error">{error}</p> : null}
      {message ? <p className="status-success">{message}</p> : null}
    </div>
  );
}
