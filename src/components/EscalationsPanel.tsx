import React, { useState } from 'react';
import { EscalationInfo } from '../types';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import { AlertTriangle, CheckCircle2, XCircle, Trash2, Clock, Phone, MessageSquare, Globe2, MessageCircle, ExternalLink, MessageCircleReply, Send, TimerReset } from 'lucide-react';

interface EscalationsPanelProps {
  escalations: EscalationInfo[];
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  /** Abre a conversa desse lead na aba WhatsApp — pedido real do operador
   * depois de revisar prints do app no celular: hoje resolver um
   * escalonamento exige sair daqui e caçar o lead manualmente na lista de
   * conversas. */
  onGoToConversation?: (phone: string) => void;
  /**
   * Issue #97 — operador orienta a IA em vez de assumir a conversa
   * pessoalmente: dentro da janela de 24h ela já responde agora; fora dela,
   * manda um convite e usa a orientação assim que o cliente escrever de novo.
   */
  onSubmitOperatorReply?: (id: string, reply: string) => void;
  /**
   * Verificação de pagamento unificada aqui (pedido real do dono do
   * produto, 12/08/2026) — antes existiam dois lugares desconectados pro
   * mesmo caso: o banner Confirmar/Rejeitar dentro da conversa, e este
   * escalonamento gerado automaticamente pro mesmo comprovante. `reply`
   * presente = também usa o motivo como orientação pra IA avisar o cliente
   * (reusa o mesmo pipeline de onSubmitOperatorReply).
   */
  onResolvePayment?: (id: string, phone: string, status: 'verified' | 'rejected', reply?: string) => void;
}

/** wa.me só aceita dígitos (sem "+", espaços, parênteses, hífen). */
function toWaMeLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

/** "expira em 3h40" / "expirou há 2h" — usado no timer da janela de 24h (issue #97). */
function formatWindowRemaining(expiresAtIso: string): string {
  const diffMs = new Date(expiresAtIso).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const hours = Math.floor(abs / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  const label = hours > 0 ? `${hours}h${minutes.toString().padStart(2, '0')}` : `${minutes}min`;
  return diffMs > 0 ? `expira em ${label}` : `expirou há ${label}`;
}

export const EscalationsPanel: React.FC<EscalationsPanelProps> = ({ escalations, onResolve, onDelete, onGoToConversation, onSubmitOperatorReply, onResolvePayment }) => {
  const [filter, setFilter] = useState<'pendentes' | 'resolvidos'>('pendentes');
  const [replyDraftById, setReplyDraftById] = useState<Record<string, string>>({});
  const [openReplyId, setOpenReplyId] = useState<string | null>(null);

  const pending = escalations.filter((e) => !e.resolved);
  const resolved = escalations.filter((e) => e.resolved);
  const visible = filter === 'pendentes' ? pending : resolved;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            Escalonamentos — precisa de atenção humana
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Casos que a IA não conseguiu resolver sozinha: comprovante de pagamento, falha ao responder, ou qualquer coisa que precisa de uma pessoa real.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('pendentes')}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
              filter === 'pendentes' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Pendentes
            {pending.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-white/20 font-bold">{pending.length}</span>
            )}
          </button>
          <button
            onClick={() => setFilter('resolvidos')}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === 'resolvidos' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Resolvidos ({resolved.length})
          </button>
        </div>
      </div>

      {visible.length === 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500">
          {filter === 'pendentes' ? 'Nenhum escalonamento pendente. 🎉' : 'Nenhum escalonamento resolvido ainda.'}
        </div>
      )}

      <div className="space-y-3">
        {visible.map((e) => (
          <div key={e.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-white">{e.contactName || e.phone}</span>
                  <span className="text-slate-500 text-sm flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5" /> {e.phone}
                  </span>
                  <span className="text-slate-500 text-sm flex items-center gap-1">
                    <Globe2 className="w-3.5 h-3.5" /> {e.country}
                  </span>
                </div>
                <p className="text-sm text-amber-300 mt-1">{e.reason}</p>
                {e.lastMessage && (
                  <p className="text-sm text-slate-400 mt-1 flex items-start gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span className="truncate">"{e.lastMessage}"</span>
                  </p>
                )}
                <div className="flex items-center gap-3 flex-wrap mt-1">
                  <span className="text-xs text-slate-600 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {timeAgo(e.createdAt)}
                  </span>
                  {/* Timer da janela de 24h da Meta (issue #97) — só faz
                      sentido pro operador decidir enquanto o caso ainda está
                      pendente; escalonamento resolvido não precisa mais disso. */}
                  {!e.resolved && e.serviceWindowExpiresAt && (
                    <span
                      title="Desde a última mensagem do cliente — dentro da janela a IA responde de imediato; fora dela, precisa de um template de reengajamento primeiro."
                      className={`text-xs flex items-center gap-1 px-1.5 py-0.5 rounded-md ${
                        e.withinServiceWindow ? 'bg-emerald-950/60 text-emerald-300' : 'bg-amber-950/60 text-amber-300'
                      }`}
                    >
                      <TimerReset className="w-3 h-3" /> {formatWindowRemaining(e.serviceWindowExpiresAt)}
                    </span>
                  )}
                </div>
                {e.operatorReply && !e.operatorReplyConsumedAt && (
                  <p className="text-xs text-amber-400 mt-1.5 flex items-start gap-1.5">
                    <MessageCircleReply className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    Orientação enviada, aguardando o cliente responder pra IA retomar: "{e.operatorReply}"
                  </p>
                )}
                {openReplyId === e.id && (
                  <div className="mt-2 flex flex-col gap-1.5" onClick={(evt) => evt.stopPropagation()}>
                    <AutoResizeTextarea
                      value={replyDraftById[e.id] || ''}
                      onChange={(evt) => setReplyDraftById((prev) => ({ ...prev, [e.id]: evt.target.value }))}
                      placeholder={e.kind === 'payment_proof' ? 'Ex: faltam Gs 10.000, pede pra ela completar e reenviar o comprovante' : 'Ex: diz pra ela que o horário de sábado 14h ainda está livre'}
                      minRows={2}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-amber-500"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const reply = (replyDraftById[e.id] || '').trim();
                          if (!reply) return;
                          if (e.kind === 'payment_proof') {
                            if (!onResolvePayment) return;
                            onResolvePayment(e.id, e.phone, 'rejected', reply);
                          } else {
                            if (!onSubmitOperatorReply) return;
                            onSubmitOperatorReply(e.id, reply);
                          }
                          setReplyDraftById((prev) => ({ ...prev, [e.id]: '' }));
                          setOpenReplyId(null);
                        }}
                        disabled={!(replyDraftById[e.id] || '').trim()}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        <Send className="w-3.5 h-3.5" /> {e.kind === 'payment_proof' ? 'Rejeitar e enviar' : 'Enviar orientação'}
                      </button>
                      <button
                        onClick={() => setOpenReplyId(null)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {/* Achado real em produção (mesmo padrão já documentado em
                  WhatsAppLeadsSim.tsx): flex-wrap sozinho não quebra linha
                  no mobile se o item não tiver uma largura própria pra
                  quebrar contra — sem w-full aqui, os 3-4 botões
                  estouravam a tela em vez de empilhar. md:w-auto devolve o
                  tamanho natural no desktop, onde cabem numa linha só. */}
              <div className="flex gap-2 flex-wrap justify-end w-full md:w-auto md:flex-shrink-0">
                {onGoToConversation && (
                  <button
                    onClick={() => onGoToConversation(e.phone)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-emerald-900/40 hover:text-emerald-300 flex items-center gap-1.5"
                  >
                    <MessageCircle className="w-3.5 h-3.5" /> Voltar pra conversa
                  </button>
                )}
                <a
                  href={toWaMeLink(e.phone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-emerald-900/40 hover:text-emerald-300 flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> WhatsApp pessoal
                </a>
                {/* Verificação de pagamento unificada aqui — em vez das ações
                    genéricas, o card já resolvido pra decidir na hora
                    (pedido real do dono do produto, 12/08/2026): antes disso
                    confirmar/rejeitar vivia num banner separado dentro da
                    conversa, desconectado deste escalonamento gerado pro
                    mesmo comprovante. */}
                {!e.resolved && e.kind === 'payment_proof' && onResolvePayment ? (
                  <>
                    <button
                      onClick={() => onResolvePayment(e.id, e.phone, 'verified')}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar pagamento
                    </button>
                    <button
                      onClick={() => setOpenReplyId(openReplyId === e.id ? null : e.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800/60 flex items-center gap-1.5"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Rejeitar pagamento
                    </button>
                  </>
                ) : (
                  <>
                    {!e.resolved && onSubmitOperatorReply && (
                      <button
                        onClick={() => setOpenReplyId(openReplyId === e.id ? null : e.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-amber-900/40 hover:text-amber-300 flex items-center gap-1.5"
                      >
                        <MessageCircleReply className="w-3.5 h-3.5" /> Orientar a IA
                      </button>
                    )}
                    {!e.resolved && (
                      <button
                        onClick={() => onResolve(e.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Marcar resolvido
                      </button>
                    )}
                  </>
                )}
                {!e.resolved && (
                  <button
                    onClick={() => onDelete(e.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-red-900/40 hover:text-red-300 flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Descartar
                  </button>
                )}
                {e.resolved && (
                  <button
                    onClick={() => onDelete(e.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:bg-red-900/40 hover:text-red-300 flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remover
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
