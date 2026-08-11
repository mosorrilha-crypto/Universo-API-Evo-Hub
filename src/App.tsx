import React, { useState, useEffect } from 'react';
import { 
  ActiveTab,
  Tenant,
  UserProfile,
  LeadInfo,
  FinancialTransaction,
  AgentKnowledgeBase,
  SavedTranscriptItem,
  EscalationInfo
} from './types';
import { Header } from './components/Header';
import { SaaSAdminDashboard } from './components/SaaSAdminDashboard';
import { WhatsAppLeadsSim } from './components/WhatsAppLeadsSim';
import { OperatorCRM } from './components/OperatorCRM';
import { EscalationsPanel } from './components/EscalationsPanel';
import { FinancialDashboard } from './components/FinancialDashboard';
import { AdAttributionCAPI } from './components/AdAttributionCAPI';
import { AgentKnowledgeBaseView, moniqueStudioKnowledgeBase } from './components/AgentKnowledgeBase';
import { EvoHubIntegration } from './components/EvoHubIntegration';
import { WhatsAppGuide } from './components/WhatsAppGuide';
import { LoginModal } from './components/LoginModal';
import { setAuthToken, setUnauthorizedHandler, apiFetch } from './lib/apiClient';

import { INITIAL_TENANTS } from './data/mockTenants';
import { INITIAL_MOCK_LEADS } from './data/mockLeads';
import { INITIAL_TRANSACTIONS } from './data/mockTransactions';

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

export const App: React.FC = () => {
  // Navigation & View State
  const [activeTab, setActiveTab] = useState<ActiveTab>('saas');
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
    // Migração (07/08/2026): navegadores que já tinham os tenants fictícios
    // de demonstração salvos no localStorage (Drogaria, MetaLeads, FitLife)
    // continuariam vendo esses cards mesmo depois de removidos do código —
    // filtra pra manter só os IDs conhecidos (o real da Monique) e cai pro
    // INITIAL_TENANTS atual se não sobrar nenhum tenant reconhecido.
    const parsed = JSON.parse(saved) as Tenant[];
    const knownIds = new Set(INITIAL_TENANTS.map((t) => t.id));
    const filtered = parsed.filter((t) => knownIds.has(t.id));
    return filtered.length ? filtered : INITIAL_TENANTS;
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

  // CRM Leads
  const [leads, setLeads] = useState<LeadInfo[]>(() => {
    const saved = localStorage.getItem('saas_crm_leads');
    return saved ? JSON.parse(saved) : INITIAL_MOCK_LEADS;
  });

  // Financial Transactions
  const [transactions, setTransactions] = useState<FinancialTransaction[]>(() => {
    const saved = localStorage.getItem('saas_transactions');
    return saved ? JSON.parse(saved) : INITIAL_TRANSACTIONS;
  });

  // Agent Knowledge Base
  const [knowledgeBase, setKnowledgeBase] = useState<AgentKnowledgeBase>(() => {
    const saved = localStorage.getItem('saas_agent_kb');
    return saved ? JSON.parse(saved) : moniqueStudioKnowledgeBase;
  });

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
      showToast('Sessão expirada — faça login novamente.');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Sync state to local storage
  useEffect(() => {
    localStorage.setItem('saas_tenants', JSON.stringify(tenants));
  }, [tenants]);

  useEffect(() => {
    localStorage.setItem('saas_crm_leads', JSON.stringify(leads));
  }, [leads]);

  useEffect(() => {
    localStorage.setItem('saas_transactions', JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem('saas_agent_kb', JSON.stringify(knowledgeBase));
  }, [knowledgeBase]);

  // Busca a base de conhecimento real salva no backend (usada pelo agente
  // automático de verdade) e sincroniza no painel, se existir.
  useEffect(() => {
    apiFetch('/api/knowledge-base')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
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
          setLeads((prev) => {
            const byId = new Map<string, LeadInfo>(prev.map((l) => [l.id, l]));
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
      localStorage.setItem('saas_current_user', JSON.stringify(currentUser));
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

  const handleAddTransaction = (newTx: FinancialTransaction) => {
    setTransactions((prev) => [newTx, ...prev]);
    showToast('Nova fatura gerada com sucesso!');
  };

  const handleUpdateTransactionStatus = (id: string, newStatus: any) => {
    setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, status: newStatus } : tx)));
    showToast('Status do pagamento atualizado');
  };

  const handleDeleteTransaction = (txId: string) => {
    setTransactions((prev) => prev.filter((tx) => tx.id !== txId));
    showToast('Fatura excluída');
  };

  const handleSelectTenant = (tenant: Tenant) => {
    setActiveTenant(tenant);
    showToast(`Empresa alterada para: ${tenant.name}`);
  };

  const handleClearAllMockData = () => {
    if (window.confirm('Tem certeza que deseja zerar todos os dados fictícios para entrar em modo de produção limpo?')) {
      setLeads([]);
      setTransactions([]);
      setSavedTranscripts([]);
      // Achado real em produção: o "Gerenciador de Usuários" (Painel SaaS
      // Master) guarda sua própria lista fictícia numa chave separada de
      // localStorage, gerenciada só dentro de SaaSAdminDashboard.tsx (nunca
      // fala com a tabela real `operators` do Supabase) — esse botão nunca
      // limpava ela, deixando nomes/e-mails fictícios (Carlos Silva, Ricardo
      // Santos etc) presos no navegador mesmo depois de "limpar tudo". O
      // componente só lê essa chave no mount, então remover aqui já resolve
      // na próxima vez que a aba "Painel SaaS Master" for aberta.
      localStorage.removeItem('saas_users_list');
      showToast('Dados limpos! Canvas pronto para produção.');
    }
  };

  const handleLoadDemoData = () => {
    setLeads(INITIAL_MOCK_LEADS);
    setTransactions(INITIAL_TRANSACTIONS);
    setKnowledgeBase(moniqueStudioKnowledgeBase);
    showToast('Dados de demonstração restaurados!');
  };

  const handleExportBackup = () => {
    const backupData = {
      tenants,
      leads,
      transactions,
      knowledgeBase,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_saas_${activeTenant.id}_${Date.now()}.json`;
    a.click();
    showToast('Backup JSON gerado com sucesso!');
  };

  // Tab Cross-Navigation Handlers
  const handleNavigateToFinancial = (lead: LeadInfo) => {
    setFinancialPreselectedLead(lead);
    setActiveTab('financial');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      
      {/* Header Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        savedCount={savedTranscripts.length}
        currentUser={currentUser}
        onOpenLoginModal={() => setIsLoginModalOpen(true)}
        onLogout={() => {
          setCurrentUser(null);
          setAuthToken(null);
          setIsLoginModalOpen(true);
          showToast('Sessão encerrada');
        }}
        tenants={tenants}
        activeTenant={activeTenant}
        onSelectTenant={handleSelectTenant}
        onClearAllMockData={handleClearAllMockData}
        onLoadDemoData={handleLoadDemoData}
        onExportBackup={handleExportBackup}
        leadsCount={leads.length}
        transactionsCount={transactions.length}
        demoLeadsCount={leads.filter((l) => !l.isReal).length}
        escalationsPendingCount={escalations.filter((e) => !e.resolved).length}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        
        {/* Toast Alert */}
        {toastMsg && (
          <div className="fixed top-20 right-6 z-50 bg-emerald-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl shadow-xl animate-fade-in border border-emerald-400 text-xs flex items-center gap-2">
            <span>{toastMsg}</span>
          </div>
        )}

        {activeTab === 'saas' && (
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
          <WhatsAppLeadsSim
            knowledgeBase={knowledgeBase}
            activeTenant={activeTenant}
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
            onGoToEscalations={() => setActiveTab('escalations')}
            openLeadPhone={whatsAppOpenLead?.phone}
            openLeadRequestId={whatsAppOpenLead?.requestId}
          />
        </div>

        {activeTab === 'crm' && (
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
        )}

        {activeTab === 'financial' && (
          <FinancialDashboard
            transactions={transactions}
            onAddTransaction={handleAddTransaction}
            onUpdateTransactionStatus={handleUpdateTransactionStatus}
            onDeleteTransaction={handleDeleteTransaction}
            onClearAllTransactions={() => {
              setTransactions([]);
              showToast('Faturas limpas');
            }}
            leads={leads}
            currentUser={currentUser || GUEST_USER}
            initialSelectedLead={financialPreselectedLead}
          />
        )}

        {activeTab === 'attribution' && (
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

        {activeTab === 'knowledge' && (
          <AgentKnowledgeBaseView
            knowledgeBase={knowledgeBase}
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
            onGoToWhatsAppSim={() => setActiveTab('whatsapp')}
          />
        )}

        {activeTab === 'escalations' && (
          <EscalationsPanel
            escalations={escalations}
            onResolve={handleResolveEscalation}
            onDelete={handleDeleteEscalation}
            onGoToConversation={(phone) => {
              setWhatsAppOpenLead({ phone, requestId: Date.now() });
              setActiveTab('whatsapp');
            }}
          />
        )}

        {activeTab === 'evohub' && (
          <EvoHubIntegration
            activeTenant={activeTenant}
            showToast={showToast}
          />
        )}

        {activeTab === 'integration' && (
          <WhatsAppGuide />
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
