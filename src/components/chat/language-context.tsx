"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { SUPPORTED_UI_LANGUAGES } from "@/lib/types";
import type { UiLanguage } from "@/lib/types";

interface LanguageContextValue {
  language: UiLanguage;
  setLanguage: (lang: UiLanguage) => void;
  toggle: () => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

// ISO 639-1 for the UI languages: <html lang> (the root layout can only seed a
// static SSR default, so it is synced after mount) and `Intl` locales. Bare
// subtags resolve to the same defaults as "it-IT" / "en-US" for our formats.
export const UI_LANGUAGE_BCP47: Record<UiLanguage, string> = {
  eng: "en",
  ita: "it",
  spa: "es",
  fra: "fr",
  por: "pt",
  deu: "de",
};

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage>("ita");

  // Hydrate from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    const stored = localStorage.getItem("chat:language");
    if (SUPPORTED_UI_LANGUAGES.includes(stored as UiLanguage)) {
      setLanguageState(stored as UiLanguage);
    }
  }, []);

  // Screen readers pick their voice from <html lang>; without this every
  // language is announced with an Italian one.
  useEffect(() => {
    document.documentElement.lang = UI_LANGUAGE_BCP47[language];
    return () => {
      // The root layout persists across client navigation. Restore its SSR
      // default when leaving the app layout for auth or other public routes.
      document.documentElement.lang = "it";
    };
  }, [language]);

  const setLanguage = useCallback((lang: UiLanguage) => {
    setLanguageState(lang);
    try {
      localStorage.setItem("chat:language", lang);
    } catch {
      // ignore (private mode etc.)
    }
  }, []);

  const toggle = useCallback(() => {
    const currentIndex = SUPPORTED_UI_LANGUAGES.indexOf(language);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % SUPPORTED_UI_LANGUAGES.length : 0;
    setLanguage(SUPPORTED_UI_LANGUAGES[nextIndex]);
  }, [language, setLanguage]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggle }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
