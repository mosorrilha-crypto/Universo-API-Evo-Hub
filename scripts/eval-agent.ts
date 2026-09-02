/**
 * TASK-0203 — pedido direto do dono do produto: "como podemos usar um robô
 * pra criar 100 perguntas reais pra o agente e ir avaliando as respostas e
 * corrigindo os erros automaticamente". Gera N perguntas sintéticas
 * grounded no catálogo real do tenant, roda cada uma no pipeline de
 * verdade (`generateAutoReplyForText`), avalia a resposta com o mesmo
 * revisor de segurança que já protege produção (`replySafetyGate.ts`) +
 * um juiz de estilo dedicado (`agentEvalService.ts`), e registra toda
 * falha encontrada na Central de Qualidade (`qualityAuditStore.ts`) pra
 * revisão humana — nunca corrige nada sozinho: uma IA decidindo por conta
 * própria que a própria resposta está errada e reescrevendo prompt/Base de
 * Conhecimento sem revisão é exatamente o risco que este projeto evita em
 * todo canto (agenda, pagamento, CRM).
 *
 * Seguro de rodar contra um tenant real em produção: nunca manda mensagem
 * de WhatsApp de verdade (generateAutoReplyForText só GERA texto, quem
 * manda é webhooks.ts/sendBubbles, nunca chamado aqui), nunca mexe na
 * agenda real (calendarConfig fica undefined de propósito — sem ele,
 * autoReply.ts pula as ferramentas de Google Calendar, mesmo caminho já
 * usado por um tenant sem Calendar conectado), e nunca grava em
 * `conversations` (usa um telefone fake só em memória por caso, e nenhuma
 * função de persistência de conversa é chamada). Só escreve em
 * `quality_reviews`/`quality_audit_events` — reversível, basta apagar a
 * linha.
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_KEY=... GEMINI_API_KEY=... \
 *     npx tsx scripts/eval-agent.ts --tenant <tenant-uuid> [--count 100] [--out resultado.json]
 *
 * SUPABASE_KEY precisa ser a service role key (não anon) — mesmo padrão
 * dos outros scripts em scripts/ (ver CLAUDE.md).
 */
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { initDb } from '../server/services/db';
import { getRuntimeKnowledgeBase, formatKnowledgeBaseForPrompt } from '../server/services/knowledgeBaseStore';
import { getTenantSegment } from '../server/services/tenantProfileStore';
import { generateAutoReplyForText, type AgentType } from '../server/services/autoReply';
import { reviewAutoReplyBeforeSend, type ReplySafetyVerdict } from '../server/services/replySafetyGate';
import {
  generateSyntheticEvalQuestions,
  judgeAgentReplyQuality,
  findRepeatedPhrasesAcrossResponses,
  type SyntheticEvalCase,
  type QualityJudgeVerdict,
} from '../server/services/agentEvalService';
import { createQualityReview } from '../server/services/qualityAuditStore';

interface EvalCaseResult extends SyntheticEvalCase {
  agent?: AgentType;
  bubbles?: string[];
  safety?: ReplySafetyVerdict;
  quality?: QualityJudgeVerdict;
  passed?: boolean;
  error?: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tenantId = args.tenant;
  const count = Number(args.count) > 0 ? Number(args.count) : 100;
  const outPath = args.out;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!tenantId) {
    console.error('❌ Informe --tenant <uuid>.');
    process.exit(1);
  }
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Defina SUPABASE_URL e SUPABASE_KEY (service role) no ambiente.');
    process.exit(1);
  }
  if (!geminiApiKey) {
    console.error('❌ Defina GEMINI_API_KEY no ambiente.');
    process.exit(1);
  }

  initDb(createClient(supabaseUrl, supabaseKey));
  const ai = new GoogleGenAI({ apiKey: geminiApiKey });
  const groqApiKey = process.env.GROQ_API_KEY;

  console.log(`🧪 Avaliação automática do agente — tenant ${tenantId}, ${count} casos.\n`);

  const runtimeKb = await getRuntimeKnowledgeBase(tenantId);
  if (runtimeKb.source === 'unavailable') {
    console.error('❌ Base de Conhecimento indisponível pra este tenant — não dá pra gerar casos grounded sem ela.');
    process.exit(1);
  }
  const kb = runtimeKb.knowledgeBase;
  const kbContext = formatKnowledgeBaseForPrompt(kb);
  const segment = await getTenantSegment(tenantId);

  console.log('📝 Gerando perguntas sintéticas grounded no catálogo real...');
  const cases = await generateSyntheticEvalQuestions(ai, kb, count);
  console.log(`   ${cases.length} casos gerados.\n`);

  const results: EvalCaseResult[] = [];
  let passCount = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const preview = c.text.length > 60 ? `${c.text.slice(0, 60)}...` : c.text;
    process.stdout.write(`  [${i + 1}/${cases.length}] ${c.category}: "${preview}" `);

    const fakePhone = `eval-${randomUUID()}`;
    let genResult;
    try {
      genResult = await generateAutoReplyForText(
        tenantId, ai, c.text, undefined, kbContext, c.history, fakePhone,
        undefined /* calendarConfig — de propósito ausente, nunca toca a agenda real */,
        segment, undefined, undefined, undefined, undefined, groqApiKey, undefined, false
      );
    } catch (err) {
      console.log('💥');
      results.push({ ...c, error: (err as Error)?.message || String(err) });
      continue;
    }
    if (!genResult) {
      console.log('⚠️  (sem resposta — fallback honesto do Gemini indisponível)');
      results.push({ ...c, error: 'Sem resposta (Gemini indisponível, fallback honesto acionado)' });
      continue;
    }

    const bubbles = genResult.bubbles;
    let safety: ReplySafetyVerdict;
    let quality: QualityJudgeVerdict;
    try {
      [safety, quality] = await Promise.all([
        reviewAutoReplyBeforeSend(
          {
            customerMessage: c.text,
            draftBubbles: bubbles,
            history: c.history,
            knowledgeContext: kbContext,
            isBookingFlow: genResult.agent === 'agendamento',
            needsHumanConfirmation: genResult.needsHumanConfirmation,
          },
          { ai, groqApiKey }
        ),
        judgeAgentReplyQuality(ai, { customerMessage: c.text, history: c.history, bubbles }),
      ]);
    } catch (err) {
      console.log('💥 (falha na avaliação)');
      results.push({ ...c, agent: genResult.agent, bubbles, error: `Falha ao avaliar: ${(err as Error)?.message || err}` });
      continue;
    }

    const passed = safety.approved && quality.passed;
    if (passed) passCount++;
    console.log(passed ? '✅' : '❌');
    results.push({ ...c, agent: genResult.agent, bubbles, safety, quality, passed });
  }

  const repeated = findRepeatedPhrasesAcrossResponses(results.filter((r): r is EvalCaseResult & { bubbles: string[] } => Array.isArray(r.bubbles)));

  console.log('\n💾 Registrando falhas na Central de Qualidade...');
  let createdCount = 0;
  for (const r of results) {
    if (r.passed === false || r.error) {
      const issueParts = [
        r.safety && !r.safety.approved ? `Revisor de segurança: ${r.safety.reason}` : null,
        r.quality?.issues?.length ? `Qualidade: ${r.quality.issues.join('; ')}` : null,
        r.error ? `Erro: ${r.error}` : null,
      ].filter((p): p is string => Boolean(p));
      await createQualityReview({
        tenantId,
        kind: 'bug',
        title: `[Avaliação automática] ${r.category}: falha em caso sintético`,
        description: `Pergunta sintética (${r.note || 'sem nota'}): "${r.text}"\n\nProblema encontrado: ${issueParts.join(' | ') || 'não especificado'}`,
        context: { source: 'synthetic_eval', category: r.category, question: r.text, history: r.history, agent: r.agent },
        originalValue: r.bubbles?.join('\n') || null,
        correctedValue: r.quality?.suggestedFix || null,
      });
      createdCount++;
    }
  }

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`   Resultado completo salvo em ${outPath}.`);
  }

  console.log(`\n📊 Resumo: ${passCount}/${results.length} passaram, ${results.length - passCount} falharam, ${createdCount} registrados na Central de Qualidade (kind=bug, source=synthetic_eval).`);
  if (repeated.length) {
    console.log(`\n🔁 Frases repetidas quase-verbatim entre respostas de casos DIFERENTES (achado adicional, mesma classe da regra 12 do REGRAS DE ESTILO):`);
    repeated.forEach((r) => console.log(`   ${r.count}x — "${r.phrase.slice(0, 100)}${r.phrase.length > 100 ? '...' : ''}"`));
  }
}

main().catch((err) => {
  console.error('💥 Falha na avaliação:', err);
  process.exit(1);
});
