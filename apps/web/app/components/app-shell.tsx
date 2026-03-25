"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/app/components/auth-provider";
import { AuthStatus } from "@/app/components/auth-status";
import { FaceVerificationGate } from "@/app/components/face-verification-gate";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isLoginPage = pathname === "/login";

  // Redirect unauthenticated users to /login (except if already on /login)
  useEffect(() => {
    if (!loading && !user && !isLoginPage) {
      router.replace("/login");
    }
  }, [loading, user, isLoginPage, router]);

  // On the login page, render children directly (no shell)
  if (isLoginPage) {
    return <>{children}</>;
  }

  // Loading state
  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          gap: 12,
        }}
      >
        <span className="spinner" style={{ width: 28, height: 28 }} />
        <span className="dim" style={{ fontSize: 14 }}>Loading…</span>
      </div>
    );
  }

  // Not authenticated — show nothing while redirecting
  if (!user) {
    return null;
  }

  // Authenticated — render full app shell
  return (
    <>
      <div className="app-shell">
        {/* ── Sidebar Navigation ── */}
        <aside className="sidebar" id="sidebar">
          <div className="sidebar-brand">
            <h1>Pixora</h1>
            <p>Automated Photo Sharing</p>
          </div>

          <nav className="sidebar-nav">
            <Link className={`nav-item ${pathname === "/" ? "active" : ""}`} href="/">
              <span className="nav-icon">🏠</span>
              Home
            </Link>
            <Link className={`nav-item ${pathname === "/enrollment" ? "active" : ""}`} href="/enrollment">
              <span className="nav-icon">🤳</span>
              Face Enrollment
            </Link>
            <Link className={`nav-item ${pathname.startsWith("/groups") ? "active" : ""}`} href="/groups">
              <span className="nav-icon">📂</span>
              Groups
            </Link>
            <Link className={`nav-item ${pathname === "/shares" ? "active" : ""}`} href="/shares">
              <span className="nav-icon">💜</span>
              Shared With Me
            </Link>
          </nav>

          <div className="sidebar-footer">
            <AuthStatus />
          </div>
        </aside>

        {/* ── Main Content ── */}
        <main className="main-content">
          {/* Mobile header */}
          <div className="mobile-header">
            <MobileMenuToggle />
            <h1
              style={{
                fontSize: 20,
                fontWeight: 700,
                background:
                  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Pixora
            </h1>
          </div>

          <FaceVerificationGate />
          {children}
        </main>
      </div>

      {/* Mobile sidebar toggle script */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.addEventListener('click', function(e) {
              var toggle = e.target.closest('.menu-toggle');
              var sidebar = document.getElementById('sidebar');
              if (toggle && sidebar) {
                sidebar.classList.toggle('open');
                var overlay = document.getElementById('mobile-overlay');
                if (sidebar.classList.contains('open')) {
                  if (!overlay) {
                    overlay = document.createElement('div');
                    overlay.id = 'mobile-overlay';
                    overlay.className = 'mobile-overlay';
                    document.body.appendChild(overlay);
                  }
                } else if (overlay) {
                  overlay.remove();
                }
              }
              if (e.target.closest('.mobile-overlay')) {
                sidebar && sidebar.classList.remove('open');
                var ov = document.getElementById('mobile-overlay');
                ov && ov.remove();
              }
              if (e.target.closest('.nav-item') && sidebar) {
                sidebar.classList.remove('open');
                var ov2 = document.getElementById('mobile-overlay');
                ov2 && ov2.remove();
              }
            });
          `,
        }}
      />
    </>
  );
}

function MobileMenuToggle() {
  return (
    <button className="menu-toggle" type="button" aria-label="Toggle menu">
      ☰
    </button>
  );
}
