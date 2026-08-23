import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppPreferencesProvider } from './contexts/AppPreferencesContext';
import PublicCatalogPage from './components/PublicCatalogPage';
import './index.css';

const publicCatalogMatch = window.location.pathname.match(/^\/catalogo\/([a-z0-9][a-z0-9-]{0,79})\/?$/i);
const publicCatalogSlug = publicCatalogMatch?.[1]?.toLowerCase();

function Root() {
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
