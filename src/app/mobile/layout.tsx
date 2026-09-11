import type { Metadata, Viewport } from "next";
export const metadata: Metadata = {
  title: "ARY · Companion",
  description: "Voice, missions and the moments that need you.",
  manifest: "/mobile/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "ARY",
    statusBarStyle: "black-translucent",
  },
  icons: { apple: "/mobile/icon-192.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080c13",
};
export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
