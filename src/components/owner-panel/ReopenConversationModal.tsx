import React, { useState, useEffect } from 'react';
import { X, Send, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ApprovedMetaTemplate } from './ownerPanelTypes';
import { apiFetch } from '../../lib/apiClient';

interface ReopenConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  phone: string;
  contactName: string;
  suggestedService?: string;
  onTemplateSent: () => void;
}

const DEFAULT_TEMPLATES: ApprovedMetaTemplate[] = [
  {
    id: 'teste_modelo',
    name: 'teste_modelo',
    category: 'MARKETING',
    language: 'pt_BR',
    bodyText: 'Oi {{1}}, testando o modelo de mensagem {{2}}. Teste dos modelos...',
    variableExamples: ['Enzo S.', 'suporte'],
    estimatedCostUsd: 0.008,
  },
  {
    id: 'promocao_servico',
    name: 'promocao_servico',
    category: 'MARKETING',
    language: 'pt_BR',
    bodyText: 'Oi {{1}}! Tem novidade na {{2}} com condição especial para você!',
    variableExamples: ['Enzo S.', 'Renov Estética'],
    estimatedCostUsd: 0.008,
  },
  {
    id: 'lembrete_consulta',
    name: 'lembrete_consulta',
    category: 'UTILITY',
    language: 'pt_BR',
    bodyText:
      'Olá {{1}}, tudo bem?\nPassando para lembrar da sua consulta na {{2}}.\n\nServiço: {{3}}\nSe precisar remarcar, é só responder por aqui.',
    variableExamples: ['Enzo S.', 'Renov Estética', 'Limpeza de Pele'],
    estimatedCostUsd: 0.005,
  },
  {
    id: 'hello_world',
    name: 'hello_world',
    category: 'UTILITY',
    language: 'en_US',
    bodyText:
      'Welcome and congratulations! This message demonstrates your ability to send a WhatsApp template notification.',
    variableExamples: [],
    estimatedCostUsd: 0.005,
  },
];

export const ReopenConversationModal: React.FC<ReopenConversationModalProps> = ({
  isOpen,
  onClose,
  phone,
  contactName,
  suggestedService,
  onTemplateSent,
}) => {
  const [templates, setTemplates] = useState<ApprovedMetaTemplate[]>(DEFAULT_TEMPLATES);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('lembrete_consulta');
  const [variables, setVariables] = useState<Record<number, string>>({});
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Inicializar variáveis com base no contato
  useEffect(() => {
    if (isOpen) {
      setVariables({
        1: contactName || 'Cliente',
        2: 'Universo Estética',
        3: suggestedService || 'Consulta / Avaliação',
      });
      setErrorMessage(null);
    }
  }, [isOpen, contactName, suggestedService]);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) || templates[0];

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

      await apiFetch(`/api/conversations/${phone}/send-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName: selectedTemplate.name,
          languageCode: selectedTemplate.language,
          parameters: paramArray,
        }),
      });

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
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Cabeçalho */}
        <div className="p-5 border-b border-zinc-800 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Reabrir a conversa
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Para <strong className="text-zinc-200">{contactName}</strong> — {phone}
            </p>
            <p className="text-[11px] text-amber-400/90 mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              A janela de 24 horas fechou, então só sai modelo aprovado. Confira o texto antes de confirmar.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition-colors"
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

          {/* Lista de Modelos */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-300 block">
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
                      : 'bg-zinc-800/50 border-zinc-700/60 hover:bg-zinc-800'
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
                      <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-1">
                        {tpl.bodyText}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Campos de Variáveis */}
          <div className="space-y-3 pt-2">
            <label className="text-xs font-semibold text-zinc-300 block">
              Variáveis do modelo:
            </label>
            {[1, 2, 3].map((num) => {
              const placeholderExample =
                selectedTemplate.variableExamples?.[num - 1] || `Valor para {{${num}}}`;
              return (
                <div key={num} className="space-y-1">
                  <span className="text-[11px] text-zinc-400">
                    Variável {'{{' + num + '}}'} — exemplo da Meta: {placeholderExample}
                  </span>
                  <input
                    type="text"
                    value={variables[num] || ''}
                    onChange={(e) =>
                      setVariables((prev) => ({ ...prev, [num]: e.target.value }))
                    }
                    placeholder={placeholderExample}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-hidden focus:border-emerald-500"
                  />
                </div>
              );
            })}
          </div>

          {/* Prévia: O que o cliente vai receber */}
          <div className="pt-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1.5">
              O que o cliente vai receber:
            </span>
            <div className="bg-[#183628] border border-emerald-600/30 rounded-2xl p-3.5 shadow-inner">
              <p className="text-xs text-emerald-50 whitespace-pre-wrap leading-relaxed">
                {renderedPreview}
              </p>
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950 flex items-center justify-between">
          <span className="text-[11px] text-zinc-400">
            Custo estimado deste envio:{' '}
            <strong className="text-zinc-200">
              USD {selectedTemplate.estimatedCostUsd.toFixed(4)}
            </strong>
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={isSending}
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
