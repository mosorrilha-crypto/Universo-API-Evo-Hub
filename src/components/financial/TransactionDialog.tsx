/**
 * Modal de lançamento manual de receita/despesa no Financeiro — extraído de
 * AgendaFinanceiroCenter.tsx (TASK-0284) pra ser reaproveitado também a
 * partir do menu "⋮" do balão de mensagem (WhatsAppLeadsSim.tsx), quando o
 * operador marca uma imagem do chat como comprovante de pagamento. Nenhuma
 * mudança de comportamento pro uso original — `initialValues`,
 * `lockedLead` e `linkableAppointment` são todos aditivos/opcionais.
 */
import React from 'react';
import { X } from 'lucide-react';
import type { LeadInfo, PaymentMethod } from '../../types';

export const PAYMENT_METHODS: PaymentMethod[] = ['PIX', 'Transferência Bancária', 'Cartão de Crédito', 'Boleto Bancário', 'Link WhatsApp'];

export function DialogShell({ title, description, children, onClose }: { title: string; description: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"><div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4"><div><h2 className="font-bold text-white">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-400">{description}</p></div><button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button></div>{children}</div></div>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-semibold text-slate-300"><span className="mb-1.5 block">{label}</span>{children}</label>; }
export const inputClass = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-400';

interface TransactionDialogProps {
  kind: 'income' | 'expense';
  leads: LeadInfo[];
  currency: string;
  isSpanish: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
  /** Pré-preenche os campos (ex: valor/forma/descrição extraídos por IA de um comprovante) — o operador ainda revisa/edita antes de enviar. */
  initialValues?: { description?: string; amount?: number; paymentMethod?: PaymentMethod };
  /** Quando presente, substitui o seletor "Cliente do CRM" por um texto fixo — usado quando o cliente já é conhecido (ex: contato da conversa de onde veio o comprovante), evitando o operador trocar de cliente no dropdown e o submit ignorar essa escolha. */
  lockedLead?: { name: string; phone: string };
  /** Quando presente, mostra um checkbox (marcado por padrão) oferecendo vincular o lançamento a um agendamento existente em vez de criar um registro avulso. */
  linkableAppointment?: { summary: string; startIso: string } | null;
}

export function TransactionDialog({ kind, leads, currency, isSpanish, onClose, onSubmit, submitting, initialValues, lockedLead, linkableAppointment }: TransactionDialogProps) {
  const isExpense = kind === 'expense';
  const paymentLabel = (method: PaymentMethod) => isSpanish ? ({ 'Transferência Bancária': 'Transferencia bancaria', 'Cartão de Crédito': 'Tarjeta de crédito', 'Boleto Bancário': 'Boleta bancaria', 'Link WhatsApp': 'Enlace de WhatsApp', PIX: 'PIX' }[method] || method) : method;
  return <DialogShell title={isExpense ? (isSpanish ? 'Registrar gasto' : 'Registrar despesa') : (isSpanish ? 'Registrar ingreso adicional' : 'Registrar receita avulsa')} description={isExpense ? (isSpanish ? 'Registrá una salida operativa que no provino de un agendamiento.' : 'Controle uma saída operacional que não veio de um agendamento.') : (isSpanish ? 'Registrá un ingreso externo sin duplicar los cobros de la agenda.' : 'Registre uma receita externa sem duplicar cobranças da agenda.')} onClose={onClose}>
    <form onSubmit={onSubmit} className="space-y-4 pt-5">
      {!isExpense && (
        lockedLead ? (
          <Field label={isSpanish ? 'Cliente' : 'Cliente'}>
            <p className={`${inputClass} flex items-center text-slate-200`}>{lockedLead.name} · {lockedLead.phone}</p>
          </Field>
        ) : (
          <Field label={isSpanish ? 'Cliente del CRM' : 'Cliente do CRM'}>
            <select name="clientId" defaultValue="" className={inputClass}>
              <option value="">{isSpanish ? 'Cliente sin registro' : 'Cliente sem cadastro'}</option>
              {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name} · {lead.phone}</option>)}
            </select>
          </Field>
        )
      )}
      <Field label={isSpanish ? 'Descripción' : 'Descrição'}>
        <input name="description" required defaultValue={initialValues?.description} placeholder={isExpense ? (isSpanish ? 'Ej.: Compra de materiales' : 'Ex.: Compra de materiais') : (isSpanish ? 'Ej.: Venta presencial' : 'Ex.: Venda presencial')} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={`${isSpanish ? 'Valor' : 'Valor'} (${currency})`}>
          <input name="amount" type="number" min="0.01" step="0.01" required defaultValue={initialValues?.amount} className={inputClass} />
        </Field>
        <Field label={isSpanish ? 'Forma' : 'Forma'}>
          <select name="paymentMethod" defaultValue={initialValues?.paymentMethod} className={inputClass}>
            {PAYMENT_METHODS.map((method) => <option key={method}>{paymentLabel(method)}</option>)}
          </select>
        </Field>
      </div>
      <Field label={isSpanish ? 'Estado' : 'Status'}>
        <select name="status" defaultValue="pago" className={inputClass}>
          <option value="pago">{isSpanish ? 'Cobrado / confirmado' : 'Pago / confirmado'}</option>
          {!isExpense && <option value="pendente">{isSpanish ? 'Pendiente' : 'Pendente'}</option>}
        </select>
      </Field>
      {linkableAppointment && (
        <label className="flex items-start gap-2.5 rounded-xl border border-slate-700 bg-slate-950/60 px-3.5 py-3 text-xs text-slate-300">
          <input type="checkbox" name="linkToAppointment" defaultChecked className="mt-0.5" />
          <span>
            {isSpanish ? 'Vincular a este turno: ' : 'Vincular a este agendamento: '}
            <strong className="text-slate-100">{linkableAppointment.summary}</strong>
            {' '}{isSpanish ? 'el' : 'em'} {new Date(linkableAppointment.startIso).toLocaleString(isSpanish ? 'es-PY' : 'pt-BR')}
          </span>
        </label>
      )}
      <button type="submit" disabled={submitting} className={`w-full rounded-xl py-3 text-xs font-black transition-opacity disabled:opacity-50 ${isExpense ? 'bg-rose-300 text-rose-950' : 'bg-emerald-400 text-slate-950'}`}>
        {submitting ? (isSpanish ? 'Guardando...' : 'Salvando...') : isExpense ? (isSpanish ? 'Registrar gasto' : 'Registrar despesa') : (isSpanish ? 'Registrar ingreso' : 'Registrar receita')}
      </button>
    </form>
  </DialogShell>;
}
