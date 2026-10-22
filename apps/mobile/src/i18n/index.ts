import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { sr } from './sr';
import { toCyrillic, type Tree } from './cyrillic';

export type AppLanguage = 'sr' | 'en';
export type AppScript = 'latn' | 'cyrl';
export type LocaleCode = 'sr-Latn' | 'sr-Cyrl' | 'en';

// The language setting and the script setting together pick the resource set.
export const localeCode = (language: AppLanguage, script: AppScript): LocaleCode =>
  language === 'en' ? 'en' : script === 'cyrl' ? 'sr-Cyrl' : 'sr-Latn';

export const resources = {
  'sr-Latn': { translation: sr },
  'sr-Cyrl': { translation: toCyrillic(sr as unknown as Tree) },
  en: { translation: en },
} as const;

export async function initI18n(language: AppLanguage, script: AppScript) {
  await i18next.use(initReactI18next).init({
    resources,
    lng: localeCode(language, script),
    fallbackLng: 'sr-Latn',
    interpolation: { escapeValue: false },
    // The plural rules of Serbian are one/few/other; Intl.PluralRules supplies them (Hermes has it).
    compatibilityJSON: 'v4',
    returnNull: false,
  } as Parameters<typeof i18next.init>[0]);
  return i18next;
}

export async function setLocale(language: AppLanguage, script: AppScript) {
  await i18next.changeLanguage(localeCode(language, script));
}

export { i18next };
