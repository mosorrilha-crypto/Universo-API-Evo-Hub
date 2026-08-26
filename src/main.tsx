import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { AppPreferencesProvider } from './contexts/AppPreferencesContext';
import PublicCatalogPage from './components/PublicCatalogPage';
import PublicCatalogMoniqueConcierge from './components/PublicCatalogMoniqueConcierge';
import './index.css';

const publicCatalogMatch = window.location.pathname.match(/^\/catalogo\/([a-z0-9][a-z0-9-]{0,79})\/?$/i);
const publicCatalogSlug = publicCatalogMatch?.[1]?.toLowerCase();

// Segundo catálogo independente da Monique (captura real do site), rota fixa e separada
// do catálogo público existente acima — nunca deve substituir nem recolorir aquele fluxo.
const isMoniqueSecondCatalogRoute = /^\/catalogo\/monique-teste\/novo\/?$/i.test(window.location.pathname);

function Root() {
  if (isMoniqueSecondCatalogRoute) {
    return <PublicCatalogMoniqueConcierge />;
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
