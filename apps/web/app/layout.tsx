import "./globals.css";
import { AuthProvider } from "@/app/components/auth-provider";
import { AppShell } from "@/app/components/app-shell";

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
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
