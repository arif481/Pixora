import Link from "next/link";

export default function HomePage() {
  return (
    <>
      {/* ── Hero ── */}
      <section className="hero">
        <h2>Share Memories,{"\n"}Automatically</h2>
        <p>
          Upload photos and Pixora instantly recognizes faces to share memories
          with the right people. Private, secure, and completely free.
        </p>
        <div className="row" style={{ justifyContent: "center", gap: 12 }}>
          <Link className="btn-primary" href="/enrollment" style={{
            padding: "12px 28px", borderRadius: 12, textDecoration: "none",
            display: "inline-flex", fontWeight: 600, fontSize: 15,
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "#fff", border: "none", boxShadow: "0 4px 15px rgba(102, 126, 234, 0.3)"
          }}>
            Get Started
          </Link>
          <Link className="btn-primary" href="/groups" style={{
            padding: "12px 28px", borderRadius: 12, textDecoration: "none",
            display: "inline-flex", fontWeight: 600, fontSize: 15,
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            color: "var(--text)"
          }}>
            Browse Groups
          </Link>
        </div>
      </section>

      {/* ── Features ── */}
      <div className="feature-grid">
        <div className="feature-card">
          <span className="feature-icon">🤖</span>
          <h3>AI Face Recognition</h3>
          <p>
            Client-side face detection runs in your browser — no cloud APIs,
            no costs, complete privacy.
          </p>
        </div>
        <div className="feature-card">
          <span className="feature-icon">🔗</span>
          <h3>Auto-Share</h3>
          <p>
            Upload a group photo and everyone in it automatically gets access.
            No manual tagging needed.
          </p>
        </div>
        <div className="feature-card">
          <span className="feature-icon">🔒</span>
          <h3>Privacy First</h3>
          <p>
            Live face verification protects every session. You control who sees
            what, and can revoke access anytime.
          </p>
        </div>
        <div className="feature-card">
          <span className="feature-icon">⏪</span>
          <h3>Retroactive Sharing</h3>
          <p>
            Someone uploaded your photo before you signed up? You&apos;ll get access
            the moment you create your account.
          </p>
        </div>
      </div>

      {/* ── How it works ── */}
      <div className="card" style={{ marginTop: 24 }}>
        <h2>How It Works</h2>
        <div className="steps">
          <div className="step">
            <div className="step-content">
              <h4>Create Your Account</h4>
              <p>Sign up with email and password in seconds.</p>
            </div>
          </div>
          <div className="step">
            <div className="step-content">
              <h4>Enroll Your Face</h4>
              <p>
                Take 5 quick selfies or upload clear photos. Your face data
                stays private and is processed entirely in your browser.
              </p>
            </div>
          </div>
          <div className="step">
            <div className="step-content">
              <h4>Verify &amp; Unlock</h4>
              <p>
                Complete a quick live face check (blink, smile, or turn) to
                unlock sharing features each session.
              </p>
            </div>
          </div>
          <div className="step">
            <div className="step-content">
              <h4>Upload &amp; Auto-Share</h4>
              <p>
                Upload photos to a group or your personal space. Faces are
                detected and matched instantly — shared automatically.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
