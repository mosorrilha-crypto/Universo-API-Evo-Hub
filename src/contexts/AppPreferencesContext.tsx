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
// de status branca no claro — regressão real (TASK-0324): usuário
// confirmou, testando de verdade com o Universo JÁ INSTALADO como PWA (não
// só no navegador), que o ícone/relógio da barra de status ficava escuro
// sobre um fundo que continuava escuro (ilegível), mesmo nesse modo. Uma
// primeira correção desta task tentou só ativar a troca dinâmica no modo
// `standalone` (supondo que só falhava numa aba de navegador comum) — mas
// como o usuário já estava usando o modo instalado e o problema persistia,
// essa suposição estava errada: o Android/Chrome, no PWA instalado deste
// projeto, provavelmente lê a cor da barra do `theme_color` ESTÁTICO do
// `manifest.json` na abertura do app, não da tag `<meta>` mutada via JS
// depois — mudar a `<meta>` em runtime não repinta a barra de verdade,
// só (possivelmente) o ícone, criando o mesmo descompasso escuro-sobre-
// escuro em qualquer modo. Diferente do WhatsApp (app nativo, acesso direto
// do SO pra pintar a barra em qualquer momento), um PWA não tem esse nível
// de controle garantido. Solução: parar de tentar sincronizar em runtime —
// deixar a barra sempre no valor estático de `index.html`/`manifest.json`
// (`#111b21`, ícone sempre claro), que é o que de fato funciona hoje.

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
    // TASK-0324 — não mexe mais em `theme-color` aqui (ver comentário acima
    // do arquivo). O valor estático de index.html/manifest.json já garante
    // ícone sempre legível, em qualquer modo (navegador ou PWA instalado).
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
