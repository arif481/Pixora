import "./globals.css";
import Link from "next/link";
import { AuthStatus } from "@/app/components/auth-status";

export const metadata = {
  title: "Pixora",
  description: "Face-based group photo sharing",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <header className="app-header">
            <div className="brand">
              <h1>Pixora</h1>
              <p>Private face-based group photo sharing</p>
            </div>
            <div className="top-right">
              <nav className="nav">
                <Link className="nav-link" href="/">Home</Link>
                <Link className="nav-link" href="/enrollment">Enrollment</Link>
                <Link className="nav-link" href="/groups">Groups</Link>
                <Link className="nav-link" href="/shares">Shared With Me</Link>
              </nav>
              <AuthStatus />
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
