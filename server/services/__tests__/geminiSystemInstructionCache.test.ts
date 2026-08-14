/**
 * Cache de contexto real do Gemini pra Camada 1+2 do prompt — achado numa
 * auditoria (14/08/2026): o painel já tinha um card "Tokens Economizados
 * (Cache)" e um badge "Context Cache" há tempos, mas sempre mostrava 0
 * porque isso nunca tinha sido implementado de verdade. Foco destes testes:
 * nunca deixar uma falha de cache derrubar o fluxo real do agente (sempre
 * cai pra `null` = "sem cache, systemInstruction inline como sempre").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedSystemInstruction, invalidateAllSystemInstructionCaches } from '../geminiSystemInstructionCache';
import type { GoogleGenAI } from '@google/genai';

function fakeAiWithCaches(createImpl: (params: any) => Promise<any>): GoogleGenAI {
  return { caches: { create: createImpl } } as unknown as GoogleGenAI;
}

function fakeAiWithoutCaches(): GoogleGenAI {
  return {} as unknown as GoogleGenAI;
}

beforeEach(() => {
  invalidateAllSystemInstructionCaches();
});

describe('getCachedSystemInstruction', () => {
  it('cria um cache novo e devolve o name da API na primeira chamada', async () => {
    const create = vi.fn(async (params: any) => {
      expect(params.model).toBe('gemini-3.6-flash');
      expect(params.config.systemInstruction).toBe('Texto fixo da Camada 1+2.');
      return { name: 'cachedContents/abc123' };
    });
    const ai = fakeAiWithCaches(create);

    const name = await getCachedSystemInstruction(ai, 'gemini-3.6-flash', 'especialista:faq:beauty_studio', 'Texto fixo da Camada 1+2.');
    expect(name).toBe('cachedContents/abc123');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('reusa o cache já criado (não chama caches.create de novo) quando o texto não mudou', async () => {
    const create = vi.fn(async () => ({ name: 'cachedContents/abc123' }));
    const ai = fakeAiWithCaches(create);

    await getCachedSystemInstruction(ai, 'gemini-3.6-flash', 'especialista:faq:beauty_studio', 'Texto fixo.');
    const second = await getCachedSystemInstruction(ai, 'gemini-3.6-flash', 'especialista:faq:beauty_studio', 'Texto fixo.');

    expect(second).toBe('cachedContents/abc123');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('recria o cache quando o texto muda (ex: admin editou o prompt global) — nunca serve uma regra desatualizada', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ name: 'cachedContents/versao-antiga' })
      .mockResolvedValueOnce({ name: 'cachedContents/versao-nova' });
    const ai = fakeAiWithCaches(create as any);

    const first = await getCachedSystemInstruction(ai, 'gemini-3.6-flash', 'especialista:faq:beauty_studio', 'Texto versão 1.');
    const second = await getCachedSystemInstruction(ai, 'gemini-3.6-flash', 'especialista:faq:beauty_studio', 'Texto versão 2 (editado pelo admin).');

    expect(first).toBe('cachedContents/versao-antiga');
    expect(second).toBe('cachedContents/versao-nova');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('invalidateAllSystemInstructionCaches força recriar mesmo com o texto igual (reset explícito do prompt global)', async () => {
    const create = vi.fn(async () => ({ name: 'cachedContents/abc123' }));
    const ai = fakeAiWithCaches(create);

    await getCachedSystemInstruction(ai, 'gemini-3.6-flash', 'especialista:faq:beauty_studio', 'Texto fixo.');
    invalidateAllSystemInstructionCaches();
    await getCachedSystemInstruction(ai, 'gemini-3.6-flash', 'especialista:faq:beauty_studio', 'Texto fixo.');

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('nunca lança — devolve null quando ai.caches nem existe no client (mock de teste, versão antiga do SDK, etc)', async () => {
    const ai = fakeAiWithoutCaches();
    const name = await getCachedSystemInstruction(ai, 'gemini-3.6-flash', 'especialista:faq:beauty_studio', 'Texto fixo.');
    expect(name).toBeNull();
  });

  it('nunca lança — devolve null quando caches.create rejeita (rede, conteúdo abaixo do mínimo cacheável, etc)', async () => {
    const ai = fakeAiWithCaches(async () => {
      throw new Error('conteúdo abaixo do mínimo de tokens cacheável');
    });
    const name = await getCachedSystemInstruction(ai, 'gemini-3.6-flash', 'especialista:faq:beauty_studio', 'Texto fixo.');
    expect(name).toBeNull();
  });

  it('devolve null quando a API responde sem "name" (nada pra reusar)', async () => {
    const ai = fakeAiWithCaches(async () => ({}));
    const name = await getCachedSystemInstruction(ai, 'gemini-3.6-flash', 'especialista:faq:beauty_studio', 'Texto fixo.');
    expect(name).toBeNull();
  });

  it('cacheKeys diferentes (ex: segmentos diferentes) nunca compartilham cache um do outro', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ name: 'cachedContents/beauty' })
      .mockResolvedValueOnce({ name: 'cachedContents/generic' });
    const ai = fakeAiWithCaches(create as any);

    const beauty = await getCachedSystemInstruction(ai, 'gemini-3.6-flash', 'especialista:faq:beauty_studio', 'Texto A.');
    const generic = await getCachedSystemInstruction(ai, 'gemini-3.6-flash', 'especialista:faq:generic', 'Texto A.');

    expect(beauty).toBe('cachedContents/beauty');
    expect(generic).toBe('cachedContents/generic');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
