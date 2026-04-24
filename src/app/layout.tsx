import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
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
  title: "LDS RAG Chat",
  description:
    "AI assistant grounded in LDS scriptures, conference talks, handbook and Liahona and so much more!",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "LDS RAG Chat",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#121212",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="it"
        className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
        suppressHydrationWarning
      >
        <head>
          <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        </head>
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
