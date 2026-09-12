import { useEffect, useState } from 'react';
import { BellRing, Loader2, Save, Info } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

/**
 * Painel de "Notificações" — pedido direto (12/09/2026, achado real: alerta
 * de um tenant chegando no número de outro, porque `admin_alert_phone` só
 * dava pra configurar via SQL direto no Supabase, sem nenhuma tela). Cobre
 * os 5 alertas administrativos do sistema (GET/POST /api/alert-settings,
 * server/services/tenantProfileStore.ts).
 *
 * Escalonamento e pagamento pendente (TASK-0399, 12/09/2026) vêm com o
 * WhatsApp DESLIGADO por padrão: até a TASK-0298 (05/09/2026) esses dois
 * mandavam WhatsApp incondicionalmente, e foi removido porque um tenant
 * reclamou de receber alerta misturado com as conversas reais dos próprios
 * clientes. Virou escolha por tenant — "são modelos de negócio diferentes,
 * necessidades diferentes" — em vez de comportamento fixo pra todo mundo. O
 * push pro painel continua sempre ligado pros 5, independente disso.
 *
 * Pedido direto (12/09/2026, mesmo dia): "deixa as orientações ainda mais
 * didáticas... como ensinar uma criança de 5 anos" — textos reescritos com
 * exemplo concreto por item, em vez de descrição técnica curta.
 */

interface AlertPreferences {
  agent_paused: boolean;
  evolution_disconnected: boolean;
  system_error: boolean;
  escalation: boolean;
  payment_pending: boolean;
}

interface AlertSettingsResponse {
  adminAlertPhone: string | null;
  preferences: AlertPreferences;
}

const ALERT_TYPE_META: Array<{ key: keyof AlertPreferences; label: string; description: string }> = [
  {
    key: 'agent_paused',
    label: 'Agente pausado sem resposta',
    description: 'Exemplo: você pausou a IA pra atender um cliente pessoalmente, esqueceu de ligar de novo, e chegou mensagem de OUTRO cliente sem ninguém responder. A plataforma te avisa que tem gente esperando.',
  },
  {
    key: 'evolution_disconnected',
    label: 'Conexão do WhatsApp caiu',
    description: 'Exemplo: o celular ficou sem internet ou a sessão do WhatsApp (aquele QR Code que você escaneou) expirou. Enquanto isso, as mensagens dos clientes não chegam na plataforma — precisa escanear o QR Code de novo pra voltar a funcionar.',
  },
  {
    key: 'system_error',
    label: 'Erro real no sistema',
    description: 'Alguma coisa quebrou dentro da plataforma (não tem nada a ver com o seu WhatsApp nem com um cliente específico) e a equipe técnica precisa saber pra consertar.',
  },
  {
    key: 'escalation',
    label: 'Escalonamento (IA pede ajuda humana)',
    description: 'Exemplo: um cliente reclamou, pediu algo fora do comum, ou a IA não teve certeza do que responder e preferiu chamar alguém. Isso SEMPRE aparece na tela de Escalonamentos, com ou sem este botão ligado — aqui você só escolhe se quer ganhar um aviso extra no WhatsApp também.',
  },
  {
    key: 'payment_pending',
    label: 'Pagamento pendente de verificação',
    description: 'Exemplo: um cliente mandou a foto do comprovante de pagamento e está esperando você confirmar há um tempo. Isso SEMPRE aparece na tela de Escalonamentos, com ou sem este botão ligado — aqui você só escolhe se quer ganhar um aviso extra no WhatsApp também.',
  },
];

export function AlertSettingsPanel() {
  const [isLoading, setIsLoading] = useState(true);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [preferences, setPreferences] = useState<AlertPreferences>({ agent_paused: true, evolution_disconnected: true, system_error: true, escalation: false, payment_pending: false });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/alert-settings');
        if (!res.ok) throw new Error('Não foi possível carregar as configurações de alerta.');
        const data: AlertSettingsResponse = await res.json();
        if (cancelled) return;
        setPhoneDraft(data.adminAlertPhone || '');
        setPreferences(data.preferences);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Não foi possível carregar as configurações de alerta.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      const digits = phoneDraft.replace(/\D/g, '');
      const res = await apiFetch('/api/alert-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminAlertPhone: digits || null, preferences }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Não foi possível salvar as configurações de alerta.');
      setPhoneDraft(data.adminAlertPhone || '');
      setPreferences(data.preferences);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível salvar as configurações de alerta.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando configurações de alerta...
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-1.5 text-amber-300"><BellRing className="h-4 w-4" /></span>
          <div>
            <h2 className="text-sm font-bold text-white">Qual número de WhatsApp recebe os alertas</h2>
            <p className="text-[11px] text-slate-400">Pense assim: quando algo importante acontece na plataforma, ela manda uma mensagem PRA VOCÊ avisando — igual um lembrete de um amigo. Essa mensagem nunca é de um cliente, é sempre da própria plataforma.</p>
          </div>
        </div>
        <div>
          <label htmlFor="alert-phone" className="mb-1 block text-xs font-semibold text-slate-300">Telefone (com o código do país na frente)</label>
          <input
            id="alert-phone"
            type="tel"
            inputMode="numeric"
            value={phoneDraft}
            onChange={(event) => setPhoneDraft(event.target.value)}
            placeholder="Ex.: 595991234567"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />
          <p className="mt-1 text-[10px] text-slate-500">Coloque o código do país antes do número (ex.: 595 pro Paraguai), sem espaço, sem "+" e sem traço. Se deixar em branco, você simplesmente não recebe nenhum desses avisos no WhatsApp — mas eles continuam aparecendo normalmente dentro da plataforma.</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
        <div>
          <h2 className="text-sm font-bold text-white">Escolha quais desses avisos você quer no WhatsApp</h2>
          <p className="text-[11px] text-slate-400">Marcado = você recebe esse aviso no número acima. Desmarcado = esse aviso só fica dentro da plataforma, não vai pro seu WhatsApp.</p>
        </div>
        <div className="space-y-2">
          {ALERT_TYPE_META.map(({ key, label, description }) => (
            <label key={key} className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 cursor-pointer hover:border-slate-700">
              <span>
                <span className="block text-xs font-semibold text-slate-200">{label}</span>
                <span className="block text-[11px] text-slate-500">{description}</span>
              </span>
              <input
                type="checkbox"
                checked={preferences[key]}
                onChange={(event) => setPreferences((prev) => ({ ...prev, [key]: event.target.checked }))}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-amber-500 focus:ring-amber-500"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-[11px] text-sky-100/90">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
        <span>
          <span className="font-bold">Importante pra entender:</span> os 5 avisos acima SEMPRE aparecem dentro da plataforma, não importa o que você marcar aqui. Esses botões só decidem se, ALÉM disso, você também quer receber uma mensagem no seu WhatsApp. Ou seja: desmarcar um item aqui nunca faz você perder o aviso — só faz você não ganhar a mensagem extra no celular.
        </span>
      </div>

      {error && <p className="text-xs font-semibold text-rose-300">{error}</p>}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={isSaving}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        {isSaving ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar'}
      </button>
    </div>
  );
}
