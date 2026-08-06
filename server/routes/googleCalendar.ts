import { Router } from 'express';
import {
  getGoogleAuthUrl,
  handleGoogleOAuthCallback,
  isGoogleCalendarConnected,
  disconnectGoogleCalendar,
} from '../services/googleCalendar';
import { LEGACY_DEFAULT_TENANT_ID } from '../services/tenantContext';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { RequestHandler } from 'express';

interface GoogleCalendarRouterDeps {
  authenticateToken: RequestHandler;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri: string;
}

/**
 * Conexão OAuth com Google Calendar. O callback (GET /oauth-callback) é
 * público de propósito — o Google redireciona o NAVEGADOR do operador pra
 * cá direto após o consentimento, sem Bearer token nenhum; a segurança do
 * fluxo vem do "code" de uso único que só o Google emite, não de auth aqui.
 * Por isso ele ainda não sabe pra qual tenant está conectando — encodar o
 * tenantId no parâmetro `state` do OAuth é trabalho do Bloco 2.C. Até lá,
 * usa o tenant legado único (LEGACY_DEFAULT_TENANT_ID).
 */
export function createGoogleCalendarRouter({ authenticateToken, googleClientId, googleClientSecret, googleRedirectUri }: GoogleCalendarRouterDeps): Router {
  const router = Router();

  router.get('/api/google-calendar/status', authenticateToken, async (req: AuthenticatedRequest, res) => {
    const tenantId = req.user?.tenantId || LEGACY_DEFAULT_TENANT_ID;
    res.json({ connected: await isGoogleCalendarConnected(tenantId) });
  });

  router.get('/api/google-calendar/connect', authenticateToken, (req, res) => {
    if (!googleClientId || !googleClientSecret) {
      return res.status(500).json({ error: 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados no servidor.' });
    }
    const url = getGoogleAuthUrl(googleClientId, googleClientSecret, googleRedirectUri);
    res.json({ url });
  });

  router.get('/api/google-calendar/oauth-callback', async (req, res) => {
    const code = req.query.code as string | undefined;
    const error = req.query.error as string | undefined;

    if (error) {
      return res.status(400).send(`<html><body style="font-family:sans-serif;padding:2rem"><h2>Conexão cancelada</h2><p>${error}</p><a href="/">Voltar ao painel</a></body></html>`);
    }
    if (!code || !googleClientId || !googleClientSecret) {
      return res.status(400).send('<html><body style="font-family:sans-serif;padding:2rem"><h2>Erro</h2><p>Código de autorização ausente ou credenciais não configuradas.</p></body></html>');
    }

    try {
      await handleGoogleOAuthCallback(LEGACY_DEFAULT_TENANT_ID, code, googleClientId, googleClientSecret, googleRedirectUri);
      res.send('<html><body style="font-family:sans-serif;padding:2rem;text-align:center"><h2>✅ Google Calendar conectado!</h2><p>Pode fechar esta aba e voltar ao painel.</p></body></html>');
    } catch (err: any) {
      console.error('❌ [Google Calendar] Falha no callback OAuth:', err.message);
      res.status(500).send(`<html><body style="font-family:sans-serif;padding:2rem"><h2>Falha ao conectar</h2><p>${err.message}</p></body></html>`);
    }
  });

  router.post('/api/google-calendar/disconnect', authenticateToken, async (req: AuthenticatedRequest, res) => {
    const tenantId = req.user?.tenantId || LEGACY_DEFAULT_TENANT_ID;
    await disconnectGoogleCalendar(tenantId);
    res.json({ success: true });
  });

  return router;
}
