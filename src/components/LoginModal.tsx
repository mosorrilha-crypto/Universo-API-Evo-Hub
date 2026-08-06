import React, { useState, useEffect } from 'react';
import { UserProfile, UserRole } from '../types';
import { SAAS_DEMO_USERS } from '../data/mockTenants';
import { ShieldCheck, UserCheck, Lock, Sparkles, LogIn, Key, Building2, User, Layers, AlertCircle, Flame } from 'lucide-react';
import { loginWithGoogle } from '../lib/firebase';
import { apiFetch } from '../lib/apiClient';

export const DEMO_USERS: UserProfile[] = SAAS_DEMO_USERS;

interface LoginModalProps {
  onLogin: (user: UserProfile, token?: string) => void;
  isOpen: boolean;
  onClose?: () => void;
  isForcedLogin?: boolean;
}

// Emite um Bearer token de verdade pro perfil (só funciona quando o backend
// está em DEMO_MODE=true). O servidor valida a senha contra o cadastro fixo
// dele mesmo (server/routes/auth.ts) — role/tenantId/email vêm de lá, nunca
// do que mandamos aqui, então não adianta chamar isso com um id qualquer.
//
// Tenta de novo uma vez em caso de falha de rede (ex: 4G instável no
// celular) antes de desistir — sem isso, uma única soneca de conexão fazia
// o login "dar certo" na tela mas sem token nenhum, e todo o resto do painel
// quebrava em silêncio (401 em tudo) sem o usuário entender por quê.
const mintDemoToken = async (id: string, password: string): Promise<string | undefined> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await apiFetch('/api/auth/demo-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password }),
      });
      if (!res.ok) return undefined; // credenciais inválidas — não adianta tentar de novo
      const data = await res.json();
      if (data.token) return data.token;
    } catch {
      // provável falha de rede — tenta mais uma vez antes de desistir
    }
  }
  return undefined;
};

export const LoginModal: React.FC<LoginModalProps> = ({
  onLogin,
  isOpen,
  onClose,
  isForcedLogin = false,
}) => {
  const [selectedUserId, setSelectedUserId] = useState<string>(DEMO_USERS[0].id);
  const [password, setPassword] = useState<string>('');
  const [customEmail, setCustomEmail] = useState<string>(DEMO_USERS[0].email);
  const [useCustomLogin, setUseCustomLogin] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  // Assume true (comportamento atual) até a config real chegar do backend, pra
  // não travar a tela de login por causa de uma requisição lenta/falha.
  const [demoMode, setDemoMode] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/public/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.demoMode === 'boolean') {
          setDemoMode(data.demoMode);
        }
      })
      .catch(() => {
        // Mantém o valor otimista em caso de falha de rede.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isOpen) return null;

  const handleSelectUser = (user: UserProfile) => {
    setUseCustomLogin(false);
    setSelectedUserId(user.id);
    setCustomEmail(user.email);
    setPassword('');
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!password || password.trim().length === 0) {
      setErrorMsg('Por favor, informe a sua senha de acesso.');
      return;
    }

    const presetUser = useCustomLogin ? null : (DEMO_USERS.find((u) => u.id === selectedUserId) || DEMO_USERS[0]);

    // Fora do modo demo, as senhas fixas abaixo não valem nada — a validação
    // é sempre feita de verdade contra o backend/Supabase.
    if (!demoMode) {
      setIsSubmitting(true);
      try {
        const tenantId = presetUser?.tenantId || 'main-tenant';
        const email = useCustomLogin ? customEmail : presetUser!.email;
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Falha na autenticação');
        }
        const authenticatedUser: UserProfile = {
          id: data.operator.email,
          tenantId,
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
      return;
    }

    // --- Modo demo (DEMO_MODE=true no backend) ---
    let authenticatedUser: UserProfile | null = null;

    if (useCustomLogin && customEmail) {
      const foundDemo = DEMO_USERS.find((u) => u.email.toLowerCase() === customEmail.toLowerCase());
      if (foundDemo) {
        authenticatedUser = foundDemo;
      } else {
        authenticatedUser = {
          id: `usr_${Date.now()}`,
          name: customEmail.split('@')[0].toUpperCase(),
          email: customEmail,
          role: 'operator',
          avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
          department: 'Atendimento Geral',
          tenantId: 'tenant-1',
        };
      }
    } else {
      authenticatedUser = presetUser;
    }

    // Per-user password mapping for Demo / Production Preset Profiles
    const USER_PASSWORDS: Record<string, string[]> = {
      usr_monique: ['monique2026', 'admin123', '123456'],
      usr_carlos: ['viva1234', '123456'],
      usr_fernanda: ['meta2026', '123456'],
      usr_ricardo: ['master2026#', 'adminMaster123'], // Enforce strict password for SaaS Master Admin
    };

    let isPasswordValid = false;

    if (useCustomLogin && customEmail) {
      // General custom password check
      const validPasswords = ['123456', 'admin123', 'universo2024', 'mudar-senha-123', 'monique2026', 'master2026#'];
      isPasswordValid = validPasswords.includes(password.trim());
    } else if (authenticatedUser) {
      const allowedForUser = USER_PASSWORDS[authenticatedUser.id] || ['123456', 'admin123'];
      isPasswordValid = allowedForUser.includes(password.trim());
    }

    if (!isPasswordValid) {
      const hint = authenticatedUser?.role === 'saas_admin'
        ? 'Dica: A senha do SaaS Master Admin é "master2026#".'
        : 'Verifique a senha informada para este usuário.';
      setErrorMsg(`Senha incorreta! Acesso negado. ${hint}`);
      return;
    }

    setIsSubmitting(true);
    const token = await mintDemoToken(authenticatedUser.id, password.trim());
    setIsSubmitting(false);

    if (!token) {
      setErrorMsg('Não foi possível confirmar sua sessão com o servidor (verifique sua conexão e tente novamente). O painel não vai funcionar direito sem isso.');
      return;
    }

    onLogin(authenticatedUser, token);
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'saas_admin':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800">SaaS Master Admin</span>;
      case 'admin':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800/80">Administrador / CFO</span>;
      case 'manager':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800/80">Gerente Comercial</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/80">Operador de Vendas</span>;
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
                Digite a senha do usuário cadastrado para prosseguir
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

          {/* User Select Preset Cards */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              1. Selecione o Usuário / Operador:
            </label>
            <div className="grid grid-cols-1 gap-2">
              {DEMO_USERS.map((usr) => {
                const isSelected = !useCustomLogin && selectedUserId === usr.id;
                return (
                  <button
                    key={usr.id}
                    type="button"
                    onClick={() => handleSelectUser(usr)}
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all text-left cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-950/50 border-emerald-500 text-white shadow-lg ring-1 ring-emerald-500/50'
                        : 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <img
                        src={usr.avatar}
                        alt={usr.name}
                        className="w-9 h-9 rounded-full object-cover border border-slate-700"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-white">{usr.name}</span>
                          {getRoleBadge(usr.role)}
                        </div>
                        <p className="text-[11px] text-slate-400">{usr.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center">
                      <UserCheck className={`w-4 h-4 ${isSelected ? 'text-emerald-400' : 'text-slate-600'}`} />
                    </div>
                  </button>
                );
              })}
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
                  placeholder="Ex: 123456 ou admin123"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500 pl-9"
                  autoFocus
                />
                <Lock className="w-4 h-4 text-emerald-400 absolute left-3 top-3" />
              </div>
              {demoMode ? (
                <p className="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                  <span>
                    Senha do perfil selecionado:{' '}
                    <span className="text-emerald-400 font-mono font-bold">
                      {selectedUserId === 'usr_ricardo'
                        ? 'master2026#'
                        : selectedUserId === 'usr_monique'
                        ? 'monique2026'
                        : selectedUserId === 'usr_fernanda'
                        ? 'meta2026'
                        : 'viva1234'}
                    </span>
                  </span>
                  <span className="text-slate-500">Validação Estreita v2.0</span>
                </p>
              ) : (
                <p className="text-[10px] text-amber-400 mt-1">
                  Modo de demonstração desativado neste ambiente — informe a senha real do operador.
                </p>
              )}
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

          {/* Alternative Google / Firebase Login */}
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
                  // provar que esse e-mail corresponde a um dos 4 perfis fixos de
                  // demo (nem a um operador real do Supabase), então as rotas
                  // protegidas continuam corretamente bloqueadas (401) até haver um
                  // login de verdade (senha demo ou operador real cadastrado).
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
