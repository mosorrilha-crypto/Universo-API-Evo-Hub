/**
 * Camada 1 (Global) editável por saas_admin (pedido real do dono do
 * produto: ajustar sem PR+deploy toda vez) — ver docs/AGENTE-VERTICAL-
 * ARQUITETURA.md seção 1 e server/services/autoReply.ts (DEFAULT_GLOBAL_LAYER).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { getGlobalPromptLayerOverride, getGlobalPromptLayerRow, setGlobalPromptLayer } from '../globalPromptStore';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('getGlobalPromptLayerOverride', () => {
  it('devolve null quando nenhum override foi salvo ainda (linha não existe)', async () => {
    expect(await getGlobalPromptLayerOverride()).toBeNull();
  });

  it('devolve null quando o content salvo é string vazia/só espaço (equivalente a "sem override")', async () => {
    await setGlobalPromptLayer('   ', 'op-1');
    expect(await getGlobalPromptLayerOverride()).toBeNull();
  });

  it('devolve o texto salvo quando existe um override real', async () => {
    await setGlobalPromptLayer('Regra customizada de teste.', 'op-1');
    expect(await getGlobalPromptLayerOverride()).toBe('Regra customizada de teste.');
  });
});

describe('setGlobalPromptLayer / getGlobalPromptLayerRow', () => {
  it('grava e sobrescreve (upsert) a mesma linha singleton — nunca cria uma segunda', async () => {
    await setGlobalPromptLayer('Versão 1', 'op-1');
    await setGlobalPromptLayer('Versão 2', 'op-2');

    const row = await getGlobalPromptLayerRow();
    expect(row.content).toBe('Versão 2');
    expect(row.updatedBy).toBe('op-2');
    expect(row.updatedAt).toBeTruthy();
  });

  it('content: null reseta pro padrão hardcoded (limpa o override, não apaga a linha)', async () => {
    await setGlobalPromptLayer('Algo temporário', 'op-1');
    await setGlobalPromptLayer(null, 'op-1');

    expect(await getGlobalPromptLayerOverride()).toBeNull();
    const row = await getGlobalPromptLayerRow();
    expect(row.content).toBeNull();
  });
});
