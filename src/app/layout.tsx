import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AI 求職配對介面｜證據工作台",
  description: "個人本機作品：核對履歷與職缺原文，逐項分析與可還原改寫。",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
