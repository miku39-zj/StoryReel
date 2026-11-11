import type { Metadata } from "next";
import "./globals.css";
import { TooltipProvider } from "@/components/ui";

export const metadata: Metadata = {
  title: "StoryReel — AI 互动影视创作平台",
  description: "从剧本到互动视频的一体化 AI 创作平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
