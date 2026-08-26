import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { publicCatalogRateLimiter } from '../middleware/rateLimit';
import { getPublicCatalogBySlug } from '../services/publicCatalogStore';
import { resolveCatalogWhatsappTarget, recordCatalogWhatsappClick, type CatalogClickSource } from '../services/publicCatalogClickStore';

/** Limite generoso o bastante pra qualquer mensagem pré-preenchida real, mas evita abuso (payload gigante inflando a tabela de cliques). */
const MAX_CLICK_MESSAGE_LENGTH = 500;

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

  // Contador interno de clique nos botões de WhatsApp do catálogo (pedido
  // real, 25/08/2026) — o frontend aponta o botão pra cá em vez de ir direto
  // pro wa.me. Regista o clique (contagem real, sempre acontece, mesmo que o
  // cliente desista de mandar a mensagem depois) e redireciona (302) pro
  // WhatsApp de verdade com um código curto de emojis embutido no fim da
  // mensagem — ver publicCatalogClickStore.ts pro porquê.
  router.get('/api/public/catalog/:slug/whatsapp-click', publicCatalogRateLimiter, asyncHandler(async (req: Request<{ slug: string }>, res) => {
    const target = await resolveCatalogWhatsappTarget(req.params.slug);
    if (!target) return res.status(404).json({ error: 'Catálogo não encontrado.' });

    const rawMessage = typeof req.query.msg === 'string' ? req.query.msg : '';
    const baseMessage = rawMessage.slice(0, MAX_CLICK_MESSAGE_LENGTH).trim();
    if (!baseMessage) return res.status(400).json({ error: 'Mensagem ausente.' });
    const product = typeof req.query.product === 'string' ? req.query.product.slice(0, 200) : undefined;
    const source: CatalogClickSource | undefined = req.query.source === 'novo' ? 'novo' : req.query.source === 'legacy' ? 'legacy' : undefined;

    const click = await recordCatalogWhatsappClick(target.tenantId, baseMessage, product, source);
    res.redirect(302, `https://wa.me/${target.whatsappNumber}?text=${encodeURIComponent(click.message)}`);
  }));

  return router;
}
