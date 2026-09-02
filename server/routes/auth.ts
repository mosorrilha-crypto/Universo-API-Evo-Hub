import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authLoginRateLimiter, authSessionRateLimiter } from '../middleware/rateLimit';
import { clearFailedLogins, isLoginLocked, recordFailedLogin } from '../services/authLoginAttempts';

interface AuthRouterDeps {
  jwtSecret: string;
  supabase: SupabaseClient | null;
}

export function createAuthRouter({ jwtSecret, supabase }: AuthRouterDeps): Router {
  const router = Router();

  // Rota de Login de Operadores e Administradores com verificação de senha
  //
  // Busca só por e-mail (case-insensitive) — NUNCA filtra por tenant_id vindo
  // do cliente. Antes desta correção, o frontend mandava o tenantId de mock
  // do card de preset demo selecionado (ex: "tenant_004", de
  // src/data/mockTenants.ts), que nunca bate com o tenant_id real (UUID) de
  // nenhum operador de verdade no Supabase — todo login real falhava com
  // "E-mail ou senha incorretos" mesmo com a senha certa, porque a query
  // .eq('tenant_id', 'tenant_004') nunca encontrava a linha. O tenant certo
  // é sempre derivado do próprio registro do operador encontrado, nunca
  // adivinhado a priori por quem está logando.
  router.post('/api/auth/login', authLoginRateLimiter, async (req, res) => {
    const { email, password } = req.body;

    // Mensagem genérica de propósito — "usuário não encontrado" vs "senha
    // incorreta" permite enumerar quais e-mails/tenants existem no sistema.
    // A mesma mensagem cobre também a conta bloqueada por excesso de
    // tentativas, pelo mesmo motivo: uma mensagem diferente revelaria que
    // aquele e-mail existe e tem tentativas recentes.
    const genericError = 'E-mail ou senha incorretos.';

    try {
      // Validação de formato (campo ausente/vazio) — nunca acessa o banco
      // nem compara senha, então não é um "bypass" de verdade: com ou sem
      // essa checagem o pedido termina rejeitado. Unificada na MESMA
      // genericError (não mais duas mensagens específicas) pra fechar de
      // vez a diferenciação "faltou senha" vs "faltou e-mail" vs "senha
      // errada" — todas indistinguíveis pra quem está tentando adivinhar.
      // codeql[js/user-controlled-bypass]: e-mail/senha vêm do próprio
      // corpo da requisição por definição (é o que a rota de login lê) —
      // a checagem de formato não decide autenticação nenhuma, só evita
      // gastar bcrypt.compare/consulta ao banco com um campo vazio.
      if (!password || password.trim() === '' || !email || String(email).trim() === '') {
        throw new Error(genericError);
      }

      if (!supabase) {
        throw new Error('Supabase não está configurado. Configure SUPABASE_URL e SUPABASE_KEY no ambiente.');
      }

      // Achado de segurança (02/09/2026): sem isso, um atacante com muitos
      // IPs (ou nenhum limite de IP relevante) tinha tentativas ilimitadas
      // contra UMA conta específica. Verificado ANTES da consulta ao banco
      // e da comparação de senha — a conta trancada nem chega a gastar um
      // bcrypt.compare (mais barato pro servidor, e o atacante não aprende
      // nada sobre o timing de uma senha "quase certa").
      if (isLoginLocked(String(email))) {
        throw new Error(genericError);
      }

      const { data, error } = await supabase
        .from('operators')
        .select('*')
        .ilike('email', String(email).trim())
        .maybeSingle();

      const operator = data as any;

      if (error || !operator) throw new Error(genericError);

      const validPassword = await bcrypt.compare(password, operator.password_hash);
      if (!validPassword) {
        recordFailedLogin(String(email));
        throw new Error(genericError);
      }
      clearFailedLogins(String(email));

      // Bloqueio de acesso do tenant (TASK-0070, tenants.is_active) — checado
      // só DEPOIS da senha validar, pra não virar um jeito de descobrir se um
      // tenant está bloqueado sem saber a senha de ninguém dele. Mensagem
      // diferente de propósito aqui (não é genericError): quem já tem senha
      // certa precisa saber que o problema é bloqueio, não credencial errada.
      const { data: tenantRow, error: tenantError } = await supabase
        .from('tenants')
        .select('is_active')
        .eq('id', operator.tenant_id)
        .maybeSingle();
      if (tenantError) throw new Error('Falha ao verificar o status do tenant.');
      if (tenantRow && tenantRow.is_active === false) {
        throw new Error('Acesso bloqueado. Fale com o administrador do sistema.');
      }

      const token = jwt.sign(
        { id: operator.id, tenantId: operator.tenant_id, role: operator.role },
        jwtSecret,
        { expiresIn: '24h' }
      );

      res.json({ token, operator: { name: operator.name, email: operator.email, role: operator.role, tenantId: operator.tenant_id } });
    } catch (e: any) {
      res.status(401).json({ error: e.message || 'Falha na autenticação' });
    }
  });

  // A UI pode ter um perfil antigo salvo no navegador, mas ele nunca é
  // autoridade para liberar a administração SaaS. Esta rota valida o JWT e
  // relê o registro atual do operador, garantindo que uma alteração de papel
  // no banco tenha efeito logo no próximo carregamento do aplicativo.
  router.get('/api/auth/session', authSessionRateLimiter, async (req, res) => {
    try {
      if (!supabase) throw new Error('Serviço de autenticação indisponível.');
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token) return res.sendStatus(401);

      const payload = jwt.verify(token, jwtSecret) as { id?: string };
      if (!payload.id) return res.sendStatus(403);

      const { data, error } = await supabase
        .from('operators')
        .select('id, tenant_id, email, name, role')
        .eq('id', payload.id)
        .maybeSingle();
      if (error || !data) return res.sendStatus(403);

      res.json({
        operator: {
          id: data.id,
          tenantId: data.tenant_id,
          email: data.email,
          name: data.name,
          role: data.role,
        },
      });
    } catch {
      return res.sendStatus(403);
    }
  });

  return router;
}
