import { reportSystemIncident, type SystemIncidentCategory, type SystemIncidentSeverity } from './systemIncidentStore';

/**
 * Log estruturado mínimo por tenant — não é Sentry/observability pesada
 * (ver issue #184, baixa prioridade até ter um gatilho concreto), só
 * disciplina de formato consistente pra dar pra filtrar/agregar no log
 * bruto do Render sem esforço de infra nenhum.
 *
 * Motivação real (19/08/2026): o `invalid_grant` recorrente do Google
 * Calendar (job de lembretes) só foi descoberto por leitura manual de log
 * solto, sem `tenant_id`/latência/outcome estruturado — não dava pra saber
 * de qual tenant era, nem há quanto tempo vinha falhando, sem grep manual.
 */
export interface StructuredLogFields {
  tenantId: string;
  /** Área/serviço que gerou o evento — ex: 'autoReply', 'googleCalendar', 'appointmentStore'. */
  area: string;
  /** Operação específica dentro da área — ex: 'router', 'especialista', 'listUpcomingEvents', 'confirmPayment'. */
  op: string;
  outcome: 'success' | 'error';
  latencyMs?: number;
  /** Texto curto livre — ex: agente classificado, motivo do erro. Nunca dado sensível (token, mensagem do cliente). */
  detail?: string;
}

/** Traduz somente falhas e contingências em itens auditáveis; não envia alertas. */
/**
 * Achado real em produção (CLAUDE.md — "Gemini billing exhaustion is a
 * recurring real incident, not hypothetical"): o prepay credits/spend cap do
 * Google AI Studio já esgotou em produção mais de uma vez, derrubando TODAS
 * as chamadas Gemini do projeto ao mesmo tempo (resposta automática,
 * transcrição, análises) até um humano reabastecer o crédito manualmente.
 * Antes desta função, esse erro caía como incidente 'medium' genérico,
 * indistinguível de qualquer timeout/falha transitória isolada de um
 * tenant — só era descoberto quando alguém percebia várias features de IA
 * falhando ao mesmo tempo e ia ler o log bruto do Render. Reconhecendo o
 * padrão de erro aqui, o mesmo incidente que já existe (system_incidents,
 * SystemLogsPanel) passa a marcar isso como crítico, com a ação concreta já
 * documentada (reabastecer em ai.studio/projects), em vez de mais um
 * "runtime error" qualquer na lista.
 */
function isGeminiQuotaExhaustedDetail(detail?: string): boolean {
  return /RESOURCE_EXHAUSTED|prepayment credits|quota exceeded|exceeded your current quota/i.test(detail || '');
}

export function getSystemIncidentFromStructuredLog(fields: StructuredLogFields): Omit<Parameters<typeof reportSystemIncident>[0], 'tenantId'> | null {
  const isLegacyFallback = fields.area === 'knowledgeBase' && fields.op === 'loadRuntimeSource' && /source=legacy_blob/.test(fields.detail || '');
  const isKnowledgeUnavailable = fields.area === 'knowledgeBase' && fields.op === 'loadRuntimeSource' && /source=unavailable/.test(fields.detail || '');
  const isGeminiQuotaExhausted = fields.outcome === 'error' && isGeminiQuotaExhaustedDetail(fields.detail);
  if (fields.outcome !== 'error' && !isLegacyFallback && !isKnowledgeUnavailable) return null;
  const category: SystemIncidentCategory = isGeminiQuotaExhausted ? 'integration'
    : fields.area === 'knowledgeBase' ? 'knowledge_base'
    : /auth|session|token/i.test(`${fields.area} ${fields.op}`) ? 'authentication'
      : /catalog/i.test(`${fields.area} ${fields.op}`) ? 'catalog'
        : /media|video|upload/i.test(`${fields.area} ${fields.op}`) ? 'media'
          : /webhook|evolution|meta|calendar|integration/i.test(`${fields.area} ${fields.op}`) ? 'integration' : 'runtime';
  const severity: SystemIncidentSeverity = isGeminiQuotaExhausted || isKnowledgeUnavailable || fields.outcome === 'error' && /unavailable|5\d\d|fatal/i.test(fields.detail || '') ? 'critical'
    : isLegacyFallback || fields.area === 'knowledgeBase' ? 'high' : 'medium';
  const title = isGeminiQuotaExhausted ? 'Cota/crédito pré-pago do Gemini esgotado'
    : isKnowledgeUnavailable ? 'Runtime da Base de Conhecimento indisponível'
    : isLegacyFallback ? 'Fonte legada usada como contingência' : `Falha técnica: ${redactSystemIncidentDetail(fields.area)}.${redactSystemIncidentDetail(fields.op)}`;
  const suggestedAction = isGeminiQuotaExhausted
    ? 'Reabasteça o crédito pré-pago em ai.studio/projects AGORA — esta falha derruba TODAS as chamadas Gemini do projeto (resposta automática, transcrição, análises) pra TODOS os tenants ao mesmo tempo, não só este. Retentativas (withGeminiRetry) não ajudam numa exaustão sustentada.'
    : isKnowledgeUnavailable
    ? 'Verifique o banco e o runtime da Base. Preserve o fallback técnico e suspenda publicações até a revisão humana confirmar a recuperação.'
    : isLegacyFallback
    ? 'Revise se os oito documentos estão publicados e confira a telemetria da Base antes de qualquer publicação nova.'
    : category === 'authentication'
      ? 'Revise papel e capability do usuário afetado. Não invalide sessões nem altere permissões sem confirmação administrativa.'
      : category === 'catalog' || category === 'media'
        ? 'Revise a configuração e o arquivo envolvidos. Não altere catálogo, preços ou mídia sem validação humana.'
        : category === 'integration'
          ? 'Verifique a credencial e a disponibilidade da integração, sem reenviar mensagens nem modificar agenda automaticamente.'
          : 'Revise o detalhe, confirme se a falha persiste e siga a correção sugerida pelo módulo afetado. Não altere dados comerciais sem validação.';
  return {
    sourceKey: `system:${safeSignal(fields.area)}:${safeSignal(fields.op)}:${isGeminiQuotaExhausted ? 'gemini-quota-exhausted' : isLegacyFallback ? 'legacy-fallback' : isKnowledgeUnavailable ? 'unavailable' : 'error'}`,
    category, severity, title, detail: redactSystemIncidentDetail(fields.detail), suggestedAction,
    metadata: { area: fields.area, op: fields.op, outcome: fields.outcome, latencyMs: fields.latencyMs ?? null },
  };
}

/** Remove padrões de contato e segredo antes de levar um detalhe para a auditoria administrativa. */
export function redactSystemIncidentDetail(detail?: string): string {
  return String(detail || '')
    .replace(/(?:authorization|token|api[_-]?key|secret|password)\s*[=:]\s*[^\s;,&]+/gi, '[segredo redigido]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g, '[token redigido]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[e-mail redigido]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[telefone redigido]')
    .replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
}

function safeSignal(value: string): string {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 72) || 'unknown';
}

/** Uma linha por evento, grep-ável por qualquer campo (`tenant=`, `area=`, `op=`, `outcome=`). */
export function logStructured(fields: StructuredLogFields): void {
  const parts = [
    `tenant=${fields.tenantId}`,
    `area=${fields.area}`,
    `op=${fields.op}`,
    `outcome=${fields.outcome}`,
    fields.latencyMs !== undefined ? `latency_ms=${fields.latencyMs}` : null,
    fields.detail ? `detail="${fields.detail.replace(/"/g, "'")}"` : null,
  ].filter(Boolean);
  const line = `[LOG] ${parts.join(' ')}`;
  if (fields.outcome === 'error') console.warn(line);
  else console.log(line);
  const incident = getSystemIncidentFromStructuredLog(fields);
  if (incident) void reportSystemIncident({ tenantId: fields.tenantId, ...incident }).catch(() => undefined);
}

/** Envolve uma operação assíncrona, medindo latência e logando outcome — rethrow sempre em erro, nunca engole a falha. */
export async function withStructuredLog<T>(
  fields: Omit<StructuredLogFields, 'outcome' | 'latencyMs' | 'detail'>,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    logStructured({ ...fields, outcome: 'success', latencyMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    logStructured({ ...fields, outcome: 'error', latencyMs: Date.now() - startedAt, detail: (err as Error)?.message || String(err) });
    throw err;
  }
}
