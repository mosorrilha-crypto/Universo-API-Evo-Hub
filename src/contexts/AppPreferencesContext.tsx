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

// TASK-0320 — achado real (print comparando lado a lado com o WhatsApp
// Business real): `index.html`/`manifest.json` fixam `theme-color` em
// #111b21 (o --surface-panel do tema escuro) pra sempre, então a barra de
// status do Android/PWA fica escura mesmo com o tema claro/azul/limpo
// selecionado — cria uma tarja escura colada no topo do cabeçalho branco
// que o WhatsApp real não tem (o app nativo dele sincroniza a cor da barra
// de status com o próprio tema). Mesma cor que `--surface-panel` de cada
// tema em index.css (não dá pra ler a custom property do CSS daqui sem
// forçar um reflow só pra isso, então os hex ficam espelhados à mão; se um
// desses tokens mudar de cor de fundo do cabeçalho, atualizar aqui também).
const THEME_COLOR: Record<AppTheme, string> = {
  dark: '#151C22',
  light: '#FFFFFF',
  blue: '#0B2B47',
  clean: '#FFFFFF',
};

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
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.setAttribute('content', THEME_COLOR[theme]);
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
