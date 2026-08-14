/**
 * Backlog técnico real (roadmapStore.ts) — substitui a lista de 4 cards
 * fixos no código que existia na aba "Roadmap Técnico & Backlog".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { createRoadmapItem, deleteRoadmapItem, listRoadmapItems, updateRoadmapItem } from '../roadmapStore';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('createRoadmapItem / listRoadmapItems', () => {
  it('cria um item e devolve na listagem', async () => {
    const created = await createRoadmapItem({ title: 'Exportador de relatórios', description: 'CSV/PDF', priority: 'baixa', createdBy: 'op-1' });
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('pendente');

    const items = await listRoadmapItems();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Exportador de relatórios');
    expect(items[0].imageBase64).toBeNull();
  });

  it('guarda a imagem quando informada', async () => {
    const created = await createRoadmapItem({
      title: 'Mockup novo botão',
      description: '',
      priority: 'media',
      imageBase64: 'data:image/png;base64,QQ==',
      createdBy: 'op-1',
    });
    expect(created.imageBase64).toBe('data:image/png;base64,QQ==');
  });

  it('ordena pendentes antes de concluídas, e dentro de cada grupo por prioridade (alta > média > baixa)', async () => {
    const baixa = await createRoadmapItem({ title: 'Baixa', description: '', priority: 'baixa', createdBy: 'op-1' });
    const alta = await createRoadmapItem({ title: 'Alta', description: '', priority: 'alta', createdBy: 'op-1' });
    const media = await createRoadmapItem({ title: 'Média', description: '', priority: 'media', createdBy: 'op-1' });
    await updateRoadmapItem(alta.id, { status: 'concluido' });

    const items = await listRoadmapItems();
    // Concluída (mesmo sendo "alta") vai pro final; entre as pendentes, média antes de baixa.
    expect(items.map((i) => i.title)).toEqual(['Média', 'Baixa', 'Alta']);
    expect(items.map((i) => i.status)).toEqual(['pendente', 'pendente', 'concluido']);
  });
});

describe('updateRoadmapItem', () => {
  it('atualiza só os campos informados, mantém o resto', async () => {
    const created = await createRoadmapItem({ title: 'Original', description: 'Desc original', priority: 'media', createdBy: 'op-1' });
    const updated = await updateRoadmapItem(created.id, { status: 'concluido' });

    expect(updated?.title).toBe('Original');
    expect(updated?.description).toBe('Desc original');
    expect(updated?.status).toBe('concluido');
  });

  it('devolve null quando o item não existe', async () => {
    const updated = await updateRoadmapItem('id-fantasma', { status: 'concluido' });
    expect(updated).toBeNull();
  });

  it('imageBase64: null apaga a imagem existente', async () => {
    const created = await createRoadmapItem({ title: 'X', description: '', priority: 'media', imageBase64: 'data:image/png;base64,QQ==', createdBy: 'op-1' });
    const updated = await updateRoadmapItem(created.id, { imageBase64: null });
    expect(updated?.imageBase64).toBeNull();
  });
});

describe('deleteRoadmapItem', () => {
  it('remove o item — some da listagem', async () => {
    const created = await createRoadmapItem({ title: 'Pra apagar', description: '', priority: 'media', createdBy: 'op-1' });
    await deleteRoadmapItem(created.id);
    const items = await listRoadmapItems();
    expect(items).toHaveLength(0);
  });
});
