import { Router, type RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireRole, isSaasAdmin } from '../middleware/rbac';
import type { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { setEvolutionWebhook } from '../services/evolutionSend';

interface AdminRouterDeps {
  authenticateToken: RequestHandler;
  supabase: SupabaseClient | null;
  /** Credencial "admin" da Evolution API (servidor self-hosted) usada só pra provisionar instância nova — depois de criada, cada instância tem sua própria linha em tenant_evolution_credentials (Epic 4.6). */
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  /** URL pública deste backend — usada pra registrar o webhook da instância recém-criada apontando de volta pra cá (ver setEvolutionWebhook). */
  publicBaseUrl: string;
}

/**
 * Bloco 2.D.3/2.D.5 — versão real (via API, autenticada com RBAC) do que
 * `scripts/create-tenant.ts`/`scripts/create-operator.ts` fazem por linha de
 * comando. É o que o painel "SaaS Admin" (Cadastrar Novo Cliente/Usuário)
 * vai precisar chamar pra deixar de ser decorativo — essa reconexão do
 * frontend ainda não foi feita, fica pro próximo passo.
 */
export function createAdminRouter({ authenticateToken, supabase, evolutionApiUrl, evolutionApiKey, publicBaseUrl }: AdminRouterDeps): Router {
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

  /**
   * Reconecta uma instância Evolution já existente: busca um QR Code novo e
   * reafirma o webhook (corrige de graça instâncias criadas antes da
   * correção do webhook, sem precisar desconectar/reconectar o número).
   * Compartilhado entre a rota GET .../qrcode e o atalho idempotente da
   * rota POST .../evolution-instance abaixo (achado real em produção,
   * 12/08/2026: clicar em "Gerar QR Code" pra um tenant que já tem instância
   * tentava CRIAR outra, e quebrava com "duplicate key" no unique constraint
   * de tenant_evolution_credentials — deixando pra trás uma instância órfã
   * na Evolution API).
   */
  async function reconnectExistingInstance(cred: { instance_name: string; api_url: string; api_key: string }) {
    const connectRes = await fetch(`${cred.api_url.replace(/\/$/, '')}/instance/connect/${cred.instance_name}`, {
      headers: { apikey: cred.api_key },
      signal: AbortSignal.timeout(20000),
    });
    const data = await connectRes.json().catch(() => ({}));
    if (!connectRes.ok) {
      throw new Error(`Falha ao buscar QR Code: HTTP ${connectRes.status} — ${JSON.stringify(data).slice(0, 300)}`);
    }
    const qrCodeBase64 = data?.base64 || data?.qrcode?.base64;

    let webhookWarning: string | undefined;
    try {
      await setEvolutionWebhook(cred.instance_name, cred.api_url, cred.api_key, `${publicBaseUrl.replace(/\/$/, '')}/api/webhooks/evolution`);
    } catch (err: any) {
      webhookWarning = `QR Code pronto, mas falha ao configurar o webhook (mensagens não vão chegar até isso ser corrigido): ${err.message}`;
    }

    return { instanceName: cred.instance_name, qrCodeBase64, warning: webhookWarning };
  }

  // ── Evolution API multi-instância (Epic 4.6 — Porta A, QR Code) ────────
  // Onboarding "sem barreira de entrada": cria uma instância nova na
  // Evolution API self-hosted em nome do tenant e devolve o QR Code pro
  // painel exibir. Só saas_admin cria (provisionamento ainda é manual — o
  // self-service completo, 4.6.5, fica pra depois).
  router.post('/api/admin/tenants/:id/evolution-instance', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!evolutionApiUrl || !evolutionApiKey) {
      return res.status(503).json({ error: 'EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados neste servidor — não é possível provisionar instância nova.' });
    }
    const { data: tenant, error: tenantError } = await db().from('tenants').select('id, slug, name').eq('id', req.params.id).maybeSingle();
    if (tenantError) return res.status(500).json({ error: tenantError.message });
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });

    // Idempotente: esse tenant já tem uma instância — em vez de tentar criar
    // outra (e quebrar com "duplicate key" + deixar uma instância órfã na
    // Evolution API), reusa a existente e só busca um QR Code novo.
    const { data: existingCred, error: existingCredError } = await db()
      .from('tenant_evolution_credentials')
      .select('instance_name, api_url, api_key')
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (existingCredError) return res.status(500).json({ error: existingCredError.message });
    if (existingCred) {
      try {
        const result = await reconnectExistingInstance(existingCred as any);
        return res.json(result);
      } catch (err: any) {
        return res.status(502).json({ error: err.message });
      }
    }

    const requestedName: string | undefined = req.body?.instanceName;
    // Nome estável e único: slug do tenant (ou prefixo do id) + sufixo curto
    // aleatório, pra nunca colidir com uma instância já existente na mesma
    // Evolution API mesmo se o slug se repetir.
    const baseName = (requestedName || tenant.slug || tenant.id.slice(0, 8)).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const instanceName = `${baseName}-${Math.random().toString(36).slice(2, 8)}`;

    let created: any;
    try {
      const createRes = await fetch(`${evolutionApiUrl.replace(/\/$/, '')}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evolutionApiKey },
        body: JSON.stringify({ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
        signal: AbortSignal.timeout(20000),
      });
      created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        return res.status(502).json({ error: `Falha ao criar instância na Evolution API: HTTP ${createRes.status} — ${JSON.stringify(created).slice(0, 300)}` });
      }
    } catch (err: any) {
      return res.status(502).json({ error: `Falha ao falar com a Evolution API: ${err.message}` });
    }

    // A resposta de /instance/create varia por versão do servidor Evolution
    // — tenta os formatos conhecidos antes de desistir. A instância em si já
    // foi criada do lado da Evolution mesmo se não conseguirmos ler o QR
    // daqui; por isso devolve um aviso em vez de erro puro nesse caso.
    const instanceApiKey: string = created?.hash?.apikey || created?.hash || evolutionApiKey;
    const qrCodeBase64: string | undefined = created?.qrcode?.base64 || created?.qrcode || created?.base64;

    const { error: credError } = await db()
      .from('tenant_evolution_credentials')
      .insert({ tenant_id: tenant.id, instance_name: instanceName, api_url: evolutionApiUrl, api_key: instanceApiKey });
    if (credError) {
      return res.status(500).json({ error: `Instância criada na Evolution API, mas falha ao salvar credencial: ${credError.message}` });
    }

    // Bug real em produção (12/08/2026): sem isso, a instância recebe a
    // mensagem normalmente (por isso aparece no WhatsApp do celular, síncrono
    // direto com a Meta) mas nunca avisa o Universo — o agente nunca vê nada
    // chegar. Melhor esforço: instância+credencial já estão salvas mesmo se
    // isso falhar, e reabrir o QR Code (rota abaixo) tenta de novo.
    let webhookWarning: string | undefined;
    try {
      await setEvolutionWebhook(instanceName, evolutionApiUrl, instanceApiKey, `${publicBaseUrl.replace(/\/$/, '')}/api/webhooks/evolution`);
    } catch (err: any) {
      webhookWarning = `Instância e QR Code prontos, mas falha ao configurar o webhook (mensagens não vão chegar até isso ser corrigido): ${err.message}`;
    }

    res.status(201).json({
      instanceName,
      qrCodeBase64,
      warning: webhookWarning || (qrCodeBase64 ? undefined : 'Instância criada, mas a resposta não trouxe QR Code — use GET /api/admin/tenants/:id/evolution-instance/qrcode pra buscar.'),
    });
  }));

  // Reconecta/renova o QR Code de uma instância já criada — o QR do
  // /instance/create expira rápido, e o operador pode reabrir a tela de
  // onboarding depois desse tempo.
  router.get('/api/admin/tenants/:id/evolution-instance/qrcode', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { data: cred, error: credError } = await db()
      .from('tenant_evolution_credentials')
      .select('instance_name, api_url, api_key')
      .eq('tenant_id', req.params.id)
      .maybeSingle();
    if (credError) return res.status(500).json({ error: credError.message });
    if (!cred) return res.status(404).json({ error: 'Esse tenant ainda não tem instância Evolution criada.' });

    try {
      const result = await reconnectExistingInstance(cred as any);
      res.json(result);
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  }));

  // Estado da conexão (aberta/fechada/conectando) — pro painel saber quando
  // parar de mostrar o QR Code e exibir "conectado" sem precisar o operador
  // ficar recarregando a tela manualmente pra descobrir.
  router.get('/api/admin/tenants/:id/evolution-instance/status', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { data: cred, error: credError } = await db()
      .from('tenant_evolution_credentials')
      .select('instance_name, api_url, api_key')
      .eq('tenant_id', req.params.id)
      .maybeSingle();
    if (credError) return res.status(500).json({ error: credError.message });
    if (!cred) return res.status(404).json({ error: 'Esse tenant ainda não tem instância Evolution criada.' });

    try {
      const stateRes = await fetch(`${cred.api_url.replace(/\/$/, '')}/instance/connectionState/${cred.instance_name}`, {
        headers: { apikey: cred.api_key },
        signal: AbortSignal.timeout(15000),
      });
      const data = await stateRes.json().catch(() => ({}));
      if (!stateRes.ok) {
        return res.status(502).json({ error: `Falha ao consultar estado da instância: HTTP ${stateRes.status} — ${JSON.stringify(data).slice(0, 300)}` });
      }
      // Formato varia por versão do servidor Evolution, mesma cautela já
      // aplicada na leitura do QR Code acima.
      const state: string = data?.instance?.state || data?.state || 'unknown';
      res.json({ instanceName: cred.instance_name, state, connected: state === 'open' });
    } catch (err: any) {
      res.status(502).json({ error: `Falha ao falar com a Evolution API: ${err.message}` });
    }
  }));

  return router;
}
