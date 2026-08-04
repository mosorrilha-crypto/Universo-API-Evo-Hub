import React, { useState } from 'react';
import { Operator } from '../types';
import { Lock, Mail, Building, ArrowRight, Shield, UserPlus, KeyRound, Flame } from 'lucide-react';
import {
  loginWithEmailPassword,
  registerWithEmailPassword,
  loginWithGoogle,
  resetUserPassword
} from '../lib/firebase';

interface LoginProps {
  onLoginSuccess: (operator: Operator, token: string) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [authMethod, setAuthMethod] = useState<'firebase' | 'server'>('firebase');
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');

  const [tenantId, setTenantId] = useState('main-tenant');
  const [email, setEmail] = useState('admin@seu-saas.com');
  const [password, setPassword] = useState('mudar-senha-123');
  const [name, setName] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleFirebaseLogin = async () => {
    try {
      const user = await loginWithEmailPassword(email, password);
      const token = await user.getIdToken();
      const operator: Operator = {
        name: user.displayName || user.email?.split('@')[0] || 'Operador',
        email: user.email || email,
        role: 'admin',
        tenantId: tenantId || 'main-tenant'
      };
      onLoginSuccess(operator, token);
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found') {
        throw new Error('Credenciais inválidas ou usuário não encontrado no Firebase Auth.');
      }
      throw new Error(err.message || 'Erro ao autenticar no Firebase');
    }
  };

  const handleFirebaseRegister = async () => {
    try {
      const user = await registerWithEmailPassword(email, password, name);
      const token = await user.getIdToken();
      setSuccessMsg('Conta criada com sucesso no Firebase Auth!');
      const operator: Operator = {
        name: name || user.displayName || email.split('@')[0],
        email: user.email || email,
        role: 'operator',
        tenantId: tenantId || 'main-tenant'
      };
      setTimeout(() => {
        onLoginSuccess(operator, token);
      }, 1000);
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        throw new Error('Este e-mail já está em uso no Firebase Auth.');
      } else if (err.code === 'auth/weak-password') {
        throw new Error('A senha deve conter no mínimo 6 caracteres.');
      }
      throw new Error(err.message || 'Erro ao registrar usuário no Firebase');
    }
  };

  const handleFirebaseGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      const user = await loginWithGoogle();
      const token = await user.getIdToken();
      const operator: Operator = {
        name: user.displayName || user.email?.split('@')[0] || 'Usuário Google',
        email: user.email || '',
        role: 'admin',
        tenantId: tenantId || 'main-tenant'
      };
      onLoginSuccess(operator, token);
    } catch (err: any) {
      setError(err.message || 'Erro no login com Google');
    } finally {
      setLoading(false);
    }
  };

  const handleFirebaseForgot = async () => {
    if (!email) {
      throw new Error('Informe o seu e-mail para redefinição.');
    }
    await resetUserPassword(email);
    setSuccessMsg(`E-mail de redefinição enviado para ${email}. Verifique sua caixa de entrada.`);
  };

  const handleServerLogin = async () => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Falha na autenticação do servidor');
    }

    onLoginSuccess(data.operator, data.token);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      if (authMethod === 'server') {
        await handleServerLogin();
      } else {
        if (mode === 'login') {
          await handleFirebaseLogin();
        } else if (mode === 'register') {
          await handleFirebaseRegister();
        } else if (mode === 'forgot') {
          await handleFirebaseForgot();
        }
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao processar requisição');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 bg-purple-600/20 border border-purple-500/30 rounded-2xl mx-auto flex items-center justify-center text-purple-400">
            <Shield className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-white">WhatsSaaS Pro / Evo Hub</h2>
          <p className="text-xs text-slate-400">Faça login com suas credenciais de operador ou admin</p>
        </div>

        {/* Method selector */}
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setAuthMethod('firebase');
              setError(null);
              setSuccessMsg(null);
            }}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
              authMethod === 'firebase'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            <span>Firebase Auth</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMethod('server');
              setMode('login');
              setError(null);
              setSuccessMsg(null);
            }}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
              authMethod === 'server'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building className="w-3.5 h-3.5 text-cyan-400" />
            <span>Servidor / Tenant</span>
          </button>
        </div>

        {error && (
          <div className="bg-rose-950/50 border border-rose-800 text-rose-300 text-xs p-3 rounded-xl animate-fade-in">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-950/50 border border-emerald-800 text-emerald-300 text-xs p-3 rounded-xl animate-fade-in">
            {successMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {authMethod === 'server' && (
            <div>
              <label className="block text-slate-400 font-semibold mb-1">Tenant ID</label>
              <div className="relative">
                <Building className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl pl-9 pr-3 py-2.5 font-mono"
                />
              </div>
            </div>
          )}

          {authMethod === 'firebase' && mode === 'register' && (
            <div>
              <label className="block text-slate-400 font-semibold mb-1">Nome Completo</label>
              <div className="relative">
                <UserPlus className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Carlos Silva"
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl pl-9 pr-3 py-2.5"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-slate-400 font-semibold mb-1">E-mail</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl pl-9 pr-3 py-2.5 font-mono"
              />
            </div>
          </div>

          {mode !== 'forgot' && (
            <div>
              <label className="block text-slate-400 font-semibold mb-1">Senha</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl pl-9 pr-3 py-2.5 font-mono"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 text-white font-bold rounded-xl flex items-center justify-center space-x-2 shadow-lg transition-all cursor-pointer"
          >
            <span>
              {loading
                ? 'Processando...'
                : mode === 'login'
                ? 'Entrar no Sistema'
                : mode === 'register'
                ? 'Criar Minha Conta'
                : 'Recuperar Senha'}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {authMethod === 'firebase' && (
          <div className="space-y-3 pt-2 border-t border-slate-800 text-xs">
            <button
              type="button"
              onClick={handleFirebaseGoogle}
              disabled={loading}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl flex items-center justify-center space-x-2 border border-slate-700 transition-all cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#EA4335"
                  d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.2 9 5 12 5z"
                />
                <path
                  fill="#4285F4"
                  d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.2-6.4-5.2L1.9 16C3.7 19.7 7.5 22.3 12 23z"
                />
              </svg>
              <span>Entrar com Conta do Google</span>
            </button>

            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
              {mode === 'login' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                      setSuccessMsg(null);
                    }}
                    className="text-purple-400 hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <UserPlus className="w-3 h-3 inline" />
                    <span>Criar nova conta</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setError(null);
                      setSuccessMsg(null);
                    }}
                    className="text-slate-400 hover:text-slate-200 hover:underline flex items-center space-x-1 cursor-pointer"
                  >
                    <KeyRound className="w-3 h-3 inline" />
                    <span>Esqueceu a senha?</span>
                  </button>
                </>
              )}

              {(mode === 'register' || mode === 'forgot') && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setSuccessMsg(null);
                  }}
                  className="text-purple-400 hover:underline mx-auto font-semibold cursor-pointer"
                >
                  Voltar para Tela de Login
                </button>
              )}
            </div>
          </div>
        )}

        <div className="text-center pt-2 border-t border-slate-800 text-[11px] text-slate-500">
          Dica: Acesse <code className="text-purple-400">/api/setup-db</code> para inicializar o ambiente de teste.
        </div>
      </div>
    </div>
  );
};
