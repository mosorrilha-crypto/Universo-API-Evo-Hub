import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppPreferencesProvider } from './contexts/AppPreferencesContext';
import PublicCatalogPage from './components/PublicCatalogPage';
import { PublicGoldCatalogPage } from './components/PublicGoldCatalogPage';
import './index.css';

const publicGoldCatalogMatch = window.location.pathname.match(/^\/catalogo\/([a-z0-9][a-z0-9-]{0,79})\/gold\/?$/i);
const publicGoldCatalogSlug = publicGoldCatalogMatch?.[1]?.toLowerCase();
const publicCatalogMatch = window.location.pathname.match(/^\/catalogo\/([a-z0-9][a-z0-9-]{0,79})\/?$/i);
const publicCatalogSlug = publicCatalogMatch?.[1]?.toLowerCase();

function Root() {
  if (publicGoldCatalogSlug) {
    return <PublicGoldCatalogPage slug={publicGoldCatalogSlug} />;
  }

  if (publicCatalogSlug) {
    return <PublicCatalogPage slug={publicCatalogSlug} />;
  }

  return (
    <AppPreferencesProvider>
      <App />
    </AppPreferencesProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
