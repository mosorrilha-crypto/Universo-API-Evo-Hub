import { Router, type RequestHandler } from 'express';
import {
  getGoogleAuthUrl,
  handleGoogleOAuthCallback,
  isGoogleCalendarConnected,
  disconnectGoogleCalendar,
} from '../services/googleCalendar';

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
 */
export function createGoogleCalendarRouter({ authenticateToken, googleClientId, googleClientSecret, googleRedirectUri }: GoogleCalendarRouterDeps): Router {
  const router = Router();

  router.get('/api/google-calendar/status', authenticateToken, async (req, res) => {
    res.json({ connected: await isGoogleCalendarConnected() });
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
      await handleGoogleOAuthCallback(code, googleClientId, googleClientSecret, googleRedirectUri);
      res.send('<html><body style="font-family:sans-serif;padding:2rem;text-align:center"><h2>✅ Google Calendar conectado!</h2><p>Pode fechar esta aba e voltar ao painel.</p></body></html>');
    } catch (err: any) {
      console.error('❌ [Google Calendar] Falha no callback OAuth:', err.message);
      res.status(500).send(`<html><body style="font-family:sans-serif;padding:2rem"><h2>Falha ao conectar</h2><p>${err.message}</p></body></html>`);
    }
  });

  router.post('/api/google-calendar/disconnect', authenticateToken, async (req, res) => {
    await disconnectGoogleCalendar();
    res.json({ success: true });
  });

  return router;
}
