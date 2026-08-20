import React from 'react';
import { Tag, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react';
import { labelColorClasses } from '../../utils/leadDisplay';

export interface LabelCatalogEntry {
  label: string;
  usageCount: number;
}

interface ManageLabelsModalProps {
  isOpen: boolean;
  labels: LabelCatalogEntry[];
  isLoading: boolean;
  onRename: (oldLabel: string, newLabel: string) => Promise<void>;
  onDelete: (label: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Pedido real (20/08/2026): etiqueta não tinha catálogo próprio — só texto
 * solto em cada conversa (ver conversationLabelStore.ts) — então um erro de
 * digitação ou uma etiqueta que deixou de fazer sentido ficava acumulada nas
 * sugestões pra sempre, sem forma de corrigir sem editar conversa por
 * conversa. Renomear/apagar aqui agem em TODAS as conversas do tenant de uma
 * vez (rotas PATCH/DELETE /api/conversation-labels/:label).
 */
export const ManageLabelsModal: React.FC<ManageLabelsModalProps> = ({
  isOpen, labels, isLoading, onRename, onDelete, onClose,
}) => {
  const [editingLabel, setEditingLabel] = React.useState<string | null>(null);
  const [editValue, setEditValue] = React.useState('');
  const [busyLabel, setBusyLabel] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (!isOpen) return null;

  const startEditing = (label: string) => {
    setEditingLabel(label);
    setEditValue(label);
    setError(null);
  };

  const confirmRename = async (oldLabel: string) => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === oldLabel) {
      setEditingLabel(null);
      return;
    }
    setBusyLabel(oldLabel);
    setError(null);
    try {
      await onRename(oldLabel, trimmed);
      setEditingLabel(null);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível renomear essa etiqueta.');
    } finally {
      setBusyLabel(null);
    }
  };

  const confirmDelete = async (label: string) => {
    if (!window.confirm(`Apagar "${label}" de todas as conversas que a usam? Essa ação não pode ser desfeita.`)) return;
    setBusyLabel(label);
    setError(null);
    try {
      await onDelete(label);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível apagar essa etiqueta.');
    } finally {
      setBusyLabel(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Tag className="w-5 h-5 text-emerald-400" />
            Gerenciar etiquetas
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Renomear ou apagar aqui vale pra todas as conversas que usam essa etiqueta, de uma vez só.
        </p>

        {error && (
          <div className="bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-xs text-red-300">{error}</div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : labels.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">Nenhuma etiqueta criada ainda neste tenant.</p>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {labels.map(({ label, usageCount }) => {
              const isEditing = editingLabel === label;
              const isBusy = busyLabel === label;
              return (
                <div
                  key={label}
                  className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
                >
                  {isEditing ? (
                    <>
                      <input
                        type="text"
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmRename(label);
                          if (e.key === 'Escape') setEditingLabel(null);
                        }}
                        className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => confirmRename(label)}
                        disabled={isBusy}
                        className="p-1.5 text-emerald-400 hover:text-emerald-300 rounded-lg cursor-pointer disabled:opacity-50"
                        title="Salvar"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingLabel(null)}
                        className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                        title="Cancelar"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className={`flex-1 min-w-0 truncate text-[11px] px-2 py-0.5 rounded-full border ${labelColorClasses(label)}`}>
                        {label}
                      </span>
                      <span className="text-[10px] text-slate-500 flex-shrink-0">
                        {usageCount} {usageCount === 1 ? 'conversa' : 'conversas'}
                      </span>
                      <button
                        type="button"
                        onClick={() => startEditing(label)}
                        disabled={isBusy}
                        className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer disabled:opacity-50 flex-shrink-0"
                        title="Renomear"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => confirmDelete(label)}
                        disabled={isBusy}
                        className="p-1.5 text-rose-400 hover:text-rose-300 rounded-lg cursor-pointer disabled:opacity-50 flex-shrink-0"
                        title="Apagar de todas as conversas"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
