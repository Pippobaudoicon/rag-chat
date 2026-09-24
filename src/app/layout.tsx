import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { authLocalization, deviceLanguage } from "@/components/auth/AuthShell";
import { UI_LANGUAGE_BCP47 } from "@/lib/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "ChatLDS",
  description:
    "AI assistant grounded in LDS scriptures, conference talks, handbook and Liahona and so much more!",
  icons: {
    icon: [
      { url: "/icons/icon0.svg", type: "image/svg+xml" },
      { url: "/icons/icon1.png", type: "image/png" },
    ],
    apple: "/icons/apple-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ChatLDS",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-title": "ChatLDS",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#121212",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = await deviceLanguage();
  return (
    <ClerkProvider
      appearance={{ cssLayerName: "clerk" }}
      afterSignOutUrl="/sign-in"
      localization={authLocalization(lang)}
    >
      <html
        lang={UI_LANGUAGE_BCP47[lang]}
        className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
        suppressHydrationWarning
      >
        <head />
        <body className="h-full bg-background text-foreground">
          <TooltipProvider>{children}</TooltipProvider>
          <InstallPrompt />
          <ServiceWorkerRegistration />
          <Analytics />
          <SpeedInsights />
        </body>
      </html>
    </ClerkProvider>
  );
}
