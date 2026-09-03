import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

const requiredLightSlateSelectors = [
  "html[data-theme='light'] .bg-slate-700",
  "html[data-theme='light'] .bg-slate-700\\/50",
  "html[data-theme='light'] .bg-slate-700\\/60",
  "html[data-theme='light'] .bg-slate-700\\/70",
  "html[data-theme='light'] .bg-slate-800",
  "html[data-theme='light'] .bg-slate-800\\/30",
  "html[data-theme='light'] .bg-slate-800\\/40",
  "html[data-theme='light'] .bg-slate-800\\/50",
  "html[data-theme='light'] .bg-slate-800\\/60",
  "html[data-theme='light'] .bg-slate-800\\/65",
  "html[data-theme='light'] .bg-slate-800\\/70",
  "html[data-theme='light'] .bg-slate-800\\/75",
  "html[data-theme='light'] .bg-slate-800\\/80",
  "html[data-theme='light'] .bg-slate-800\\/90",
  "html[data-theme='light'] .bg-slate-900",
  "html[data-theme='light'] .bg-slate-900\\/40",
  "html[data-theme='light'] .bg-slate-900\\/45",
  "html[data-theme='light'] .bg-slate-900\\/50",
  "html[data-theme='light'] .bg-slate-900\\/60",
  "html[data-theme='light'] .bg-slate-900\\/65",
  "html[data-theme='light'] .bg-slate-900\\/70",
  "html[data-theme='light'] .bg-slate-900\\/75",
  "html[data-theme='light'] .bg-slate-900\\/80",
  "html[data-theme='light'] .bg-slate-900\\/90",
  "html[data-theme='light'] .bg-slate-950",
  "html[data-theme='light'] .bg-slate-950\\/25",
  "html[data-theme='light'] .bg-slate-950\\/30",
  "html[data-theme='light'] .bg-slate-950\\/35",
  "html[data-theme='light'] .bg-slate-950\\/40",
  "html[data-theme='light'] .bg-slate-950\\/45",
  "html[data-theme='light'] .bg-slate-950\\/50",
  "html[data-theme='light'] .bg-slate-950\\/55",
  "html[data-theme='light'] .bg-slate-950\\/60",
  "html[data-theme='light'] .bg-slate-950\\/65",
  "html[data-theme='light'] .bg-slate-950\\/70",
  "html[data-theme='light'] .bg-slate-950\\/80",
  "html[data-theme='light'] .bg-slate-950\\/85",
  "html[data-theme='light'] .bg-slate-950\\/90",
] as const;

describe('contraste global de botões no tema claro', () => {
  it('cobre no modo claro todas as variações slate inventariadas nos componentes', () => {
    requiredLightSlateSelectors.forEach((selector) => expect(css).toContain(selector));
  });

  it('mantém ações sólidas com texto branco e fundos escuros o suficiente', () => {
    expect(css).toContain("button[class~='bg-emerald-500'][class~='text-white']");
    expect(css).toContain("button[class~='bg-sky-500'][class~='text-white']");
    expect(css).toContain('background-color: var(--button-action) !important;');
    expect(css).toContain('background-color: var(--button-info) !important;');
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

  it('escurece valores e avisos semânticos fora de botões no modo claro', () => {
    expect(css).toContain("html[data-theme='light'] .text-emerald-200");
    expect(css).toContain("html[data-theme='light'] .text-sky-200");
    expect(css).toContain("html[data-theme='light'] .text-amber-200");
    expect(css).toContain("html[data-theme='light'] .text-rose-200");
    expect(css).toContain("html[data-theme='light'] .text-cyan-200");
    expect(css).toContain("html[data-theme='light'] .text-indigo-200");
    expect(css).toContain("html[data-theme='light'] .text-violet-200");
    expect(css).toContain("html[data-theme='light'] .knowledge-workspace__audit");
    expect(css).toContain("html[data-theme='light'] .knowledge-workspace__audit-metric");
    expect(css).toContain("html[data-theme='light'] .knowledge-workspace__catalog-summary");
    expect(css).toContain("html[data-theme='light'] .knowledge-workspace__catalog-metric");
    expect(css).toContain("html[data-theme='light'] .knowledge-workspace__variant-editor");
    expect(css).toContain('.knowledge-workspace__variant-editor input');
    expect(css).toContain("html[data-theme='light'] .operations-quick-access");
    expect(css).toContain("html[data-theme='light'] .operations-quick-action");
    expect(css).toContain("html[data-theme='light'] .operations-smart-queue");
    expect(css).toContain("html[data-theme='light'] .operations-priority-item");
    expect(css).toContain("html[data-theme='light'] [class*='bg-[#111b21]']");
    expect(css).toContain("html[data-theme='light'] [class*='bg-[#202c33]']");
    expect(css).toContain("html[data-theme='light'] [class*='bg-[#26343c]']");
    expect(css).toContain("html[data-theme='light'] .bg-blue-950\\/80");
    expect(css).toContain("html[data-theme='light'] .bg-sky-950\\/80");
    expect(css).toContain("html[data-theme='light'] .bg-amber-950\\/40");
    expect(css).toContain("html[data-theme='light'] .bg-rose-950\\/80");
  });

  it('mantém texto branco nas bolhas de mensagem enviada (operador/IA) que ficam com fundo escuro de propósito no claro', () => {
    expect(css).toContain("html[data-theme='light'] [class*='bg-[#2e261f]'].text-white");
    expect(css).toContain("html[data-theme='light'] [class*='bg-[#005c4b]'].text-white");
  });
});
