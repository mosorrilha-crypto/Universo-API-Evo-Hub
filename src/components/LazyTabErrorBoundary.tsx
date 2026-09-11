import React from 'react';

const CHUNK_RELOAD_FLAG_KEY = 'saas_lazy_chunk_reload_attempted';

function isLikelyStaleChunkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'ChunkLoadError') return true;
  return /dynamically imported module|importing a module script failed|failed to fetch dynamically imported module/i.test(
    error.message || ''
  );
}

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * TASK-0376 fez várias abas carregarem sob demanda (`React.lazy`), mas
 * nenhum Error Boundary existia no app inteiro — uma falha ao baixar o
 * chunk de uma aba (típico logo após um novo deploy: a aba estava aberta
 * com o `index.html` antigo, que referencia nomes de arquivo que o deploy
 * novo já substituiu) derrubava a árvore de componentes toda, deixando a
 * tela em branco sem nenhuma mensagem. Se o erro tem cara de chunk
 * desatualizado, recarrega a página sozinho uma única vez (o `index.html`
 * atualizado aponta pros chunks certos); para qualquer outro erro, ou se o
 * reload automático já foi tentado nesta aba do navegador, mostra um botão
 * manual em vez de tela em branco.
 */
export class LazyTabErrorBoundary extends React.Component<Props, State> {
  declare props: Readonly<Props>;
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (!isLikelyStaleChunkError(error)) return;
    let alreadyAttempted = true;
    try {
      alreadyAttempted = sessionStorage.getItem(CHUNK_RELOAD_FLAG_KEY) === '1';
      if (!alreadyAttempted) sessionStorage.setItem(CHUNK_RELOAD_FLAG_KEY, '1');
    } catch {
      // sessionStorage indisponível (modo privado/bloqueio) — segue pro
      // fallback manual abaixo em vez de arriscar loop de reload.
    }
    if (!alreadyAttempted) window.location.reload();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-4 text-center text-slate-400">
          <p className="max-w-sm text-sm">
            Não foi possível carregar esta seção. Isso costuma acontecer logo após uma atualização do sistema.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 transition-colors hover:bg-emerald-400"
          >
            Recarregar página
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
