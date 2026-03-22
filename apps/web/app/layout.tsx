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
          <header className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h1 style={{ margin: 0 }}>Pixora</h1>
            <div style={{ display: "grid", gap: 10, justifyItems: "end" }}>
              <nav className="row">
                <Link href="/">Home</Link>
                <Link href="/enrollment">Enrollment</Link>
                <Link href="/groups">Groups</Link>
                <Link href="/shares">Shared With Me</Link>
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
