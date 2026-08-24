import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppLanguage, interpolate, TranslationKey, translations } from '../i18n/translations';

export type AppTheme = 'dark' | 'light' | 'blue' | 'clean';

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

interface AppPreferencesValue {
  language: AppLanguage;
  theme: AppTheme;
  setLanguage: (language: AppLanguage) => void;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
  t: Translate;
}

const AppPreferencesContext = createContext<AppPreferencesValue | null>(null);

const LANGUAGE_STORAGE_KEY = 'universo_language';
const THEME_STORAGE_KEY = 'universo_theme';

function readPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export const AppPreferencesProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [language, setLanguageState] = useState<AppLanguage>(() => readPreference<AppLanguage>(LANGUAGE_STORAGE_KEY, ['pt', 'es'], 'pt'));
  const [theme, setThemeState] = useState<AppTheme>(() => readPreference<AppTheme>(THEME_STORAGE_KEY, ['dark', 'light', 'blue', 'clean'], 'dark'));

  useEffect(() => {
    document.documentElement.lang = language === 'es' ? 'es-PY' : 'pt-BR';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Preferências locais melhoram a experiência, mas nunca devem bloquear o painel.
    }
  }, [language, theme]);

  const value = useMemo<AppPreferencesValue>(() => ({
    language,
    theme,
    setLanguage: setLanguageState,
    setTheme: setThemeState,
    toggleTheme: () => setThemeState((current) => current === 'dark' ? 'light' : 'dark'),
    t: (key, values) => interpolate(translations[language][key], values),
  }), [language, theme]);

  return <AppPreferencesContext.Provider value={value}>{children}</AppPreferencesContext.Provider>;
};

export function useAppPreferences(): AppPreferencesValue {
  const context = useContext(AppPreferencesContext);
  if (!context) throw new Error('useAppPreferences deve ser usado dentro de AppPreferencesProvider');
  return context;
}
