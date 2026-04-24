"use client";

import { useCallback, useEffect, useState } from "react";
import { DownloadIcon, ShareIcon, XIcon } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "pwa-install-dismissed";

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    setIsStandalone(standalone);
    if (standalone) return;
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    // Detect iOS (Safari — no beforeinstallprompt support)
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as unknown as Record<string, unknown>).MSStream;
    setIsIOS(ios);

    if (ios) {
      // Show instructions banner on iOS after a short delay
      const timer = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(timer);
    }

    // Android/Chrome — listen for the native install prompt
    function handleBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () =>
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setDeferredPrompt(null);
    sessionStorage.setItem(DISMISSED_KEY, "1");
  }, []);

  if (!visible || isStandalone) return null;

  // iOS: show manual instructions
  if (isIOS) {
    return (
      <div className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-md animate-in slide-in-from-bottom-4 fade-in duration-300">
        <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/95 p-3 shadow-lg backdrop-blur-sm">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
            <DownloadIcon size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              Installa LDS RAG
            </p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Tocca{" "}
              <ShareIcon size={12} className="inline-block align-text-bottom text-indigo-400" />{" "}
              Condividi e poi{" "}
              <span className="font-medium text-foreground">
                &ldquo;Aggiungi alla schermata Home&rdquo;
              </span>
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Chiudi"
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>
    );
  }

  // Android/Chrome: native install button
  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-md animate-in slide-in-from-bottom-4 fade-in duration-300 md:left-auto md:right-6 md:max-w-sm">
      <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/95 p-3 shadow-lg backdrop-blur-sm">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400">
          <DownloadIcon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Installa LDS RAG</p>
          <p className="text-xs text-muted-foreground truncate">
            Accesso rapido dalla home
          </p>
        </div>
        <button
          onClick={handleInstall}
          className="shrink-0 rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-500/30"
        >
          Installa
        </button>
        <button
          onClick={handleDismiss}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Chiudi"
        >
          <XIcon size={14} />
        </button>
      </div>
    </div>
  );
}
