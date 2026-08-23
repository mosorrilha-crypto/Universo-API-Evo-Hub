import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X, Zap } from 'lucide-react';

interface QuickRepliesMenuProps {
  quickReplies: string[];
  isSpanish?: boolean;
  saving?: boolean;
  onSelect: (reply: string) => void;
  onCreate: (reply: string) => Promise<void>;
  onUpdate: (index: number, reply: string) => Promise<void>;
  onDelete: (index: number) => Promise<void>;
}

type EditorMode = { type: 'create' } | { type: 'edit'; index: number } | null;

export function QuickRepliesMenu({
  quickReplies,
  isSpanish = false,
  saving = false,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
}: QuickRepliesMenuProps) {
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<EditorMode>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (editor) textareaRef.current?.focus();
  }, [editor]);

  const closeEditor = () => {
    setEditor(null);
    setDraft('');
    setError(null);
  };

  const startCreate = () => {
    setError(null);
    setDraft('');
    setEditor({ type: 'create' });
  };

  const startEdit = (index: number) => {
    setError(null);
    setDraft(quickReplies[index] || '');
    setEditor({ type: 'edit', index });
  };

  const handleSubmit = async () => {
    const value = draft.trim();
    if (!value) {
      setError(isSpanish ? 'Escribe una respuesta antes de guardar.' : 'Digite uma resposta antes de salvar.');
      textareaRef.current?.focus();
      return;
    }

    setError(null);
    try {
      if (editor?.type === 'edit') {
        await onUpdate(editor.index, value);
      } else {
        await onCreate(value);
      }
      closeEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : (isSpanish ? 'No se pudo guardar.' : 'Não foi possível salvar.'));
    }
  };

  const handleDelete = async (index: number) => {
    const reply = quickReplies[index];
    const confirmed = window.confirm(
      isSpanish
        ? `¿Eliminar esta respuesta rápida?\n\n${reply}`
        : `Remover esta resposta rápida?\n\n${reply}`
    );
    if (!confirmed) return;

    setError(null);
    try {
      await onDelete(index);
    } catch (err) {
      setError(err instanceof Error ? err.message : (isSpanish ? 'No se pudo eliminar.' : 'Não foi possível remover.'));
    }
  };

  const handleSelect = (reply: string) => {
    onSelect(reply);
    setOpen(false);
    closeEditor();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((current) => !current); setError(null); }}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={isSpanish ? 'Respuestas rápidas' : 'Respostas rápidas'}
        className={`px-2 py-1 rounded-lg border text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
          open
            ? 'bg-amber-500 text-slate-950 border-amber-400'
            : 'bg-[#111b21] hover:bg-slate-800 border-slate-800 text-amber-400'
        }`}
      >
        <Zap className="w-3 h-3" />
        <span>{isSpanish ? 'Respuestas' : 'Respostas'}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={isSpanish ? 'Administrar respuestas rápidas' : 'Gerenciar respostas rápidas'}
          className="fixed bottom-24 left-2 right-2 z-50 mx-auto max-h-[min(70dvh,520px)] w-auto max-w-[360px] overflow-hidden rounded-2xl border border-slate-700 bg-[#182229] text-slate-100 shadow-2xl shadow-black/50 sm:absolute sm:bottom-full sm:left-auto sm:right-0 sm:mb-2 sm:w-[360px] sm:max-w-[min(360px,calc(100vw-2rem))]"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-700 bg-[#202c33] px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <Zap className="h-3.5 w-3.5" />
                {isSpanish ? 'Respuestas rápidas' : 'Respostas rápidas'}
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                {isSpanish
                  ? 'Elige una para colocarla en el campo. Todavía no se envía automáticamente.'
                  : 'Escolha uma para preencher o campo. Ela ainda não é enviada automaticamente.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={isSpanish ? 'Cerrar respuestas rápidas' : 'Fechar respostas rápidas'}
              className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[min(55dvh,390px)] overscroll-contain overflow-y-auto p-2">
            {editor && (
              <div className="mb-2 rounded-xl border border-amber-500/40 bg-amber-950/20 p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-amber-200">
                    {editor.type === 'edit'
                      ? (isSpanish ? 'Editar respuesta' : 'Editar resposta')
                      : (isSpanish ? 'Nueva respuesta' : 'Nova resposta')}
                  </span>
                  <span className="text-[10px] text-slate-500">{draft.length} {isSpanish ? 'caracteres' : 'caracteres'}</span>
                </div>
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void handleSubmit();
                  }}
                  rows={4}
                  placeholder={isSpanish ? 'Escribe el mensaje que quieres reutilizar…' : 'Digite a mensagem que deseja reutilizar…'}
                  className="w-full resize-y rounded-lg border border-slate-700 bg-[#111b21] px-2.5 py-2 text-xs leading-relaxed text-white outline-none placeholder:text-slate-500 focus:border-amber-400 focus:ring-1 focus:ring-amber-400/40"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeEditor}
                    disabled={saving}
                    className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                  >
                    {isSpanish ? 'Cancelar' : 'Cancelar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={saving}
                    className="flex items-center gap-1 rounded-lg bg-amber-400 px-2.5 py-1.5 text-[10px] font-bold text-slate-950 hover:bg-amber-300 disabled:cursor-wait disabled:opacity-60"
                  >
                    <Check className="h-3 w-3" />
                    {saving ? (isSpanish ? 'Guardando…' : 'Salvando…') : (isSpanish ? 'Guardar' : 'Salvar')}
                  </button>
                </div>
                {error && <p className="mt-2 text-[10px] font-medium text-rose-300">{error}</p>}
              </div>
            )}

            {!editor && error && (
              <p className="mb-2 rounded-lg border border-rose-500/30 bg-rose-950/30 px-2.5 py-2 text-[10px] font-medium text-rose-300">{error}</p>
            )}

            {quickReplies.length > 0 ? (
              <div className="space-y-1.5">
                {quickReplies.map((reply, index) => (
                  <div key={`${index}-${reply}`} className="group flex items-stretch gap-1 rounded-xl border border-slate-700/80 bg-[#202c33] p-1.5 transition-colors hover:border-slate-600 hover:bg-[#26343c]">
                    <button
                      type="button"
                      onClick={() => handleSelect(reply)}
                      disabled={saving}
                      title={reply}
                      className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left text-xs leading-relaxed text-slate-100 hover:text-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                    >
                      <span className="line-clamp-3 whitespace-pre-wrap">{reply}</span>
                      <span className="mt-1 block text-[9px] font-medium text-amber-400/80">{isSpanish ? 'Usar esta respuesta' : 'Usar esta resposta'}</span>
                    </button>
                    <div className="flex shrink-0 flex-col justify-center gap-1 border-l border-slate-700 pl-1">
                      <button
                        type="button"
                        onClick={() => startEdit(index)}
                        disabled={saving}
                        aria-label={isSpanish ? `Editar respuesta ${index + 1}` : `Editar resposta ${index + 1}`}
                        title={isSpanish ? 'Editar' : 'Editar'}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-700 hover:text-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-400"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(index)}
                        disabled={saving}
                        aria-label={isSpanish ? `Eliminar respuesta ${index + 1}` : `Remover resposta ${index + 1}`}
                        title={isSpanish ? 'Eliminar' : 'Remover'}
                        className="rounded-md p-1.5 text-slate-400 hover:bg-slate-700 hover:text-rose-300 focus:outline-none focus:ring-1 focus:ring-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-700 px-3 py-5 text-center">
                <p className="text-xs font-semibold text-slate-300">{isSpanish ? 'Aún no hay respuestas guardadas.' : 'Ainda não há respostas salvas.'}</p>
                <p className="mt-1 text-[10px] text-slate-500">{isSpanish ? 'Crea la primera para agilizar la atención.' : 'Crie a primeira para agilizar o atendimento.'}</p>
              </div>
            )}
          </div>

          <div className="border-t border-slate-700 bg-[#202c33] p-2">
            <button
              type="button"
              onClick={startCreate}
              disabled={saving}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-[11px] font-bold text-amber-300 transition-colors hover:bg-amber-500/20 disabled:cursor-wait disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {isSpanish ? 'Nueva respuesta rápida' : 'Nova resposta rápida'}
            </button>
            <p className="mt-1.5 text-center text-[9px] text-slate-500">
              {isSpanish ? 'Editar y eliminar afectan a todo el equipo.' : 'Editar e remover afetam toda a equipe.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
