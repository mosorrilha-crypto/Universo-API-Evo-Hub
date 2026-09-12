import { useEffect, useState } from 'react';
import { Loader2, Save, Info, MessageCircle } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

/**
 * Painel "Mensagens automáticas pro cliente" — pedido direto (12/09/2026):
 * "o que enviar, quando enviar e se quer enviar" pras 3 mensagens hoje
 * mandadas automaticamente pro CLIENTE FINAL (não pro dono do tenant, isso é
 * AlertSettingsPanel.tsx), antes totalmente hardcoded e fixas pra todo
 * tenant: lembrete de agendamento (reminderJob.ts), retomada de conversa
 * parada fora da janela de 24h (operatorFollowUpService.ts) e reengajamento
 * automático do funil (pendingFollowUpJob.ts/webhooks.ts). GET/POST
 * /api/customer-notification-settings, server/services/tenantProfileStore.ts.
 */

interface AppointmentReminderPreferences {
  enabled: boolean;
  diaAnteriorEnabled: boolean;
  diaAnteriorMinLeadHours: number;
  diaAnteriorEarliestTime: string;
  mesmoDiaEnabled: boolean;
  mesmoDiaEarliestTime: string;
}

interface FunnelAutoFollowUpPreferences {
  enabled: boolean;
  delayHours: number;
  businessHoursStart: number;
  businessHoursEnd: number;
}

interface CustomerNotificationPreferences {
  appointmentReminders: AppointmentReminderPreferences;
  abandonedConversationReactivation: { enabled: boolean };
  funnelAutoFollowUp: FunnelAutoFollowUpPreferences;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function CustomerNotificationSettingsPanel() {
  const [isLoading, setIsLoading] = useState(true);
  const [prefs, setPrefs] = useState<CustomerNotificationPreferences | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/customer-notification-settings');
        if (!res.ok) throw new Error('Não foi possível carregar as configurações de mensagens automáticas.');
        const data: { preferences: CustomerNotificationPreferences } = await res.json();
        if (!cancelled) setPrefs(data.preferences);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Não foi possível carregar as configurações de mensagens automáticas.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const businessHoursInvalid = Boolean(prefs && prefs.funnelAutoFollowUp.businessHoursStart >= prefs.funnelAutoFollowUp.businessHoursEnd);
  const timeFieldsInvalid = Boolean(
    prefs && (!HHMM_RE.test(prefs.appointmentReminders.diaAnteriorEarliestTime) || !HHMM_RE.test(prefs.appointmentReminders.mesmoDiaEarliestTime))
  );

  const handleSave = async () => {
    if (!prefs || businessHoursInvalid || timeFieldsInvalid) return;
    setIsSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await apiFetch('/api/customer-notification-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: prefs }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Não foi possível salvar as configurações de mensagens automáticas.');
      setPrefs(data.preferences);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível salvar as configurações de mensagens automáticas.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !prefs) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando configurações de mensagens automáticas...
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-1.5 text-emerald-300"><MessageCircle className="h-4 w-4" /></span>
          <div>
            <h2 className="text-sm font-bold text-white">Lembrete de agendamento</h2>
            <p className="text-[11px] text-slate-400">Mensagem automática pro cliente na véspera e no dia do horário marcado.</p>
          </div>
        </div>
        <label className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 cursor-pointer hover:border-slate-700">
          <span className="text-xs font-semibold text-slate-200">Mandar lembrete de agendamento</span>
          <input
            type="checkbox"
            checked={prefs.appointmentReminders.enabled}
            onChange={(e) => setPrefs({ ...prefs, appointmentReminders: { ...prefs.appointmentReminders, enabled: e.target.checked } })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
          />
        </label>

        {prefs.appointmentReminders.enabled && (
          <div className="space-y-3 pl-1">
            <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex-1 space-y-2">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-200">Véspera</span>
                  <input
                    type="checkbox"
                    checked={prefs.appointmentReminders.diaAnteriorEnabled}
                    onChange={(e) => setPrefs({ ...prefs, appointmentReminders: { ...prefs.appointmentReminders, diaAnteriorEnabled: e.target.checked } })}
                    className="h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                  />
                </label>
                {prefs.appointmentReminders.diaAnteriorEnabled && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-[10px] text-slate-500">Antecedência mínima (horas)</span>
                      <input
                        type="number" min={0} max={168}
                        value={prefs.appointmentReminders.diaAnteriorMinLeadHours}
                        onChange={(e) => setPrefs({ ...prefs, appointmentReminders: { ...prefs.appointmentReminders, diaAnteriorMinLeadHours: Number(e.target.value) } })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] text-slate-500">Não antes de</span>
                      <input
                        type="time"
                        value={prefs.appointmentReminders.diaAnteriorEarliestTime}
                        onChange={(e) => setPrefs({ ...prefs, appointmentReminders: { ...prefs.appointmentReminders, diaAnteriorEarliestTime: e.target.value } })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex-1 space-y-2">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-200">Mesmo dia</span>
                  <input
                    type="checkbox"
                    checked={prefs.appointmentReminders.mesmoDiaEnabled}
                    onChange={(e) => setPrefs({ ...prefs, appointmentReminders: { ...prefs.appointmentReminders, mesmoDiaEnabled: e.target.checked } })}
                    className="h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                  />
                </label>
                {prefs.appointmentReminders.mesmoDiaEnabled && (
                  <label className="block w-1/2">
                    <span className="mb-1 block text-[10px] text-slate-500">Não antes de</span>
                    <input
                      type="time"
                      value={prefs.appointmentReminders.mesmoDiaEarliestTime}
                      onChange={(e) => setPrefs({ ...prefs, appointmentReminders: { ...prefs.appointmentReminders, mesmoDiaEarliestTime: e.target.value } })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    />
                  </label>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
        <h2 className="text-sm font-bold text-white">Retomada de conversa parada</h2>
        <p className="text-[11px] text-slate-400">Quando um atendente orienta a IA fora da janela de 24h de atendimento do WhatsApp, um convite automático é mandado pro cliente responder.</p>
        <label className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 cursor-pointer hover:border-slate-700">
          <span className="text-xs font-semibold text-slate-200">Mandar convite automático de retomada</span>
          <input
            type="checkbox"
            checked={prefs.abandonedConversationReactivation.enabled}
            onChange={(e) => setPrefs({ ...prefs, abandonedConversationReactivation: { enabled: e.target.checked } })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
          />
        </label>
        {!prefs.abandonedConversationReactivation.enabled && (
          <p className="text-[10px] text-slate-500">Desligar isso nunca perde a orientação do atendente — ela continua salva e é usada automaticamente assim que o cliente responder por conta própria.</p>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
        <h2 className="text-sm font-bold text-white">Reengajamento automático do funil</h2>
        <p className="text-[11px] text-slate-400">Quando a IA oferece um horário/opção e o cliente some, tenta reengajar automaticamente antes de escalar pro atendente.</p>
        <label className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 cursor-pointer hover:border-slate-700">
          <span className="text-xs font-semibold text-slate-200">Tentar reengajamento automático</span>
          <input
            type="checkbox"
            checked={prefs.funnelAutoFollowUp.enabled}
            onChange={(e) => setPrefs({ ...prefs, funnelAutoFollowUp: { ...prefs.funnelAutoFollowUp, enabled: e.target.checked } })}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
          />
        </label>
        {prefs.funnelAutoFollowUp.enabled && (
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] text-slate-500">Esperar (horas)</span>
              <input
                type="number" min={0.5} max={24} step={0.5}
                value={prefs.funnelAutoFollowUp.delayHours}
                onChange={(e) => setPrefs({ ...prefs, funnelAutoFollowUp: { ...prefs.funnelAutoFollowUp, delayHours: Number(e.target.value) } })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-slate-500">Das (hora)</span>
              <input
                type="number" min={0} max={23}
                value={prefs.funnelAutoFollowUp.businessHoursStart}
                onChange={(e) => setPrefs({ ...prefs, funnelAutoFollowUp: { ...prefs.funnelAutoFollowUp, businessHoursStart: Number(e.target.value) } })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-slate-500">Às (hora)</span>
              <input
                type="number" min={1} max={24}
                value={prefs.funnelAutoFollowUp.businessHoursEnd}
                onChange={(e) => setPrefs({ ...prefs, funnelAutoFollowUp: { ...prefs.funnelAutoFollowUp, businessHoursEnd: Number(e.target.value) } })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              />
            </label>
          </div>
        )}
        {businessHoursInvalid && <p className="text-[10px] font-semibold text-rose-300">O horário "Das" precisa ser antes do "Às".</p>}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-[11px] text-sky-100/90">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
        <span>Essas mensagens vão direto pro WhatsApp do cliente — diferente da aba "Alertas internos", que avisa só você.</span>
      </div>

      {timeFieldsInvalid && <p className="text-xs font-semibold text-rose-300">Confira os horários preenchidos (formato HH:mm).</p>}
      {error && <p className="text-xs font-semibold text-rose-300">{error}</p>}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={isSaving || businessHoursInvalid || timeFieldsInvalid}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        {isSaving ? 'Salvando...' : saved ? 'Salvo!' : 'Salvar'}
      </button>
    </div>
  );
}
