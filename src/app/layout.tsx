import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TokenBlaster.lol",
  description: "Live BSV traffic, chain games and token-blasting competitions.",
  applicationName: "TokenBlaster",
  appleWebApp: { capable: true, title: "TokenBlaster", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0a0404",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
