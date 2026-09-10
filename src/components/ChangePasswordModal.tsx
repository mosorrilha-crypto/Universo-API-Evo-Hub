import React, { useState } from 'react';
import { KeyRound, Lock, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Troca de senha pelo próprio operador (TASK-0261) — diferente do reset feito
 * por um admin (PATCH /api/admin/operators/:id), aqui a senha nova nunca
 * passa por nenhuma tela de admin: vai direto pro backend, que só grava o
 * hash. Nem o saas_admin fica sabendo qual é a senha nova.
 */
export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, onClose }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const resetAndClose = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setErrorMsg(null);
    setSuccessMsg(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (newPassword.length < 6) {
      setErrorMsg('A nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('A confirmação não bate com a nova senha.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao trocar a senha.');
      setSuccessMsg('Senha alterada com sucesso.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao trocar a senha.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-900 p-6 border-b border-slate-800 relative">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Trocar minha senha</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                A senha nova fica só com você — ninguém mais tem acesso a ela.
              </p>
            </div>
          </div>
          <button type="button" onClick={resetAndClose} className="absolute right-4 top-4 text-slate-500 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-200 text-xs flex items-center gap-2.5 animate-shake">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-3 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-emerald-200 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Senha atual</label>
            <div className="relative">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => { setCurrentPassword(e.target.value); setErrorMsg(null); }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 pl-9"
                autoComplete="current-password"
                autoFocus
              />
              <Lock className="w-4 h-4 text-emerald-400 absolute left-3 top-3" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Nova senha</label>
            <div className="relative">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setErrorMsg(null); }}
                placeholder="Mínimo 6 caracteres"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 pl-9"
                autoComplete="new-password"
              />
              <Lock className="w-4 h-4 text-emerald-400 absolute left-3 top-3" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Confirmar nova senha</label>
            <div className="relative">
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setErrorMsg(null); }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 pl-9"
                autoComplete="new-password"
              />
              <Lock className="w-4 h-4 text-emerald-400 absolute left-3 top-3" />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/40 transition-all flex items-center justify-center space-x-2 cursor-pointer"
          >
            <KeyRound className="w-4 h-4" />
            <span>{isSubmitting ? 'Salvando...' : 'Salvar nova senha'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
