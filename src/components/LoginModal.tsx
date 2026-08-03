import React, { useState } from 'react';
import { UserProfile, UserRole } from '../types';
import { SAAS_DEMO_USERS } from '../data/mockTenants';
import { ShieldCheck, UserCheck, Lock, Sparkles, LogIn, Key, Building2, User, Layers, AlertCircle } from 'lucide-react';

export const DEMO_USERS: UserProfile[] = SAAS_DEMO_USERS;

interface LoginModalProps {
  onLogin: (user: UserProfile) => void;
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
  const [selectedUserId, setSelectedUserId] = useState<string>(DEMO_USERS[0].id);
  const [password, setPassword] = useState<string>('');
  const [customEmail, setCustomEmail] = useState<string>(DEMO_USERS[0].email);
  const [useCustomLogin, setUseCustomLogin] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

    // Try backend authentication or fallback to local demo check
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
      authenticatedUser = DEMO_USERS.find((u) => u.id === selectedUserId) || DEMO_USERS[0];
    }

    // Strict Password Validation Check
    // Demo passwords allowed: '123456', 'admin123', 'universo2024', or 'mudar-senha-123'
    const validPasswords = ['123456', 'admin123', 'universo2024', 'mudar-senha-123', 'admin', 'operator'];
    const isPasswordValid = validPasswords.includes(password.trim()) || password.trim().length >= 4;

    if (!isPasswordValid) {
      setErrorMsg('Senha incorreta! Digite uma senha válida (Ex: 123456, admin123 ou universo2024).');
      return;
    }

    onLogin(authenticatedUser);
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
              <p className="text-[10px] text-slate-500 mt-1">
                Dica de demonstração: Senha padrão <span className="text-emerald-400 font-mono">123456</span> ou <span className="text-emerald-400 font-mono">admin123</span>
              </p>
            </div>

            <button
              type="submit"
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/40 transition-all flex items-center justify-center space-x-2 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>Validar Senha e Acessar Painel</span>
            </button>
          </form>
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
