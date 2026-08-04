import { Router, type RequestHandler } from 'express';

interface MetaCapiRouterDeps {
  authenticateToken: RequestHandler;
}

export function createMetaCapiRouter({ authenticateToken }: MetaCapiRouterDeps): Router {
  const router = Router();

  // Meta CAPI Send Event Endpoint
  router.post('/api/meta-capi/send-event', authenticateToken, (req, res) => {
    const { eventName, pixelId } = req.body || {};
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    res.json({
      success: true,
      eventId,
      eventTime: new Date().toISOString(),
      matchQualityScore: 8.9,
      status: 'simulated_ok',
      userHash: {
        phoneHash: '5511999998888_sha256_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      message: `Evento Meta Conversions API "${eventName || 'Lead'}" sincronizado com Pixel ${pixelId || '891029384712039'}.`,
    });
  });

  // Criar Conexão Canal Endpoint
  router.post('/api/canais/criar', (req, res) => {
    const { empresaId, nomeCanal } = req.body || {};
    const channel_token = `evo_tok_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    res.json({
      success: true,
      channel_token,
      empresaId,
      nomeCanal,
      status: 'qr_pendente',
      message: 'Canal configurado com sucesso! Utilize o token para conectar o WhatsApp.',
    });
  });

  return router;
}
