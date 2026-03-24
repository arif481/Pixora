import "./globals.css";
import Link from "next/link";
import { AuthStatus } from "@/app/components/auth-status";
import { FaceVerificationGate } from "@/app/components/face-verification-gate";

export const metadata = {
  title: "Pixora – Private Face-Based Photo Sharing",
  description:
    "Share memories automatically with friends detected in each photo. Private, secure, free.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          {/* ── Sidebar Navigation ── */}
          <aside className="sidebar" id="sidebar">
            <div className="sidebar-brand">
              <h1>Pixora</h1>
              <p>Automated Photo Sharing</p>
            </div>

            <nav className="sidebar-nav">
              <Link className="nav-item" href="/">
                <span className="nav-icon">🏠</span>
                Home
              </Link>
              <Link className="nav-item" href="/enrollment">
                <span className="nav-icon">🤳</span>
                Face Enrollment
              </Link>
              <Link className="nav-item" href="/groups">
                <span className="nav-icon">📂</span>
                Groups
              </Link>
              <Link className="nav-item" href="/shares">
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
      </body>
    </html>
  );
}

function MobileMenuToggle() {
  return (
    <button className="menu-toggle" type="button" aria-label="Toggle menu">
      ☰
    </button>
  );
}
