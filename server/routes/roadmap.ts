import { Router, type RequestHandler } from 'express';
import { requireRole } from '../middleware/rbac';
import { asyncHandler } from '../middleware/asyncHandler';
import type { AuthenticatedRequest } from '../middleware/auth';
import {
  listRoadmapItems,
  createRoadmapItem,
  updateRoadmapItem,
  deleteRoadmapItem,
  type RoadmapPriority,
  type RoadmapStatus,
} from '../services/roadmapStore';

interface RoadmapRouterDeps {
  authenticateToken: RequestHandler;
}

const VALID_PRIORITIES: RoadmapPriority[] = ['alta', 'media', 'baixa'];
const VALID_STATUSES: RoadmapStatus[] = ['pendente', 'concluido'];
/** ~6MB de imagem real depois de decodificar base64 (o texto base64 em si fica ~33% maior) — folgado o bastante pra um screenshot/mockup de referência, sem deixar a linha do banco crescer sem limite. */
const MAX_IMAGE_BASE64_LENGTH = 8 * 1024 * 1024;

function validateImageBase64(imageBase64: unknown): string | null {
  if (imageBase64 === undefined || imageBase64 === null) return null;
  if (typeof imageBase64 !== 'string' || !imageBase64.startsWith('data:image/')) {
    return 'Campo "imageBase64" precisa ser uma data URI de imagem (ex: "data:image/png;base64,...").';
  }
  if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
    return 'Imagem muito grande — máximo de ~6MB.';
  }
  return null;
}

/**
 * Backlog técnico real (ver roadmapStore.ts) — substitui a lista de 4
 * cards fixos que existia direto no JSX do painel, impossível de editar.
 * Só saas_admin: é o backlog do produto inteiro, não um dado por tenant.
 */
export function createRoadmapRouter({ authenticateToken }: RoadmapRouterDeps): Router {
  const router = Router();

  router.get('/api/admin/roadmap-items', authenticateToken, requireRole('saas_admin'), asyncHandler(async (_req, res) => {
    const items = await listRoadmapItems();
    res.json({ items });
  }));

  router.post('/api/admin/roadmap-items', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { title, description, priority, imageBase64 } = req.body || {};
    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Campo "title" é obrigatório.' });
    }
    if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `Campo "priority" precisa ser um de: ${VALID_PRIORITIES.join(', ')}.` });
    }
    const imageError = validateImageBase64(imageBase64);
    if (imageError) return res.status(400).json({ error: imageError });

    const operatorId = req.user?.id;
    if (!operatorId) return res.status(401).json({ error: 'Sessão sem operador identificado.' });

    const item = await createRoadmapItem({
      title: title.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      priority: priority || 'media',
      imageBase64: imageBase64 || null,
      createdBy: operatorId,
    });
    res.status(201).json({ item });
  }));

  router.patch('/api/admin/roadmap-items/:id', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { title, description, priority, status, imageBase64 } = req.body || {};
    if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
      return res.status(400).json({ error: 'Campo "title" não pode ficar vazio.' });
    }
    if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `Campo "priority" precisa ser um de: ${VALID_PRIORITIES.join(', ')}.` });
    }
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Campo "status" precisa ser um de: ${VALID_STATUSES.join(', ')}.` });
    }
    const imageError = validateImageBase64(imageBase64);
    if (imageError) return res.status(400).json({ error: imageError });

    const item = await updateRoadmapItem(req.params.id, {
      title: typeof title === 'string' ? title.trim() : undefined,
      description: typeof description === 'string' ? description.trim() : undefined,
      priority,
      status,
      imageBase64: imageBase64 === null ? null : imageBase64,
    });
    if (!item) return res.status(404).json({ error: 'Pendência não encontrada.' });
    res.json({ item });
  }));

  router.delete('/api/admin/roadmap-items/:id', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    await deleteRoadmapItem(req.params.id);
    res.json({ success: true });
  }));

  return router;
}
