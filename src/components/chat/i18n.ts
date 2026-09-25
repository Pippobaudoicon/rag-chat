import { SOURCE_LABELS, UI_LANGUAGE_BCP47 } from "@/lib/types";
import type { CorpusLanguage, SourceType, UiLanguage } from "@/lib/types";
import { eng } from "./locales/eng";
import { ita } from "./locales/ita";
import { spa } from "./locales/spa";

export const UI_LANGUAGE_CODES: Record<UiLanguage, string> = {
  eng: "EN",
  ita: "IT",
  spa: "ES",
  fra: "FR",
  por: "PT",
  deu: "DE",
};

export const UI_LANGUAGE_NAMES: Record<UiLanguage, string> = {
  eng: "English",
  ita: "Italiano",
  spa: "Español",
  fra: "Français",
  por: "Português",
  deu: "Deutsch",
};

export const SOURCE_LANGUAGE_NAMES: Record<CorpusLanguage, string> = {
  ita: "Italiano",
  eng: "English",
};

export const UI_TEXT = { ita, eng, spa } as const;

type UiText = (typeof UI_TEXT)["ita"] | (typeof UI_TEXT)["eng"] | (typeof UI_TEXT)["spa"];

// TODO: temporarily hardcode the three languages that have onboarding copy, until we have all the copy translated into all languages. Then we can remove this function and just use the `language` directly.
export function uiText(language: UiLanguage): UiText {
  if (language === "ita") return UI_TEXT.ita;
  if (language === "spa") return UI_TEXT.spa;
  return UI_TEXT.eng;
}

export type TextLanguage = keyof typeof UI_TEXT;

// Default UI language before the user picks one: the first device language
// (Accept-Language on the server, navigator.languages in the browser) that has
// copy, else English.
// ponytail: ignores Accept-Language q-values; browsers already sort by preference.
export function pickLanguage(tags: readonly string[]): TextLanguage {
  for (const tag of tags) {
    const code = tag.trim().slice(0, 2).toLowerCase();
    const lang = (Object.keys(UI_TEXT) as TextLanguage[]).find((l) => UI_LANGUAGE_BCP47[l] === code);
    if (lang) return lang;
  }
  return "eng";
}

export function sourceLabel(source: SourceType, language: UiLanguage): string {
  if (language === "ita") return SOURCE_LABELS[source].it;
  if (language === "spa") return SOURCE_LABELS[source].es;
  return SOURCE_LABELS[source].en;
}

export function formatText(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}
