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

  // Cadastro fixo dos 4 perfis de demonstração — espelha exatamente
  // src/data/mockTenants.ts (SAAS_DEMO_USERS) e as senhas de
  // src/components/LoginModal.tsx (USER_PASSWORDS). Precisa ficar em sincronia
  // manual com esses dois arquivos caso os perfis demo mudem.
  //
  // Antes desta correção, o endpoint confiava cegamente em id/tenantId/role
  // vindos do corpo da requisição — qualquer um podia POST
  // {"id":"x","tenantId":"y","role":"saas_admin"} e ganhar um JWT de admin,
  // sem senha nenhuma. Agora role/tenantId/email vêm SEMPRE do cadastro fixo
  // abaixo, nunca do que o cliente mandou, e a senha é obrigatória.
  const DEMO_USERS: Record<string, { passwords: string[]; tenantId: string; role: string; email: string }> = {
    usr_monique: { passwords: ['monique2026', 'admin123', '123456'], tenantId: 'tenant_004', role: 'admin', email: 'monique@pestanaspormonique.com' },
    usr_carlos: { passwords: ['viva1234', '123456'], tenantId: 'tenant_001', role: 'operator', email: 'carlos@drogariaviva.com.br' },
    usr_fernanda: { passwords: ['meta2026', '123456'], tenantId: 'tenant_002', role: 'manager', email: 'fernanda@metaleads.com.br' },
    usr_ricardo: { passwords: ['master2026#', 'adminMaster123'], tenantId: 'tenant_001', role: 'saas_admin', email: 'ricardo.master@saasplatform.com' },
  };

  // Emite um JWT válido pra um perfil de demonstração — só funciona com
  // DEMO_MODE=true. Valida a senha contra o cadastro fixo acima (nunca
  // confia em role/tenantId/email vindos do cliente).
  router.post('/api/auth/demo-token', (req, res) => {
    if (!demoMode) {
      return res.status(403).json({ error: 'Login de demonstração desabilitado (DEMO_MODE=false).' });
    }
    const { id, password } = req.body || {};
    const user = DEMO_USERS[id];
    if (!user || typeof password !== 'string' || !user.passwords.includes(password)) {
      // Mensagem genérica de propósito — não revela se o id existe ou só a senha está errada.
      return res.status(401).json({ error: 'Credenciais de demonstração inválidas.' });
    }
    const token = jwt.sign({ id, tenantId: user.tenantId, role: user.role, email: user.email, demo: true }, jwtSecret, { expiresIn: '24h' });
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

      // Mensagem genérica de propósito — "usuário não encontrado" vs "senha
      // incorreta" permite enumerar quais e-mails/tenants existem no sistema.
      const genericError = 'E-mail ou senha incorretos.';
      if (error || !operator) throw new Error(genericError);

      const validPassword = await bcrypt.compare(password, operator.password_hash);
      if (!validPassword) throw new Error(genericError);

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
