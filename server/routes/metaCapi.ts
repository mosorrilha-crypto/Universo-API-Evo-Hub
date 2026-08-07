import crypto from 'crypto';
import { Router, type RequestHandler } from 'express';
import { hashUserDataField, normalizePhoneForHash } from '../services/metaCapiService';

interface MetaCapiRouterDeps {
  authenticateToken: RequestHandler;
}

const META_GRAPH_VERSION = 'v21.0';

export { hashUserDataField, normalizePhoneForHash };

/**
 * Meta Conversions API (server-to-server) — Epic 4.5.1. Substitui o mock
 * anterior (`status: 'simulated_ok'`, hash fixo hardcoded, nenhuma chamada
 * de rede) por uma chamada real a `graph.facebook.com/{pixelId}/events`.
 *
 * `pixelId`/`accessToken` ainda vêm do corpo da requisição (localStorage do
 * painel, não de credencial por tenant no banco) — isso é dívida conhecida
 * do Bloco 2.E (frontend ainda não migrou de localStorage pra API real),
 * não algo pra resolver aqui sem reabrir aquele epic inteiro.
 *
 * Só envia o que temos dado real pra afirmar: hash do telefone (advanced
 * matching). Nunca fabrica fbc/fbp/e-mail nem um "match quality score" —
 * a Meta não devolve essa métrica de forma síncrona na resposta da API,
 * só aparece no Events Manager depois.
 */
export function createMetaCapiRouter({ authenticateToken }: MetaCapiRouterDeps): Router {
  const router = Router();

  router.post('/api/meta-capi/send-event', authenticateToken, async (req, res) => {
    const { eventName, pixelId, accessToken, testEventCode, leadInfo, eventValue } = req.body || {};

    if (!pixelId || !accessToken) {
      return res.status(400).json({ success: false, error: 'Configure pixelId e accessToken reais do Meta antes de enviar um evento (aba de configurações do CAPI).' });
    }
    const phone: string | undefined = leadInfo?.phone;
    const normalizedPhone = phone ? normalizePhoneForHash(phone) : '';
    if (!normalizedPhone) {
      return res.status(400).json({ success: false, error: 'Lead sem telefone válido — a Meta exige pelo menos um identificador de user_data pra processar o evento.' });
    }

    const phoneHash = hashUserDataField(normalizedPhone);
    const eventTime = Math.floor(Date.now() / 1000);

    const payload = {
      data: [
        {
          event_name: eventName || 'Lead',
          event_time: eventTime,
          action_source: 'system_generated',
          user_data: { ph: [phoneHash] },
          ...(typeof eventValue === 'number' ? { custom_data: { value: eventValue, currency: 'USD' } } : {}),
        },
      ],
      ...(testEventCode ? { test_event_code: testEventCode } : {}),
    };

    try {
      const metaResponse = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const metaData: any = await metaResponse.json();

      if (!metaResponse.ok) {
        const metaError = metaData?.error?.message || `Meta respondeu ${metaResponse.status}`;
        return res.status(502).json({ success: false, error: metaError, metaResponse: metaData });
      }

      res.json({
        success: true,
        eventId: `evt_${eventTime}_${crypto.randomBytes(3).toString('hex')}`,
        eventTime: new Date(eventTime * 1000).toISOString(),
        status: 'sent',
        userHash: { phoneHash },
        metaResponse: metaData,
        message: `Evento Meta Conversions API "${eventName || 'Lead'}" enviado de verdade pro Pixel ${pixelId} (${metaData.events_received ?? 0} evento(s) recebido(s) pela Meta).`,
      });
    } catch (err: any) {
      res.status(502).json({ success: false, error: `Falha ao chamar a Meta Conversions API: ${err.message}` });
    }
  });

  // Criar Conexão Canal Endpoint — achado numa auditoria externa: única
  // rota deste arquivo sem authenticateToken.
  router.post('/api/canais/criar', authenticateToken, (req, res) => {
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
