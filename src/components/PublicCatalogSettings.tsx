import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, Link2, Loader2, Save } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

interface PublicCatalogFormState {
  enabled: boolean;
  whatsappPhone: string;
  instagramUrl: string;
  locationMapsUrl: string;
  address: string;
  hoursLabel: string;
}

const EMPTY_FORM: PublicCatalogFormState = {
  enabled: false,
  whatsappPhone: '',
  instagramUrl: '',
  locationMapsUrl: '',
  address: '',
  hoursLabel: '',
};

interface PublicCatalogSettingsProps {
  /** Slug do tenant ativo — usado só pra montar o link de pré-visualização (`/catalogo/:slug`); nunca enviado na requisição, o backend sempre resolve o tenant pelo JWT. */
  tenantSlug: string;
  /** Quantos produtos da Base de Conhecimento aparecem no catálogo público hoje (mesmo filtro `active !== false` do backend) — deixa claro que esta aba não cadastra produto, só publica o que já está na Base de Conhecimento. */
  activeProductCount: number;
  onGoToKnowledgeBase: () => void;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-slate-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60';

export function PublicCatalogSettings({ tenantSlug, activeProductCount, onGoToKnowledgeBase }: PublicCatalogSettingsProps) {
  const [form, setForm] = useState<PublicCatalogFormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch('/api/public-catalog-settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setForm({
          enabled: !!data.enabled,
          whatsappPhone: data.whatsappPhone || '',
          instagramUrl: data.instagramUrl || '',
          locationMapsUrl: data.locationMapsUrl || '',
          address: data.address || '',
          hoursLabel: data.hoursLabel || '',
        });
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar a configuração do catálogo público.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const res = await apiFetch('/api/public-catalog-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSavedAt(Date.now());
    } catch (err: any) {
      setError(err.message || 'Não foi possível salvar. Tente de novo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="catalog-settings space-y-6 max-w-4xl mx-auto">
      <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-950 via-slate-900 to-slate-900 border border-sky-500/30 shadow-xl flex items-center justify-between gap-3">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400 flex-shrink-0">
            <Link2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight truncate">Catálogo Público</h2>
            <p className="text-[11px] text-slate-300 mt-0.5 max-w-2xl leading-relaxed">
              A página que o cliente vê antes de escrever no WhatsApp — filtra curiosos e manda pra conversa só quem já viu preço e serviço.
            </p>
          </div>
        </div>
        {form.enabled && (
          <a
            href={`/catalogo/${encodeURIComponent(tenantSlug)}`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-2 rounded-xl border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200 text-xs font-semibold flex items-center gap-1.5 transition-all flex-shrink-0"
            title="Abrir catálogo público"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ver catálogo</span>
          </a>
        )}
      </div>

      {loading ? (
        <div className="p-6 text-sm text-slate-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando configuração do catálogo…
        </div>
      ) : (
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-5">
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <p className="text-sm font-semibold text-white">Catálogo público ativo</p>
              <p className="text-xs text-slate-400 mt-1 max-w-md">
                Quando ativo, <code className="text-slate-300">/catalogo/{tenantSlug}</code> fica acessível pra qualquer pessoa com o link — sem exigir login. Regras do agente e dados internos nunca aparecem ali.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              onClick={() => setForm((prev) => ({ ...prev, enabled: !prev.enabled }))}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${form.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-800">
            <p className="text-xs text-slate-300">
              <span className="font-semibold text-white">{activeProductCount}</span> {activeProductCount === 1 ? 'produto ativo aparece' : 'produtos ativos aparecem'} hoje neste catálogo, direto da Base de Conhecimento.
            </p>
            <button
              type="button"
              onClick={onGoToKnowledgeBase}
              className="text-xs font-semibold text-sky-300 hover:text-sky-200 whitespace-nowrap"
            >
              Editar produtos →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="WhatsApp para o botão de contato" hint="Código do país + número, sem espaços ou símbolos (ex: 595981436141).">
              <input
                className={inputClass}
                value={form.whatsappPhone}
                onChange={(e) => setForm((prev) => ({ ...prev, whatsappPhone: e.target.value }))}
                placeholder="595981436141"
                inputMode="numeric"
              />
            </Field>
            <Field label="Instagram">
              <input
                className={inputClass}
                value={form.instagramUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, instagramUrl: e.target.value }))}
                placeholder="https://instagram.com/sua-conta"
              />
            </Field>
            <Field label="Link do Google Maps">
              <input
                className={inputClass}
                value={form.locationMapsUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, locationMapsUrl: e.target.value }))}
                placeholder="https://www.google.com/maps?q=..."
              />
            </Field>
            <Field label="Endereço (texto exibido no rodapé)">
              <input
                className={inputClass}
                value={form.address}
                onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                placeholder="Rua Exemplo 123, Bairro, Cidade"
              />
            </Field>
            <Field label="Horário de atendimento (texto exibido no rodapé)">
              <input
                className={inputClass}
                value={form.hoursLabel}
                onChange={(e) => setForm((prev) => ({ ...prev, hoursLabel: e.target.value }))}
                placeholder="Lun–Vie 8–18h · Sáb 8–13h"
              />
            </Field>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {savedAt && !error && <p className="text-xs text-emerald-400">Configuração salva.</p>}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold flex items-center gap-2 transition-all"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PublicCatalogSettings;
