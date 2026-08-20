import { Router } from 'express';
import {
  getGoogleAuthUrl,
  handleGoogleOAuthCallback,
  isGoogleCalendarConnected,
  disconnectGoogleCalendar,
  signOAuthState,
  verifyOAuthState,
  listUpcomingEvents,
  updateCalendarEventSummary,
  findAvailabilityForDate,
  rescheduleCalendarEvent,
  cancelCalendarEvent,
  checkFreeBusy,
  type CalendarConfig,
} from '../services/googleCalendar';
import { updateAppointmentSummaryByEventId, updateAppointmentTimesByEventId, clearAppointmentByEventId } from '../services/appointmentStore';
import { clearRemindersForEvent } from '../services/reminderStore';
import { LEGACY_DEFAULT_TENANT_ID } from '../services/tenantContext';
import { markEventCompleted, markEventNotCompleted, getCompletedEventIds } from '../services/calendarEventCompletionStore';
import type { AuthenticatedRequest } from '../middleware/auth';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { resolveTenantId } from '../middleware/rbac';

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
 * tenantId de verdade da requisição — vem do JWT, exceto pra saas_admin
 * usando o seletor de tenant do painel (ver resolveTenantId em
 * middleware/rbac.ts pro porquê disso existir).
 */
function tenantOf(req: AuthenticatedRequest): string {
  return resolveTenantId(req);
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
  //
  // Pedido real (15/08/2026): só mostrar "os próximos dias a partir de
  // agora" fazia a agenda parecer "desatualizada" — não tinha como olhar um
  // mês específico (nem o mês corrente inteiro, nem meses passados/futuros
  // fora da janela de N dias). `?year=YYYY&month=1-12` (opcional, os dois
  // juntos) troca a janela pra esse mês inteiro; sem eles, mantém o
  // comportamento antigo (compatibilidade com quem já chamava sem parâmetro).
  router.get('/api/google-calendar/upcoming-events', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    if (!(await isGoogleCalendarConnected(tenantId))) {
      return res.status(503).json({ error: 'Google Calendar não conectado pra este tenant.' });
    }
    if (!googleRedirectUri) {
      return res.status(500).json({ error: 'Google Calendar não configurado neste servidor.' });
    }
    const cfg: CalendarConfig = { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: googleRedirectUri };

    const year = Number(req.query.year);
    const month = Number(req.query.month); // 1-12
    let timeMinIso: string;
    let timeMaxIso: string;
    if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
      timeMinIso = new Date(year, month - 1, 1).toISOString();
      timeMaxIso = new Date(year, month, 1).toISOString();
    } else {
      const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 60);
      const now = new Date();
      timeMinIso = now.toISOString();
      timeMaxIso = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    const events = await listUpcomingEvents(tenantId, cfg, timeMinIso, timeMaxIso);
    const completedIds = await getCompletedEventIds(tenantId, events.map((e) => e.id));
    res.json({ events: events.map((e) => ({ ...e, completed: completedIds.has(e.id) })) });
  }));

  // Horários livres de uma data específica, pro cadastro manual mostrar só
  // opções reais em vez do operador digitar hora "no escuro" (pedido real,
  // 20/08/2026: "consigo até auditar os horários que a IA tem disponível
  // visualmente"). `durationMinutes` vem do serviço escolhido no modal.
  router.get('/api/google-calendar/free-slots', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    if (!(await isGoogleCalendarConnected(tenantId))) {
      return res.status(503).json({ error: 'Google Calendar não conectado pra este tenant.' });
    }
    if (!googleRedirectUri) {
      return res.status(500).json({ error: 'Google Calendar não configurado neste servidor.' });
    }
    const date = req.query.date as string | undefined;
    const durationMinutes = Number(req.query.durationMinutes);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Parâmetro "date" (YYYY-MM-DD) é obrigatório.' });
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      return res.status(400).json({ error: 'Parâmetro "durationMinutes" precisa ser um inteiro positivo.' });
    }
    const cfg: CalendarConfig = { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: googleRedirectUri };
    const slots = await findAvailabilityForDate(tenantId, cfg, date, durationMinutes);
    res.json({ slots });
  }));

  // Remarca um agendamento a partir do widget de agenda — pedido real
  // (20/08/2026): "hoje não consigo remarcar horário, editar ou excluir
  // agendamento" pelo painel (só dava pra editar o título do serviço).
  // Reconsulta disponibilidade antes de mover (mesma garantia do
  // remarcar_agendamento da IA, autoReply.ts) — nunca move em cima de outro
  // horário já ocupado. `newEndIso` vem do frontend (mantém a MESMA duração
  // do evento original, só desloca o início) em vez de recalculado aqui —
  // evita duplicar a lógica de duração por serviço, que já mora no catálogo
  // e é resolvida no cliente a partir do evento atual.
  router.patch('/api/google-calendar/events/:eventId/reschedule', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const { newStartIso, newEndIso } = req.body || {};
    if (typeof newStartIso !== 'string' || typeof newEndIso !== 'string' || !newStartIso || !newEndIso) {
      return res.status(400).json({ error: 'Campos "newStartIso" e "newEndIso" são obrigatórios.' });
    }
    if (!googleRedirectUri) {
      return res.status(500).json({ error: 'Google Calendar não configurado neste servidor.' });
    }
    const cfg: CalendarConfig = { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: googleRedirectUri };
    const eventId = req.params.eventId;

    let disponivel: boolean;
    try {
      disponivel = await checkFreeBusy(tenantId, cfg, newStartIso, newEndIso);
    } catch (err: any) {
      return res.status(502).json({ error: `Falha ao verificar disponibilidade na agenda: ${err.message}` });
    }
    if (!disponivel) {
      return res.status(409).json({ error: 'Esse novo horário já está ocupado na agenda.' });
    }

    try {
      await rescheduleCalendarEvent(tenantId, cfg, eventId, newStartIso, newEndIso);
    } catch (err: any) {
      return res.status(502).json({ error: `Falha ao remarcar o evento na agenda: ${err.message}` });
    }
    await updateAppointmentTimesByEventId(tenantId, eventId, newStartIso, newEndIso);
    await clearRemindersForEvent(tenantId, eventId);
    res.json({ success: true });
  }));

  // Cancela um agendamento a partir do widget de agenda — mesma lacuna real
  // acima. Remove o evento real do Google Calendar e a linha espelhada em
  // `appointments` (sem isso, o telefone continuaria "com agendamento
  // ativo" pro resto do sistema — bloquearia um novo agendamento pro mesmo
  // contato e o job de lembretes tentaria avisar de um evento que não existe
  // mais).
  router.delete('/api/google-calendar/events/:eventId', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    if (!googleRedirectUri) {
      return res.status(500).json({ error: 'Google Calendar não configurado neste servidor.' });
    }
    const cfg: CalendarConfig = { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: googleRedirectUri };
    const eventId = req.params.eventId;
    try {
      await cancelCalendarEvent(tenantId, cfg, eventId);
    } catch (err: any) {
      return res.status(502).json({ error: `Falha ao cancelar o evento na agenda: ${err.message}` });
    }
    await clearAppointmentByEventId(tenantId, eventId);
    await clearRemindersForEvent(tenantId, eventId);
    res.json({ success: true });
  }));

  // Marca/desmarca um evento como concluído (checkbox da Agenda) — só a
  // marca em si, nunca mexe no evento real do Google Calendar (ver
  // calendarEventCompletionStore.ts).
  router.post('/api/google-calendar/events/:eventId/complete', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const { completed } = req.body || {};
    if (typeof completed !== 'boolean') {
      return res.status(400).json({ error: '"completed" precisa ser true ou false.' });
    }
    if (completed) await markEventCompleted(tenantId, req.params.eventId);
    else await markEventNotCompleted(tenantId, req.params.eventId);
    res.json({ success: true });
  }));

  // Corrige só o título (summary) de um evento já criado — pedido real
  // (19/08/2026): não existia nenhum jeito de editar isso depois de criado.
  // Atualiza o evento real no Google Calendar e, melhor esforço, a linha
  // espelhada em `appointments` (se o eventId bater com uma) pra não ficar
  // com o nome errado grudado no painel mesmo depois da correção real.
  router.patch('/api/google-calendar/events/:eventId', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const { summary } = req.body || {};
    if (typeof summary !== 'string' || !summary.trim()) {
      return res.status(400).json({ error: 'Campo "summary" é obrigatório.' });
    }
    if (!googleRedirectUri) {
      return res.status(500).json({ error: 'Google Calendar não configurado neste servidor.' });
    }
    const cfg: CalendarConfig = { clientId: googleClientId, clientSecret: googleClientSecret, redirectUri: googleRedirectUri };
    try {
      await updateCalendarEventSummary(tenantId, cfg, req.params.eventId, summary.trim());
    } catch (err: any) {
      return res.status(502).json({ error: `Falha ao atualizar o evento na agenda: ${err.message}` });
    }
    await updateAppointmentSummaryByEventId(tenantId, req.params.eventId, summary.trim());
    res.json({ success: true });
  }));

  return router;
}
