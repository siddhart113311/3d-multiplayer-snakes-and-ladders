import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk, Unbounded } from "next/font/google";
import "./globals.css";

const body = Space_Grotesk({ subsets: ["latin"], variable: "--font-body" });
const display = Unbounded({ subsets: ["latin"], variable: "--font-display", weight: ["500", "700", "900"] });

export const metadata: Metadata = {
  title: "Serpentia — 3D Snakes & Ladders Online",
  description: "Multiplayer 3D Snakes & Ladders. Square, hex and triangle boards, roaming fire-mode serpents, gulping animations and lobby join codes.",
};

export const viewport: Viewport = {
  themeColor: "#060b18",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body className="bg-[#060b18] font-body text-white antialiased">{children}</body>
    </html>
  );
}
