import { Router, type RequestHandler } from 'express';
import { listConversations } from '../services/conversationStore';
import { listCrmLeadStates, upsertCrmLeadState, deleteCrmLeadState, type CrmLeadState } from '../services/crmStore';
import type { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

interface CrmRouterDeps {
  authenticateToken: RequestHandler;
}

function tenantOf(req: AuthenticatedRequest): string {
  if (!req.user?.tenantId) {
    throw new Error('Sessão autenticada sem tenantId — recusado (nunca cair no tenant legado por segurança).');
  }
  return req.user.tenantId;
}

/**
 * Achado real em produção: o CRM (OperatorCRM.tsx) era 100% mock/localStorage
 * — leads reais que já chegam via WhatsApp (server/routes/conversations.ts)
 * nunca apareciam lá, a menos que um operador cadastrasse cada um na mão. Ver
 * supabase/migrations/0013_crm_lead_state.sql pro design completo.
 */
export function createCrmRouter({ authenticateToken }: CrmRouterDeps): Router {
  const router = Router();

  // Combina toda conversa real com o estado de CRM já registrado (se houver)
  // + leads cadastrados manualmente sem conversa nenhuma ainda. Conversa sem
  // linha em crm_lead_state recebe um estágio "novo" só na resposta — nada é
  // gravado até o operador interagir de verdade (ver comentário na migration).
  router.get('/api/crm/leads', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = tenantOf(req);
    const [conversations, crmStates] = await Promise.all([
      listConversations(tenantId, { includeArchived: true }),
      listCrmLeadStates(tenantId),
    ]);

    const crmByPhone = new Map(crmStates.map((s) => [s.phone, s]));
    const leads: Array<CrmLeadState & { hasConversation: boolean; lastMessage?: string }> = [];

    for (const conv of conversations) {
      const state = crmByPhone.get(conv.phone);
      const lastMessage = conv.messages[conv.messages.length - 1]?.text;
      leads.push({
        phone: conv.phone,
        // Nome da conversa real sempre prevalece sobre o que foi digitado
        // manualmente no cadastro de CRM (fonte da verdade, nunca diverge).
        name: conv.name || state?.name,
        email: state?.email,
        stage: state?.stage || 'novo',
        dealValue: state?.dealValue,
        assignedOperator: state?.assignedOperator,
        notes: state?.notes || [],
        tasks: state?.tasks || [],
        updatedAt: state?.updatedAt || conv.updatedAt,
        hasConversation: true,
        lastMessage,
      });
      crmByPhone.delete(conv.phone);
    }

    // Sobrou aqui só quem foi cadastrado manualmente e ainda não tem
    // conversa real nenhuma associada.
    for (const state of crmByPhone.values()) {
      leads.push({ ...state, hasConversation: false });
    }

    res.json({ leads });
  }));

  router.patch('/api/crm/leads/:phone', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { name, email, stage, dealValue, assignedOperator, notes, tasks } = req.body || {};
    const patch: Parameters<typeof upsertCrmLeadState>[2] = {};
    if (typeof name === 'string') patch.name = name;
    if (typeof email === 'string') patch.email = email;
    if (typeof stage === 'string') patch.stage = stage;
    if (dealValue !== undefined) patch.dealValue = dealValue === null ? null : Number(dealValue);
    if (assignedOperator !== undefined) patch.assignedOperator = assignedOperator;
    if (Array.isArray(notes)) patch.notes = notes;
    if (Array.isArray(tasks)) patch.tasks = tasks;

    const state = await upsertCrmLeadState(tenantOf(req), req.params.phone, patch);
    res.json({ leadState: state });
  }));

  router.delete('/api/crm/leads/:phone', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    await deleteCrmLeadState(tenantOf(req), req.params.phone);
    res.json({ success: true });
  }));

  return router;
}
