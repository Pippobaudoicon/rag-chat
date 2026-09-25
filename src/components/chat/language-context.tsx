"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { UI_LANGUAGE_BCP47 } from "@/lib/types";
import type { UiLanguage } from "@/lib/types";
import { pickLanguage, SELECTABLE_UI_LANGUAGES } from "@/components/chat/i18n";

interface LanguageContextValue {
  language: UiLanguage;
  setLanguage: (lang: UiLanguage) => void;
  toggle: () => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage>("ita");

  // Hydrate after mount to avoid SSR mismatch: the user's pick, else the
  // device language (not stored, so it keeps following the device until they pick).
  useEffect(() => {
    const stored = localStorage.getItem("chat:language");
    setLanguageState(
      SELECTABLE_UI_LANGUAGES.includes(stored as UiLanguage)
        ? (stored as UiLanguage)
        : pickLanguage(navigator.languages)
    );
  }, []);

  // Screen readers pick their voice from <html lang>; without this every
  // language is announced with an Italian one.
  useEffect(() => {
    const ssrLang = document.documentElement.lang;
    document.documentElement.lang = UI_LANGUAGE_BCP47[language];
    return () => {
      // The root layout persists across client navigation. Restore its SSR
      // value (the device language) when leaving the app layout for auth or
      // other public routes.
      document.documentElement.lang = ssrLang;
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
    const currentIndex = SELECTABLE_UI_LANGUAGES.indexOf(language);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % SELECTABLE_UI_LANGUAGES.length : 0;
    setLanguage(SELECTABLE_UI_LANGUAGES[nextIndex]);
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
