import { Router, type RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireRole, isSaasAdmin } from '../middleware/rbac';
import type { AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { setEvolutionWebhook } from '../services/evolutionSend';
import { getGlobalPromptLayerRow, setGlobalPromptLayer } from '../services/globalPromptStore';
import { getKnowledgeBase } from '../services/knowledgeBaseStore';
import { LEGACY_DEFAULT_TENANT_ID } from '../services/tenantContext';

interface AdminRouterDeps {
  authenticateToken: RequestHandler;
  supabase: SupabaseClient | null;
  /** Credencial "admin" da Evolution API (servidor self-hosted) usada só pra provisionar instância nova — depois de criada, cada instância tem sua própria linha em tenant_evolution_credentials (Epic 4.6). */
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  /** URL pública deste backend — usada pra registrar o webhook da instância recém-criada apontando de volta pra cá (ver setEvolutionWebhook). */
  publicBaseUrl: string;
  /** META_PHONE_NUMBER_ID (env) — número compartilhado cujo dono real é o
   * tenant legado (LEGACY_DEFAULT_TENANT_ID), que nunca teve linha própria
   * em tenant_meta_credentials (ver tenantResolver.ts, resolveTenantByPhoneNumberId).
   * Sem isso, o tenant legado aparecia como "Não conectado" no painel mesmo
   * recebendo/respondendo mensagens reais pelo número compartilhado. */
  sharedMetaPhoneNumberId?: string;
}

/**
 * Bloco 2.D.3/2.D.5 — versão real (via API, autenticada com RBAC) do que
 * `scripts/create-tenant.ts`/`scripts/create-operator.ts` fazem por linha de
 * comando. É o que o painel "SaaS Admin" (Cadastrar Novo Cliente/Usuário)
 * vai precisar chamar pra deixar de ser decorativo — essa reconexão do
 * frontend ainda não foi feita, fica pro próximo passo.
 */
export function createAdminRouter({ authenticateToken, supabase, evolutionApiUrl, evolutionApiKey, publicBaseUrl, sharedMetaPhoneNumberId }: AdminRouterDeps): Router {
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
    const tenants = data || [];

    // whatsappConnected: achado numa auditoria (13/08/2026) — o painel
    // ("Tenants & Conexões") mostrava "WhatsApp Conectado" fixo pra todo
    // tenant, sem checar nada de verdade. Conectado de verdade = tem
    // phone_number_id real (Meta Cloud API) OU uma instância Evolution
    // provisionada (Epic 4.6, QR Code) — as duas formas suportadas hoje.
    //
    // Achado real em produção logo em seguida (usuário reportou "1/3"
    // quando deveria ser "2/3"): o tenant legado (LEGACY_DEFAULT_TENANT_ID,
    // a Monique) nunca teve linha própria em tenant_meta_credentials — ele
    // usa a credencial Meta COMPARTILHADA (env META_PHONE_NUMBER_ID, ver
    // tenantResolver.ts) pra receber/responder mensagens reais. Sem esse
    // caso especial, ele contava como "não conectado" mesmo estando de
    // verdade em produção.
    //
    // Segundo achado real (24/08/2026): pro provider Evolution, ter uma
    // LINHA em tenant_evolution_credentials só prova que a instância foi
    // PROVISIONADA (ex: alguém clicou "Gerar QR Code") — não que o WhatsApp
    // foi realmente pareado. Um tenant recém-criado, com o QR gerado mas
    // nunca escaneado, aparecia como "Conectado" igual a um que já estava
    // em produção há dias. Agora usa `last_connection_state`
    // (evolutionConnectionAlertJob.ts mantém essa coluna atualizada a cada
    // 5min consultando o estado real na Evolution API) — só conta como
    // conectado quando o último estado observado for `'open'`.
    const tenantIds = tenants.map((t: any) => t.id);
    const connectedIds = new Set<string>();
    if (tenantIds.length) {
      const [{ data: metaCreds }, { data: evoCreds }] = await Promise.all([
        db().from('tenant_meta_credentials').select('tenant_id, phone_number_id').in('tenant_id', tenantIds),
        db().from('tenant_evolution_credentials').select('tenant_id, last_connection_state').in('tenant_id', tenantIds),
      ]);
      (metaCreds || []).forEach((c: any) => { if (c.phone_number_id) connectedIds.add(c.tenant_id); });
      (evoCreds || []).forEach((c: any) => { if (c.last_connection_state === 'open') connectedIds.add(c.tenant_id); });
      if (sharedMetaPhoneNumberId && tenantIds.includes(LEGACY_DEFAULT_TENANT_ID)) {
        connectedIds.add(LEGACY_DEFAULT_TENANT_ID);
      }
    }

    res.json({ tenants: tenants.map((t: any) => ({ ...t, whatsappConnected: connectedIds.has(t.id) })) });
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
        // seção 1) — achado numa auditoria: default 'beauty_studio' aqui
        // fazia qualquer tenant de outro ramo herdar sem querer regras de
        // clínica de estética. 'generic' não bate com nenhuma chave de
        // SEGMENT_LAYERS (autoReply.ts) — só a Camada 1 (Global) se aplica.
        segment: segment || 'generic',
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

  // Edição básica do tenant (nome/slug/moeda/idioma/segmento) — pedido real
  // do dono do produto depois de criar tenants de teste com nome errado
  // (ex: "Monique 2", "Tanent 3") e não ter como corrigir sem SQL direto no
  // Supabase. Só os campos passados no body são atualizados; nunca mexe em
  // credenciais (Meta/Evolution/Instagram) nem em dado de negócio (base de
  // conhecimento, conversas) — isso continua em rotas próprias.
  router.patch('/api/admin/tenants/:id', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req, res) => {
    const { name, slug, currency, locale, segment, isActive } = req.body || {};
    const patch: Record<string, unknown> = {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Campo "name" não pode ficar vazio.' });
      patch.name = name;
    }
    if (slug !== undefined) patch.slug = slug || null;
    if (currency !== undefined) patch.currency = currency;
    if (locale !== undefined) patch.locale = locale;
    if (segment !== undefined) patch.segment = segment;
    // Bloqueio de acesso (TASK-0070) — reversível, distinto do DELETE
    // abaixo (que é irreversível e em cascata). Só desliga login novo dos
    // operadores desse tenant (ver server/routes/auth.ts); não apaga nada.
    if (isActive !== undefined) patch.is_active = Boolean(isActive);
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nenhum campo pra atualizar.' });

    const { data: tenant, error } = await db().from('tenants').update(patch).eq('id', req.params.id).select('*').maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
    res.json({ tenant });
  }));

  // Exclusão de tenant — destrutivo e em cascata de propósito (todas as
  // tabelas tenant-scoped referenciam tenants(id) com "on delete cascade",
  // ver migration 0001): apaga conversas, mensagens, credenciais, base de
  // conhecimento, operadores etc. desse tenant, tudo de uma vez, sem
  // recuperação. Pedido real do dono do produto pra limpar tenants de teste
  // criados sem querer (ex: "Monique 2", "Tanent 3") sem precisar de SQL
  // direto no Supabase.
  //
  // `confirmName` (exato, case-sensitive) é obrigatório — segunda barreira
  // além da confirmação do próprio painel, justamente porque o dano aqui é
  // irreversível e atinge todo o histórico do tenant, não só um registro.
  router.delete('/api/admin/tenants/:id', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req, res) => {
    const { confirmName } = req.body || {};
    const { data: tenant, error: fetchError } = await db().from('tenants').select('id, name').eq('id', req.params.id).maybeSingle();
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
    if (!confirmName || confirmName !== tenant.name) {
      return res.status(400).json({ error: 'Confirmação não bate com o nome do tenant. Digite o nome exato pra confirmar a exclusão.' });
    }

    const { error: deleteError } = await db().from('tenants').delete().eq('id', req.params.id);
    if (deleteError) return res.status(500).json({ error: deleteError.message });
    res.json({ success: true });
  }));

  // ── Histórico de pagamento mensal do tenant ao Universo (TASK-0070) ────
  // Cobrança do SAAS ao tenant (assinatura mensal) — distinta de
  // financial_transactions, que é a cobrança do TENANT ao cliente final
  // dele. Registro manual (sem gateway, mesma decisão de escopo de
  // financial_transactions/Epic 4.4): um saas_admin marca cada mês.
  router.get('/api/admin/tenants/:id/billing', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req, res) => {
    const { data, error } = await db()
      .from('tenant_billing_records')
      .select('*')
      .eq('tenant_id', req.params.id)
      .order('reference_month', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ records: data || [] });
  }));

  router.post('/api/admin/tenants/:id/billing', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { referenceMonth, amount, currency, status, note } = req.body || {};
    if (!referenceMonth) return res.status(400).json({ error: 'Campo "referenceMonth" (AAAA-MM ou AAAA-MM-DD) é obrigatório.' });
    if (amount === undefined || amount === null || Number.isNaN(Number(amount))) {
      return res.status(400).json({ error: 'Campo "amount" é obrigatório e precisa ser numérico.' });
    }
    // Normaliza sempre pro dia 1 do mês (unique(tenant_id, reference_month))
    // — quem manda "2026-08" ou "2026-08-15" cai no mesmo registro do mês.
    const monthMatch = String(referenceMonth).match(/^(\d{4})-(\d{2})/);
    if (!monthMatch) return res.status(400).json({ error: 'Formato de "referenceMonth" inválido — use AAAA-MM.' });
    const normalizedMonth = `${monthMatch[1]}-${monthMatch[2]}-01`;
    const statusValue = status || 'pendente';
    if (!['pendente', 'pago', 'atrasado'].includes(statusValue)) {
      return res.status(400).json({ error: `Status inválido: ${statusValue}` });
    }

    const { data, error } = await db()
      .from('tenant_billing_records')
      .insert({
        tenant_id: req.params.id,
        reference_month: normalizedMonth,
        amount: Number(amount),
        currency: currency || 'BRL',
        status: statusValue,
        paid_at: statusValue === 'pago' ? new Date().toISOString() : null,
        note: note || null,
        created_by: req.user?.id || null,
      })
      .select('*')
      .single();
    if (error) {
      if (String((error as any).code) === '23505') {
        return res.status(409).json({ error: 'Já existe um registro de cobrança pra esse tenant nesse mês — edite o existente em vez de criar outro.' });
      }
      return res.status(500).json({ error: error.message });
    }
    res.status(201).json({ record: data });
  }));

  router.patch('/api/admin/tenants/:id/billing/:recordId', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req, res) => {
    const { status, amount, note, paidAt } = req.body || {};
    const patch: Record<string, unknown> = {};
    if (status !== undefined) {
      if (!['pendente', 'pago', 'atrasado'].includes(status)) return res.status(400).json({ error: `Status inválido: ${status}` });
      patch.status = status;
      // Marcar como "pago" sem informar paidAt explicitamente registra agora
      // — é a decisão humana acontecendo neste instante (mesmo padrão de
      // verify-payment em conversations.ts: o clique é o registro).
      if (status === 'pago' && paidAt === undefined) patch.paid_at = new Date().toISOString();
    }
    if (paidAt !== undefined) patch.paid_at = paidAt || null;
    if (amount !== undefined) {
      if (Number.isNaN(Number(amount))) return res.status(400).json({ error: 'Campo "amount" precisa ser numérico.' });
      patch.amount = Number(amount);
    }
    if (note !== undefined) patch.note = note || null;
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nenhum campo pra atualizar.' });

    const { data, error } = await db()
      .from('tenant_billing_records')
      .update(patch)
      .eq('id', req.params.recordId)
      .eq('tenant_id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Registro de cobrança não encontrado.' });
    res.json({ record: data });
  }));

  router.delete('/api/admin/tenants/:id/billing/:recordId', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req, res) => {
    const { error, data } = await db()
      .from('tenant_billing_records')
      .delete()
      .eq('id', req.params.recordId)
      .eq('tenant_id', req.params.id)
      .select('id');
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.length) return res.status(404).json({ error: 'Registro de cobrança não encontrado.' });
    res.json({ success: true });
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

  // Troca de função de um operador já existente — até aqui só dava pra
  // fazer via SQL direto no Supabase (achado real: um operador cadastrado
  // como "Operador" não enxergava a aba Base de Conhecimento, que exige
  // "Administrador" ou acima, e não existia nenhum jeito no painel de
  // corrigir isso sem alguém mexer no banco). Mesma regra de escopo/
  // escalonamento de privilégio da criação (POST acima): admin comum só
  // edita dentro do próprio tenant e nunca promove ninguém a saas_admin.
  // Estendido (TASK-0070, pedido direto de chat: "trocar login de acesso e
  // senha" na tela de gestão de tenants) pra aceitar também email/name/
  // password, além da role já suportada. Continua um PATCH parcial — só os
  // campos enviados são alterados, mesma convenção do PATCH de tenant acima.
  router.patch('/api/admin/operators/:id', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { role, email, name, password } = req.body || {};
    const saasAdmin = isSaasAdmin(req);
    const patch: Record<string, unknown> = {};

    if (role !== undefined) {
      if (!['operator', 'manager', 'admin', 'saas_admin'].includes(role)) {
        return res.status(400).json({ error: `Role inválida: ${role}` });
      }
      if (!saasAdmin && role === 'saas_admin') {
        return res.status(403).json({ error: 'Só saas_admin pode promover alguém a saas_admin.' });
      }
      patch.role = role;
    }
    if (email !== undefined) {
      if (!String(email).trim()) return res.status(400).json({ error: 'Campo "email" não pode ficar vazio.' });
      patch.email = String(email).trim();
    }
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'Campo "name" não pode ficar vazio.' });
      patch.name = name;
    }
    if (password !== undefined) {
      if (String(password).length < 6) return res.status(400).json({ error: 'Senha precisa ter pelo menos 6 caracteres.' });
      patch.password_hash = await bcrypt.hash(String(password), 10);
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nenhum campo pra atualizar.' });

    let query = db().from('operators').update(patch).eq('id', req.params.id);
    if (!saasAdmin) {
      query = query.eq('tenant_id', req.user?.tenantId);
    }
    const { data, error } = await query.select('id, tenant_id, email, name, role, created_at').maybeSingle();
    if (error) {
      // e-mail único por tenant (unique(tenant_id, email), migration 0001) —
      // devolve mensagem legível em vez do erro cru do Postgres.
      if (String(error.message || '').includes('duplicate') || String((error as any).code) === '23505') {
        return res.status(409).json({ error: 'Já existe um operador com esse e-mail neste tenant.' });
      }
      return res.status(500).json({ error: error.message });
    }
    if (!data) return res.status(404).json({ error: 'Operador não encontrado.' });
    res.json({ operator: data });
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
  /** Erro de "connect" numa instância que a Evolution API já não conhece (deletada por fora, ex: recriação que falhou no meio) — distinto de outras falhas pra quem chama poder se autocurar recriando em vez de só devolver erro. */
  class InstanceNotFoundError extends Error {}

  async function reconnectExistingInstance(cred: { instance_name: string; api_url: string; api_key: string }) {
    const connectRes = await fetch(`${cred.api_url.replace(/\/$/, '')}/instance/connect/${cred.instance_name}`, {
      headers: { apikey: cred.api_key },
      signal: AbortSignal.timeout(20000),
    });
    const data = await connectRes.json().catch(() => ({}));
    if (!connectRes.ok) {
      const message = `Falha ao buscar QR Code: HTTP ${connectRes.status} — ${JSON.stringify(data).slice(0, 300)}`;
      if (connectRes.status === 404) throw new InstanceNotFoundError(message);
      throw new Error(message);
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

  /**
   * Cria uma instância nova na Evolution API e persiste — usada tanto pro
   * tenant que nunca teve instância quanto pra "autocura" quando a
   * instância salva já não existe mais do lado da Evolution API (achado
   * real em produção, 15/08/2026: "Recriar instância do zero" apagou a
   * instância antiga mas falhou ao recriar com o mesmo nome — HTTP 403
   * "already in use" — deixando a credencial salva apontando pra uma
   * instância morta; clicar em "Gerar QR Code" depois disso batia num
   * `/instance/connect` que devolve 404 pra sempre, sem saída no painel).
   * `persist: 'insert'` quando não existe nenhuma linha ainda pra esse
   * tenant, `'update'` quando já existe (troca instance_name + api_key).
   */
  async function createFreshInstance(tenantId: string, instanceName: string, persist: 'insert' | 'update'): Promise<{ instanceName: string; qrCodeBase64?: string; warning?: string }> {
    let created: any;
    try {
      const createRes = await fetch(`${evolutionApiUrl!.replace(/\/$/, '')}/instance/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evolutionApiKey! },
        body: JSON.stringify({ instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
        signal: AbortSignal.timeout(20000),
      });
      created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        throw new Error(`Falha ao criar instância na Evolution API: HTTP ${createRes.status} — ${JSON.stringify(created).slice(0, 300)}`);
      }
    } catch (err: any) {
      throw new Error(err.message || `Falha ao falar com a Evolution API: ${err}`);
    }

    const instanceApiKey: string = created?.hash?.apikey || created?.hash || evolutionApiKey!;
    const qrCodeBase64: string | undefined = created?.qrcode?.base64 || created?.qrcode || created?.base64;

    const { error: credError } =
      persist === 'insert'
        ? await db().from('tenant_evolution_credentials').insert({ tenant_id: tenantId, instance_name: instanceName, api_url: evolutionApiUrl, api_key: instanceApiKey })
        : await db().from('tenant_evolution_credentials').update({ instance_name: instanceName, api_key: instanceApiKey }).eq('tenant_id', tenantId);
    if (credError) {
      throw new Error(`Instância criada na Evolution API, mas falha ao salvar credencial: ${credError.message}`);
    }

    let webhookWarning: string | undefined;
    try {
      await setEvolutionWebhook(instanceName, evolutionApiUrl, instanceApiKey, `${publicBaseUrl.replace(/\/$/, '')}/api/webhooks/evolution`);
    } catch (err: any) {
      webhookWarning = `Instância pronta, mas falha ao configurar o webhook (mensagens não vão chegar até isso ser corrigido): ${err.message}`;
    }

    return {
      instanceName,
      qrCodeBase64,
      warning: webhookWarning || (qrCodeBase64 ? undefined : 'Instância criada, mas a resposta não trouxe QR Code — use GET /api/admin/tenants/:id/evolution-instance/qrcode pra buscar.'),
    };
  }

  /** Sufixo curto aleatório pra nunca colidir com um nome já usado (a Evolution API não libera nomes de instância pra reuso mesmo depois de apagados). */
  function withFreshSuffix(baseName: string): string {
    return `${baseName}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ── Evolution API multi-instância (Epic 4.6 — Porta A, QR Code) ────────
  // Onboarding "sem barreira de entrada": cria uma instância nova na
  // Evolution API self-hosted em nome do tenant e devolve o QR Code pro
  // painel exibir.
  // Pedido real (15/08/2026, incidente Clic Piscinas — WhatsApp deslogou
  // sozinho do lado do WhatsApp e ninguém com saas_admin estava disponível
  // na hora): liberado pra `admin` comum reconectar/gerar QR Code do PRÓPRIO
  // tenant, mesmo padrão de escopo já usado nas rotas de operators acima —
  // nunca confia no `:id` da URL pra quem não é saas_admin, sempre resolve
  // pelo tenantId do JWT (nunca client-supplied), pra um admin de um tenant
  // nunca conseguir mexer na conexão de outro só trocando o id na URL.
  function resolveEvolutionTenantId(req: AuthenticatedRequest): string {
    if (isSaasAdmin(req)) return req.params.id;
    if (!req.user?.tenantId) throw new Error('tenantId ausente na sessão autenticada.');
    return req.user.tenantId;
  }

  router.post('/api/admin/tenants/:id/evolution-instance', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!evolutionApiUrl || !evolutionApiKey) {
      return res.status(503).json({ error: 'EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados neste servidor — não é possível provisionar instância nova.' });
    }
    const tenantId = resolveEvolutionTenantId(req);
    const { data: tenant, error: tenantError } = await db().from('tenants').select('id, slug, name').eq('id', tenantId).maybeSingle();
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
        if (err instanceof InstanceNotFoundError) {
          // Autocura: a credencial salva aponta pra uma instância que já não
          // existe do lado da Evolution API (ex: recriação anterior que
          // apagou a antiga mas falhou ao recriar) — recria do zero com nome
          // novo em vez de devolver 502 pra sempre com nenhuma saída no painel.
          try {
            const result = await createFreshInstance(tenantId, withFreshSuffix(existingCred.instance_name), 'update');
            return res.json(result);
          } catch (recreateErr: any) {
            return res.status(502).json({ error: recreateErr.message });
          }
        }
        return res.status(502).json({ error: err.message });
      }
    }

    const requestedName: string | undefined = req.body?.instanceName;
    // Nome estável e único: slug do tenant (ou prefixo do id) + sufixo curto
    // aleatório, pra nunca colidir com uma instância já existente na mesma
    // Evolution API mesmo se o slug se repetir.
    const baseName = (requestedName || tenant.slug || tenant.id.slice(0, 8)).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const instanceName = withFreshSuffix(baseName);

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
  router.get('/api/admin/tenants/:id/evolution-instance/qrcode', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const tenantId = resolveEvolutionTenantId(req);
    const { data: cred, error: credError } = await db()
      .from('tenant_evolution_credentials')
      .select('instance_name, api_url, api_key')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (credError) return res.status(500).json({ error: credError.message });
    if (!cred) return res.status(404).json({ error: 'Esse tenant ainda não tem instância Evolution criada.' });

    try {
      const result = await reconnectExistingInstance(cred as any);
      res.json(result);
    } catch (err: any) {
      // Mesma autocura do POST .../evolution-instance acima — ver comentário
      // na definição de createFreshInstance.
      if (err instanceof InstanceNotFoundError && evolutionApiUrl && evolutionApiKey) {
        try {
          const result = await createFreshInstance(tenantId, withFreshSuffix(cred.instance_name), 'update');
          return res.json(result);
        } catch (recreateErr: any) {
          return res.status(502).json({ error: recreateErr.message });
        }
      }
      res.status(502).json({ error: err.message });
    }
  }));

  // Estado da conexão (aberta/fechada/conectando) — pro painel saber quando
  // parar de mostrar o QR Code e exibir "conectado" sem precisar o operador
  // ficar recarregando a tela manualmente pra descobrir.
  router.get('/api/admin/tenants/:id/evolution-instance/status', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { data: cred, error: credError } = await db()
      .from('tenant_evolution_credentials')
      .select('instance_name, api_url, api_key')
      .eq('tenant_id', resolveEvolutionTenantId(req))
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

  // Recria a instância do zero (delete + create) — achado real em produção
  // (15/08/2026, Clic Piscinas): reconectar via QR Code (rota acima) NÃO
  // limpa o cache/estado interno do Baileys por contato (ex: mapeamento
  // @lid degradado — ver issue #262); mensagens continuavam sendo aceitas
  // pela Evolution API mas nunca chegavam no destinatário. Apagar a
  // instância inteira e recriá-la força uma sessão Baileys nova do zero,
  // sem esse estado acumulado. Sempre exige escanear o QR Code de novo
  // depois — é deliberadamente destrutivo, por isso fica atrás de uma
  // confirmação explícita no painel (não é a mesma coisa que "Gerar QR
  // Code", que só renova o QR de uma instância já saudável).
  //
  // Achado real em produção (mesmo dia, na hora H): recriar com o MESMO
  // nome falha com 403 "This name ... is already in use" — a Evolution API
  // não libera um nome de instância pra reuso mesmo depois de apagada.
  // Precisa de um nome NOVO (mesmo esquema de sufixo aleatório da criação
  // original) — por isso o instance_name salvo também muda aqui, não só a
  // api_key.
  router.post('/api/admin/tenants/:id/evolution-instance/recreate', authenticateToken, requireRole('admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (!evolutionApiUrl || !evolutionApiKey) {
      return res.status(503).json({ error: 'EVOLUTION_API_URL/EVOLUTION_API_KEY não configurados neste servidor — não é possível recriar a instância.' });
    }
    const tenantId = resolveEvolutionTenantId(req);
    const { data: cred, error: credError } = await db()
      .from('tenant_evolution_credentials')
      .select('instance_name, api_url, api_key')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (credError) return res.status(500).json({ error: credError.message });
    if (!cred) return res.status(404).json({ error: 'Esse tenant ainda não tem instância Evolution criada.' });

    const apiBase = cred.api_url.replace(/\/$/, '');

    // Best-effort — a instância pode já estar deslogada/num estado
    // inconsistente; o que importa de verdade é o delete logo abaixo.
    await fetch(`${apiBase}/instance/logout/${cred.instance_name}`, {
      method: 'DELETE',
      headers: { apikey: cred.api_key },
      signal: AbortSignal.timeout(20000),
    }).catch(() => {});

    const deleteRes = await fetch(`${apiBase}/instance/delete/${cred.instance_name}`, {
      method: 'DELETE',
      headers: { apikey: cred.api_key },
      signal: AbortSignal.timeout(20000),
    }).catch((err: any) => {
      throw new Error(`Falha ao falar com a Evolution API pra apagar a instância: ${err.message}`);
    });
    // 404 aqui significa "já não existia" — segue normalmente pro recreate
    // em vez de travar numa instância que, pro nosso propósito, já se foi.
    if (!deleteRes.ok && deleteRes.status !== 404) {
      const data = await deleteRes.json().catch(() => ({}));
      return res.status(502).json({ error: `Falha ao apagar a instância na Evolution API: HTTP ${deleteRes.status} — ${JSON.stringify(data).slice(0, 300)}` });
    }

    try {
      const result = await createFreshInstance(tenantId, withFreshSuffix(cred.instance_name), 'update');
      res.json(result);
    } catch (err: any) {
      res.status(502).json({ error: `Instância apagada — ${err.message}` });
    }
  }));

  // ── Camada 1 (Global) do prompt do agente ───────────────────────────────
  // Pedido real do dono do produto: poder ajustar a regra fixa do agente
  // (docs/AGENTE-VERTICAL-ARQUITETURA.md seção 1) direto pelo painel quando
  // encontrar um problema numa conversa real, sem depender de PR+deploy a
  // cada vez (motivado por duas rodadas seguidas de correção de alucinação
  // de mídia na mesma sessão de desenvolvimento). Só saas_admin — é
  // compartilhado por TODOS os tenants, não um dado de um tenant só.
  router.get('/api/admin/global-prompt', authenticateToken, requireRole('saas_admin'), asyncHandler(async (_req, res) => {
    const row = await getGlobalPromptLayerRow();
    res.json(row);
  }));

  router.post('/api/admin/global-prompt', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { content } = req.body || {};
    if (content !== null && typeof content !== 'string') {
      return res.status(400).json({ error: 'Campo "content" precisa ser string ou null (null reseta pro padrão).' });
    }
    const operatorId = req.user?.id;
    if (!operatorId) return res.status(401).json({ error: 'Sessão sem operador identificado.' });
    await setGlobalPromptLayer(content, operatorId);
    res.json(await getGlobalPromptLayerRow());
  }));

  // ── Credenciais Meta Conversions API (CAPI) por tenant ──────────────────
  // Achado numa auditoria (13/08/2026): fireMetaCapiEventForTenant já dispara
  // sozinho os eventos "Schedule"/"Purchase" quando o agente confirma um
  // agendamento/pagamento real (metaCapiService.ts), mas as colunas que ele
  // lê (tenant_meta_credentials.capi_dataset_id/capi_access_token/
  // capi_page_id, migration 0005) nunca tinham rota nem tela que as
  // gravasse — getTenantCapiCredentials sempre devolvia null, e o painel
  // "Central & Disparo Meta CAPI" (aba de operador) exigia clique manual
  // toda vez, mesmo pra lead vindo de anúncio Clique-para-WhatsApp. O
  // accessToken nunca volta em texto puro no GET — só um indicador de que já
  // está configurado — pra não deixar o segredo trafegando de volta pro
  // painel toda vez que a tela é carregada.
  router.get('/api/admin/tenants/:id/capi-credentials', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { data, error } = await db()
      .from('tenant_meta_credentials')
      .select('capi_dataset_id, capi_page_id, capi_access_token')
      .eq('tenant_id', req.params.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({
      capiDatasetId: data?.capi_dataset_id || null,
      capiPageId: data?.capi_page_id || null,
      capiAccessTokenSet: !!data?.capi_access_token,
    });
  }));

  router.put('/api/admin/tenants/:id/capi-credentials', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { capiDatasetId, capiPageId, capiAccessToken } = req.body || {};
    if (capiDatasetId !== undefined && capiDatasetId !== null && typeof capiDatasetId !== 'string') {
      return res.status(400).json({ error: 'Campo "capiDatasetId" precisa ser string ou null.' });
    }
    if (capiPageId !== undefined && capiPageId !== null && typeof capiPageId !== 'string') {
      return res.status(400).json({ error: 'Campo "capiPageId" precisa ser string ou null.' });
    }
    if (capiAccessToken !== undefined && capiAccessToken !== null && typeof capiAccessToken !== 'string') {
      return res.status(400).json({ error: 'Campo "capiAccessToken" precisa ser string ou null.' });
    }

    const { data: tenant, error: tenantError } = await db().from('tenants').select('id').eq('id', req.params.id).maybeSingle();
    if (tenantError) return res.status(500).json({ error: tenantError.message });
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });

    const update: Record<string, string | null> = {};
    if (capiDatasetId !== undefined) update.capi_dataset_id = capiDatasetId || null;
    if (capiPageId !== undefined) update.capi_page_id = capiPageId || null;
    // Campo em branco no formulário nunca apaga um token já salvo — só troca
    // de verdade quando o admin digita um valor novo (ver comentário do GET
    // acima sobre nunca devolver o token em texto puro).
    if (capiAccessToken) update.capi_access_token = capiAccessToken;

    const { error: upsertError } = await db()
      .from('tenant_meta_credentials')
      .upsert({ tenant_id: tenant.id, ...update }, { onConflict: 'tenant_id' });
    if (upsertError) return res.status(500).json({ error: upsertError.message });

    res.json({ success: true });
  }));

  // ── Copiar Base de Conhecimento de outro tenant (18/08/2026) ────────────
  // Pedido real do saas_admin: os "Modelos de Negócio Prontos" do painel
  // (AgentKnowledgeBase.tsx) são fixos em código, sem jeito de editar sem
  // deploy. Isso deixa carregar a Base de Conhecimento REAL de qualquer
  // tenant existente como ponto de partida pra configurar um tenant novo —
  // só LEITURA aqui (não grava nada; quem chama decide se aplica e depois
  // clica em "Salvar Regras no Agente" no tenant de destino).
  //
  // Remove referências de Storage (`firstContactBlocks` do tipo
  // video/file, `exampleVideoId` dos produtos) antes de devolver: esses
  // arquivos vivem sob o PREFIXO do tenant de origem (ver
  // knowledgeBaseVideoStore.ts/knowledgeBaseDocumentStore.ts, sempre
  // scoped por tenantId) — copiar a referência crua faria o tenant novo
  // tentar mandar um vídeo/arquivo que não existe no storage dele, uma
  // falha silenciosa só visível no log do servidor (ver
  // firstContactMessage.ts). Conteúdo inline (imagem base64 de produto e
  // de bloco de 1º contato) não tem esse problema, continua igual.
  router.get('/api/admin/tenants/:id/knowledge-base', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const kb = await getKnowledgeBase(req.params.id);
    if (!kb) return res.status(404).json({ error: 'Este tenant ainda não tem Base de Conhecimento salva.' });
    res.json({
      knowledgeBase: {
        ...kb,
        products: (kb.products || []).map(({ exampleVideoId, variants, ...product }) => ({
          ...product,
          variants: variants?.map(({ exampleVideoId: _variantVideoId, ...variant }) => variant),
        })),
        firstContactBlocks: (kb.firstContactBlocks || []).filter((block) => block.type === 'text' || block.type === 'image'),
      },
    });
  }));

  // ── Instagram DM (Fase 1) — credenciais por tenant ──────────────────────
  // Pedido real (15/08/2026): "como responder lead do Instagram" — Fase 1 é
  // entrada manual do ID da conta Instagram + access token (obtidos direto
  // no App da Meta, já conectado à Página/conta certa segundo o dono do
  // produto), sem fluxo de OAuth próprio ainda. Mesmo padrão de segredo do
  // GET/PUT de capi-credentials acima: token nunca volta em texto puro, só
  // um indicador de "já configurado"; campo em branco no PUT nunca apaga um
  // token já salvo.
  router.get('/api/admin/tenants/:id/instagram-credentials', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { data, error } = await db()
      .from('tenant_instagram_credentials')
      .select('instagram_account_id, access_token')
      .eq('tenant_id', req.params.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({
      instagramAccountId: data?.instagram_account_id || null,
      accessTokenSet: !!data?.access_token,
    });
  }));

  router.put('/api/admin/tenants/:id/instagram-credentials', authenticateToken, requireRole('saas_admin'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { instagramAccountId, accessToken } = req.body || {};
    if (instagramAccountId !== undefined && instagramAccountId !== null && typeof instagramAccountId !== 'string') {
      return res.status(400).json({ error: 'Campo "instagramAccountId" precisa ser string ou null.' });
    }
    if (accessToken !== undefined && accessToken !== null && typeof accessToken !== 'string') {
      return res.status(400).json({ error: 'Campo "accessToken" precisa ser string ou null.' });
    }

    const { data: tenant, error: tenantError } = await db().from('tenants').select('id').eq('id', req.params.id).maybeSingle();
    if (tenantError) return res.status(500).json({ error: tenantError.message });
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });

    const { data: existing } = await db()
      .from('tenant_instagram_credentials')
      .select('instagram_account_id, access_token')
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    const finalInstagramAccountId: string | undefined = instagramAccountId?.trim() || existing?.instagram_account_id;
    const finalAccessToken: string | undefined = accessToken?.trim() || existing?.access_token;
    if (!finalInstagramAccountId || !finalAccessToken) {
      return res.status(400).json({ error: 'ID da conta Instagram e access token são obrigatórios.' });
    }

    const { error: upsertError } = await db()
      .from('tenant_instagram_credentials')
      .upsert({ tenant_id: tenant.id, instagram_account_id: finalInstagramAccountId, access_token: finalAccessToken }, { onConflict: 'tenant_id' });
    if (upsertError) return res.status(500).json({ error: upsertError.message });

    res.json({ success: true });
  }));

  return router;
}
