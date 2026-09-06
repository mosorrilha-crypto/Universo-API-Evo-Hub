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

// TASK-0321 tentou sincronizar `theme-color` com o tema pra deixar a barra
// de status branca no claro — regressão real (TASK-0324, print comparando
// com o WhatsApp nativo NO MESMO APARELHO): fora do modo instalado
// (standalone/PWA), o Android/Chrome não repinta a barra de status de
// verdade numa aba de navegador comum, mas alguns navegadores AINDA usam a
// luminância do `theme-color` pra decidir a cor do ícone/relógio (claro vs
// escuro) — resultado: `theme-color` branco pro tema claro fez o ícone
// ficar escuro, só que a barra continuou preta (porque não dava pra pintar
// mesmo), virando texto escuro sobre fundo escuro, ilegível. Prova real: o
// WhatsApp nativo, no mesmo celular, também tem a barra de status preta —
// ele só garante ícone/relógio SEMPRE branco, nunca tenta deixar a barra
// branca. TASK-0324 reverte pra esse comportamento (ícone sempre claro);
// só ativa a troca de cor de verdade quando o app está instalado como PWA
// (`display-mode: standalone`), único modo em que o Android realmente
// pinta a barra com a cor do tema.
const THEME_COLOR: Record<AppTheme, string> = {
  dark: '#151C22',
  light: '#FFFFFF',
  blue: '#0B2B47',
  clean: '#FFFFFF',
};
const STANDALONE_QUERY = '(display-mode: standalone)';

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
    // Só troca a cor de verdade quando o app está instalado (standalone) —
    // fora daí, o Android não repinta a barra mesmo, e mudar `theme-color`
    // só arriscava trocar a cor do ícone pra escuro sem a barra acompanhar
    // (ver comentário do THEME_COLOR acima). Em aba de navegador comum, o
    // valor estático de index.html (#111b21, ícone sempre claro) já é o
    // comportamento correto e não precisa ser tocado aqui.
    const isStandalone = typeof window.matchMedia === 'function' && window.matchMedia(STANDALONE_QUERY).matches;
    if (isStandalone) {
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) themeColorMeta.setAttribute('content', THEME_COLOR[theme]);
    }
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
