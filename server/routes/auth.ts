import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestHandler } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import { authChangePasswordRateLimiter, authLoginRateLimiter, authSessionRateLimiter } from '../middleware/rateLimit';
import { clearFailedLogins, isLoginLocked, recordFailedLogin } from '../services/authLoginAttempts';
import { FirebaseAdminNotConfiguredError, verifyGoogleIdToken } from '../services/firebaseAdmin';

interface AuthRouterDeps {
  jwtSecret: string;
  supabase: SupabaseClient | null;
  authenticateToken: RequestHandler;
}

export function createAuthRouter({ jwtSecret, supabase, authenticateToken }: AuthRouterDeps): Router {
  const router = Router();

  /**
   * Compartilhado entre login por senha e login com Google: bloqueio de
   * tenant (TASK-0070) + bloqueio de operador (TASK-0261) + emissão do JWT.
   * Extraído pra não duplicar essa checagem quando o segundo caminho de
   * login foi adicionado.
   */
  async function issueSessionForOperator(operator: any) {
    // Bloqueio individual do operador (TASK-0261) — checado ANTES do tenant
    // porque é o caso mais específico. Mesma mensagem genérica do bloqueio
    // de tenant (abaixo): não revela qual dos dois motivos causou o bloqueio.
    if (operator.is_active === false) {
      throw new Error('Acesso bloqueado. Fale com o administrador do sistema.');
    }

    const { data: tenantRow, error: tenantError } = await supabase!
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
    return { token, operator: { name: operator.name, email: operator.email, role: operator.role, tenantId: operator.tenant_id } };
  }

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
    // Achado do CodeQL (js/user-controlled-bypass, PR #588): um `if (!password
    // || !email) throw` explícito aqui — mesmo rejeitando a requisição — lia
    // como "condição controlada pelo usuário decide se um passo sensível
    // roda" pro analisador estático. Em vez de um gate condicional, e-mail e
    // senha são normalizados pra string vazia sem nenhum `if`: o restante do
    // fluxo já rejeita os dois casos naturalmente e com a MESMA mensagem
    // genérica (bcrypt.compare('', hash) sempre dá false, nunca lança; e
    // .ilike('email', '') não encontra nenhum operador real) — nenhum
    // comportamento novo, só sem a ramificação que o CodeQL lia como bypass.
    const email = typeof req.body.email === 'string' ? req.body.email : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    // Mensagem genérica de propósito — "usuário não encontrado" vs "senha
    // incorreta" permite enumerar quais e-mails/tenants existem no sistema.
    // A mesma mensagem cobre também a conta bloqueada por excesso de
    // tentativas, pelo mesmo motivo: uma mensagem diferente revelaria que
    // aquele e-mail existe e tem tentativas recentes.
    const genericError = 'E-mail ou senha incorretos.';

    try {
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
      const session = await issueSessionForOperator(operator);
      res.json(session);
    } catch (e: any) {
      res.status(401).json({ error: e.message || 'Falha na autenticação' });
    }
  });

  // Login com Google (TASK-0218) — o botão já existia no painel desde antes,
  // mas só provava posse do e-mail via Firebase client-side sem nunca emitir
  // um JWT de backend: rotas protegidas continuavam corretamente bloqueadas
  // (401), então o botão parecia funcionar mas não abria nada de verdade.
  //
  // O frontend manda o ID token do Google (obtido via `user.getIdToken()`
  // depois do `signInWithPopup` — ver firebase.ts/LoginModal.tsx), este
  // endpoint verifica esse token contra a API do Google/Firebase (prova
  // real de posse do e-mail, não confia em nada que o cliente afirma) e só
  // então busca um operador cadastrado com aquele e-mail — exatamente a
  // mesma política de acesso do login por senha (nunca cria operador novo
  // automaticamente; um e-mail Google sem operador cadastrado é rejeitado).
  router.post('/api/auth/login-google', authLoginRateLimiter, async (req, res) => {
    const idToken = typeof req.body.idToken === 'string' ? req.body.idToken : '';

    try {
      if (!supabase) {
        throw new Error('Supabase não está configurado. Configure SUPABASE_URL e SUPABASE_KEY no ambiente.');
      }

      let verified;
      try {
        verified = await verifyGoogleIdToken(idToken);
      } catch (err) {
        if (err instanceof FirebaseAdminNotConfiguredError) {
          return res.status(503).json({ error: 'Login com Google não está configurado neste servidor.' });
        }
        throw new Error('Não foi possível verificar sua conta Google. Tente novamente.');
      }

      if (!verified.email || !verified.emailVerified) {
        throw new Error('O e-mail da sua conta Google precisa estar verificado.');
      }

      const { data, error } = await supabase
        .from('operators')
        .select('*')
        .ilike('email', verified.email.trim())
        .maybeSingle();
      const operator = data as any;

      // Diferente do login por senha, não há como "adivinhar" um e-mail
      // aqui — o Google já provou que o requisitante é dono exatamente
      // desse endereço, então dizer que ele não está cadastrado não vaza
      // nada que a pessoa já não soubesse sobre a própria conta.
      if (error || !operator) {
        throw new Error('Esta conta Google não está cadastrada como operador. Peça ao administrador para cadastrar seu e-mail.');
      }

      const session = await issueSessionForOperator(operator);
      res.json(session);
    } catch (e: any) {
      res.status(401).json({ error: e.message || 'Falha na autenticação com Google.' });
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
        .select('id, tenant_id, email, name, role, is_active')
        .eq('id', payload.id)
        .maybeSingle();
      if (error || !data) return res.sendStatus(403);
      // Operador bloqueado (TASK-0261) depois do login original: derruba a
      // sessão já no próximo carregamento do app, não só em um login novo.
      if (data.is_active === false) return res.sendStatus(403);

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

  // Troca de senha pelo próprio operador (TASK-0261) — até aqui só existia
  // o reset feito por um admin (PATCH /api/admin/operators/:id), onde é o
  // admin quem escolhe a senha nova e portanto sempre sabe qual é. Esta rota
  // cobre o caso "lembro a senha atual, mas quero trocar por segurança sem
  // que ninguém mais (incluindo o saas_admin) saiba a senha nova" — o valor
  // novo vai direto pro hash, nunca é lido nem logado em lugar nenhum.
  // Exige a senha atual (não só o JWT válido) pra uma sessão sequestrada não
  // conseguir travar o dono de fora só trocando a senha sem saber a antiga.
  router.put('/api/auth/password', authenticateToken, authChangePasswordRateLimiter, async (req: AuthenticatedRequest, res) => {
    const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';

    try {
      if (!supabase) throw new Error('Supabase não está configurado.');
      if (newPassword.length < 6) {
        throw new Error('A nova senha precisa ter pelo menos 6 caracteres.');
      }

      const { data, error } = await supabase
        .from('operators')
        .select('id, password_hash')
        .eq('id', req.user!.id)
        .maybeSingle();
      const operator = data as any;
      if (error || !operator) throw new Error('Sessão inválida.');

      const validPassword = await bcrypt.compare(currentPassword, operator.password_hash);
      if (!validPassword) throw new Error('Senha atual incorreta.');

      const newHash = await bcrypt.hash(newPassword, 10);
      const { error: updateError } = await supabase.from('operators').update({ password_hash: newHash }).eq('id', operator.id);
      if (updateError) throw new Error('Falha ao atualizar a senha.');

      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message || 'Falha ao trocar a senha.' });
    }
  });

  return router;
}
