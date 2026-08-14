/**
 * Backlog técnico do produto ("Roadmap Técnico & Backlog" no painel SaaS
 * Master) — pedido real do usuário: a aba era uma lista de 4 cards fixos no
 * código (SaaSAdminDashboard.tsx), impossível de editar, com itens já
 * desatualizados. Agora é uma lista real: o saas_admin adiciona pendências
 * não-urgentes (título + descrição + prioridade + imagem opcional) conforme
 * aparecem, marca como concluída quando executada.
 *
 * Não é por tenant — é o backlog do SaaS inteiro (ver migration
 * 0028_roadmap_items.sql).
 */
import { getDb } from './db';

export type RoadmapPriority = 'alta' | 'media' | 'baixa';
export type RoadmapStatus = 'pendente' | 'concluido';

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  priority: RoadmapPriority;
  status: RoadmapStatus;
  imageBase64: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const PRIORITY_RANK: Record<RoadmapPriority, number> = { alta: 0, media: 1, baixa: 2 };

function mapRow(row: any): RoadmapItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    priority: row.priority,
    status: row.status,
    imageBase64: row.image_base64 ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Pendentes primeiro (por prioridade, depois mais recente primeiro), concluídas por último — ordenado em JS porque o fake de teste não implementa ORDER BY de verdade, e assim o comportamento é idêntico em teste e produção. */
export async function listRoadmapItems(): Promise<RoadmapItem[]> {
  const db = getDb();
  const { data, error } = await db.from('roadmap_items').select('*');
  if (error) throw error;
  const items = (data || []).map(mapRow);
  items.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pendente' ? -1 : 1;
    if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return b.createdAt.localeCompare(a.createdAt);
  });
  return items;
}

export async function createRoadmapItem(input: {
  title: string;
  description: string;
  priority: RoadmapPriority;
  imageBase64?: string | null;
  createdBy: string;
}): Promise<RoadmapItem> {
  const db = getDb();
  const { data, error } = await db
    .from('roadmap_items')
    .insert({
      title: input.title,
      description: input.description,
      priority: input.priority,
      status: 'pendente' as RoadmapStatus,
      image_base64: input.imageBase64 || null,
      created_by: input.createdBy,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function updateRoadmapItem(
  id: string,
  patch: Partial<{ title: string; description: string; priority: RoadmapPriority; status: RoadmapStatus; imageBase64: string | null }>
): Promise<RoadmapItem | null> {
  const db = getDb();
  const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) updatePayload.title = patch.title;
  if (patch.description !== undefined) updatePayload.description = patch.description;
  if (patch.priority !== undefined) updatePayload.priority = patch.priority;
  if (patch.status !== undefined) updatePayload.status = patch.status;
  if (patch.imageBase64 !== undefined) updatePayload.image_base64 = patch.imageBase64;
  const { data, error } = await db.from('roadmap_items').update(updatePayload).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}

export async function deleteRoadmapItem(id: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('roadmap_items').delete().eq('id', id);
  if (error) throw error;
}
