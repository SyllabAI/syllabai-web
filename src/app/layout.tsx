import type { Metadata } from "next";
import { Geist, Geist_Mono, Kodchasan, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// SME demo-parity fonts (session-119) — scoped to the Exam Questions surface
// through .exam-theme in globals.css; the workbench default stays Geist.
const jakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const kodchasan = Kodchasan({
  variable: "--font-kodchasan",
  weight: ["400", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SyllabAI — Learner Workbench",
  description:
    "Knowledge-graph driven practice with BKT mastery tracking, misconception diagnosis and Ebbinghaus review. Cycle 1: Edexcel IGCSE Chemistry.",
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${jakartaSans.variable} ${kodchasan.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
