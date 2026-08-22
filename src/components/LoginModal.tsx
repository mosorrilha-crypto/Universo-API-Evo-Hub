import React, { useState } from 'react';
import { UserProfile } from '../types';
import { ShieldCheck, Lock, LogIn, User, AlertCircle } from 'lucide-react';
import { loginWithGoogle } from '../lib/firebase';
import { apiFetch } from '../lib/apiClient';

interface LoginModalProps {
  onLogin: (user: UserProfile, token?: string) => void;
  isOpen: boolean;
  onClose?: () => void;
  isForcedLogin?: boolean;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  onLogin,
  isOpen,
  onClose,
  isForcedLogin = false,
}) => {
  const [password, setPassword] = useState<string>('');
  const [customEmail, setCustomEmail] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!password || password.trim().length === 0) {
      setErrorMsg('Por favor, informe a sua senha de acesso.');
      return;
    }
    if (!customEmail || !customEmail.trim()) {
      setErrorMsg('Por favor, informe o seu e-mail de acesso.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Busca só por e-mail — o backend nunca aceita um tenantId sugerido pelo
      // cliente, sempre devolve o tenant real do operador encontrado (ver
      // server/routes/auth.ts).
      const email = customEmail.trim();
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha na autenticação');
      }
      const authenticatedUser: UserProfile = {
        id: data.operator.email,
        tenantId: data.operator.tenantId,
        name: data.operator.name,
        email: data.operator.email,
        role: data.operator.role,
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
        department: 'Operador',
      };
      onLogin(authenticatedUser, data.token);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao fazer login.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-900 p-6 border-b border-slate-800 relative">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Acesso Seguro à Plataforma
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  Autenticação v2.0
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Digite o e-mail e a senha do operador cadastrado para prosseguir
              </p>
            </div>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-5">

          {/* Error Message Alert */}
          {errorMsg && (
            <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-200 text-xs flex items-center gap-2.5 animate-shake">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              1. Digite o seu E-mail:
            </label>
            <div className="relative">
              <input
                type="email"
                value={customEmail}
                onChange={(e) => {
                  setCustomEmail(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="seu-email@exemplo.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 pl-9"
                autoFocus
                autoComplete="username"
              />
              <User className="w-4 h-4 text-emerald-400 absolute left-3 top-3" />
            </div>
          </div>

          {/* Password Form */}
          <form onSubmit={handleSubmit} className="space-y-4 pt-2 border-t border-slate-800">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                2. Digite a Senha do Operador:
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMsg(null);
                  }}
                  placeholder="Digite sua senha"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 pl-9"
                  autoComplete="current-password"
                />
                <Lock className="w-4 h-4 text-emerald-400 absolute left-3 top-3" />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/40 transition-all flex items-center justify-center space-x-2 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>{isSubmitting ? 'Verificando...' : 'Validar Senha e Acessar Painel'}</span>
            </button>
          </form>

          {/* Alternative Google / Firebase Login — ainda não emite um Bearer
              token de backend (ver PARTE 1 do card "[AUTH] Login real com
              Google" no Trello, bloqueada por falta de credencial do Firebase
              Admin). Rotas protegidas continuam corretamente bloqueadas (401)
              até esse login virar um JWT de verdade. */}
          <div className="pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={async () => {
                setErrorMsg(null);
                try {
                  const googleUser = await loginWithGoogle();
                  const authenticatedUser: UserProfile = {
                    id: googleUser.uid,
                    name: googleUser.displayName || googleUser.email?.split('@')[0] || 'Usuário Google',
                    email: googleUser.email || '',
                    // Nunca 'admin' automático: login Google (Firebase) prova só que a
                    // pessoa é dona daquele e-mail, não que ela é um operador
                    // autorizado deste sistema — antes, qualquer conta Google virava
                    // admin sem checagem nenhuma. Sem mapeamento real Google→Supabase,
                    // o papel mais seguro por padrão é o de menor privilégio.
                    role: 'operator',
                    avatar: googleUser.photoURL || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
                    department: 'Autenticação Firebase (sem operador cadastrado)',
                    tenantId: 'tenant_004',
                  };
                  // Login Google não emite Bearer token de backend: não temos como
                  // provar que esse e-mail corresponde a um operador real do
                  // Supabase, então as rotas protegidas continuam corretamente
                  // bloqueadas (401) até haver um login de verdade (senha real do
                  // operador cadastrado).
                  onLogin(authenticatedUser, undefined);
                } catch (err: any) {
                  setErrorMsg(`Erro ao autenticar via Google: ${err.message || 'Falha no login'}`);
                }
              }}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded-xl flex items-center justify-center space-x-2 border border-slate-700 transition-all cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.2 9 5 12 5z" />
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z" />
                <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z" />
                <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.2-6.4-5.2L1.9 16C3.7 19.7 7.5 22.3 12 23z" />
              </svg>
              <span>Autenticar com Conta do Google (Firebase)</span>
            </button>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-950 px-6 py-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <Lock className="w-3 h-3 text-emerald-400" /> Autenticação Segura de Usuário
          </span>
          {!isForcedLogin && onClose && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white underline cursor-pointer"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
