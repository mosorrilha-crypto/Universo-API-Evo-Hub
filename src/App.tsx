import React, { useState, useEffect } from 'react';
import { 
  ActiveTab, 
  Tenant, 
  UserProfile, 
  LeadInfo, 
  FinancialTransaction, 
  AgentKnowledgeBase, 
  SavedTranscriptItem 
} from './types';
import { Header } from './components/Header';
import { SaaSAdminDashboard } from './components/SaaSAdminDashboard';
import { WhatsAppLeadsSim } from './components/WhatsAppLeadsSim';
import { OperatorCRM } from './components/OperatorCRM';
import { FinancialDashboard } from './components/FinancialDashboard';
import { AdAttributionCAPI } from './components/AdAttributionCAPI';
import { AgentKnowledgeBaseView, moniqueStudioKnowledgeBase } from './components/AgentKnowledgeBase';
import { EvoHubIntegration } from './components/EvoHubIntegration';
import { WhatsAppGuide } from './components/WhatsAppGuide';
import { LoginModal } from './components/LoginModal';
import { setAuthToken, setUnauthorizedHandler, apiFetch } from './lib/apiClient';

import { INITIAL_TENANTS, SAAS_DEMO_USERS } from './data/mockTenants';
import { INITIAL_MOCK_LEADS } from './data/mockLeads';
import { INITIAL_TRANSACTIONS } from './data/mockTransactions';

export const App: React.FC = () => {
  // Navigation & View State
  const [activeTab, setActiveTab] = useState<ActiveTab>('saas');
  
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
  const handleUpdateLead = (updatedLead: LeadInfo) => {
    setLeads((prev) => {
      const exists = prev.some((l) => l.id === updatedLead.id);
      return exists ? prev.map((l) => (l.id === updatedLead.id ? updatedLead : l)) : [updatedLead, ...prev];
    });
  };

  const handleDeleteLead = (leadId: string) => {
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    showToast('Lead removido do CRM');
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
            currentUser={currentUser || SAAS_DEMO_USERS[0]}
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
            currentUser={currentUser || SAAS_DEMO_USERS[0]}
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
            currentUser={currentUser || SAAS_DEMO_USERS[0]}
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
            onSaveKnowledgeBase={(updatedKb) => {
              setKnowledgeBase(updatedKb);
              apiFetch('/api/knowledge-base', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ knowledgeBase: updatedKb }),
              }).catch((err) => console.error('Falha ao salvar base de conhecimento no backend:', err));
              showToast('Base de conhecimento do Agente salva!');
            }}
            onGoToWhatsAppSim={() => setActiveTab('whatsapp')}
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
