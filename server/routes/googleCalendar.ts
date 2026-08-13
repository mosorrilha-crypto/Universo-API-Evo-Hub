import { Router } from 'express';
import {
  getGoogleAuthUrl,
  handleGoogleOAuthCallback,
  isGoogleCalendarConnected,
  disconnectGoogleCalendar,
  signOAuthState,
  verifyOAuthState,
  listUpcomingEvents,
  type CalendarConfig,
} from '../services/googleCalendar';
import { LEGACY_DEFAULT_TENANT_ID } from '../services/tenantContext';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';

interface GoogleCalendarRouterDeps {
  authenticateToken: RequestHandler;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri: string;
  jwtSecret: string;
}

/**
 * Conexão OAuth com Google Calendar. O callback (GET /oauth-callback) é
 * público de propósito — o Google redireciona o NAVEGADOR do operador pra
 * cá direto após o consentimento, sem Bearer token nenhum; a segurança do
 * fluxo vem do "code" de uso único que só o Google emite, não de auth aqui.
 *
 * Bloco 2.C: o parâmetro `state` do OAuth carrega o tenantId de quem clicou
 * "Conectar" (assinado, ver signOAuthState), pra o callback público saber a
 * qual tenant devolver o refresh token — antes disso, todo mundo caía no
 * tenant legado único.
 */
/**
 * tenantId do operador autenticado. Achado numa auditoria externa: caía
 * silenciosamente no tenant legado quando o JWT não trazia tenantId, em vez
 * de rejeitar — mesmo padrão já corrigido no roteamento de webhook por
 * phone_number_id (Bloco 2.B). Todo fluxo de emissão de token hoje sempre
 * inclui tenantId, então isso não deveria disparar em uso normal.
 */
function tenantOf(req: AuthenticatedRequest): string {
  if (!req.user?.tenantId) {
    throw new Error('Sessão autenticada sem tenantId — recusado (nunca cair no tenant legado por segurança).');
  }
  return req.user.tenantId;
}

export function createGoogleCalendarRouter({ authenticateToken, googleClientId, googleClientSecret, googleRedirectUri, jwtSecret }: GoogleCalendarRouterDeps): Router {
  const router = Router();

  router.get('/api/google-calendar/status', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    res.json({ connected: await isGoogleCalendarConnected(tenantId) });
  }));

  router.get('/api/google-calendar/connect', authenticateToken, (req: AuthenticatedRequest, res) => {
    if (!googleClientId || !googleClientSecret) {
      return res.status(500).json({ error: 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados no servidor.' });
    }
    const tenantId = tenantOf(req);
    const state = signOAuthState(tenantId, jwtSecret);
    const url = getGoogleAuthUrl(googleClientId, googleClientSecret, googleRedirectUri, state);
    res.json({ url });
  });

  router.get('/api/google-calendar/oauth-callback', asyncHandler(async (req, res) => {
    const code = req.query.code as string | undefined;
    const error = req.query.error as string | undefined;

    if (error) {
      return res.status(400).send(`<html><body style="font-family:sans-serif;padding:2rem"><h2>Conexão cancelada</h2><p>${error}</p><a href="/">Voltar ao painel</a></body></html>`);
    }
    if (!code || !googleClientId || !googleClientSecret) {
      return res.status(400).send('<html><body style="font-family:sans-serif;padding:2rem"><h2>Erro</h2><p>Código de autorização ausente ou credenciais não configuradas.</p></body></html>');
    }

    // Fallback pro tenant legado se o state vier ausente/inválido/expirado —
    // preserva o comportamento de hoje em vez de simplesmente falhar.
    const tenantId = verifyOAuthState(req.query.state as string | undefined, jwtSecret) || LEGACY_DEFAULT_TENANT_ID;

    try {
      await handleGoogleOAuthCallback(tenantId, code, googleClientId, googleClientSecret, googleRedirectUri);
      res.send('<html><body style="font-family:sans-serif;padding:2rem;text-align:center"><h2>✅ Google Calendar conectado!</h2><p>Pode fechar esta aba e voltar ao painel.</p></body></html>');
    } catch (err: any) {
      console.error('❌ [Google Calendar] Falha no callback OAuth:', err.message);
      res.status(500).send(`<html><body style="font-family:sans-serif;padding:2rem"><h2>Falha ao conectar</h2><p>${err.message}</p></body></html>`);
    }
  }));

  router.post('/api/google-calendar/disconnect', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    await disconnectGoogleCalendar(tenantId);
    res.json({ success: true });
  }));

  // Widget de agenda no painel (issue: atendente pedia pra ver o que a IA já
  // marcou sem sair da plataforma) — `listUpcomingEvents` já existia e já
  // roda em produção pro job de lembretes; só faltava uma rota expondo isso
  // pro frontend. `?days=N` (default 14) igual ao raciocínio de
  // findWeeklyAvailability, sem virar um parâmetro livre demais.
  router.get('/api/google-calendar/upcoming-events', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    if (!(await isGoogleCalendarConnected(tenantId))) {
      return res.status(503).json({ error: 'Google Calendar não conectado pra este tenant.' });
    }
    if (!googleRedirectUri) {
      return res.status(500).json({ error: 'Google Calendar não configurado neste servidor.' });
    }
    const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 60);
    const cfg: CalendarConfig = { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: googleRedirectUri };
    const now = new Date();
    const timeMaxIso = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    const events = await listUpcomingEvents(tenantId, cfg, now.toISOString(), timeMaxIso);
    res.json({ events });
  }));

  return router;
}
