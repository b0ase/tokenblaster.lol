import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";

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
  },
  twitter: {
    card: "summary_large_image",
    title: "TokenBlaster.lol",
    description: "Load your tokens. Blast them at the chain. Every bullet is a real BSV transaction.",
  },
  applicationName: "TokenBlaster",
  appleWebApp: { capable: true, title: "TokenBlaster", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0a0404",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
