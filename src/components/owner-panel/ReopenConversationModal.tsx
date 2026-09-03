import React, { useState, useEffect } from 'react';
import { X, Send, Loader2, AlertTriangle } from 'lucide-react';
import type { ApprovedMetaTemplate } from './ownerPanelTypes';
import { apiFetch } from '../../lib/apiClient';

interface ReopenConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  phone: string;
  contactName: string;
  /** Nome real do negócio (tenant ativo) — usado como valor de variável do template quando fizer sentido. Nunca hardcoded. */
  businessName: string;
  suggestedService?: string;
  onTemplateSent: () => void;
}

export const ReopenConversationModal: React.FC<ReopenConversationModalProps> = ({
  isOpen,
  onClose,
  phone,
  contactName,
  businessName,
  suggestedService,
  onTemplateSent,
}) => {
  const [templates, setTemplates] = useState<ApprovedMetaTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  // 'waba_not_configured' | 'load_failed' | null — motivo de não haver templates pra mostrar.
  const [loadIssue, setLoadIssue] = useState<'waba_not_configured' | 'load_failed' | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [variables, setVariables] = useState<Record<number, string>>({});
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Busca os templates APROVADOS de verdade na conta WhatsApp Business do
  // tenant (GET /api/conversations/:phone/templates) sempre que o modal
  // abre — nunca uma lista fixa: achado real de auditoria, a versão
  // anterior mostrava 4 templates inventados (nomes que não existem em
  // nenhuma conta Meta real) pra qualquer tenant.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoadingTemplates(true);
    setLoadIssue(null);
    setErrorMessage(null);
    apiFetch(`/api/conversations/${phone}/templates`)
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        const list: ApprovedMetaTemplate[] = Array.isArray(data?.templates) ? data.templates : [];
        setTemplates(list);
        setSelectedTemplateId(list[0]?.id || '');
        if (!list.length) setLoadIssue(data?.reason === 'waba_not_configured' ? 'waba_not_configured' : 'load_failed');
      })
      .catch(() => {
        if (!cancelled) {
          setTemplates([]);
          setLoadIssue('load_failed');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTemplates(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, phone]);

  // Inicializar variáveis com dado real do contato/negócio — nunca um nome
  // de negócio fixo (achado real de auditoria: estava hardcoded como
  // "Universo Estética", que vazaria pro cliente de QUALQUER tenant).
  useEffect(() => {
    if (isOpen) {
      setVariables({
        1: contactName || 'Cliente',
        2: businessName,
        3: suggestedService || 'Consulta / Avaliação',
      });
    }
  }, [isOpen, contactName, businessName, suggestedService]);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  // Renderiza o texto do preview substituindo as variáveis {{1}}, {{2}}, etc.
  const renderedPreview = React.useMemo(() => {
    if (!selectedTemplate) return '';
    return selectedTemplate.bodyText.replace(/\{\{(\d+)\}\}/g, (_match, index) => {
      const idx = Number(index);
      return variables[idx] || `{{${idx}}}`;
    });
  }, [selectedTemplate, variables]);

  const handleSend = async () => {
    if (!selectedTemplate) return;
    setIsSending(true);
    setErrorMessage(null);

    try {
      const paramArray = Object.keys(variables)
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => variables[Number(k)]);

      const res = await apiFetch(`/api/conversations/${phone}/send-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName: selectedTemplate.name,
          languageCode: selectedTemplate.language,
          parameters: paramArray,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as any);
        throw new Error(body?.error || `Falha ao enviar modelo (HTTP ${res.status}).`);
      }

      onTemplateSent();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Falha ao enviar modelo oficial.');
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Cabeçalho */}
        <div className="p-5 border-b border-slate-800 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Reabrir a conversa
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Para <strong className="text-slate-200">{contactName}</strong> — {phone}
            </p>
            <p className="text-[11px] text-amber-400/90 mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              A janela de 24 horas fechou, então só sai modelo aprovado. Confira o texto antes de confirmar.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo com scroll */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              {errorMessage}
            </div>
          )}

          {isLoadingTemplates ? (
            <div className="flex items-center justify-center gap-2 py-8 text-slate-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" />
              Buscando modelos aprovados na sua conta do WhatsApp Business...
            </div>
          ) : loadIssue ? (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {loadIssue === 'waba_not_configured'
                  ? 'Esta empresa ainda não tem uma conta do WhatsApp Business (WABA) configurada.'
                  : 'Não foi possível buscar os modelos aprovados agora.'}
              </p>
              <p className="text-amber-300/80">
                {loadIssue === 'waba_not_configured'
                  ? 'Fale com o suporte para configurar a conta oficial antes de reabrir conversas fora da janela de 24h.'
                  : 'Tente fechar e abrir esta janela de novo em instantes.'}
              </p>
            </div>
          ) : !templates.length ? (
            <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/60 text-slate-400 text-xs">
              Nenhum modelo aprovado encontrado na conta do WhatsApp Business desta empresa. Cadastre e aguarde a aprovação de um template na Meta antes de reabrir conversas fora da janela de 24h.
            </div>
          ) : (
            <>
              {/* Lista de Modelos */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 block">
                  Selecione o modelo aprovado:
                </label>
                {templates.map((tpl) => {
                  const isSelected = tpl.id === selectedTemplateId;
                  return (
                    <div
                      key={tpl.id}
                      onClick={() => setSelectedTemplateId(tpl.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start justify-between gap-3 ${
                        isSelected
                          ? 'bg-emerald-950/20 border-emerald-500/60 ring-1 ring-emerald-500/40'
                          : 'bg-slate-800/50 border-slate-700/60 hover:bg-slate-800'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <input
                          type="radio"
                          checked={isSelected}
                          onChange={() => setSelectedTemplateId(tpl.id)}
                          className="mt-1 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-white">
                              {tpl.name}
                            </span>
                            <span
                              className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-full ${
                                tpl.category === 'MARKETING'
                                  ? 'bg-purple-900/50 text-purple-300 border border-purple-700/40'
                                  : 'bg-blue-900/50 text-blue-300 border border-blue-700/40'
                              }`}
                            >
                              {tpl.category}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                            {tpl.bodyText}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedTemplate && (
                <>
                  {/* Campos de Variáveis */}
                  <div className="space-y-3 pt-2">
                    <label className="text-xs font-semibold text-slate-300 block">
                      Variáveis do modelo:
                    </label>
                    {[1, 2, 3].map((num) => {
                      const placeholderExample =
                        selectedTemplate.variableExamples?.[num - 1] || `Valor para {{${num}}}`;
                      return (
                        <div key={num} className="space-y-1">
                          <span className="text-[11px] text-slate-400">
                            Variável {'{{' + num + '}}'} — exemplo da Meta: {placeholderExample}
                          </span>
                          <input
                            type="text"
                            value={variables[num] || ''}
                            onChange={(e) =>
                              setVariables((prev) => ({ ...prev, [num]: e.target.value }))
                            }
                            placeholder={placeholderExample}
                            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-hidden focus:border-emerald-500"
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Prévia: O que o cliente vai receber */}
                  <div className="pt-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                      O que o cliente vai receber:
                    </span>
                    <div className="bg-[#183628] border border-emerald-600/30 rounded-2xl p-3.5 shadow-inner">
                      <p className="text-xs text-emerald-50 whitespace-pre-wrap leading-relaxed">
                        {renderedPreview}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Rodapé */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-end">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending || !selectedTemplate}
              className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Enviar modelo
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
