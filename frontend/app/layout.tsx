import { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-context";

export const metadata = {
  title: "AI Planner",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
