/**
 * Achado real em produção: os catálogos semeados via scripts/seed-monique-
 * knowledge-base.ts nunca tiveram campo `id` nos produtos/FAQs — o tipo do
 * backend (server/services/knowledgeBaseStore.ts) nem declara essa
 * propriedade. Como a tela de edição (AgentKnowledgeBase.tsx) compara itens
 * por `p.id === id` pra saber qual atualizar, todo item com `id === undefined`
 * era "o mesmo item" pra esse código — editar o preço de UM produto mudava
 * todos os outros que também não tinham id. `ensureUniqueIds` fecha esse
 * buraco assim que os dados entram no editor.
 */
import { describe, expect, it } from 'vitest';
import { ensureUniqueIds } from '../AgentKnowledgeBase';

interface TestProduct {
  id?: string;
  name: string;
  price: string;
}

describe('ensureUniqueIds', () => {
  it('gera um id único pra cada item que não tem nenhum (caso real: catálogo semeado sem id)', () => {
    const products: TestProduct[] = [
      { name: 'Neutralización', price: 'Gs 450.000' },
      { name: 'Combo Cejas + Labios', price: 'Gs 800.000' },
      { name: 'Retoque', price: 'Gs 150.000' },
    ];

    const result = ensureUniqueIds(products, 'prod');

    const ids = result.map((p) => p.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3); // todos únicos
    expect(ids.every((id) => !!id)).toBe(true);
    // Os dados originais continuam intactos, só ganharam id.
    expect(result.map((p) => p.name)).toEqual(['Neutralización', 'Combo Cejas + Labios', 'Retoque']);
    expect(result.map((p) => p.price)).toEqual(['Gs 450.000', 'Gs 800.000', 'Gs 150.000']);
  });

  it('preserva um id já existente e válido', () => {
    const products: TestProduct[] = [{ id: 'prod-real-1', name: 'Lash Lift', price: 'Gs 140.000' }];
    const result = ensureUniqueIds(products, 'prod');
    expect(result[0].id).toBe('prod-real-1');
  });

  it('substitui ids duplicados (não só ausentes) por ids únicos', () => {
    const products: TestProduct[] = [
      { id: 'x', name: 'A', price: '1' },
      { id: 'x', name: 'B', price: '2' },
      { id: 'x', name: 'C', price: '3' },
    ];

    const result = ensureUniqueIds(products, 'prod');
    const ids = result.map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('mistura de itens com e sem id: só normaliza quem precisa', () => {
    const products: TestProduct[] = [
      { id: 'ja-tem-id', name: 'A', price: '1' },
      { name: 'B', price: '2' },
    ];

    const result = ensureUniqueIds(products, 'prod');
    expect(result[0].id).toBe('ja-tem-id');
    expect(result[1].id).toBeTruthy();
    expect(result[1].id).not.toBe('ja-tem-id');
  });

  it('lista vazia/undefined não quebra', () => {
    expect(ensureUniqueIds(undefined, 'prod')).toEqual([]);
    expect(ensureUniqueIds([], 'prod')).toEqual([]);
  });
});
