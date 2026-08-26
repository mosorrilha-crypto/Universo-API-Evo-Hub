import React, { useState, useEffect } from 'react';
import { 
  ActiveTab,
  Tenant,
  UserProfile,
  LeadInfo,
  FinancialTransaction,
  AgentKnowledgeBase,
  BusinessHours,
  SavedTranscriptItem,
  EscalationInfo
} from './types';
import { Header } from './components/Header';
import { SaaSAdminDashboard } from './components/SaaSAdminDashboard';
import { WhatsAppLeadsSim } from './components/WhatsAppLeadsSim';
import AtendimentoWorkspaceFrame from './components/AtendimentoWorkspaceFrame';
import OperationsModuleFrame from './components/OperationsModuleFrame';
import { OperatorCRM } from './components/OperatorCRM';
import { EscalationsPanel } from './components/EscalationsPanel';
import { AgendaFinanceiroCenter } from './components/AgendaFinanceiroCenter';
import { AdAttributionCAPI } from './components/AdAttributionCAPI';
import { AgentKnowledgeBaseView, emptyKnowledgeBase } from './components/AgentKnowledgeBase';
import { PublicCatalogSettings } from './components/PublicCatalogSettings';
import { OperationsCenter } from './components/OperationsCenter';
import { QualityAuditCenter } from './components/QualityAuditCenter';
import { LoginModal } from './components/LoginModal';
import { setAuthToken, setUnauthorizedHandler, apiFetch, setTenantOverride } from './lib/apiClient';
import { ACTIVE_TAB_STORAGE_KEY, parseStoredActiveTab } from './lib/activeTab';
import { hasRoleAtLeast } from './lib/roles';

import { INITIAL_TENANTS } from './data/mockTenants';

// Placeholder usado só como prop enquanto a tela de login (bloqueante,
// isForcedLogin={!currentUser} logo abaixo) está aberta por cima do painel —
// evita quebrar componentes que ainda exigem currentUser não-nulo, sem
// representar nenhuma conta real ou de demonstração.
const GUEST_USER: UserProfile = {
  id: 'guest',
  tenantId: '',
  name: 'Convidado',
  email: '',
  role: 'operator',
  avatar: '',
  department: '',
};

/**
 * Bug real em produção (12/08/2026): `localStorage.setItem` sem try/catch
 * pra cachear o estado do painel — assim que a base de conhecimento real (com
 * fotos de exemplo em base64, Epic 4.5.2) passou a caber no cache, estourou a
 * cota do navegador (~5-10MB por origem) e o `QuotaExceededError` não tratado
 * derrubava a árvore de componentes inteira (tela em branco). O cache é só
 * uma otimização de carregamento a frio — se não couber, segue sem ele em vez
 * de quebrar a tela.
 */
function safeSetLocalStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.warn(`⚠️  Falha ao salvar cache local "${key}" (provavelmente localStorage cheio) — segue funcionando só com os dados em memória:`, err);
  }
}

// Chave onde o saas_admin persiste a empresa escolhida manualmente no
// seletor do Header — sem isso, um F5 recarregava `currentUser` do
// localStorage e o efeito de sincronização (linha ~154) tratava isso como um
// "novo login", voltando `activeTenant` pro tenant do próprio login do
// saas_admin em vez de manter a empresa selecionada (bug real relatado
// 18/08/2026: seletor "não fixa" a troca de empresa a cada refresh).
const ACTIVE_TENANT_OVERRIDE_KEY = 'saas_active_tenant_override';

// Bug real relatado junto com o anterior (18/08/2026): a base de
// conhecimento cacheada em localStorage usava uma chave única global
// (`saas_agent_kb`), então trocar de tenant no seletor sobrescrevia o cache
// do tenant anterior com o do novo — reabrir a empresa anterior mostrava por
// um instante a base de conhecimento errada até o fetch real terminar,
// dando a sensação de bases "se misturando". Uma chave por tenant elimina a
// colisão.
const kbCacheKey = (tenantId: string) => `saas_agent_kb_${tenantId}`;

// Bug real relatado (18/08/2026): o cache de leads do CRM (`saas_crm_leads`)
// também usava uma chave única global — e pior, o efeito que busca leads
// reais (fetchCrmLeads, abaixo) nunca removia do estado um lead que não veio
// mais na resposta atual (só ADICIONA/ATUALIZA por id), diferente do
// equivalente em WhatsAppLeadsSim.tsx (fetchRealConversations), que já poda
// corretamente. Resultado: trocar de tenant no seletor acumulava leads reais
// de todos os tenants já vistos no navegador, gravados na mesma chave global
// que WhatsAppLeadsSim.tsx também lê ao montar — contato de um tenant
// aparecia na lista de outro. Chave por tenant + poda corrigem os dois lados.
const leadsCacheKey = (tenantId: string) => `saas_crm_leads_${tenantId}`;
/** Mesmo raciocínio de leadsCacheKey acima, pro cache de transações financeiras. */
const transactionsCacheKey = (tenantId: string) => `saas_transactions_${tenantId}`;

export const App: React.FC = () => {
  // Navigation & View State
  // Atendimento (WhatsApp) é a página principal pra qualquer papel, inclusive
  // saas_admin (pedido direto, 19/08/2026) — o Painel Multi-Tenant saiu da
  // faixa de abas e virou um botão próprio no cabeçalho (ver Header.tsx),
  // acessado sob demanda em vez de ser a tela de entrada.
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    try {
      return parseStoredActiveTab(localStorage.getItem(ACTIVE_TAB_STORAGE_KEY));
    } catch {
      return 'home';
    }
  });
  // Lead a abrir automaticamente ao entrar na aba WhatsApp — usado pelo
  // botão "Voltar pra conversa" do card de Escalonamento. requestId muda a
  // cada clique (mesmo pro mesmo telefone), pra garantir que clicar de novo
  // no mesmo lead depois de já ter navegado manualmente pra outra conversa
  // sempre reabra o lead certo.
  const [whatsAppOpenLead, setWhatsAppOpenLead] = useState<{ phone: string; requestId: number } | undefined>(undefined);
  
  // Tenants & Active Company
  const [tenants, setTenants] = useState<Tenant[]>(() => {
    const saved = localStorage.getItem('saas_tenants');
    if (!saved) return INITIAL_TENANTS;
    // Migração antiga (07/08/2026) filtrava o cache pra manter só o ID
    // fictício da Monique (tenant_004), descartando qualquer outro tenant —
    // isso resolvia o problema de então (tenants 100% fictícios do template
    // original: Drogaria, MetaLeads, FitLife) mas também descarta tenants
    // REAIS cacheados (ex: Clic Piscinas, IDs UUID de verdade vindos de
    // /api/admin/tenants — ver efeito abaixo) a cada reload, fazendo o
    // seletor de empresa (saas_admin) nunca conseguir mostrar/marcar um
    // tenant real como ativo. Cache velho de tenant fictício, se sobrar
    // algum, se autocorrige assim que o efeito abaixo buscar a lista real.
    const parsed = JSON.parse(saved) as Tenant[];
    return parsed.length ? parsed : INITIAL_TENANTS;
  });
  const [activeTenant, setActiveTenant] = useState<Tenant>(tenants[0] || INITIAL_TENANTS[0]);

  // Auth User
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem('saas_current_user');
    // Antes, sem sessão salva, o app assumia SAAS_DEMO_USERS[0] (Monique,
    // admin) como logado por padrão — abrindo o painel inteiro sem exigir
    // login nenhum. null aciona a tela de login forçada já existente logo
    // abaixo (isForcedLogin={!currentUser}).
    return saved ? JSON.parse(saved) : null;
  });
  const [isLoginModalOpen, setIsLoginModalOpen] = useState<boolean>(false);

  // Persiste a última aba escolhida para que um refresh seja apenas um
  // refresh: o operador volta ao mesmo contexto em vez de cair sempre em
  // "home". O valor é validado por allowlist em activeTab.ts.
  const handleSetActiveTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    safeSetLocalStorage(ACTIVE_TAB_STORAGE_KEY, tab);
  };

  // Restrição de telas por papel (issue #159 original + TASK-0038: o app
  // instalado (PWA) escondia Financeiro/Admin/SaaS Master de TODO MUNDO,
  // mesmo de quem tinha papel pra ver (ex: o próprio dono do produto como
  // saas_admin) — bloqueio era por "está instalado?", não por credencial
  // real. Agora a regra é só o papel, igual ao navegador: quem tem o papel
  // vê a tela também no app instalado; quem não tem continua sem ver nem
  // no navegador. Mesmos níveis usados em Header.tsx pra esconder os
  // botões das abas — repetido aqui pra também travar o CONTEÚDO: esconder
  // só o botão não bastaria se activeTab ficasse apontando pra uma aba
  // proibida (ex: troca de usuário no meio da sessão, sem reload da página).
  const canSeeFinancial = hasRoleAtLeast(currentUser?.role, 'manager');
  const canSeeAdminTools = hasRoleAtLeast(currentUser?.role, 'admin');
  const canSeeSaasMaster = hasRoleAtLeast(currentUser?.role, 'saas_admin');

  // Volta pra Atendimento se o usuário logado (ou a troca de conta) não tem
  // mais permissão pra ver a aba em que estava — cobre re-login com outro
  // papel no meio da sessão, sem depender de um reload de página completo.
  useEffect(() => {
    // Durante o carregamento/login não redireciona a preferência restaurada.
    // A permissão é verificada assim que o usuário real estiver disponível.
    if (!currentUser) return;
    const blocked =
      (activeTab === 'saas' && !canSeeSaasMaster) ||
      (['financial', 'agenda_financeiro'].includes(activeTab) && !canSeeFinancial) ||
      (['attribution', 'knowledge', 'catalog', 'quality'].includes(activeTab) && !canSeeAdminTools);
    if (blocked) handleSetActiveTab('whatsapp');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.role]);

  // Bug real relatado em produção: o badge de "empresa ativa" no cabeçalho
  // (e tudo que depende de `activeTenant`, como o polling de CRM leads —
  // ver `[activeTenant.id]` abaixo) nunca era sincronizado com o usuário que
  // de fato logou. `activeTenant` nascia sempre com `tenants[0]` e só mudava
  // via seletor manual (saas_admin) — então um operador da Clic Piscinas
  // logando no mesmo aparelho onde antes tinha logado um operador da
  // Monique via a tela inteira mostrando "Monique Sorrilha" no cabeçalho,
  // mesmo com os dados reais (que sempre resolvem o tenant pelo JWT no
  // backend) corretos por baixo — a sensação de "cache misturando tenant"
  // vinha metade daqui, metade do merge de conversas nunca descartar leads
  // antigos (ver WhatsAppLeadsSim.tsx). Roda só quando `currentUser` muda
  // (login/logout/troca de conta) — nunca sobrescreve uma escolha manual do
  // seletor de tenant do saas_admin feita depois do login.
  useEffect(() => {
    if (!currentUser) return;
    setActiveTenant((prev) => {
      if (prev.id === currentUser.tenantId) return prev;
      const matching = tenants.find((t) => t.id === currentUser.tenantId);
      return matching || prev;
    });

    // Achado real em produção (13/08/2026): a busca acima nunca encontra
    // nada de verdade — `tenants` só carrega o mock local (INITIAL_TENANTS,
    // 1 registro fictício da Monique com id "tenant_004"), nunca os tenants
    // reais do Supabase (só o painel SaaS Master, restrito a saas_admin,
    // busca a lista real via /api/admin/tenants). Sem isso, o badge do
    // cabeçalho ficava preso no nome do mock pra qualquer operador que não
    // fosse saas_admin, mesmo depois do fix acima. GET /api/tenant é
    // self-scoped (resolve pelo JWT, sem exigir role nenhuma) e sempre
    // reflete o tenant real de quem está logado.
    apiFetch('/api/tenant')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.tenant?.id) return;
        // Achado real em produção (18/08/2026): esta chamada e a de
        // /api/admin/tenants logo abaixo (que restaura a escolha manual do
        // seletor) disparam juntas, sem ordem garantida entre si. Quando
        // /api/admin/tenants resolvia primeiro e restaurava, por exemplo,
        // "Clic Piscinas", ESTA promise podia resolver depois e sobrescrever
        // `activeTenant` de volta pro tenant do próprio login do saas_admin
        // (ex: Monique) — indo contra o que o comentário acima já dizia ser
        // a intenção ("nunca sobrescrever uma escolha manual"), só que sem
        // checar isso de verdade. Resultado: o seletor no cabeçalho mudava
        // de novo sozinho, e a tela toda (leads, conversas, CRM) passava a
        // mostrar os dados do tenant errado outra vez. Só aplica o tenant
        // do próprio login se não houver uma escolha manual salva apontando
        // pra outro tenant.
        const savedOverrideId = currentUser.role === 'saas_admin' ? localStorage.getItem(ACTIVE_TENANT_OVERRIDE_KEY) : null;
        if (savedOverrideId && savedOverrideId !== data.tenant.id) return;
        // currency/locale entraram aqui (19/08/2026) pro Financeiro formatar
        // valores na moeda real do tenant em vez de R$/pt-BR fixo.
        setActiveTenant((prev) =>
          prev.id === data.tenant.id && prev.name === data.tenant.name && prev.currency === data.tenant.currency && prev.locale === data.tenant.locale
            ? prev
            : { ...prev, id: data.tenant.id, name: data.tenant.name, currency: data.tenant.currency, locale: data.tenant.locale }
        );
      })
      .catch(() => {});

    // Achado real em produção (14/08/2026, print do seletor): mesmo com o
    // fix acima, o seletor de empresa (Header.tsx, só visível pra
    // saas_admin) continuava sempre mostrando só "Monique" marcada como
    // ativa — porque a LISTA do seletor (`tenants`) nunca era populada com
    // os tenants reais (ex: Clic Piscinas), só o mock local de 1 item
    // seguia ali; o id real vindo de /api/tenant acima nunca batia com
    // nenhum item da lista, mas como havia só UM item na lista mesmo assim
    // ele aparecia (visualmente) como se fosse o único/selecionado. Busca a
    // lista real (mesmo endpoint que a aba SaaS Master já usa) só pra quem
    // é saas_admin — outros papéis nem veem o seletor (ver Header.tsx).
    if (currentUser.role === 'saas_admin') {
      apiFetch('/api/admin/tenants')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const real = (data?.tenants || []) as Array<{ id: string; name: string; slug: string; created_at?: string; whatsappConnected?: boolean }>;
          if (!real.length) return;
          const mapped = real.map((t) => ({
            id: t.id,
            name: t.name,
            slug: t.slug,
            plan: 'enterprise',
            monthlyMRR: 0,
            status: 'ativo',
            createdAt: t.created_at ? new Date(t.created_at).toLocaleDateString('pt-BR') : '',
            whatsappPhone: '',
            whatsappStatus: t.whatsappConnected ? 'conectado' : 'desconectado',
            whatsappEngine: 'meta_cloud_api',
            maxLeadsPerMonth: 0,
            currentLeadsMonth: 0,
            webhookEndpoint: '',
          }));
          setTenants(mapped);

          // Restaura a empresa escolhida manualmente no seletor antes do
          // último refresh, em vez de deixar o efeito acima (que roda
          // sempre que `currentUser` é recarregado do localStorage, inclusive
          // num F5) prender o saas_admin de volta no próprio tenant de login.
          const savedOverrideId = localStorage.getItem(ACTIVE_TENANT_OVERRIDE_KEY);
          const overrideTenant = savedOverrideId ? mapped.find((t) => t.id === savedOverrideId) : undefined;
          if (overrideTenant) {
            setActiveTenant((prev) => (prev.id === overrideTenant.id ? prev : overrideTenant));
          }
        })
        .catch(() => {});
    } else {
      // Só saas_admin usa o seletor manual — outros papéis nunca devem
      // carregar um override de sessão anterior.
      localStorage.removeItem(ACTIVE_TENANT_OVERRIDE_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  // Achado real em produção (15/08/2026): o seletor de tenant (Header.tsx,
  // só visível pra saas_admin) até aqui só mudava essa tela — toda chamada
  // ao backend continuava resolvendo o tenant pelo token de login, fixo
  // desde que o operador entrou (ver resolveTenantId em
  // server/middleware/rbac.ts). Um saas_admin trocou pra outro tenant no
  // seletor, salvou a Mensagem de Primeiro Contato lá, e a gravação foi
  // silenciosamente pro tenant do PRÓPRIO login — um cliente real de outro
  // tenant chegou a receber o conteúdo errado. Mantém `apiFetch` mandando o
  // tenant realmente selecionado (header X-Tenant-Id) só quando quem está
  // logado é saas_admin — pra qualquer outro papel o backend ignora esse
  // header de qualquer forma, mas nem faz sentido mandar (o seletor nem
  // aparece pra eles).
  //
  // Segundo achado real (18/08/2026, mesma classe de bug voltando de outro
  // jeito): isso estava num useEffect, e o React roda efeitos de FILHO antes
  // do PAI no mesmo commit. WhatsAppLeadsSim (filho) também tem um efeito
  // que depende de `activeTenant.id` e lê `getTenantOverride()` pra montar o
  // fetch de `/api/conversations` e a URL do EventSource — esse efeito
  // sempre rodava ANTES deste aqui, então via o override ainda apontando pro
  // tenant ANTERIOR (ou nulo, no primeiro load), caindo no tenant do próprio
  // token do saas_admin. Resultado: trocar pra "Clic Piscinas" no seletor
  // buscava e assinava (SSE) as conversas de "Monique" por engano — e como
  // não tinha reatividade nenhuma pra corrigir depois, ficava preso nesse
  // tenant errado até o próximo F5. Chamar direto no corpo do componente (em
  // vez de useEffect) roda de forma síncrona durante o render do PAI, antes
  // de qualquer efeito de filho — a leitura em WhatsAppLeadsSim já vê o
  // valor certo. É só uma atribuição de variável (sem I/O), então chamar em
  // todo render não tem custo real.
  setTenantOverride(currentUser?.role === 'saas_admin' ? activeTenant.id : null);

  // CRM Leads — bug real em produção (12/08/2026): sempre que o cache local
  // estava vazio (navegador novo, aba anônima, ou depois de limpar dados do
  // site pra corrigir outro bug), essa tela caía pro conjunto inteiro de
  // leads fictícios de demonstração em vez de começar vazia — e como o merge
  // com os leads reais (GET /api/crm/leads, abaixo) só ADICIONA por id, nunca
  // remove, os fictícios ficavam "grudados" na lista pra sempre, misturados
  // com clientes reais. Começa vazia agora.
  const [leads, setLeads] = useState<LeadInfo[]>(() => {
    const saved = localStorage.getItem(leadsCacheKey(activeTenant.id));
    return saved ? JSON.parse(saved) : [];
  });

  // Financial Transactions — mesmo raciocínio do fix de leads fake
  // (12/08/2026): cache vazio nunca deveria cair pro dataset fictício, senão
  // dado de demonstração "gruda" pra sempre (o merge com transações reais,
  // GET /api/financial/transactions abaixo, só ADICIONA por id, nunca
  // remove). Começa vazia.
  const [transactions, setTransactions] = useState<FinancialTransaction[]>(() => {
    const saved = localStorage.getItem(transactionsCacheKey(activeTenant.id));
    return saved ? JSON.parse(saved) : [];
  });

  // Agent Knowledge Base
  // Bug real (25/08/2026): usava moniqueStudioKnowledgeBase (catálogo REAL
  // da Monique, com dado bancário real dela) como fallback aqui — um tenant
  // novo, sem cache ainda, mostrava o catálogo dela como se fosse próprio.
  // emptyKnowledgeBase é o fallback correto; o catálogo de exemplo continua
  // disponível só como preset explícito (AgentKnowledgeBase.tsx).
  const [knowledgeBase, setKnowledgeBase] = useState<AgentKnowledgeBase>(() => {
    const saved = localStorage.getItem(kbCacheKey(activeTenant.id));
    return saved ? JSON.parse(saved) : emptyKnowledgeBase;
  });
  // Bug real reportado (16/08/2026): imagem de produto salva no catálogo
  // "sumia" depois de atualizar a página. Causa: o cache local acima nunca
  // guarda `exampleImageBase64` (ver comentário na sync abaixo), e
  // AgentKnowledgeBaseView captura `knowledgeBase` num useState preguiçoso só
  // na montagem — se o operador abrisse a aba antes do GET /api/knowledge-base
  // real terminar, o formulário ficava travado pra sempre no snapshot do
  // cache sem imagem, mesmo depois do fetch real chegar. `kbLoaded` trava a
  // montagem do editor até o fetch real (com imagem) ter respondido pelo
  // menos uma vez.
  const [kbLoaded, setKbLoaded] = useState(false);

  // Horário de funcionamento real do tenant (tabela `tenants`, GET/POST
  // /api/business-hours) — usado pelo agendamento automático pra nunca
  // oferecer horário fora do expediente; até aqui só existia via SQL direto,
  // sem nenhuma tela pro operador ver ou editar.
  const [businessHours, setBusinessHours] = useState<BusinessHours>({});

  // Transcripts
  const [savedTranscripts, setSavedTranscripts] = useState<SavedTranscriptItem[]>([]);

  // Escalonamentos (issue #82, item 2) — backend GET/POST resolve/DELETE
  // /api/escalations já existia, sem nenhuma UI (achado real em produção: 17
  // escalonamentos acumulados no tenant real, 0 resolvidos, ninguém via).
  const [escalations, setEscalations] = useState<EscalationInfo[]>([]);

  // Inter-tab Selection States
  const [financialPreselectedLead, setFinancialPreselectedLead] = useState<LeadInfo | null>(null);

  // Toast Notification
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Bug real em produção (12/08/2026): o cache local (leads, base de
  // conhecimento, faturas) nunca era limpo no logout — então trocar de conta
  // no mesmo navegador (ex: saas_admin pra um operador de outro tenant)
  // continuava mostrando, por alguns instantes, os dados em cache da conta
  // anterior até a busca real terminar, e às vezes nem terminava de limpar
  // (leads reais só são ADICIONADOS ao merge, nunca removidos). Limpa tudo
  // no logout — o próximo login sempre recomeça do zero e busca os dados
  // reais do tenant certo.
  const clearCachedTenantScopedData = () => {
    localStorage.removeItem('saas_crm_leads'); // chave antiga (pré cache por tenant) — remove se sobrar de sessão anterior
    localStorage.removeItem('saas_agent_kb'); // idem
    localStorage.removeItem('saas_transactions'); // chave antiga (pré cache por tenant)
    localStorage.removeItem(ACTIVE_TENANT_OVERRIDE_KEY);
    for (const key of Object.keys(localStorage)) {
      if (
        key.startsWith('saas_agent_kb_') ||
        key.startsWith('saas_crm_leads_') ||
        key.startsWith('saas_whatsapp_leads_') ||
        key.startsWith('saas_transactions_')
      ) {
        localStorage.removeItem(key);
      }
    }
    setLeads([]);
    setTransactions([]);
    setKnowledgeBase(emptyKnowledgeBase);
    setSavedTranscripts([]);
    setEscalations([]);
  };

  // Se o servidor rejeitar explicitamente o token da sessão (403 — token
  // presente mas inválido/expirado), força um novo login com aviso — em vez
  // de deixar a tela travada mostrando dados velhos com tudo quebrado em
  // silêncio (era o que causava a sensação de "mensagens/análises não
  // atualizam", sem nenhum erro visível pro usuário).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCurrentUser(null);
      setAuthToken(null);
      setIsLoginModalOpen(true);
      clearCachedTenantScopedData();
      showToast('Sessão expirada — faça login novamente.');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Sync state to local storage
  useEffect(() => {
    safeSetLocalStorage('saas_tenants', JSON.stringify(tenants));
  }, [tenants]);

  useEffect(() => {
    safeSetLocalStorage(leadsCacheKey(activeTenant.id), JSON.stringify(leads));
  }, [leads, activeTenant.id]);

  // Troca de tenant: carrega o cache do tenant novo (ou começa vazio) na
  // hora, em vez de deixar os leads/transações do tenant anterior visíveis
  // até o próximo tick do polling (até 8s) — mesmo raciocínio do fix de base
  // de conhecimento acima.
  useEffect(() => {
    const cachedLeads = localStorage.getItem(leadsCacheKey(activeTenant.id));
    setLeads(cachedLeads ? JSON.parse(cachedLeads) : []);
    const cachedTx = localStorage.getItem(transactionsCacheKey(activeTenant.id));
    setTransactions(cachedTx ? JSON.parse(cachedTx) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id]);

  useEffect(() => {
    safeSetLocalStorage(transactionsCacheKey(activeTenant.id), JSON.stringify(transactions));
  }, [transactions, activeTenant.id]);

  // As fotos de exemplo (`exampleImageBase64`, Epic 4.5.2) são o que estoura
  // a cota — e não precisam estar no cache: são carregadas de novo, completas,
  // do backend real logo abaixo (GET /api/knowledge-base) toda vez que a
  // página abre. O cache existe só pra evitar a tela vazia entre o primeiro
  // render e essa busca terminar, não pra guardar imagem nenhuma.
  useEffect(() => {
    const cacheableKb = {
      ...knowledgeBase,
      products: knowledgeBase.products.map(({ exampleImageBase64, exampleImageMimeType, ...rest }) => rest),
    };
    safeSetLocalStorage(kbCacheKey(activeTenant.id), JSON.stringify(cacheableKb));
  }, [knowledgeBase, activeTenant.id]);

  // Busca a base de conhecimento real salva no backend (usada pelo agente
  // automático de verdade) e sincroniza no painel, se existir.
  //
  // Bug real reportado (17/08/2026): um saas_admin trocava de tenant no
  // seletor (Header.tsx) — o header X-Tenant-Id mudava certinho (efeito
  // acima) — mas essa busca só rodava UMA VEZ, na montagem (`[]`), então o
  // painel continuava mostrando a base de conhecimento do tenant anterior
  // até um F5 na página. Depende de `activeTenant.id` agora: toda troca de
  // tenant refaz a busca pro tenant certo. Reseta `kbLoaded` antes de buscar
  // pelo mesmo motivo do fix de imagem sumindo — evita o editor capturar
  // (mesmo que por um instante) a base de conhecimento do tenant errado.
  useEffect(() => {
    // Bug real reportado (25-26/08/2026, dois prints do celular): trocar de
    // empresa no seletor mostrava o catálogo de OUTRA empresa (ex: Monique
    // selecionada, mas produtos da Clic Piscinas aparecendo). Banco de dados
    // sempre esteve correto nos dois casos (confirmado por query direta no
    // Postgres) — não é vazamento de dado nem bug de isolamento por
    // tenant_id, é uma corrida de requisições puramente no navegador: esse
    // efeito nunca verificava se a resposta que chegou ainda era da empresa
    // ativa NA HORA que ela chega. Trocar de empresa rapidamente (ou uma
    // resposta antiga demorar mais que a nova) deixava a resposta da
    // empresa ERRADA "vencer" e sobrescrever o estado, mesmo com o seletor
    // já mostrando a empresa certa. `cancelled` (mesmo padrão já usado em
    // PublicCatalogSettings.tsx) faz a resposta tardia ser ignorada assim
    // que outra troca de tenant já aconteceu.
    let cancelled = false;
    setKbLoaded(false);
    // Carrega o cache do TENANT NOVO (ou o placeholder padrão) na hora —
    // sem isso a tela continuava mostrando, por um instante, a base de
    // conhecimento do tenant anterior (ainda em memória) até essa busca real
    // terminar, o que dava a sensação de bases "se misturando" ao trocar de
    // empresa no seletor.
    // Bug real (25/08/2026): um tenant novo, criado agora, sem cache local
    // ainda, caía no fallback moniqueStudioKnowledgeBase — o admin via o
    // catálogo REAL da Monique (produtos, preços, dado bancário dela) como
    // se fosse do tenant novo, por um instante até GET /api/knowledge-base
    // responder (e, se a resposta real vier vazia — tenant sem linha em
    // knowledge_base ainda — o guard abaixo nem troca esse estado, então
    // ficava assim pra sempre, não só "por um instante"). emptyKnowledgeBase
    // é o fallback correto.
    const cachedForTenant = localStorage.getItem(kbCacheKey(activeTenant.id));
    setKnowledgeBase(cachedForTenant ? JSON.parse(cachedForTenant) : emptyKnowledgeBase);
    apiFetch('/api/knowledge-base')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled) return;
        if (data?.knowledgeBase) {
          setKnowledgeBase((prev) => ({
            ...prev,
            ...data.knowledgeBase,
            products: data.knowledgeBase.products || prev.products || [],
            businessRules: data.knowledgeBase.businessRules || prev.businessRules || [],
            faqs: data.knowledgeBase.faqs || prev.faqs || [],
            documents: data.knowledgeBase.documents || prev.documents || [],
          }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setKbLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTenant.id]);

  // Busca o horário de funcionamento real salvo no backend (usado pelo
  // agendamento automático de verdade) e sincroniza no painel, se existir.
  useEffect(() => {
    apiFetch('/api/business-hours')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.businessHours) setBusinessHours(data.businessHours);
      })
      .catch(() => {});
  }, []);

  // [CRM] Achado real em produção: OperatorCRM.tsx era 100% mock/localStorage
  // — leads reais que já chegam via WhatsApp nunca apareciam no CRM a menos
  // que alguém cadastrasse cada um manualmente. Busca GET /api/crm/leads
  // (combina conversas reais + estado de CRM já persistido, ver
  // server/routes/crm.ts) e mescla no state local sem NUNCA sobrescrever
  // leads de exemplo locais (mesmo padrão de merge por id já usado em
  // WhatsAppLeadsSim.tsx pra conversas reais).
  useEffect(() => {
    let cancelled = false;
    const fetchCrmLeads = () => {
      apiFetch('/api/crm/leads')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.leads || cancelled) return;
          // Poda leads reais que não vêm mais nesta resposta (ex: sobraram
          // de um tenant anterior, ver leadsCacheKey acima) — mesmo padrão
          // de currentRealIds em WhatsAppLeadsSim.tsx.fetchRealConversations.
          const currentRealIds = new Set((data.leads as any[]).map((crmLead) => `real-${crmLead.phone}`));
          setLeads((prev) => {
            const byId = new Map<string, LeadInfo>(
              prev.filter((l) => !(l as any).isReal || currentRealIds.has(l.id)).map((l) => [l.id, l])
            );
            for (const crmLead of data.leads as any[]) {
              const id = `real-${crmLead.phone}`;
              const existing = byId.get(id);
              byId.set(id, {
                ...(existing || {}),
                id,
                tenantId: activeTenant.id,
                name: crmLead.name || crmLead.phone,
                phone: crmLead.phone,
                email: crmLead.email,
                avatarUrl: (existing as any)?.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
                timestamp: crmLead.updatedAt,
                status: 'transcribed',
                crmStage: crmLead.stage,
                dealValue: crmLead.dealValue,
                assignedOperator: crmLead.assignedOperator,
                crmNotes: crmLead.notes,
                crmTasks: crmLead.tasks,
                isReal: true,
                hasConversation: crmLead.hasConversation,
              } as LeadInfo);
            }
            return Array.from(byId.values());
          });
        })
        .catch(() => {});
    };
    fetchCrmLeads();
    const interval = setInterval(fetchCrmLeads, 8000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id]);

  // Financeiro real (mesmo padrão de fetchCrmLeads acima) — merge por id,
  // marca isReal pra distinguir de dado de demonstração local.
  useEffect(() => {
    let cancelled = false;
    const fetchFinancialTransactions = () => {
      apiFetch('/api/financial/transactions')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.transactions || cancelled) return;
          const currentRealIds = new Set((data.transactions as any[]).map((tx) => tx.id));
          setTransactions((prev) => {
            const byId = new Map<string, FinancialTransaction>(
              prev.filter((t) => !(t as any).isReal || currentRealIds.has(t.id)).map((t) => [t.id, t])
            );
            for (const tx of data.transactions as any[]) {
              byId.set(tx.id, { ...tx, tenantId: activeTenant.id, isReal: true } as FinancialTransaction);
            }
            return Array.from(byId.values());
          });
        })
        .catch(() => {});
    };
    fetchFinancialTransactions();
    const interval = setInterval(fetchFinancialTransactions, 8000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id]);

  useEffect(() => {
    let cancelled = false;
    const fetchEscalations = () => {
      apiFetch('/api/escalations')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.escalations || cancelled) return;
          setEscalations(data.escalations);
        })
        .catch(() => {});
    };
    fetchEscalations();
    const interval = setInterval(fetchEscalations, 8000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id]);

  useEffect(() => {
    if (currentUser) {
      safeSetLocalStorage('saas_current_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('saas_current_user');
    }
  }, [currentUser]);

  // Handlers for Data Updates
  // Upsert: o CRM (OperatorCRM) reaproveita este handler tanto pra editar um
  // lead existente quanto pra inserir um novo (modal "+ Novo Lead Real") — um
  // `.map()` puro nunca casa com um ID novo, então o lead recém-criado
  // desaparecia em silêncio (bug real encontrado na auditoria pré-lançamento).
  const handleUpdateLead = async (updatedLead: LeadInfo) => {
    // [CRM] Leads reais (isReal — vieram de GET /api/crm/leads ou foram
    // cadastrados via "+ Novo Lead Real") persistem de verdade no servidor
    // antes de atualizar a tela — nunca aplica localmente primeiro e torce
    // pra dar certo depois (mesmo padrão de WhatsAppLeadsSim.handleUpdateConversationState,
    // pra nunca parecer salvo sem ter salvado de verdade).
    if (updatedLead.isReal) {
      try {
        const res = await apiFetch(`/api/crm/leads/${encodeURIComponent(updatedLead.phone)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: updatedLead.name,
            email: updatedLead.email,
            stage: updatedLead.crmStage,
            dealValue: updatedLead.dealValue,
            assignedOperator: updatedLead.assignedOperator,
            notes: updatedLead.crmNotes,
            tasks: updatedLead.crmTasks,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('Falha ao salvar CRM no servidor:', err);
        showToast('Não foi possível salvar essa alteração no servidor. Tente de novo.');
        return;
      }
    }
    setLeads((prev) => {
      const exists = prev.some((l) => l.id === updatedLead.id);
      return exists ? prev.map((l) => (l.id === updatedLead.id ? updatedLead : l)) : [updatedLead, ...prev];
    });
  };

  const handleDeleteLead = async (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (lead?.isReal) {
      try {
        const res = await apiFetch(`/api/crm/leads/${encodeURIComponent(lead.phone)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('Falha ao remover CRM no servidor:', err);
        showToast('Não foi possível remover esse lead no servidor. Tente de novo.');
        return;
      }
    }
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    showToast('Lead removido do CRM');
  };

  const handleResolveEscalation = async (id: string) => {
    try {
      const res = await apiFetch(`/api/escalations/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEscalations((prev) => prev.map((e) => (e.id === id ? data.escalation : e)));
    } catch (err) {
      console.error('Falha ao marcar escalonamento como resolvido:', err);
      showToast('Não foi possível marcar como resolvido. Tente de novo.');
    }
  };

  const handleAssignEscalationToSelf = async (id: string) => {
    try {
      const res = await apiFetch(`/api/escalations/${encodeURIComponent(id)}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEscalations((prev) => prev.map((e) => (e.id === id ? data.escalation : e)));
      showToast('Você assumiu este escalonamento.');
    } catch (err) {
      console.error('Falha ao assumir escalonamento:', err);
      showToast('Não foi possível assumir esse caso agora. Tente novamente.');
    }
  };

  // Issue #97 — operador deixa uma orientação em vez de assumir a conversa
  // pessoalmente; o backend decide se a IA já responde agora (dentro da
  // janela de 24h) ou manda o template de reengajamento (fora dela).
  const handleSubmitOperatorReply = async (id: string, reply: string) => {
    try {
      const res = await apiFetch(`/api/escalations/${encodeURIComponent(id)}/operator-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEscalations((prev) => prev.map((e) => (e.id === id ? data.escalation : e)));
      if (data.outcome?.sent && data.outcome.viaTemplate) {
        showToast('Fora da janela de 24h — mandamos um convite pro cliente responder. A IA usa sua orientação assim que ele voltar a escrever.');
      } else if (data.outcome?.sent) {
        showToast('A IA já respondeu ao cliente com base na sua orientação.');
      } else {
        showToast(data.outcome?.reason || 'Orientação salva, mas não deu pra enviar agora. Tente de novo.');
      }
    } catch (err) {
      console.error('Falha ao enviar orientação do operador:', err);
      showToast('Não foi possível enviar sua orientação agora. Tente de novo.');
    }
  };

  const handleGenerateReplySuggestion = async (id: string): Promise<EscalationInfo | null> => {
    try {
      const res = await apiFetch(`/api/escalations/${encodeURIComponent(id)}/reply-suggestion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setEscalations((prev) => prev.map((e) => (e.id === id ? data.escalation : e)));
      showToast('Sugestão segura gerada. Revise antes de copiar; nada foi enviado.');
      return data.escalation as EscalationInfo;
    } catch (err: any) {
      console.error('Falha ao gerar sugestão supervisionada:', err);
      showToast(err?.message || 'Não foi possível gerar a sugestão agora. O bloqueio permanece.');
      return null;
    }
  };

  const handleReplySuggestionFeedback = async (
    id: string,
    suggestion: string,
    status: 'edited' | 'copied' | 'discarded',
  ): Promise<EscalationInfo | null> => {
    try {
      const res = await apiFetch(`/api/escalations/${encodeURIComponent(id)}/reply-suggestion-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestion, status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setEscalations((prev) => prev.map((e) => (e.id === id ? data.escalation : e)));
      if (status === 'edited') showToast('Edição da sugestão salva para auditoria.');
      if (status === 'copied') showToast('Resposta copiada. Revise novamente antes de qualquer envio.');
      if (status === 'discarded') showToast('Sugestão descartada; o bloqueio continua registrado.');
      return data.escalation as EscalationInfo;
    } catch (err) {
      console.error('Falha ao registrar feedback da sugestão supervisionada:', err);
      showToast('Não foi possível registrar essa ação da sugestão. Tente novamente.');
      return null;
    }
  };

  // Verificação de pagamento unificada aqui (pedido real do dono do
  // produto, 12/08/2026) — antes existiam dois lugares desconectados pro
  // mesmo caso: o banner Confirmar/Rejeitar dentro da conversa, e este
  // escalonamento gerado automaticamente pro mesmo comprovante.
  const handleResolvePaymentEscalation = async (id: string, phone: string, status: 'verified' | 'rejected', reply?: string) => {
    try {
      const res = await apiFetch(`/api/escalations/${encodeURIComponent(id)}/resolve-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, status, reply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.escalation) {
        setEscalations((prev) => prev.map((e) => (e.id === id ? data.escalation : e)));
      }
      if (data.outcome?.sent && data.outcome.viaTemplate) {
        showToast('Pagamento rejeitado — fora da janela de 24h, mandamos um convite pro cliente responder antes de explicar o motivo.');
      } else if (data.outcome?.sent) {
        showToast(status === 'verified' ? 'Pagamento confirmado e cliente avisado.' : 'Pagamento rejeitado e cliente avisado do motivo.');
      } else if (status === 'verified') {
        showToast('Pagamento confirmado.');
      } else {
        showToast('Pagamento rejeitado.');
      }
    } catch (err) {
      console.error('Falha ao resolver verificação de pagamento:', err);
      showToast('Não foi possível registrar a verificação de pagamento agora — tente de novo.');
    }
  };

  const handleDeleteEscalation = async (id: string) => {
    try {
      const res = await apiFetch(`/api/escalations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEscalations((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      console.error('Falha ao remover escalonamento:', err);
      showToast('Não foi possível remover esse escalonamento. Tente de novo.');
    }
  };

  // Toda cobrança criada pelo botão "Registrar Transferência / Venda" do
  // painel é uma ação real de operador — persiste no servidor sempre, mesmo
  // padrão de handleUpdateLead: nunca aplica local antes de confirmar.
  // Devolve true/false pro FinancialDashboard.tsx saber se deve mostrar a
  // tela de sucesso — achado real testando: antes disso o modal mostrava
  // "Registrado com sucesso" mesmo quando o POST falhava (ex: 401), porque
  // a chamada era fire-and-forget e o componente nunca esperava o resultado.
  const handleAddTransaction = async (newTx: FinancialTransaction): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/financial/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newTx.id,
          leadId: newTx.leadId,
          leadName: newTx.leadName,
          leadPhone: newTx.leadPhone,
          productName: newTx.productName,
          amount: newTx.amount,
          paymentMethod: newTx.paymentMethod,
          status: newTx.status,
          date: newTx.date,
          operatorName: newTx.operatorName,
          channel: newTx.channel,
          pixQrCode: newTx.pixQrCode,
          paymentLinkUrl: newTx.paymentLinkUrl,
          entryType: newTx.entryType,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Falha ao salvar cobrança no servidor:', err);
      showToast('Não foi possível salvar essa cobrança no servidor. Tente de novo.');
      return false;
    }
    setTransactions((prev) => [{ ...newTx, isReal: true }, ...prev]);
    showToast('Transação registrada com sucesso!');
    return true;
  };

  const handleUpdateTransactionStatus = async (id: string, newStatus: any) => {
    const tx = transactions.find((t) => t.id === id);
    if (tx?.isReal) {
      try {
        const res = await apiFetch(`/api/financial/transactions/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('Falha ao atualizar status da cobrança no servidor:', err);
        showToast('Não foi possível atualizar o status no servidor. Tente de novo.');
        return;
      }
    }
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
    showToast('Status do pagamento atualizado');
  };

  const handleDeleteTransaction = async (txId: string) => {
    const tx = transactions.find((t) => t.id === txId);
    if (tx?.isReal) {
      try {
        const res = await apiFetch(`/api/financial/transactions/${encodeURIComponent(txId)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('Falha ao remover cobrança no servidor:', err);
        showToast('Não foi possível remover essa cobrança no servidor. Tente de novo.');
        return;
      }
    }
    setTransactions((prev) => prev.filter((t) => t.id !== txId));
    showToast('Fatura excluída');
  };

  const handleSelectTenant = (tenant: Tenant) => {
    setActiveTenant(tenant);
    safeSetLocalStorage(ACTIVE_TENANT_OVERRIDE_KEY, tenant.id);
    showToast(`Empresa alterada para: ${tenant.name}`);
  };

  // Tab Cross-Navigation Handlers
  const handleNavigateToFinancial = (lead: LeadInfo) => {
    setFinancialPreselectedLead(lead);
    handleSetActiveTab('agenda_financeiro');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-emerald-500 selection:text-slate-950">
      
      {/* Header Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        savedCount={savedTranscripts.length}
        currentUser={currentUser}
        onOpenLoginModal={() => setIsLoginModalOpen(true)}
        onLogout={() => {
          handleSetActiveTab('home');
          setCurrentUser(null);
          setAuthToken(null);
          setIsLoginModalOpen(true);
          clearCachedTenantScopedData();
          showToast('Sessão encerrada');
        }}
        tenants={tenants}
        activeTenant={activeTenant}
        onSelectTenant={handleSelectTenant}
      />

      {/* Main Content Area */}
      <main className="app-main mx-auto w-full max-w-7xl space-y-5 p-3 sm:p-6 lg:p-8">
        
        {/* Toast Alert */}
        {toastMsg && (
          <div className="app-toast fixed right-3 top-3 z-50 flex items-center gap-2 rounded-xl border border-emerald-400 bg-emerald-600 px-3 py-2 text-xs font-bold text-slate-950 shadow-xl animate-fade-in sm:right-4 sm:top-4">
            <span>{toastMsg}</span>
          </div>
        )}

        {activeTab === 'home' && (
          <OperationsCenter
            activeTenant={activeTenant}
            currentUser={currentUser}
            leads={leads}
            transactions={transactions}
            escalations={escalations}
            canSeeFinancial={canSeeFinancial}
            canSeeAdminTools={canSeeAdminTools}
            onNavigate={handleSetActiveTab}
          />
        )}

        {activeTab === 'saas' && canSeeSaasMaster && (
          <SaaSAdminDashboard
            tenants={tenants}
            activeTenant={activeTenant}
            onSelectTenant={handleSelectTenant}
            onAddTenant={(newT) => {
              setTenants((prev) => [newT, ...prev]);
              showToast(`Nova empresa ${newT.name} cadastrada`);
            }}
            onUpdateTenant={(updatedT) => {
              setTenants((prev) => prev.map((t) => (t.id === updatedT.id ? updatedT : t)));
              if (activeTenant.id === updatedT.id) setActiveTenant(updatedT);
              showToast('Empresa atualizada');
            }}
            currentUser={currentUser || GUEST_USER}
          />
        )}

        {/* Sempre montado (visibilidade controlada por CSS, não por
            montagem/desmontagem condicional) — desmontar ao trocar de aba e
            remontar ao voltar fazia o componente reconstruir seu estado a
            partir do localStorage desatualizado (`saas_crm_leads`),
            perdendo temporariamente mensagens reais recém-chegadas do
            polling até o próximo ciclo de 8s. Bug real relatado em
            produção: mensagem aparecia e sumia da conversa. */}
        <div style={{ display: activeTab === 'whatsapp' ? 'block' : 'none' }}>
          <AtendimentoWorkspaceFrame
            activeTenantName={activeTenant.name}
            activeTenant={activeTenant}
            tenants={tenants}
            canSwitchTenant={canSeeSaasMaster}
            onSelectTenant={handleSelectTenant}
            pendingCount={escalations.filter((e) => !e.resolved).length}
            leadCount={leads.length}
            onOpenEscalations={() => handleSetActiveTab('escalations')}
          >
          <WhatsAppLeadsSim
            key={activeTenant.id}
            knowledgeBase={knowledgeBase}
            activeTenant={activeTenant}
            canManageWhatsAppConnection={canSeeAdminTools}
            onSaveTranscript={(item) => {
              setSavedTranscripts((prev) => [item, ...prev]);
              showToast('Atendimento salvo no histórico');
            }}
            onAddNewLead={(newLead) => {
              setLeads((prev) => [newLead, ...prev]);
              showToast(`Lead ${newLead.name} cadastrado no CRM`);
            }}
            onDeleteLead={handleDeleteLead}
            escalationsPendingCount={escalations.filter((e) => !e.resolved).length}
            onGoToEscalations={() => handleSetActiveTab('escalations')}
            openLeadPhone={whatsAppOpenLead?.phone}
            openLeadRequestId={whatsAppOpenLead?.requestId}
          />
          </AtendimentoWorkspaceFrame>
        </div>

        {activeTab === 'crm' && (
          <OperationsModuleFrame title="CRM e Vendas" eyebrow="Relacionamento comercial" description="Acompanhe oportunidades, clientes e próximas ações em uma visão conectada ao atendimento." accent="blue">
          <OperatorCRM
            leads={leads}
            onUpdateLead={handleUpdateLead}
            onDeleteLead={handleDeleteLead}
            onClearAllLeads={() => {
              setLeads([]);
              showToast('Leads limpos do CRM');
            }}
            currentUser={currentUser || GUEST_USER}
                        onNavigateToFinancial={handleNavigateToFinancial}
          />
          </OperationsModuleFrame>
        )}
        {activeTab === 'agenda_financeiro' && canSeeFinancial && (
          <OperationsModuleFrame
            title="Agenda & Financeiro"
            eyebrow="Operação financeira"
            description="Organize horários, recebimentos e confirmações em uma única visão operacional."
            accent="blue"
          >
          <AgendaFinanceiroCenter
            transactions={transactions}
            onAddTransaction={handleAddTransaction}
            onUpdateTransactionStatus={handleUpdateTransactionStatus}
            onDeleteTransaction={handleDeleteTransaction}
            leads={leads}
            currentUser={currentUser || GUEST_USER}
            currency={activeTenant.currency}
            locale={activeTenant.locale}
                        onToast={showToast}
          />
          </OperationsModuleFrame>
        )}
        {activeTab === 'attribution' && canSeeAdminTools && (
          <AdAttributionCAPI
            leads={leads}
            onTriggerCAPIEvent={(lead, eventName) => {
              showToast(`Evento Meta CAPI [${eventName}] enviado para ${lead.name}`);
            }}
            onAddNewAttributedLead={(newLead) => {
              setLeads((prev) => [newLead, ...prev]);
              showToast(`Lead ${newLead.name} adicionado via simulador CAPI`);
            }}
          />
        )}

        {activeTab === 'knowledge' && canSeeAdminTools && !kbLoaded && (
          <div className="p-6 text-sm text-slate-400">Carregando base de conhecimento…</div>
        )}

        {activeTab === 'knowledge' && canSeeAdminTools && kbLoaded && (
          <AgentKnowledgeBaseView
            knowledgeBase={knowledgeBase}
            businessHours={businessHours}
            onSaveBusinessHours={async (updatedHours) => {
              try {
                const res = await apiFetch('/api/business-hours', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ businessHours: updatedHours }),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                setBusinessHours(updatedHours);
                showToast('Horário de funcionamento salvo!');
                return true;
              } catch (err) {
                console.error('Falha ao salvar horário de funcionamento no backend:', err);
                showToast('Não foi possível salvar o horário — o agendamento automático pode continuar usando o horário antigo. Tente novamente.');
                return false;
              }
            }}
            onSaveKnowledgeBase={async (updatedKb) => {
              setKnowledgeBase(updatedKb);
              try {
                const res = await apiFetch('/api/knowledge-base', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ knowledgeBase: updatedKb }),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                showToast('Base de conhecimento do Agente salva!');
                return true;
              } catch (err) {
                console.error('Falha ao salvar base de conhecimento no backend:', err);
                showToast('Não foi possível salvar no servidor — o agente pode continuar respondendo com a base antiga. Tente novamente.');
                return false;
              }
            }}
            canUseBusinessTemplates={canSeeSaasMaster}
            publicCatalogSlug={activeTenant.slug}
            onGoToWhatsAppSim={() => handleSetActiveTab('whatsapp')}
            // Pedido real do saas_admin (18/08/2026): os "Modelos de Negócio
            // Prontos" são fixos em código — isso deixa carregar a Base de
            // Conhecimento REAL de outro tenant como ponto de partida pra
            // configurar um tenant novo. Só saas_admin vê essa opção (outras
            // tenants são dado de outro cliente); a rota no backend também
            // exige esse papel.
            copyableTenants={canSeeSaasMaster ? tenants.filter((t) => t.id !== activeTenant.id) : []}
            onFetchTenantKnowledgeBase={async (sourceTenantId) => {
              try {
                const res = await apiFetch(`/api/admin/tenants/${encodeURIComponent(sourceTenantId)}/knowledge-base`);
                if (!res.ok) {
                  const data = await res.json().catch(() => null);
                  showToast(data?.error || 'Não foi possível carregar a base de conhecimento desse tenant.');
                  return null;
                }
                const data = await res.json();
                return data.knowledgeBase as AgentKnowledgeBase;
              } catch (err) {
                console.error('Falha ao buscar base de conhecimento de outro tenant:', err);
                showToast('Não foi possível carregar a base de conhecimento desse tenant. Tente de novo.');
                return null;
              }
            }}
          />
        )}

        {activeTab === 'catalog' && canSeeAdminTools && (
          <PublicCatalogSettings
            tenantSlug={activeTenant.slug}
            tenantName={activeTenant.name}
            products={knowledgeBase.products || []}
            activeProductCount={(knowledgeBase.products || []).filter((product) => product.active !== false).length}
            onGoToKnowledgeBase={() => handleSetActiveTab('knowledge')}
          />
        )}

        {activeTab === 'escalations' && (
          <OperationsModuleFrame title="Escalonamentos" eyebrow="Decisões humanas" description="Resolva pendências e retome a conversa no ponto exato em que a operação precisa de você." accent="green">
          <EscalationsPanel
            escalations={escalations}
            onResolve={handleResolveEscalation}
            onDelete={handleDeleteEscalation}
            onAssignSelf={handleAssignEscalationToSelf}
            onSubmitOperatorReply={handleSubmitOperatorReply}
            onGenerateReplySuggestion={handleGenerateReplySuggestion}
            onReplySuggestionFeedback={handleReplySuggestionFeedback}
            onResolvePayment={handleResolvePaymentEscalation}
            onGoToConversation={(phone) => {
              setWhatsAppOpenLead({ phone, requestId: Date.now() });
              handleSetActiveTab('whatsapp');
            }}
                    />
          </OperationsModuleFrame>
        )}
        {activeTab === 'quality' && canSeeAdminTools && (
          <OperationsModuleFrame title="Qualidade da IA" eyebrow="Aprendizado operacional" description="Transforme revisões humanas em regras e melhorias consistentes para o atendimento." accent="green">
            <QualityAuditCenter onToast={showToast} />
          </OperationsModuleFrame>
        )}

      </main>

      {/* Login / Switch Profile Modal */}
      <LoginModal
        isOpen={isLoginModalOpen || !currentUser}
        isForcedLogin={!currentUser}
        onClose={() => {
          if (currentUser) setIsLoginModalOpen(false);
        }}
        onLogin={(usr, token) => {
          setCurrentUser(usr);
          setAuthToken(token || null);
          setIsLoginModalOpen(false);
          showToast(`Bem-vindo, ${usr.name}!`);
        }}
      />

    </div>
  );
};

export default App;
