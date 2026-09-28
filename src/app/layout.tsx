import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  Geist,
  Geist_Mono,
  Instrument_Sans,
  Kodchasan,
  Plus_Jakarta_Sans,
  Spline_Sans_Mono,
} from "next/font/google";
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

/**
 * Typography (Learning Hub design system, matched to the SaveMyExams
 * reference pages):
 *   Plus Jakarta Sans — body (SME: --font-jakarta)
 *   Kodchasan — display headings (SME's display serif for the logo/H1s)
 * next/font self-hosts both at build time; vars are wired in globals.css
 * through the runtime --app-font-* chains.
 *
 * Dual-theme support (Quiet Green port): the three QG faces below ship
 * with preload disabled so default-theme (SME) visitors never pay for
 * them — they download only when the quiet-green theme activates and its
 * --app-font-* chains reference the variables.
 */
const jakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const kodchasan = Kodchasan({
  variable: "--font-kodchasan",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  weight: ["600", "700"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const splineMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

/**
 * No-flash theme bootstrap — runs before first paint, mirrors the logic in
 * src/lib/theme-store.ts (same storage key + parsing). Reads
 * { theme: "sme"|"quiet-green", mode: "light"|"dark"|"system" } from
 * localStorage["syllabai-theme"] and applies data-theme + .dark.
 */
const themeBootstrap = `(function(){try{
var t=JSON.parse(localStorage.getItem("syllabai-theme")||"{}");
var theme=t.theme==="quiet-green"?"quiet-green":"sme";
var mode=t.mode||"system";
var dark=mode==="dark"||(mode==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var d=document.documentElement;
d.setAttribute("data-theme",theme);
d.classList.toggle("dark",dark);
d.style.colorScheme=dark?"dark":"light";
}catch(e){}})();`;

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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${jakartaSans.variable} ${kodchasan.variable} ${instrumentSans.variable} ${bricolage.variable} ${splineMono.variable}`}
    >
      <body className="antialiased">
        {/* blocking inline script — applies the stored theme before any
            content paints, so there is no light/dark flash on load */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
