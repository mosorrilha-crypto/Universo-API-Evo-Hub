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
import { GoogleCalendarIntegration } from './components/GoogleCalendarIntegration';
import { AdAttributionCAPI } from './components/AdAttributionCAPI';
import { AgentKnowledgeBaseView, moniqueStudioKnowledgeBase } from './components/AgentKnowledgeBase';
import { EvoHubIntegration } from './components/EvoHubIntegration';
import { WhatsAppGuide } from './components/WhatsAppGuide';
import { LoginModal } from './components/LoginModal';

import { INITIAL_TENANTS, SAAS_DEMO_USERS } from './data/mockTenants';
import { INITIAL_MOCK_LEADS } from './data/mockLeads';
import { INITIAL_TRANSACTIONS } from './data/mockTransactions';

export const App: React.FC = () => {
  // Navigation & View State
  const [activeTab, setActiveTab] = useState<ActiveTab>('saas');
  
  // Tenants & Active Company
  const [tenants, setTenants] = useState<Tenant[]>(() => {
    const saved = localStorage.getItem('saas_tenants');
    return saved ? JSON.parse(saved) : INITIAL_TENANTS;
  });
  const [activeTenant, setActiveTenant] = useState<Tenant>(tenants[0] || INITIAL_TENANTS[0]);

  // Auth User
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem('saas_current_user');
    return saved ? JSON.parse(saved) : SAAS_DEMO_USERS[0]; // Monique Sorrilha as default
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
  const [calendarPreselectedLead, setCalendarPreselectedLead] = useState<LeadInfo | null>(null);

  // Toast Notification
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

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

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('saas_current_user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('saas_current_user');
    }
  }, [currentUser]);

  // Handlers for Data Updates
  const handleUpdateLead = (updatedLead: LeadInfo) => {
    setLeads((prev) => prev.map((l) => (l.id === updatedLead.id ? updatedLead : l)));
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

  const handleNavigateToCalendar = (lead: LeadInfo) => {
    setCalendarPreselectedLead(lead);
    setActiveTab('calendar');
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

        {activeTab === 'whatsapp' && (
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
        )}

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
            onNavigateToCalendar={handleNavigateToCalendar}
          />
        )}

        {activeTab === 'calendar' && (
          <GoogleCalendarIntegration
            activeTenant={activeTenant}
            leads={leads}
            showToast={showToast}
            initialLeadForSync={calendarPreselectedLead}
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
        onLogin={(usr) => {
          setCurrentUser(usr);
          setIsLoginModalOpen(false);
          showToast(`Bem-vindo, ${usr.name}!`);
        }}
      />

    </div>
  );
};

export default App;
