/**
 * TASK-0203/0208 — pedido direto do dono do produto: "como podemos usar um
 * robô pra criar 100 perguntas reais pra o agente e ir avaliando as
 * respostas e corrigindo os erros automaticamente". Wrapper CLI fino sobre
 * `runAgentEvaluation` (server/services/agentEvalService.ts) — a mesma
 * orquestração usada pelo botão "Avaliação automática" na Central de
 * Qualidade do painel (TASK-0208), pra não duplicar a lógica em dois
 * lugares.
 *
 * Seguro de rodar contra um tenant real em produção: nunca manda mensagem
 * de WhatsApp de verdade (generateAutoReplyForText só GERA texto, quem
 * manda é webhooks.ts/sendBubbles, nunca chamado aqui), nunca mexe na
 * agenda real (calendarConfig fica undefined de propósito), e nunca grava
 * em `conversations` (usa um telefone fake só em memória por caso). Só
 * escreve em `quality_reviews`/`quality_audit_events` — reversível, basta
 * apagar a linha.
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_KEY=... GEMINI_API_KEY=... \
 *     npx tsx scripts/eval-agent.ts --tenant <tenant-uuid> [--count 100] [--out resultado.json]
 *
 * SUPABASE_KEY precisa ser a service role key (não anon) — mesmo padrão
 * dos outros scripts em scripts/ (ver CLAUDE.md).
 */
import { writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { initDb } from '../server/services/db';
import { runAgentEvaluation, type AgentEvalCaseResult } from '../server/services/agentEvalService';

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

  const caseResults: AgentEvalCaseResult[] = [];
  let lastCompleted = 0;

  const summary = await runAgentEvaluation({
    tenantId,
    ai,
    count,
    groqApiKey,
    onProgress: ({ completed, total, passed, failed }) => {
      if (completed > lastCompleted) {
        lastCompleted = completed;
        process.stdout.write(`  [${completed}/${total}] ✅ ${passed} / ❌ ${failed}\r`);
      }
    },
    onCaseResult: (result) => caseResults.push(result),
  });

  console.log(`\n\n📊 Resumo: ${summary.passed}/${summary.total} passaram, ${summary.failed} falharam, ${summary.createdReviewCount} registrados na Central de Qualidade (kind=bug, source=synthetic_eval).`);

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(caseResults, null, 2));
    console.log(`   Resultado completo salvo em ${outPath}.`);
  }

  if (summary.repeatedPhrases.length) {
    console.log(`\n🔁 Frases repetidas quase-verbatim entre respostas de casos DIFERENTES (achado adicional, mesma classe da regra 12 do REGRAS DE ESTILO):`);
    summary.repeatedPhrases.forEach((r) => console.log(`   ${r.count}x — "${r.phrase.slice(0, 100)}${r.phrase.length > 100 ? '...' : ''}"`));
  }
}

main().catch((err) => {
  console.error('💥 Falha na avaliação:', err);
  process.exit(1);
});
