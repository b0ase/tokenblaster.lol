import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";
import { SiteMusicPlayer } from "@/components/SiteMusicPlayer";
import { SiteFooter } from "@/components/dr/site";
import { drFontClass } from "@/components/dr/fonts";
import { logoFont } from "@/components/dr/logo-font";
import { HOME_CARD, shareImages } from "@/lib/og";
import { PALETTE_SCRIPT } from "@/components/PaletteToggle";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.tokenblaster.lol"),
  title: "TokenBlaster.lol",
  description: "Load your tokens, blast them at the chain. A DOOM-style arena where every bullet is a real BSV transaction, plus a live chain highway and leaderboard.",
  openGraph: {
    title: "TokenBlaster.lol",
    description: "Load your tokens. Blast them at the chain. Every bullet is a real BSV transaction.",
    url: "https://www.tokenblaster.lol",
    siteName: "TokenBlaster.lol",
    type: "website",
    images: shareImages(HOME_CARD).openGraph,
  },
  twitter: {
    card: "summary_large_image",
    title: "TokenBlaster.lol",
    description: "Load your tokens. Blast them at the chain. Every bullet is a real BSV transaction.",
    images: shareImages(HOME_CARD).twitter,
  },
  applicationName: "TokenBlaster",
  appleWebApp: { capable: true, title: "TokenBlaster", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full ${drFontClass} ${logoFont.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PALETTE_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <SiteNav />
        <div className="flex flex-1 flex-col">{children}</div>
        <SiteFooter />
        <SiteMusicPlayer />
      </body>
    </html>
  );
}
