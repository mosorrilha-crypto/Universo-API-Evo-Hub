import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type { SupabaseClient } from '@supabase/supabase-js';

interface AuthRouterDeps {
  jwtSecret: string;
  demoMode: boolean;
  supabase: SupabaseClient | null;
}

export function createAuthRouter({ jwtSecret, demoMode, supabase }: AuthRouterDeps): Router {
  const router = Router();

  // Config pública — o frontend usa isso pra saber se pode oferecer o login de
  // demonstração (senhas fixas) ou se precisa exigir credenciais reais.
  router.get('/api/public/config', (req, res) => {
    res.json({ demoMode });
  });

  // Emite um JWT válido pra um perfil de demonstração — só funciona com DEMO_MODE=true.
  // Não valida senha (isso já foi feito no frontend com as senhas fixas de demo);
  // existe só para que o modo demo também tenha um Bearer token de verdade pra
  // chamar as rotas protegidas, sem precisar de um operador real no Supabase.
  router.post('/api/auth/demo-token', (req, res) => {
    if (!demoMode) {
      return res.status(403).json({ error: 'Login de demonstração desabilitado (DEMO_MODE=false).' });
    }
    const { id, tenantId, role, email } = req.body || {};
    if (!id || !tenantId || !role) {
      return res.status(400).json({ error: 'id, tenantId e role são obrigatórios.' });
    }
    const token = jwt.sign({ id, tenantId, role, email, demo: true }, jwtSecret, { expiresIn: '24h' });
    res.json({ token });
  });

  // Rota de Login de Operadores e Administradores com verificação de senha
  router.post('/api/auth/login', async (req, res) => {
    const { tenantId, email, password } = req.body;

    try {
      if (!password || password.trim() === '') {
        throw new Error('A senha é obrigatória.');
      }

      if (!supabase) {
        throw new Error('Supabase não está configurado. Configure SUPABASE_URL e SUPABASE_KEY no ambiente.');
      }

      const { data, error } = await supabase
        .from('operators')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('email', email)
        .single();

      const operator = data as any;

      if (error || !operator) throw new Error('Usuário não encontrado');

      const validPassword = await bcrypt.compare(password, operator.password_hash);
      if (!validPassword) throw new Error('Senha incorreta.');

      const token = jwt.sign(
        { id: operator.id, tenantId: operator.tenant_id, role: operator.role },
        jwtSecret,
        { expiresIn: '24h' }
      );

      res.json({ token, operator: { name: operator.name, email: operator.email, role: operator.role } });
    } catch (e: any) {
      res.status(401).json({ error: e.message || 'Falha na autenticação' });
    }
  });

  return router;
}
