import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { publicCatalogRateLimiter } from '../middleware/rateLimit';
import { getPublicCatalogBySlug } from '../services/publicCatalogStore';

/**
 * Catálogo público: o slug na URL identifica o tenant de forma explícita.
 * Não aceita tenant_id em query/body e nunca retorna a Base de Conhecimento
 * completa, porque ela contém regras internas do agente.
 */
export function createPublicCatalogRouter(): Router {
  const router = Router();

  router.get('/api/public/catalog/:slug', publicCatalogRateLimiter, asyncHandler(async (req: Request<{ slug: string }>, res) => {
    const catalog = await getPublicCatalogBySlug(req.params.slug);
    if (!catalog) return res.status(404).json({ error: 'Catálogo não encontrado.' });

    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({ catalog });
  }));

  return router;
}
