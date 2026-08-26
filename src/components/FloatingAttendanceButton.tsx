/**
 * Direção visual: atalho operacional direto, discreto e sempre reconhecível.
 * Usa verde WhatsApp apenas como sinal de conversa; leva para Atendimento interno.
 */
import { MessageCircle } from 'lucide-react';

type FloatingAttendanceButtonProps = {
  onOpen: () => void;
};

export function FloatingAttendanceButton({ onOpen }: FloatingAttendanceButtonProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Abrir Atendimento por WhatsApp"
      title="Abrir Atendimento"
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full border border-emerald-300/50 bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-950/35 transition-[transform,background-color,box-shadow] duration-150 hover:bg-emerald-400 hover:shadow-xl hover:shadow-emerald-950/45 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/45 active:scale-[0.97] sm:right-6"
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
      <span>Atendimento</span>
    </button>
  );
}
