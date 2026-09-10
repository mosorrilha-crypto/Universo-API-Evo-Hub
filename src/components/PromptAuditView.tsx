/**
 * TASK-0330 — auditoria SOMENTE LEITURA do prompt real mandado ao Gemini.
 * Pedido direto (06/09/2026): depois de eliminar a rota de salvar a KB
 * inteira (TASK-0327), o dono do produto precisava de outro jeito de
 * conferir "quais informações estão chegando e como estão chegando no
 * agente" — nunca edita nada, só busca e mostra o texto que o backend já
 * monta pro turno real (GET /api/tenant-prompt-audit, ver getPromptAuditView
 * em autoReply.ts — mesma função, sem duplicar a montagem do prompt aqui).
 */
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Clipboard, RefreshCw, Search } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

interface PromptAuditViewProps {
  onBack: () => void;
}

type AgentType = 'triagem' | 'faq' | 'agendamento' | 'reclamacao';

const AGENT_OPTIONS: { value: AgentType; label: string }[] = [
  { value: 'triagem', label: 'Triagem' },
  { value: 'faq', label: 'FAQ / Especialista' },
  { value: 'agendamento', label: 'Agendamento' },
  { value: 'reclamacao', label: 'Reclamação' },
];

interface PromptAuditResult {
  agent: AgentType;
  systemInstruction: string;
  knowledgeBaseContext: string;
  businessHoursForPrompt: string;
  knowledgeBaseSource: string;
  conversationPreview?: {
    contactName?: string;
    historyText: string;
    contentsPreamble: string;
  };
  dynamicNotShown: string[];
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Sem permissão de clipboard (contexto não-seguro, navegador antigo) — sem alerta intrusivo, só não marca como copiado.
        }
      }}
      className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition-all hover:bg-slate-700"
      title={`Copiar ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Clipboard className="h-3.5 w-3.5" />}
      <span>{copied ? 'Copiado!' : 'Copiar'}</span>
    </button>
  );
}

function Section({ title, subtitle, content, action }: { title: string; subtitle?: string; content: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-slate-950 p-3 text-[11px] leading-5 text-slate-200">
        {content || '(vazio)'}
      </pre>
    </div>
  );
}

export const PromptAuditView: React.FC<PromptAuditViewProps> = ({ onBack }) => {
  const [agent, setAgent] = useState<AgentType>('faq');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<PromptAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ agent });
      if (phone.trim()) query.set('phone', phone.trim());
      const res = await apiFetch(`/api/tenant-prompt-audit?${query.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setResult(await res.json());
    } catch (err: any) {
      setError(err?.message || 'Não foi possível carregar a auditoria do prompt.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fullPromptText = result
    ? `=== SYSTEM INSTRUCTION (Camada 1 + Camada 3, cacheado por tenant) ===\n\n${result.systemInstruction}${
        result.conversationPreview
          ? `\n\n=== CONTEXTO DA CONVERSA (Camada 4, entra em "contents") ===\n\n${result.conversationPreview.contentsPreamble}`
          : ''
      }`
    : '';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 transition-all hover:bg-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Voltar</span>
        </button>
        <h2 className="text-sm font-bold text-white">Auditoria do Prompt do Agente</h2>
        <div className="w-20" />
      </div>

      <p className="max-w-3xl text-[11px] leading-5 text-slate-400">
        Mostra exatamente o texto que vai pro Gemini gerar a resposta — só leitura, nada aqui é salvo nem altera a Base de Conhecimento. Escolha o tipo de agente e, opcionalmente, o telefone de uma conversa real pra ver o histórico dela incluído no contexto.
      </p>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Tipo de agente</label>
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value as AgentType)}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-white"
          >
            {AGENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Telefone da conversa (opcional)</label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="ex: 595981234567"
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-white placeholder:text-slate-500"
          />
        </div>
        <button
          type="button"
          onClick={fetchAudit}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition-all hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          <span>{loading ? 'Carregando…' : 'Auditar'}</span>
        </button>
        {result && <CopyButton text={fullPromptText} label="o prompt inteiro" />}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>
      )}

      {result && (
        <>
          {result.knowledgeBaseSource === 'unavailable' && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              A Base de Conhecimento está indisponível pra este tenant (publicação incompleta ou erro) — o agente responde SEM contexto de negócio até isso ser corrigido.
            </div>
          )}

          <Section
            title="Prompt completo (systemInstruction + contexto da conversa)"
            subtitle="Exatamente como é mandado ao Gemini — Camada 1 (regras fixas) + Camada 3 (Base de Conhecimento) cacheadas juntas, mais o histórico da conversa quando um telefone foi informado."
            content={fullPromptText}
            action={<CopyButton text={fullPromptText} label="tudo" />}
          />

          <Section
            title="Só a Base de Conhecimento (Camada 3)"
            subtitle="Isolada do restante, pra conferir separado."
            content={result.knowledgeBaseContext}
            action={<CopyButton text={result.knowledgeBaseContext} label="a Base de Conhecimento" />}
          />

          {result.conversationPreview && (
            <Section
              title={`Histórico da conversa${result.conversationPreview.contactName ? ` — ${result.conversationPreview.contactName}` : ''}`}
              subtitle="Últimas mensagens que entram no contexto (Camada 4) pra este telefone."
              content={result.conversationPreview.historyText}
              action={<CopyButton text={result.conversationPreview.historyText} label="o histórico" />}
            />
          )}

          <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4">
            <h3 className="text-xs font-bold text-slate-300">O que NÃO aparece aqui</h3>
            <p className="mt-1 text-[11px] text-slate-500">Só existem durante uma mensagem real — não dá pra reconstruir sem simular um atendimento de verdade:</p>
            <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
              {result.dynamicNotShown.map((item) => (
                <li key={item} className="flex gap-1.5">
                  <span>•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};
