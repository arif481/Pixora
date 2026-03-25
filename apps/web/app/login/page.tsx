"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/components/auth-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AuthMode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Auto-redirect if already logged in
  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

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
      router.replace("/");
      return;
    }

    const { error: err } = await supabase.auth.signUp({ email, password });
    if (err) {
      setError(err.message);
      setSubmitting(false);
      return;
    }
    setMessage("Account created! Check your email to verify, then sign in.");
    setSubmitting(false);
  }

  // Show nothing while checking auth (prevents flash)
  if (loading || user) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <span
              className="spinner"
              style={{ width: 32, height: 32 }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Brand */}
        <div className="login-brand">
          <h1>Pixora</h1>
          <p>Private Face-Based Photo Sharing</p>
        </div>

        {/* Tabs */}
        <div className="auth-tabs">
          <button
            className={mode === "signin" ? "active" : ""}
            type="button"
            onClick={() => { setMode("signin"); setError(""); setMessage(""); }}
          >
            Sign In
          </button>
          <button
            className={mode === "signup" ? "active" : ""}
            type="button"
            onClick={() => { setMode("signup"); setError(""); setMessage(""); }}
          >
            Sign Up
          </button>
        </div>

        {/* Form */}
        <form onSubmit={(e) => void handleAuth(e, mode)}>
          <div className="login-fields">
            <div className="login-field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="login-field">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
            </div>
          </div>

          <button
            className="btn-primary login-submit"
            type="submit"
            disabled={submitting}
          >
            {submitting
              ? mode === "signin"
                ? <>
                    <span className="spinner" style={{ width: 16, height: 16 }} /> Signing in…
                  </>
                : <>
                    <span className="spinner" style={{ width: 16, height: 16 }} /> Creating account…
                  </>
              : mode === "signin"
                ? "Sign In"
                : "Create Account"}
          </button>
        </form>

        {error && <p className="status-error" style={{ marginTop: 16 }}>{error}</p>}
        {message && <p className="status-success" style={{ marginTop: 16 }}>{message}</p>}

        {/* Footer */}
        <p className="login-footer">
          {mode === "signin"
            ? "Don\u2019t have an account? "
            : "Already have an account? "}
          <button
            type="button"
            className="login-switch"
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setMessage(""); }}
          >
            {mode === "signin" ? "Create one" : "Sign in"}
          </button>
        </p>
      </div>

      {/* Features teaser */}
      <div className="login-features">
        <div className="login-feature">
          <span>🤖</span>
          <p>AI Face Recognition</p>
        </div>
        <div className="login-feature">
          <span>🔗</span>
          <p>Auto-Share Photos</p>
        </div>
        <div className="login-feature">
          <span>🔒</span>
          <p>Privacy First</p>
        </div>
      </div>
    </div>
  );
}
