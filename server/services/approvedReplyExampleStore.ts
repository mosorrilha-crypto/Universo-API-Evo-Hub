/**
 * TASK-0093 — exemplos aprovados por humano, gerados só quando um operador
 * clica "Aprovar e enviar" num escalonamento (server/routes/conversations.ts,
 * .../approve-and-resolve). Nunca escrito automaticamente pela IA e nunca
 * reescreve a Base de Conhecimento — é um few-shot curto injetado no
 * contexto dinâmico (Camada 4) de mensagens futuras parecidas, sempre
 * reversível (basta apagar a linha).
 */
import { getDb } from './db';

export interface ApprovedReplyExample {
  id: string;
  customerMessage: string;
  approvedReply: string;
  reviewerReason?: string;
  createdAt: string;
}

export interface SaveApprovedReplyExampleInput {
  escalationId: string;
  customerMessage: string;
  approvedReply: string;
  reviewerReason?: string;
  actorId?: string;
}

export async function saveApprovedReplyExample(tenantId: string, input: SaveApprovedReplyExampleInput): Promise<void> {
  const { error } = await getDb().from('tenant_approved_reply_examples').insert({
    tenant_id: tenantId,
    escalation_id: input.escalationId,
    customer_message: input.customerMessage.slice(0, 900),
    approved_reply: input.approvedReply.slice(0, 900),
    reviewer_reason: input.reviewerReason?.slice(0, 500) || null,
    created_by: input.actorId || null,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

const DEFAULT_LIMIT = 3;

/** Exemplos mais recentes do tenant, pro contexto dinâmico do especialista — nunca cacheado junto do systemInstruction, pra um exemplo novo valer já na próxima mensagem. */
export async function listRecentApprovedReplyExamples(tenantId: string, limit = DEFAULT_LIMIT): Promise<ApprovedReplyExample[]> {
  const { data, error } = await getDb()
    .from('tenant_approved_reply_examples')
    .select('id, customer_message, approved_reply, reviewer_reason, created_at')
    .eq('tenant_id', tenantId);
  if (error) throw error;
  return ((data || []) as any[])
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      customerMessage: row.customer_message,
      approvedReply: row.approved_reply,
      reviewerReason: row.reviewer_reason || undefined,
      createdAt: row.created_at,
    }));
}

/** Texto pronto pra entrar no contexto dinâmico do prompt — vazio quando não há exemplo nenhum ainda. */
export function formatApprovedReplyExamplesForPrompt(examples: ApprovedReplyExample[]): string {
  if (!examples.length) return '';
  const items = examples
    .map((example) => `- Cliente perguntou algo como: "${example.customerMessage}" → Resposta aprovada por um humano: "${example.approvedReply}"`)
    .join('\n');
  return `Exemplos de respostas já revisadas e aprovadas por um humano para situações parecidas (use como referência de tom e conteúdo, adapte ao contexto atual, nunca copie literalmente se não fizer sentido pra esta conversa):\n${items}`;
}
