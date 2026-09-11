import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Ary Nexus · Intelligence workspace",
  description:
    "A persistent intelligence workspace for memories, entities, and decisions.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
