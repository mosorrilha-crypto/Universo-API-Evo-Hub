import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

describe('contraste global de botões no tema claro', () => {
  it('mantém ações sólidas com texto branco e fundos escuros o suficiente', () => {
    expect(css).toContain("button[class~='bg-emerald-500'][class~='text-white']");
    expect(css).toContain("button[class~='bg-sky-500'][class~='text-white']");
    expect(css).toContain("background-color: var(--button-action) !important;");
    expect(css).toContain("background-color: var(--button-info) !important;");
    expect(css).toContain('color: #FFFFFF !important;');
  });

  it('mantém botões outline e desabilitados legíveis sem depender de baixa opacidade', () => {
    expect(css).toContain("button[class~='bg-emerald-500/10']");
    expect(css).toContain("button[class~='bg-sky-500/10']");
    expect(css).toContain("html[data-theme='light'] button:disabled");
    expect(css).toContain('opacity: 1 !important;');
    expect(css).toContain('color: var(--button-disabled-text) !important;');
    expect(css).toContain('background-color: var(--button-disabled-surface) !important;');
  });
});
