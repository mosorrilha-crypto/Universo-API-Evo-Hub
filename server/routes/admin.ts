import { Router, type RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireRole, isSaasAdmin } from '../middleware/rbac';
import type { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';

interface AdminRouterDeps {
  authenticateToken: RequestHandler;
  supabase: SupabaseClient | null;
}

/**
 * Bloco 2.D.3/2.D.5 — versão real (via API, autenticada com RBAC) do que
 * `scripts/create-tenant.ts`/`scripts/create-operator.ts` fazem por linha de
 * comando. É o que o painel "SaaS Admin" (Cadastrar Novo Cliente/Usuário)
 * vai precisar chamar pra deixar de ser decorativo — essa reconexão do
 * frontend ainda não foi feita, fica pro próximo passo.
 */
export function createAdminRouter({ authenticateToken, supabase }: AdminRouterDeps): Router {
  const router = Router();

  function db() {
    if (!supabase) throw new Error('Supabase não configurado.');
    return supabase;
  }

  // ── Tenants ──────────────────────────────────────────────────────────
  // Só saas_admin cria/lista tenants — são os clientes do SaaS, não algo
  // que um admin de um tenant específico deveria conseguir fazer.
  router.get('/api/admin/tenants', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req, res) => {
    const { data, error } = await db().from('tenants').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ tenants: data });
  }));

  router.post('/api/admin/tenants', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req, res) => {
    const { name, slug, currency, locale, secondaryCurrency, secondaryLocale, phoneNumberId, accessToken, wabaId, mode, segment } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Campo "name" é obrigatório.' });

    const { data: tenant, error: tenantError } = await db()
      .from('tenants')
      .insert({
        name,
        slug: slug || null,
        currency: currency || 'PYG',
        locale: locale || 'es-PY',
        secondary_currency: secondaryCurrency || null,
        secondary_locale: secondaryLocale || null,
        // Camada 2 do prompt do agente (docs/AGENTE-VERTICAL-ARQUITETURA.md
        // seção 1) — default 'beauty_studio' já cobre o único segmento
        // real hoje; passar explícito prepara pro segundo segmento.
        segment: segment || 'beauty_studio',
      })
      .select('*')
      .single();
    if (tenantError || !tenant) return res.status(500).json({ error: tenantError?.message || 'Falha ao criar tenant.' });

    // Credenciais do WhatsApp são opcionais na criação — o admin pode
    // cadastrar o tenant primeiro e voltar depois assim que tiver o
    // phone_number_id/token reais do cliente em mãos.
    if (phoneNumberId && accessToken) {
      const { error: credError } = await db()
        .from('tenant_meta_credentials')
        .insert({ tenant_id: tenant.id, phone_number_id: phoneNumberId, access_token: accessToken, waba_id: wabaId || null, mode: mode || 'shared' });
      if (credError) {
        return res.status(201).json({ tenant, warning: `Tenant criado, mas falha ao gravar credenciais do WhatsApp: ${credError.message}` });
      }
    }

    res.status(201).json({ tenant });
  }));

  // ── Operators ────────────────────────────────────────────────────────
  // admin cria operador só dentro do próprio tenant; saas_admin pode
  // escolher qualquer tenant.
  router.get('/api/admin/operators', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    let query = db().from('operators').select('id, tenant_id, email, name, role, created_at');
    if (!isSaasAdmin(req)) {
      query = query.eq('tenant_id', req.user?.tenantId);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ operators: data });
  }));

  router.post('/api/admin/operators', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { email, password, name, role, tenantId: bodyTenantId } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Campos "email", "password" e "name" são obrigatórios.' });
    }
    const requestedRole = role || 'operator';
    if (!['operator', 'manager', 'admin', 'saas_admin'].includes(requestedRole)) {
      return res.status(400).json({ error: `Role inválida: ${requestedRole}` });
    }
    // Um admin comum só pode criar dentro do próprio tenant, e nunca criar
    // saas_admin (só saas_admin cria saas_admin) — evita escalonamento de
    // privilégio via essa rota.
    const saasAdmin = isSaasAdmin(req);
    if (!saasAdmin && requestedRole === 'saas_admin') {
      return res.status(403).json({ error: 'Só saas_admin pode criar outro saas_admin.' });
    }
    const tenantId = saasAdmin && bodyTenantId ? bodyTenantId : req.user?.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'tenantId ausente.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const { data, error } = await db()
      .from('operators')
      .insert({ tenant_id: tenantId, email, password_hash: passwordHash, name, role: requestedRole })
      .select('id, tenant_id, email, name, role, created_at')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ operator: data });
  }));

  router.delete('/api/admin/operators/:id', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    let query = db().from('operators').delete().eq('id', req.params.id);
    if (!isSaasAdmin(req)) {
      query = query.eq('tenant_id', req.user?.tenantId);
    }
    const { data, error } = await query.select('id');
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.length) return res.status(404).json({ error: 'Operador não encontrado.' });
    res.json({ success: true });
  }));

  return router;
}
