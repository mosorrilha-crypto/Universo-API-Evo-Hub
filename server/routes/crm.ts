import { Router, type RequestHandler } from 'express';
import { listConversations } from '../services/conversationStore';
import { listCrmLeadStates, upsertCrmLeadState, deleteCrmLeadState, type CrmLeadState } from '../services/crmStore';
import { createFinancialTransaction, isDuplicateSourceRefError } from '../services/financialStore';
import { isFinancialModuleEnabledForCurrentTenant } from '../services/financialModuleAccess';
import type { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { resolveTenantId } from '../middleware/rbac';
import { recordQualityAuditEvent } from '../services/qualityAuditStore';

interface CrmRouterDeps {
  authenticateToken: RequestHandler;
  /** Injeção de teste; produção resolve o entitlement no contexto RLS do tenant. */
  isFinancialModuleEnabled?: () => Promise<boolean>;
}

/** tenantId de verdade da requisição — vem do JWT, exceto pra saas_admin usando o seletor de tenant do painel (ver resolveTenantId em middleware/rbac.ts). */
function tenantOf(req: AuthenticatedRequest): string {
  return resolveTenantId(req);
}

/**
 * Achado real em produção: o CRM (OperatorCRM.tsx) era 100% mock/localStorage
 * — leads reais que já chegam via WhatsApp (server/routes/conversations.ts)
 * nunca apareciam lá, a menos que um operador cadastrasse cada um na mão. Ver
 * supabase/migrations/0013_crm_lead_state.sql pro design completo.
 */
/**
 * Fecha a ponte CRM → Financeiro: quando um lead vira "ganho" no funil, gera
 * uma cobrança `pendente` (nunca `pago` — isso exige confirmação real, ver
 * conversations.ts recordFinancialTransactionForVerifiedPayment) pra que o
 * negócio fechado apareça no FinancialDashboard sem o operador ter que
 * recadastrar tudo na mão. `sourceRef` (`crm-won:<phone>`) é único por
 * tenant (migration 0037) — reenviar o mesmo PATCH (retry, ou marcar "ganho"
 * de novo) nunca duplica a cobrança, só é engolido em silêncio.
 */
async function recordFinancialTransactionForWonDeal(tenantId: string, state: CrmLeadState, isFinancialModuleEnabled: () => Promise<boolean>): Promise<void> {
  if (state.dealValue === undefined || state.dealValue === null) return; // sem valor negociado, nada a cobrar ainda
  try {
    if (!(await isFinancialModuleEnabled())) return;
    await createFinancialTransaction(tenantId, {
      id: crypto.randomUUID(),
      leadId: state.phone,
      leadName: state.name || state.phone,
      leadPhone: state.phone,
      productName: 'Negócio fechado (CRM)',
      amount: state.dealValue,
      paymentMethod: 'Transferência Bancária',
      status: 'pendente',
      date: new Date().toISOString(),
      operatorName: state.assignedOperator,
      channel: 'CRM',
      sourceRef: `crm-won:${state.phone}`,
    });
  } catch (err) {
    if (isDuplicateSourceRefError(err)) return; // já gerada antes (retry, ou "ganho" marcado de novo)
    console.warn(`⚠️  [CRM] Falha ao gerar cobrança automática pro negócio fechado (tenant=${tenantId}, phone=${state.phone}):`, (err as Error)?.message || err);
  }
}

export function createCrmRouter({ authenticateToken, isFinancialModuleEnabled }: CrmRouterDeps): Router {
  const router = Router();
  const financialModuleEnabled = isFinancialModuleEnabled || isFinancialModuleEnabledForCurrentTenant;

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

    const tenantId = tenantOf(req);
    const state = await upsertCrmLeadState(tenantId, req.params.phone, patch);

    if (patch.stage === 'ganho') {
      await recordFinancialTransactionForWonDeal(tenantId, state, financialModuleEnabled);
    }

    try {
      await recordQualityAuditEvent({
        tenantId,
        eventType: 'crm_lead_updated',
        source: 'crm_panel',
        entityType: 'crm_lead',
        entityId: state.phone,
        conversationPhone: state.phone,
        actorId: req.user?.id,
        payload: {
          changedFields: Object.keys(patch),
          stage: state.stage,
          dealValue: state.dealValue ?? null,
        },
      });
    } catch (err: any) {
      console.warn(`⚠️ [Auditoria] Falha ao registrar atualização de CRM (tenant=${tenantId}, phone=${state.phone}):`, err?.message || err);
    }

    res.json({ leadState: state });
  }));

  router.delete('/api/crm/leads/:phone', authenticateToken, asyncHandler(async (req: AuthenticatedRequest, res) => {
    await deleteCrmLeadState(tenantOf(req), req.params.phone);
    res.json({ success: true });
  }));

  return router;
}
