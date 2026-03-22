"use client";

import { FormEvent, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AuthMode = "signin" | "signup";

export function AuthStatus() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string | null>(null);

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

    const supabase = getSupabaseBrowserClient();
    if (mode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      setMessage("Signed in successfully.");
      return;
    }

    const { error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    setMessage("Sign-up complete. If email confirmation is enabled, verify your inbox before signing in.");
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
    return <p style={{ margin: 0 }}>Checking auth...</p>;
  }

  if (userEmail) {
    return (
      <div className="row" style={{ alignItems: "center" }}>
        <span style={{ fontSize: 14 }}>Signed in: {userEmail}</span>
        <button type="button" onClick={signOut}>Sign Out</button>
        {message ? <span style={{ fontSize: 13 }}>{message}</span> : null}
      </div>
    );
  }

  return (
    <form className="row" onSubmit={(event) => void handleAuth(event, "signin")}>
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
      <button type="submit">Sign In</button>
      <button type="button" onClick={(event) => void handleAuth(event, "signup")}>Sign Up</button>
      {error ? <span style={{ fontSize: 13, color: "#e35d6a" }}>{error}</span> : null}
      {message ? <span style={{ fontSize: 13 }}>{message}</span> : null}
    </form>
  );
}
