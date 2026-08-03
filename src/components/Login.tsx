import React, { useState } from 'react';
import { Operator } from '../types';
import { Lock, Mail, Building, ArrowRight, Shield } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (operator: Operator, token: string) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [tenantId, setTenantId] = useState('main-tenant');
  const [email, setEmail] = useState('admin@seu-saas.com');
  const [password, setPassword] = useState('mudar-senha-123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, email, password })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Falha na autenticação');
      }

      onLoginSuccess(data.operator, data.token);
    } catch (err: any) {
      setError(err.message || 'Erro ao fazer login');
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

        {error && (
          <div className="bg-rose-950/50 border border-rose-800 text-rose-300 text-xs p-3 rounded-xl">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
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

          <div>
            <label className="block text-slate-400 font-semibold mb-1">E-mail</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl pl-9 pr-3 py-2.5 font-mono"
              />
            </div>
          </div>

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

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 text-white font-bold rounded-xl flex items-center justify-center space-x-2 shadow-lg transition-all"
          >
            <span>{loading ? 'Entrando...' : 'Entrar no Sistema'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="text-center pt-2 border-t border-slate-800 text-[11px] text-slate-500">
          Dica: Acesse <code className="text-purple-400">/api/setup-admin</code> para inicializar o admin padrão.
        </div>
      </div>
    </div>
  );
};
