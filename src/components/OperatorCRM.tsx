import React, { useState } from 'react';
import { LeadInfo, CRMStage, UserProfile, CRMOperatorNote, CRMTask, LeadSourceChannel } from '../types';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import { useAppPreferences } from '../contexts/AppPreferencesContext';
import {
  Kanban,
  List,
  Search,
  Filter,
  User,
  Phone,
  DollarSign,
  MessageSquare,
  Sparkles,
  ChevronRight,
  Plus,
  CheckCircle2,
  Clock,
  ArrowUpRight,
  Send,
  Tag,
  FileText,
  TrendingUp,
  X,
  Share2,
  Trash2,
  Mail,
  Building2,
  UserPlus
} from 'lucide-react';
// AlertTriangle removido daqui: era só pro banner "não conectado ao backend real",
// que ficou desatualizado (o CRM já persiste de verdade, ver server/routes/crm.ts).

interface OperatorCRMProps {
  leads?: LeadInfo[];
  onUpdateLead?: (updatedLead: LeadInfo) => void;
  onDeleteLead?: (leadId: string) => void;
  onClearAllLeads?: () => void;
  currentUser?: UserProfile | any;
  currentOperator?: any;
  tenantId?: string;
  onNavigateToFinancial?: (lead: LeadInfo) => void;
  /** A moldura móvel escolhe o contexto visível sem alterar os dados do CRM. */
  mobileSection?: 'leads' | 'insights' | 'board';
}

const STAGES_BASE: { id: CRMStage; label: string; color: string; badge: string }[] = [
  { id: 'novo', label: 'Novo Lead', color: 'border-blue-500/50 bg-blue-950/20 text-blue-300', badge: 'bg-blue-500/20 text-blue-300' },
  { id: 'contato', label: 'Contato Realizado', color: 'border-yellow-500/50 bg-yellow-950/20 text-yellow-300', badge: 'bg-yellow-500/20 text-yellow-300' },
  { id: 'proposta', label: 'Proposta Enviada', color: 'border-sky-500/50 bg-sky-950/20 text-sky-300', badge: 'bg-sky-500/20 text-sky-300' },
  { id: 'negociacao', label: 'Em Negociação', color: 'border-amber-500/50 bg-amber-950/20 text-amber-300', badge: 'bg-amber-500/20 text-amber-300' },
  { id: 'ganho', label: 'Fechado / Ganho', color: 'border-emerald-500/50 bg-emerald-950/20 text-emerald-300', badge: 'bg-emerald-500/20 text-emerald-300' },
  { id: 'perdido', label: 'Perdido', color: 'border-rose-500/50 bg-rose-950/20 text-rose-300', badge: 'bg-rose-500/20 text-rose-300' },
];

export const OperatorCRM: React.FC<OperatorCRMProps> = ({
  leads: propLeads,
  onUpdateLead,
  onDeleteLead,
  onClearAllLeads,
  currentUser: propCurrentUser,
  currentOperator,
  onNavigateToFinancial,
  mobileSection = 'leads',
}) => {
  const { language } = useAppPreferences();
  const isSpanish = language === 'es';
  const locale = isSpanish ? 'es-PY' : 'pt-BR';
  const STAGES: { id: CRMStage; label: string; color: string; badge: string }[] = isSpanish ? [
    { id: 'novo', label: 'Lead nuevo', color: 'border-blue-500/50 bg-blue-950/20 text-blue-300', badge: 'bg-blue-500/20 text-blue-300' },
    { id: 'contato', label: 'Contacto realizado', color: 'border-yellow-500/50 bg-yellow-950/20 text-yellow-300', badge: 'bg-yellow-500/20 text-yellow-300' },
    { id: 'proposta', label: 'Propuesta enviada', color: 'border-sky-500/50 bg-sky-950/20 text-sky-300', badge: 'bg-sky-500/20 text-sky-300' },
    { id: 'negociacao', label: 'En negociación', color: 'border-amber-500/50 bg-amber-950/20 text-amber-300', badge: 'bg-amber-500/20 text-amber-300' },
    { id: 'ganho', label: 'Cerrado / ganado', color: 'border-emerald-500/50 bg-emerald-950/20 text-emerald-300', badge: 'bg-emerald-500/20 text-emerald-300' },
    { id: 'perdido', label: 'Perdido', color: 'border-rose-500/50 bg-rose-950/20 text-rose-300', badge: 'bg-rose-500/20 text-rose-300' },
  ] : STAGES_BASE;
  const formatAmount = (value: number) => `Gs. ${value.toLocaleString(locale)}`;
  const leads = propLeads || [];
  const currentUser = propCurrentUser || currentOperator || { name: 'Operador Admin', id: 'op_1' };
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const displayViewMode = mobileSection === 'leads' ? 'list' : mobileSection === 'board' ? 'kanban' : viewMode;
  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [selectedLead, setSelectedLead] = useState<LeadInfo | null>(null);

  // New Note State
  const [newNoteText, setNewNoteText] = useState('');
  // New Task State
  const [newTaskTitle, setNewTaskTitle] = useState('');

  // New Lead Modal State
  const [isNewLeadModalOpen, setIsNewLeadModalOpen] = useState(false);
  const [leadName, setLeadName] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadValue, setLeadValue] = useState<number>(3500);
  const [leadChannel, setLeadChannel] = useState<LeadSourceChannel>('meta_ads');
  const [leadStage, setLeadStage] = useState<CRMStage>('novo');
  const [leadSegment, setLeadSegment] = useState('Orçamento Comercial / Serviços');
  const [leadNotes, setLeadNotes] = useState('');

  const handleCreateNewLead = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadName.trim() || !leadPhone.trim()) return;

    const newLead: LeadInfo = {
      // [CRM] id precisa bater com o mesmo esquema (`real-${phone}`) que
      // GET /api/crm/leads usa pra leads reais — senão o próximo polling
      // (App.tsx, a cada 8s) cria uma linha DUPLICADA pro mesmo telefone
      // assim que o cadastro é persistido de verdade no servidor.
      id: `real-${leadPhone.trim()}`,
      name: leadName.trim(),
      phone: leadPhone.trim(),
      timestamp: (isSpanish ? 'Hoy, ' : 'Hoje, ') + new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      audioDuration: 0,
      status: 'pending',
      isReal: true,
      crmStage: leadStage,
      dealValue: Number.isFinite(Number(leadValue)) ? Number(leadValue) : 2500,
      sampleType: leadSegment || 'Atendimento Comercial Real',
      assignedOperator: currentUser.name,
      attribution: {
        sourceChannel: leadChannel,
        channelLabel: leadChannel === 'meta_ads' ? 'Meta Ads (Instagram & Facebook)' : leadChannel === 'google_ads' ? 'Google Ads (Search)' : 'WhatsApp Direto',
        campaignName: 'Campanha_Manual_Real_2026',
        adName: 'Contato_Direto_Cliente',
        utmParams: {
          utm_source: leadChannel,
          utm_medium: 'cpc',
          utm_campaign: 'Campanha_Producao_Real',
        },
      },
      crmNotes: leadNotes.trim() ? [{
        id: `note_${Date.now()}`,
        authorName: currentUser.name,
        text: leadNotes.trim(),
        createdAt: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      }] : [],
    };

    onUpdateLead(newLead);
    setIsNewLeadModalOpen(false);

    // Reset Form
    setLeadName('');
    setLeadPhone('');
    setLeadEmail('');
    setLeadValue(3500);
    setLeadNotes('');
  };

  const getLeadStage = (lead: LeadInfo): CRMStage => {
    if (lead.crmStage) return lead.crmStage;
    // Map default status to stage
    if (lead.status === 'transcribed' && lead.fullAnalysis?.dealProbability && lead.fullAnalysis.dealProbability > 70) {
      return 'negociacao';
    }
    return 'novo';
  };

  // Achado real em produção: retornava 2500 (R$) como "estimativa padrão"
  // pra QUALQUER lead sem dealValue real — como conversas reais do
  // WhatsApp nunca setam dealValue sozinhas, os 52 leads reais da Monique
  // caíam todos nesse fallback, e a soma (Pipeline Em Aberto) virava um
  // número inteiramente fabricado (52 × R$2.500 = "R$130.000" que não
  // existe de verdade). undefined em vez de um placeholder numérico —
  // quem chama decide como mostrar "sem valor" sem fingir que é dado real.
  const getLeadValue = (lead: LeadInfo): number | undefined => {
    if (lead.dealValue !== undefined) return lead.dealValue;
    if (lead.attribution?.adDetails?.spendEstimate) {
      return Math.round(lead.attribution.adDetails.spendEstimate * 4.5);
    }
    return undefined;
  };

  const filteredLeads = leads.filter((l) => {
    const matchesSearch =
      l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.phone.includes(searchTerm) ||
      (l.fullAnalysis?.conversationSummary || '').toLowerCase().includes(searchTerm.toLowerCase());

    const leadStage = getLeadStage(l);
    const matchesStage = stageFilter === 'all' || leadStage === stageFilter;

    return matchesSearch && matchesStage;
  });

  // Calculate Pipeline Metrics — só soma leads com valor real conhecido
  // (getLeadValue undefined = "não sabemos", não "zero"), pra não fabricar
  // um total que pareça preciso sem ser dado de verdade.
  const leadsWithKnownValue = filteredLeads.filter((l) => getLeadValue(l) !== undefined);
  const totalPipelineValue = leadsWithKnownValue.reduce((acc, l) => acc + (getLeadValue(l) ?? 0), 0);
  const wonLeads = leads.filter((l) => getLeadStage(l) === 'ganho');
  const wonValue = wonLeads.reduce((acc, l) => acc + (getLeadValue(l) ?? 0), 0);
  const conversionRate = leads.length ? Math.round((wonLeads.length / leads.length) * 100) : 0;

  const handleStageChange = (lead: LeadInfo, newStage: CRMStage) => {
    const updated: LeadInfo = {
      ...lead,
      crmStage: newStage,
      assignedOperator: lead.assignedOperator || currentUser.name,
    };
    onUpdateLead(updated);
    if (selectedLead && selectedLead.id === lead.id) {
      setSelectedLead(updated);
    }
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead || !newNoteText.trim()) return;

    const note: CRMOperatorNote = {
      id: `note_${Date.now()}`,
      authorName: currentUser.name,
      text: newNoteText.trim(),
      createdAt: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    };

    const updated: LeadInfo = {
      ...selectedLead,
      crmNotes: [note, ...(selectedLead.crmNotes || [])],
    };

    onUpdateLead(updated);
    setSelectedLead(updated);
    setNewNoteText('');
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead || !newTaskTitle.trim()) return;

    const task: CRMTask = {
      id: `task_${Date.now()}`,
      title: newTaskTitle.trim(),
      dueDate: isSpanish ? 'Mañana 14:00' : 'Amanhã 14:00',
      completed: false,
      assignedOperator: currentUser.name,
    };

    const updated: LeadInfo = {
      ...selectedLead,
      crmTasks: [...(selectedLead.crmTasks || []), task],
    };

    onUpdateLead(updated);
    setSelectedLead(updated);
    setNewTaskTitle('');
  };

  const handleToggleTask = (taskToToggle: CRMTask) => {
    if (!selectedLead) return;
    const updatedTasks = (selectedLead.crmTasks || []).map((t) =>
      t.id === taskToToggle.id ? { ...t, completed: !t.completed } : t
    );

    const updated: LeadInfo = {
      ...selectedLead,
      crmTasks: updatedTasks,
    };

    onUpdateLead(updated);
    setSelectedLead(updated);
  };

  const handleUpdateDealValue = (value: number) => {
    if (!selectedLead) return;
    const updated: LeadInfo = {
      ...selectedLead,
      dealValue: value,
    };
    onUpdateLead(updated);
    setSelectedLead(updated);
  };

  return (
    <div className={`crm-workspace crm-workspace--mobile-${mobileSection} space-y-5 animate-page-enter`}>
      {/* Header Banner */}
      <div className="crm-workspace__hero bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30 border border-slate-800 rounded-card p-5 sm:p-6 shadow-xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Kanban className="w-5 h-5 text-emerald-400" />
              {isSpanish ? 'Ventas' : 'Vendas'}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
{isSpanish ? `En atención: ${currentUser.name}` : `Em atendimento: ${currentUser.name}`}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
{isSpanish ? 'Llevá cada oportunidad hacia la próxima acción correcta, sin perder el historial ni el contexto de la conversación.' : 'Conduza cada oportunidade até a próxima ação certa, sem perder o histórico nem o contexto da conversa.'}
          </p>
        </div>

        {/* View mode toggle & Action Buttons */}
        <div className="crm-workspace__actions flex items-center space-x-3 w-full lg:w-auto justify-between lg:justify-end flex-wrap gap-2">
          
          {/* Create Real Lead Button */}
          <button
            onClick={() => setIsNewLeadModalOpen(true)}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl flex items-center space-x-1.5 shadow transition-all"
          >
            <UserPlus className="w-4 h-4" />
            <span>{isSpanish ? 'Nuevo lead' : 'Novo lead'}</span>
          </button>

          {/* Apaga TODOS os leads do CRM, reais inclusive (onClearAllLeads chama
              setLeads([]) em App.tsx) — rótulo/tooltip corrigidos (achado na
              auditoria "Raio-X do Universo"): dizia "leads fictícios de
              teste", mas desde que o CRM passou a mesclar leads reais
              (GET /api/crm/leads), esse botão apaga cliente de verdade
              também. Confirmação abaixo já é honesta sobre isso. */}
          {onClearAllLeads && leads.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm(isSpanish ? `¿Seguro que querés eliminar TODOS los ${leads.length} leads? Esta acción no se puede deshacer.` : `Tem certeza que deseja apagar TODOS os ${leads.length} leads? Isso não pode ser desfeito.`)) {
                  onClearAllLeads();
                }
              }}
              className="px-3 py-2 bg-slate-950 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-800/60 font-semibold text-xs rounded-xl flex items-center space-x-1 transition-all"
              title={isSpanish ? 'Elimina todos los leads del CRM — acción irreversible' : 'Apaga todos os leads do CRM — ação irreversível'}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isSpanish ? 'Limpiar todos' : 'Limpar todos'}</span>
            </button>
          )}

          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center space-x-1">
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                displayViewMode === 'kanban'
                  ? 'bg-emerald-600 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Kanban className="w-3.5 h-3.5" />
              <span>Kanban</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                displayViewMode === 'list'
                  ? 'bg-emerald-600 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>{isSpanish ? 'Lista' : 'Lista'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Metric Cards Bar */}
      <div className="crm-workspace__metrics grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/90 border border-slate-800/80 p-4 rounded-xl">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>{isSpanish ? 'Embudo abierto' : 'Pipeline em aberto'}</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-lg font-bold text-white">
            {formatAmount(totalPipelineValue)}
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            {isSpanish ? `${filteredLeads.length} oportunidades activas` : `${filteredLeads.length} oportunidades ativas`}
            {leadsWithKnownValue.length < filteredLeads.length && (
              <>{isSpanish ? ` · ${leadsWithKnownValue.length} con valor informado` : ` · ${leadsWithKnownValue.length} com valor estimado`}</>
            )}
          </p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800/80 p-4 rounded-xl">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>{isSpanish ? 'Ventas cerradas' : 'Vendas fechadas'}</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-lg font-bold text-emerald-400">
            {formatAmount(wonValue)}
          </div>
          <p className="text-[10px] text-slate-500 mt-1">{isSpanish ? `${wonLeads.length} negocios concluidos` : `${wonLeads.length} negócios concluídos`}</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800/80 p-4 rounded-xl">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>{isSpanish ? 'Tasa de conversión' : 'Taxa de conversão'}</span>
            <CheckCircle2 className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-lg font-bold text-white">{conversionRate}%</div>
          <p className="text-[10px] text-slate-500 mt-1">{isSpanish ? 'Leads calificados convertidos' : 'Leads qualificados convertidos'}</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800/80 p-4 rounded-xl">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>{isSpanish ? 'Operador conectado' : 'Operador conectado'}</span>
            <User className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-sm font-bold text-white truncate">{currentUser.name}</div>
          <p className="text-[10px] text-emerald-400 mt-1">{isSpanish ? `Sesión activa (${currentUser.department})` : `Sessão ativa (${currentUser.department})`}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="crm-workspace__filters bg-slate-900/80 border border-slate-800 p-3.5 sm:p-4 rounded-card flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md shadow-slate-950/15">
        <div className="relative w-full sm:w-80">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={isSpanish ? 'Buscá por nombre, teléfono o resumen...' : 'Buscar por nome, telefone ou resumo...'}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 pl-9"
          />
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-400 font-medium">{isSpanish ? 'Etapa:' : 'Estágio:'}</span>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">{isSpanish ? 'Todas las etapas' : 'Todos os estágios'}</option>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main View Area: KANBAN vs LIST */}
      {displayViewMode === 'kanban' ? (
        <div className="crm-workspace__kanban grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const columnLeads = filteredLeads.filter((l) => getLeadStage(l) === stage.id);
            const columnTotal = columnLeads.reduce((acc, l) => acc + (getLeadValue(l) ?? 0), 0);

            return (
              <div
                key={stage.id}
                className="bg-slate-900/70 border border-slate-800/80 rounded-xl flex flex-col min-w-[240px] max-h-[750px] overflow-hidden"
              >
                {/* Column Header */}
                <div className={`p-3 border-b flex items-center justify-between ${stage.color}`}>
                  <div>
                    <h3 className="text-xs font-bold">{stage.label}</h3>
                    <p className="text-[10px] opacity-80 mt-0.5">
                      {formatAmount(columnTotal)}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${stage.badge}`}>
                    {columnLeads.length}
                  </span>
                </div>

                {/* Cards List inside column */}
                <div className="p-2 space-y-2.5 overflow-y-auto flex-1">
                  {columnLeads.length === 0 ? (
                    <div className="py-8 text-center text-slate-600 text-xs italic">
                      {isSpanish ? 'No hay leads acá' : 'Nenhum lead aqui'}
                    </div>
                  ) : (
                    columnLeads.map((lead) => {
                      const val = getLeadValue(lead);
                      const isSelected = selectedLead?.id === lead.id;

                      return (
                        <div
                          key={lead.id}
                          onClick={() => setSelectedLead(lead)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer group ${
                            isSelected
                              ? 'bg-emerald-950/40 border-emerald-500 ring-1 ring-emerald-500/50'
                              : 'bg-slate-800/50 border-slate-700/60 hover:bg-slate-800 hover:border-slate-600'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-xs text-white group-hover:text-emerald-400 transition-colors">
                              {lead.name}
                            </span>
                            <div className="flex items-center space-x-1">
                              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/60">
                                {val !== undefined ? formatAmount(val) : (isSpanish ? 'Sin valor' : 'Sem valor')}
                              </span>
                              {onDeleteLead && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(isSpanish ? `¿Seguro que querés eliminar el lead "${lead.name}" del CRM?` : `Tem certeza que deseja excluir o lead "${lead.name}" do CRM?`)) {
                                      onDeleteLead(lead.id);
                                      if (selectedLead?.id === lead.id) setSelectedLead(null);
                                    }
                                  }}
                                  className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/80 rounded transition-colors cursor-pointer"
                                  title={isSpanish ? 'Eliminar lead' : 'Excluir lead'}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          <p className="text-[10px] text-slate-400 mt-1 flex items-center">
                            <Phone className="w-3 h-3 mr-1 text-slate-500" />
                            {lead.phone}
                          </p>

                          {/* Sentiment / Probability Badge */}
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700/40 text-[10px]">
                            <span className="text-slate-400">
                              {isSpanish ? 'Prob.:' : 'Prob.:'} <strong className="text-slate-200">{lead.fullAnalysis?.dealProbability || 50}%</strong>
                            </span>
                            {lead.attribution && (
                              <span className="text-emerald-300 font-medium truncate max-w-[100px]">
                                {lead.attribution.channelLabel}
                              </span>
                            )}
                          </div>

                          {/* Mover estágio direto no card — antes só tinha 2 botões
                              (Ganho/Proposta) escondendo os outros 4 estágios (incluindo
                              Perdido) atrás da aba lateral, obrigando abrir o drawer só
                              pra marcar um lead como perdido. Select cobre todos os 6. */}
                          <div className="mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-[10px] text-slate-400 gap-1.5">
                            <span className="shrink-0">{isSpanish ? 'Mover a:' : 'Mover para:'}</span>
                            <select
                              value={stage.id}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleStageChange(lead, e.target.value as CRMStage);
                              }}
                              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
                            >
                              {STAGES.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* LIST VIEW */
        <div className="crm-workspace__list bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase font-semibold text-[10px]">
                <tr>
                  <th className="p-3.5">{isSpanish ? 'Lead / contacto' : 'Lead / contato'}</th>
                  <th className="p-3.5">{isSpanish ? 'Etapa comercial' : 'Estágio comercial'}</th>
                  <th className="p-3.5">{isSpanish ? 'Valor estimado (Gs.)' : 'Valor estimado (Gs.)'}</th>
                  <th className="p-3.5">{isSpanish ? 'Canal de origen' : 'Canal de origem'}</th>
                  <th className="p-3.5">{isSpanish ? 'Análisis de IA' : 'Análise de IA'}</th>
                  <th className="p-3.5">{isSpanish ? 'Operador' : 'Operador'}</th>
                  <th className="p-3.5 text-right">{isSpanish ? 'Acción' : 'Ação'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredLeads.map((lead) => {
                  const currentStage = STAGES.find((s) => s.id === getLeadStage(lead)) || STAGES[0];

                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedLead(lead)}
                      className="hover:bg-slate-800/50 transition-colors cursor-pointer"
                    >
                      <td className="p-3.5">
                        <div className="font-bold text-white text-sm">{lead.name}</div>
                        <div className="text-[11px] text-slate-400">{lead.phone}</div>
                      </td>

                      <td className="p-3.5">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${currentStage.color}`}>
                          {currentStage.label}
                        </span>
                      </td>

                      <td className="p-3.5 font-bold text-emerald-400">
                        {getLeadValue(lead) !== undefined ? formatAmount(getLeadValue(lead)!) : <span className="text-slate-500 font-normal">{isSpanish ? 'Sin valor' : 'Sem valor'}</span>}
                      </td>

                      <td className="p-3.5 text-slate-300">
                        {lead.attribution?.channelLabel || (isSpanish ? 'WhatsApp directo' : 'WhatsApp direto')}
                      </td>

                      <td className="p-3.5 max-w-xs truncate text-slate-400">
                        {lead.fullAnalysis?.conversationSummary || (isSpanish ? 'Esperando transcripción...' : 'Aguardando transcrição...')}
                      </td>

                      <td className="p-3.5 text-slate-300">
                        {lead.assignedOperator || currentUser.name}
                      </td>

                      <td className="p-3.5 text-right space-x-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLead(lead);
                          }}
                          className="px-2.5 py-1 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 rounded-lg font-medium transition-all cursor-pointer"
                        >
                          {isSpanish ? 'Detalles' : 'Detalhes'}
                        </button>
                        {onDeleteLead && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm(isSpanish ? `¿Seguro que querés eliminar el lead "${lead.name}" del CRM?` : `Tem certeza que deseja excluir o lead "${lead.name}" do CRM?`)) {
                                onDeleteLead(lead.id);
                                if (selectedLead?.id === lead.id) setSelectedLead(null);
                              }
                            }}
                            className="p-1.5 bg-rose-950/40 hover:bg-rose-900 border border-rose-800/60 text-rose-300 rounded-lg transition-colors inline-flex items-center cursor-pointer"
                            title={isSpanish ? 'Eliminar lead' : 'Excluir lead'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SELECTED LEAD DETAIL DRAWER / MODAL */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border-l border-slate-800 max-w-xl w-full h-full overflow-y-auto p-6 space-y-6 flex flex-col justify-between shadow-2xl">
            {/* Drawer Header */}
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center font-bold text-lg">
                    {selectedLead.name.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">{selectedLead.name}</h2>
                    <p className="text-xs text-slate-400">{selectedLead.phone}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedLead(null)}
                  className="p-2 text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 rounded-xl transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Action Buttons Header */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
                <a
                  href={`https://wa.me/${selectedLead.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl flex items-center justify-center space-x-2 transition-all shadow"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>{isSpanish ? 'Abrir WhatsApp' : 'Abrir WhatsApp'}</span>
                </a>

                {onNavigateToFinancial && (
                  <button
                    type="button"
                    onClick={() => onNavigateToFinancial(selectedLead)}
                    className="py-2 px-3 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-xl flex items-center justify-center space-x-2 transition-all shadow"
                  >
                    <DollarSign className="w-4 h-4" />
                    <span>{isSpanish ? 'Generar factura' : 'Gerar fatura'}</span>
                  </button>
                )}
              </div>

              {/* Stage & Deal Value Editor */}
              <div className="mt-6 p-4 bg-slate-950/70 border border-slate-800 rounded-xl space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">
                      {isSpanish ? 'Mover etapa comercial:' : 'Mover estágio comercial:'}
                    </label>
                    <select
                      value={getLeadStage(selectedLead)}
                      onChange={(e) => handleStageChange(selectedLead, e.target.value as CRMStage)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                    >
                      {STAGES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">
                      {isSpanish ? 'Valor negociado (Gs.):' : 'Valor negociado (Gs.):'}
                    </label>
                    <input
                      type="number"
                      value={getLeadValue(selectedLead) ?? ''}
                      placeholder={isSpanish ? 'Todavía sin valor estimado' : 'Sem valor estimado ainda'}
                      onChange={(e) => handleUpdateDealValue(Number(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-emerald-400 font-bold focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
                  <span>{isSpanish ? 'Operador responsable:' : 'Operador responsável:'}</span>
                  <span className="font-semibold text-white">{selectedLead.assignedOperator || currentUser.name}</span>
                </div>
              </div>

              {/* AI Conversation Analysis Card */}
              {selectedLead.fullAnalysis && (
                <div className="mt-6 p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3">
                  <div className="flex items-center space-x-2 text-emerald-400 text-xs font-bold">
                    <Sparkles className="w-4 h-4" />
                    <span>{isSpanish ? 'Inteligencia de ventas' : 'Inteligência de vendas'}</span>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {selectedLead.fullAnalysis.conversationSummary}
                  </p>

                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-slate-800">
                    <div>
                      <span className="text-slate-500">{isSpanish ? 'Probabilidad de cierre:' : 'Probabilidade de fechamento:'}</span>
                      <p className="font-bold text-emerald-400">{selectedLead.fullAnalysis.dealProbability}%</p>
                    </div>
                    <div>
                      <span className="text-slate-500">{isSpanish ? 'Sentimiento predominante:' : 'Sentimento predominante:'}</span>
                      <p className="font-bold text-white">{selectedLead.fullAnalysis.overallSentiment}</p>
                    </div>
                  </div>

                  {selectedLead.fullAnalysis.recommendedNextAction && (
                    <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded-lg text-xs text-emerald-200">
                      <strong>{isSpanish ? 'Recomendación del agente:' : 'Recomendação do agente:'}</strong> {selectedLead.fullAnalysis.recommendedNextAction}
                    </div>
                  )}
                </div>
              )}

              {/* Operator Tasks / Checklist Section */}
              <div className="mt-6 space-y-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  {isSpanish ? 'Tareas y recordatorios del operador' : 'Tarefas e lembretes do operador'}
                </h3>

                <form onSubmit={handleAddTask} className="flex gap-2">
                  <input
                    type="text"
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder={isSpanish ? 'Agregar tarea (ej.: llamar a las 15 h, enviar propuesta)...' : 'Adicionar tarefa (ex.: ligar às 15h, enviar proposta)...'}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl flex items-center space-x-1"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{isSpanish ? 'Agregar' : 'Adicionar'}</span>
                  </button>
                </form>

                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {(selectedLead.crmTasks || []).length === 0 ? (
                    <p className="text-[11px] text-slate-500 italic">{isSpanish ? 'No hay tareas programadas.' : 'Nenhuma tarefa agendada.'}</p>
                  ) : (
                    (selectedLead.crmTasks || []).map((t) => (
                      <div
                        key={t.id}
                        onClick={() => handleToggleTask(t)}
                        className={`p-2.5 rounded-lg border flex items-center justify-between cursor-pointer transition-all ${
                          t.completed
                            ? 'bg-slate-950/40 border-slate-800 text-slate-500 line-through'
                            : 'bg-slate-800/60 border-slate-700/60 text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-center space-x-2 text-xs">
                          <CheckCircle2
                            className={`w-4 h-4 ${t.completed ? 'text-emerald-500' : 'text-slate-500'}`}
                          />
                          <span>{t.title}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                          {t.dueDate}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Operator Notes Feed */}
              <div className="mt-6 space-y-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <FileText className="w-4 h-4 text-sky-400" />
                  {isSpanish ? 'Notas internas e historial del operador' : 'Notas internas e histórico do operador'}
                </h3>

                <form onSubmit={handleAddNote} className="space-y-2">
                  <AutoResizeTextarea
                    minRows={2}
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    placeholder={isSpanish ? 'Registrá una observación interna (ej.: a la clienta le gustó la propuesta)...' : 'Registrar observação interna (ex.: cliente gostou da proposta)...'}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs rounded-xl flex items-center space-x-1 transition-all"
                    >
                      <Send className="w-3.5 h-3.5 mr-1" />
                      <span>{isSpanish ? 'Guardar nota' : 'Salvar nota'}</span>
                    </button>
                  </div>
                </form>

                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {(selectedLead.crmNotes || []).map((n) => (
                    <div key={n.id} className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span className="font-bold text-slate-300">{n.authorName}</span>
                        <span>{n.createdAt}</span>
                      </div>
                      <p className="text-slate-300">{n.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setSelectedLead(null)}
                  className="py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  {isSpanish ? 'Cerrar' : 'Fechar'}
                </button>
                {onDeleteLead && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(isSpanish ? `¿Querés eliminar el lead "${selectedLead.name}" del CRM?` : `Excluir o lead "${selectedLead.name}" do CRM?`)) {
                        onDeleteLead(selectedLead.id);
                        setSelectedLead(null);
                      }
                    }}
                    className="py-2 px-3 bg-rose-950/40 hover:bg-rose-900 border border-rose-800/60 text-rose-300 text-xs font-semibold rounded-xl flex items-center space-x-1 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{isSpanish ? 'Eliminar lead' : 'Excluir lead'}</span>
                  </button>
                )}
              </div>
              <span className="text-[10px] text-slate-500">{isSpanish ? 'CRM operativo conectado' : 'CRM de operação conectado'}</span>
            </div>
          </div>
        </div>
      )}

      {/* New Lead Real Client Modal */}
      {isNewLeadModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-scale-up">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">{isSpanish ? 'Registrar nuevo lead' : 'Cadastrar novo lead'}</h2>
                  <p className="text-xs text-slate-400">{isSpanish ? 'Carga manual en el CRM del operador' : 'Inserção manual no CRM do operador'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewLeadModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNewLead} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">{isSpanish ? 'Nombre completo de la clienta / lead *' : 'Nome completo do cliente / lead *'}</label>
                <input
                  type="text"
                  required
                  placeholder={isSpanish ? 'Ej.: María González' : 'Ex.: Maria Silva'}
                  value={leadName}
                  onChange={(e) => setLeadName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">{isSpanish ? 'Teléfono de WhatsApp *' : 'Telefone WhatsApp *'}</label>
                  <input
                    type="text"
                    required
                    placeholder="+55 (11) 98765-4321"
                    value={leadPhone}
                    onChange={(e) => setLeadPhone(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">{isSpanish ? 'Correo (opcional)' : 'E-mail (opcional)'}</label>
                  <input
                    type="email"
                    placeholder="cliente@empresa.com"
                    value={leadEmail}
                    onChange={(e) => setLeadEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">{isSpanish ? 'Valor del negocio (Gs.)' : 'Valor do negócio (Gs.)'}</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={leadValue}
                    onChange={(e) => setLeadValue(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 focus:outline-none focus:border-emerald-500 font-bold text-emerald-400"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">{isSpanish ? 'Etapa inicial del embudo' : 'Estágio inicial do funil'}</label>
                  <select
                    value={leadStage}
                    onChange={(e) => setLeadStage(e.target.value as CRMStage)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 focus:outline-none focus:border-emerald-500"
                  >
                    {STAGES.map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">{isSpanish ? 'Canal de origen' : 'Canal de origem'}</label>
                  <select
                    value={leadChannel}
                    onChange={(e) => setLeadChannel(e.target.value as LeadSourceChannel)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="meta_ads">Meta Ads (Instagram / FB)</option>
                    <option value="google_ads">Google Ads (Search)</option>
                    <option value="whatsapp_direct">{isSpanish ? 'WhatsApp directo' : 'WhatsApp direto'}</option>
                    <option value="instagram_organic">{isSpanish ? 'Instagram orgánico / enlace de la bio' : 'Instagram orgânico / link da bio'}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-bold mb-1">{isSpanish ? 'Segmento / asunto' : 'Segmento / assunto'}</label>
                  <input
                    type="text"
                    placeholder={isSpanish ? 'Ej.: Servicio de cejas' : 'Ex.: Serviço de sobrancelhas'}
                    value={leadSegment}
                    onChange={(e) => setLeadSegment(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-bold mb-1">{isSpanish ? 'Nota / observación inicial' : 'Nota / observação inicial'}</label>
                <AutoResizeTextarea
                  minRows={2}
                  placeholder={isSpanish ? 'Describí el primer contacto o pedido de la clienta...' : 'Descreva o primeiro contato ou pedido do cliente...'}
                  value={leadNotes}
                  onChange={(e) => setLeadNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewLeadModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  {isSpanish ? 'Cancelar' : 'Cancelar'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-xl flex items-center space-x-1.5 shadow"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{isSpanish ? 'Registrar lead' : 'Cadastrar lead'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
