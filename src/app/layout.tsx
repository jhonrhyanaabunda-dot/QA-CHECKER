import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ReviewerProvider } from "@/components/reviewer";
import { Navbar } from "@/components/navbar";

export const metadata: Metadata = {
  title: "DealerQA AI — Dealership Content QA",
  description:
    "AI-powered quality assurance for dealership blog content: factual verification, compliance, link checking, and content QA.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <ReviewerProvider>
            <Navbar />
            <main className="container py-8">{children}</main>
          </ReviewerProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
