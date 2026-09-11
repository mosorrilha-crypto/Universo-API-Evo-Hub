// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LazyTabErrorBoundary } from '../LazyTabErrorBoundary';

const ThrowingChild: React.FC<{ error: Error }> = ({ error }) => {
  throw error;
};

describe('LazyTabErrorBoundary', () => {
  beforeEach(() => {
    sessionStorage.clear();
    // React sempre loga o erro capturado no console mesmo com boundary —
    // silenciado aqui pra não poluir a saída do teste, não pra esconder bug.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renderiza os filhos normalmente quando não há erro', () => {
    render(
      <LazyTabErrorBoundary>
        <p>Conteúdo da aba</p>
      </LazyTabErrorBoundary>
    );
    expect(screen.getByText('Conteúdo da aba')).toBeTruthy();
  });

  it('mostra fallback com botão de recarregar para um erro qualquer, sem derrubar a árvore toda', () => {
    render(
      <LazyTabErrorBoundary>
        <ThrowingChild error={new Error('falha inesperada de renderização')} />
      </LazyTabErrorBoundary>
    );
    expect(screen.getByText(/Não foi possível carregar esta seção/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recarregar página' })).toBeTruthy();
  });

  it('recarrega a página sozinho uma vez para um erro de chunk desatualizado', () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    render(
      <LazyTabErrorBoundary>
        <ThrowingChild error={new Error('Failed to fetch dynamically imported module: /assets/SaaSAdminDashboard-abc123.js')} />
      </LazyTabErrorBoundary>
    );

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('saas_lazy_chunk_reload_attempted')).toBe('1');
  });

  it('não tenta recarregar de novo se o reload automático já foi tentado nesta aba', () => {
    sessionStorage.setItem('saas_lazy_chunk_reload_attempted', '1');
    const reloadSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });

    render(
      <LazyTabErrorBoundary>
        <ThrowingChild error={new Error('Failed to fetch dynamically imported module: /assets/SaaSAdminDashboard-abc123.js')} />
      </LazyTabErrorBoundary>
    );

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Recarregar página' })).toBeTruthy();
  });
});
