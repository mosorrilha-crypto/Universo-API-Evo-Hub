import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import {
  Radio, Plus, Loader2, X, Trash2, Pencil, Upload, Send, Play, Pause, Ban,
  CheckCircle2, AlertCircle, Users as UsersIcon, BookOpen,
} from 'lucide-react';
import { useAppPreferences } from '../contexts/AppPreferencesContext';
import { BroadcastDocumentation } from './BroadcastDocumentation';

/**
 * Painel de Disparo em Massa (broadcast/marketing) via WhatsApp — TASK-0171.
 * Só saas_admin. Opera sobre o tenant atualmente selecionado no seletor
 * global do painel (Header.tsx já define o X-Tenant-Id anexado por
 * apiFetch) — não tem seletor de tenant próprio, pra não duplicar/desalinhar
 * com o seletor que já existe.
 */

interface BroadcastNumber {
  id: string;
  label: string;
  phoneNumberId: string;
  wabaId: string | null;
  status: 'active' | 'paused' | 'banned' | 'warming';
  warmupProgressDays: number;
  qualityRating: 'unknown' | 'high' | 'medium' | 'low';
  perMinuteCap: number;
  dailyCap: number;
  minGapSeconds: number;
  tokenSet: boolean;
}

interface BroadcastTemplate {
  id: string;
  name: string;
  language: string;
  category: 'marketing' | 'utility';
  headerType: 'none' | 'image';
  bodyVariableLabels: string[];
  bodyText: string;
  headerImageBase64: string | null;
}

interface BroadcastContactList {
  id: string;
  name: string;
  sourceFilename: string | null;
  contactCount: number;
  createdAt: string;
}

interface BroadcastCampaign {
  id: string;
  name: string;
  templateId: string;
  contactListId: string;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'canceled';
  consentConfirmed: boolean;
  createdAt: string;
}

interface CampaignCounts {
  pending: number;
  sending: number;
  sent: number;
  delivered: number;
  failed: number;
  skippedExistingContact: number;
  skippedRecentDuplicate: number;
}

const STATUS_LABELS: Record<BroadcastNumber['status'], string> = {
  active: 'Ativo', paused: 'Pausado', banned: 'Banido', warming: 'Aquecendo',
};
const STATUS_COLORS: Record<BroadcastNumber['status'], string> = {
  active: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  paused: 'bg-slate-800 text-slate-400 border-slate-700',
  banned: 'bg-rose-950 text-rose-300 border-rose-800',
  warming: 'bg-amber-950 text-amber-300 border-amber-800',
};
const QUALITY_LABELS: Record<BroadcastNumber['qualityRating'], string> = {
  unknown: 'Não sei', high: 'Alta', medium: 'Média', low: 'Baixa',
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export const BroadcastAdminPanel: React.FC<{ tenantName?: string }> = ({ tenantName }) => {
  const { language } = useAppPreferences();
  const [showDocumentation, setShowDocumentation] = useState(false);
  const [subTab, setSubTab] = useState<'numbers' | 'templates' | 'lists' | 'campaigns'>('numbers');

  // ── Números ──────────────────────────────────────────────────────────
  const [numbers, setNumbers] = useState<BroadcastNumber[]>([]);
  const [numbersLoaded, setNumbersLoaded] = useState(false);
  const [isNumberModalOpen, setIsNumberModalOpen] = useState(false);
  const [editingNumber, setEditingNumber] = useState<BroadcastNumber | null>(null);
  const [numberForm, setNumberForm] = useState({ label: '', phoneNumberId: '', wabaId: '', accessToken: '', qualityRating: 'unknown' as BroadcastNumber['qualityRating'] });
  const [numberAdvanced, setNumberAdvanced] = useState({ perMinuteCap: '5', dailyCap: '1000', minGapSeconds: '8' });
  const [numberError, setNumberError] = useState<string | null>(null);
  const [isSavingNumber, setIsSavingNumber] = useState(false);

  const loadNumbers = async () => {
    const res = await apiFetch('/api/admin/broadcast-numbers');
    if (res.ok) setNumbers((await res.json()).numbers || []);
    setNumbersLoaded(true);
  };

  useEffect(() => {
    if (subTab === 'numbers' && !numbersLoaded) loadNumbers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  const resetNumberForm = () => {
    setEditingNumber(null);
    setNumberForm({ label: '', phoneNumberId: '', wabaId: '', accessToken: '', qualityRating: 'unknown' });
    setNumberAdvanced({ perMinuteCap: '5', dailyCap: '1000', minGapSeconds: '8' });
    setNumberError(null);
  };

  const openEditNumber = (n: BroadcastNumber) => {
    setEditingNumber(n);
    setNumberForm({ label: n.label, phoneNumberId: n.phoneNumberId, wabaId: n.wabaId || '', accessToken: '', qualityRating: n.qualityRating });
    setNumberAdvanced({ perMinuteCap: String(n.perMinuteCap), dailyCap: String(n.dailyCap), minGapSeconds: String(n.minGapSeconds) });
    setNumberError(null);
    setIsNumberModalOpen(true);
  };

  const handleSaveNumber = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingNumber(true);
    setNumberError(null);
    try {
      const payload = {
        label: numberForm.label,
        phoneNumberId: numberForm.phoneNumberId,
        wabaId: numberForm.wabaId || null,
        accessToken: numberForm.accessToken || undefined,
        qualityRating: numberForm.qualityRating,
        perMinuteCap: Number(numberAdvanced.perMinuteCap) || undefined,
        dailyCap: Number(numberAdvanced.dailyCap) || undefined,
        minGapSeconds: Number(numberAdvanced.minGapSeconds) || undefined,
      };
      const res = editingNumber
        ? await apiFetch(`/api/admin/broadcast-numbers/${editingNumber.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await apiFetch('/api/admin/broadcast-numbers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      setIsNumberModalOpen(false);
      resetNumberForm();
      await loadNumbers();
    } catch (err: any) {
      setNumberError(err.message || 'Falha ao salvar número.');
    } finally {
      setIsSavingNumber(false);
    }
  };

  const handleDeleteNumber = async (n: BroadcastNumber) => {
    if (!window.confirm(`Remover o número "${n.label}"? Campanhas que já o usaram continuam com o histórico intacto.`)) return;
    await apiFetch(`/api/admin/broadcast-numbers/${n.id}`, { method: 'DELETE' });
    await loadNumbers();
  };

  // ── Templates ────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<BroadcastTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<BroadcastTemplate | null>(null);
  const [templateForm, setTemplateForm] = useState({
    name: '', language: 'pt_BR', category: 'marketing' as BroadcastTemplate['category'],
    headerType: 'none' as BroadcastTemplate['headerType'], bodyVariableLabelsText: '', bodyText: '',
  });
  const [templateHeaderImage, setTemplateHeaderImage] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  const loadTemplates = async () => {
    const res = await apiFetch('/api/admin/broadcast-templates');
    if (res.ok) setTemplates((await res.json()).templates || []);
    setTemplatesLoaded(true);
  };

  useEffect(() => {
    if (subTab === 'templates' && !templatesLoaded) loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  const resetTemplateForm = () => {
    setEditingTemplate(null);
    setTemplateForm({ name: '', language: 'pt_BR', category: 'marketing', headerType: 'none', bodyVariableLabelsText: '', bodyText: '' });
    setTemplateHeaderImage(null);
    setTemplateError(null);
  };

  const openEditTemplate = (t: BroadcastTemplate) => {
    setEditingTemplate(t);
    setTemplateForm({
      name: t.name, language: t.language, category: t.category, headerType: t.headerType,
      bodyVariableLabelsText: t.bodyVariableLabels.join(', '), bodyText: t.bodyText,
    });
    setTemplateHeaderImage(t.headerImageBase64);
    setTemplateError(null);
    setIsTemplateModalOpen(true);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingTemplate(true);
    setTemplateError(null);
    try {
      const bodyVariableLabels = templateForm.bodyVariableLabelsText.split(',').map((s) => s.trim()).filter(Boolean);
      const payload = {
        name: templateForm.name,
        language: templateForm.language,
        category: templateForm.category,
        headerType: templateForm.headerType,
        bodyVariableLabels,
        bodyText: templateForm.bodyText,
        headerImageBase64: templateForm.headerType === 'image' ? templateHeaderImage : null,
      };
      const res = editingTemplate
        ? await apiFetch(`/api/admin/broadcast-templates/${editingTemplate.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await apiFetch('/api/admin/broadcast-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      setIsTemplateModalOpen(false);
      resetTemplateForm();
      await loadTemplates();
    } catch (err: any) {
      setTemplateError(err.message || 'Falha ao salvar template.');
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (t: BroadcastTemplate) => {
    if (!window.confirm(`Remover o template "${t.name}"?`)) return;
    await apiFetch(`/api/admin/broadcast-templates/${t.id}`, { method: 'DELETE' });
    await loadTemplates();
  };

  // ── Listas de contatos ───────────────────────────────────────────────
  const [lists, setLists] = useState<BroadcastContactList[]>([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [isImportingList, setIsImportingList] = useState(false);
  const [listImportMessage, setListImportMessage] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const loadLists = async () => {
    const res = await apiFetch('/api/admin/broadcast-contact-lists');
    if (res.ok) setLists((await res.json()).lists || []);
    setListsLoaded(true);
  };

  useEffect(() => {
    if (subTab === 'lists' && !listsLoaded) loadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  const handleImportCsv = async (file: File) => {
    if (!newListName.trim()) {
      setListError('Dê um nome pra lista antes de escolher o arquivo.');
      return;
    }
    setIsImportingList(true);
    setListError(null);
    setListImportMessage(null);
    try {
      const csvBase64 = await fileToBase64(file);
      const res = await apiFetch('/api/admin/broadcast-contact-lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newListName.trim(), filename: file.name, csvBase64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setListImportMessage(`Importados ${data.imported} contatos${data.duplicatesIgnored ? ` (${data.duplicatesIgnored} duplicatas ignoradas dentro do próprio arquivo)` : ''}.`);
      setNewListName('');
      await loadLists();
    } catch (err: any) {
      setListError(err.message || 'Falha ao importar CSV.');
    } finally {
      setIsImportingList(false);
    }
  };

  const handleDeleteList = async (l: BroadcastContactList) => {
    if (!window.confirm(`Remover a lista "${l.name}" (${l.contactCount} contatos)?`)) return;
    await apiFetch(`/api/admin/broadcast-contact-lists/${l.id}`, { method: 'DELETE' });
    await loadLists();
  };

  // ── Campanhas ────────────────────────────────────────────────────────
  const [campaigns, setCampaigns] = useState<BroadcastCampaign[]>([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [isCampaignFormOpen, setIsCampaignFormOpen] = useState(false);
  const [campaignForm, setCampaignForm] = useState({
    name: '', templateId: '', contactListId: '', dedupeWindowDays: '3', consentConfirmed: false,
    includeExistingContacts: false, includeRecentDuplicates: false,
  });
  const [allocations, setAllocations] = useState<Array<{ broadcastNumberId: string; count: string }>>([{ broadcastNumberId: '', count: '' }]);
  const [preview, setPreview] = useState<{ totalContacts: number; toSend: number; skippedExistingContact: number; skippedRecentDuplicate: number } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);

  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [campaignDetail, setCampaignDetail] = useState<{ campaign: BroadcastCampaign; counts: CampaignCounts; countsByNumber: Record<string, CampaignCounts> } | null>(null);
  const [isTestSending, setIsTestSending] = useState(false);
  const [testSendMessage, setTestSendMessage] = useState<string | null>(null);
  const [testSendSucceeded, setTestSendSucceeded] = useState(false);

  const loadCampaigns = async () => {
    const res = await apiFetch('/api/admin/broadcast-campaigns');
    if (res.ok) setCampaigns((await res.json()).campaigns || []);
    setCampaignsLoaded(true);
  };

  useEffect(() => {
    if (subTab === 'campaigns' && !campaignsLoaded) loadCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  useEffect(() => {
    // Números/templates/listas precisam estar carregados pros selects do formulário de campanha.
    if (subTab === 'campaigns') {
      if (!numbersLoaded) loadNumbers();
      if (!templatesLoaded) loadTemplates();
      if (!listsLoaded) loadLists();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  const loadCampaignDetail = async (id: string) => {
    setSelectedCampaignId(id);
    setTestSendMessage(null);
    setTestSendSucceeded(false);
    const res = await apiFetch(`/api/admin/broadcast-campaigns/${id}`);
    if (res.ok) setCampaignDetail(await res.json());
  };

  const handlePreview = async () => {
    if (!campaignForm.contactListId) return;
    setIsLoadingPreview(true);
    setCampaignError(null);
    try {
      const res = await apiFetch(`/api/admin/broadcast-campaigns/preview-allocation?contactListId=${campaignForm.contactListId}&dedupeWindowDays=${campaignForm.dedupeWindowDays || 3}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPreview(data.preview);
    } catch (err: any) {
      setCampaignError(err.message || 'Falha ao calcular prévia.');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const resetCampaignForm = () => {
    setCampaignForm({ name: '', templateId: '', contactListId: '', dedupeWindowDays: '3', consentConfirmed: false, includeExistingContacts: false, includeRecentDuplicates: false });
    setAllocations([{ broadcastNumberId: '', count: '' }]);
    setPreview(null);
    setCampaignError(null);
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignForm.consentConfirmed) {
      setCampaignError('Confirme que a lista tem consentimento pra receber comunicação.');
      return;
    }
    setIsSavingCampaign(true);
    setCampaignError(null);
    try {
      const numberAllocations = allocations
        .filter((a) => a.broadcastNumberId && Number(a.count) > 0)
        .map((a) => ({ broadcastNumberId: a.broadcastNumberId, count: Number(a.count) }));
      if (!numberAllocations.length) throw new Error('Adicione ao menos um número com uma quantidade válida.');
      const res = await apiFetch('/api/admin/broadcast-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignForm.name,
          templateId: campaignForm.templateId,
          contactListId: campaignForm.contactListId,
          dedupeWindowDays: Number(campaignForm.dedupeWindowDays) || 3,
          consentConfirmed: campaignForm.consentConfirmed,
          numberAllocations,
          includeExistingContacts: campaignForm.includeExistingContacts,
          includeRecentDuplicates: campaignForm.includeRecentDuplicates,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setIsCampaignFormOpen(false);
      resetCampaignForm();
      await loadCampaigns();
      await loadCampaignDetail(data.campaign.id);
    } catch (err: any) {
      setCampaignError(err.message || 'Falha ao criar campanha.');
    } finally {
      setIsSavingCampaign(false);
    }
  };

  const handleTestSend = async () => {
    if (!selectedCampaignId) return;
    setIsTestSending(true);
    setTestSendMessage(null);
    try {
      const res = await apiFetch(`/api/admin/broadcast-campaigns/${selectedCampaignId}/test-send`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTestSendMessage(`Teste enviado com sucesso pra ${data.sentTo}.`);
      setTestSendSucceeded(true);
    } catch (err: any) {
      setTestSendMessage(err.message || 'Falha ao enviar teste.');
      setTestSendSucceeded(false);
    } finally {
      setIsTestSending(false);
    }
  };

  const handleChangeCampaignStatus = async (status: BroadcastCampaign['status']) => {
    if (!selectedCampaignId) return;
    try {
      const res = await apiFetch(`/api/admin/broadcast-campaigns/${selectedCampaignId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await loadCampaignDetail(selectedCampaignId);
      await loadCampaigns();
    } catch (err: any) {
      window.alert(err.message || 'Falha ao mudar status da campanha.');
    }
  };

  const subTabs: Array<{ id: typeof subTab; label: string }> = [
    { id: 'numbers', label: 'Números' },
    { id: 'templates', label: 'Templates' },
    { id: 'lists', label: 'Listas de contatos' },
    { id: 'campaigns', label: 'Campanhas' },
  ];

  if (showDocumentation) {
    return <BroadcastDocumentation language={language} onBack={() => setShowDocumentation(false)} />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-400 flex items-center gap-2">
          <Radio className="w-4 h-4 text-violet-400 flex-shrink-0" />
          {language === 'pt'
            ? <>Disparo em massa via WhatsApp (Marketing) — gerenciando pra <strong className="text-slate-200">{tenantName || 'o tenant selecionado no topo'}</strong>. Pra trocar de tenant, use o seletor no cabeçalho do painel.</>
            : <>Envío masivo por WhatsApp (Marketing) — gestionando para <strong className="text-slate-200">{tenantName || 'el tenant seleccionado arriba'}</strong>. Para cambiar de tenant, use el selector en el encabezado del panel.</>}
        </p>
        <button
          type="button"
          onClick={() => setShowDocumentation(true)}
          className="flex items-center gap-1.5 rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100 transition-all hover:bg-violet-500/20 cursor-pointer flex-shrink-0"
          title={language === 'pt' ? 'Abrir documentação de como funciona e como usar o Disparo em Massa' : 'Abrir documentación de cómo funciona y cómo usar el Envío Masivo'}
          aria-label={language === 'pt' ? 'Abrir documentação do Disparo em Massa' : 'Abrir documentación del Envío Masivo'}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{language === 'pt' ? 'Documentação' : 'Documentación'}</span>
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        {subTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
              subTab === t.id ? 'bg-violet-600 text-white shadow-md shadow-violet-950/30' : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Números ── */}
      {subTab === 'numbers' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white">Números de disparo</h2>
            <button
              onClick={() => { resetNumberForm(); setIsNumberModalOpen(true); }}
              className="py-2 px-3.5 bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" /><span>Adicionar número</span>
            </button>
          </div>
          {numbers.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">{numbersLoaded ? 'Nenhum número cadastrado ainda.' : 'Carregando...'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="text-slate-500 border-b border-slate-800">
                  <tr><th className="py-2 pr-3">Rótulo</th><th className="py-2 pr-3">Phone Number ID</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Qualidade</th><th className="py-2 pr-3">Teto/dia</th><th></th></tr>
                </thead>
                <tbody>
                  {numbers.map((n) => (
                    <tr key={n.id} className="border-b border-slate-800/60">
                      <td className="py-2 pr-3 text-slate-200 font-semibold">{n.label}</td>
                      <td className="py-2 pr-3 text-slate-400">{n.phoneNumberId}</td>
                      <td className="py-2 pr-3"><span className={`px-2 py-0.5 rounded-md border font-semibold ${STATUS_COLORS[n.status]}`}>{STATUS_LABELS[n.status]}{n.status === 'warming' ? ` (dia ${n.warmupProgressDays})` : ''}</span></td>
                      <td className="py-2 pr-3 text-slate-400">{QUALITY_LABELS[n.qualityRating]}</td>
                      <td className="py-2 pr-3 text-slate-400">{n.dailyCap}</td>
                      <td className="py-2 flex items-center gap-1.5 justify-end">
                        <button onClick={() => openEditNumber(n)} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleDeleteNumber(n)} className="p-1.5 bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 rounded-lg cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {isNumberModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
          <form onSubmit={handleSaveNumber} className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative space-y-4">
            <button type="button" onClick={() => setIsNumberModalOpen(false)} className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg cursor-pointer"><X className="w-5 h-5" /></button>
            <h3 className="text-sm font-bold text-white">{editingNumber ? 'Editar número' : 'Novo número de disparo'}</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Rótulo</label>
              <input value={numberForm.label} onChange={(e) => setNumberForm({ ...numberForm, label: e.target.value })} required className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" placeholder="Ex.: Corrida ELAS 2026" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Phone Number ID (Meta)</label>
              <input value={numberForm.phoneNumberId} onChange={(e) => setNumberForm({ ...numberForm, phoneNumberId: e.target.value })} required disabled={!!editingNumber} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white disabled:opacity-50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">WABA ID (opcional)</label>
              <input value={numberForm.wabaId} onChange={(e) => setNumberForm({ ...numberForm, wabaId: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Token de acesso {editingNumber ? '(deixe em branco pra manter o atual)' : ''}</label>
              <input type="password" value={numberForm.accessToken} onChange={(e) => setNumberForm({ ...numberForm, accessToken: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Qualidade (confira em Meta Business Manager &gt; Qualidade da conta)</label>
              <select value={numberForm.qualityRating} onChange={(e) => setNumberForm({ ...numberForm, qualityRating: e.target.value as any })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white">
                <option value="unknown">Não sei</option><option value="high">Alta</option><option value="medium">Média</option><option value="low">Baixa</option>
              </select>
              {numberForm.qualityRating === 'low' && <p className="text-[11px] text-rose-400 mt-1">Marcar como Baixa pausa os envios deste número imediatamente.</p>}
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer text-slate-400 font-semibold">Avançado (cadência)</summary>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div><label className="block text-[10px] text-slate-500 mb-1">Msgs/minuto</label><input type="number" value={numberAdvanced.perMinuteCap} onChange={(e) => setNumberAdvanced({ ...numberAdvanced, perMinuteCap: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white" /></div>
                <div><label className="block text-[10px] text-slate-500 mb-1">Teto final/dia</label><input type="number" value={numberAdvanced.dailyCap} onChange={(e) => setNumberAdvanced({ ...numberAdvanced, dailyCap: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white" /></div>
                <div><label className="block text-[10px] text-slate-500 mb-1">Intervalo (s)</label><input type="number" value={numberAdvanced.minGapSeconds} onChange={(e) => setNumberAdvanced({ ...numberAdvanced, minGapSeconds: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white" /></div>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Um número novo já começa em aquecimento automático (20 a 1.000 msgs/dia ao longo de ~2 semanas) — o "teto final" só vale depois do aquecimento.</p>
            </details>
            {numberError && <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-lg px-3 py-2">{numberError}</p>}
            <button type="submit" disabled={isSavingNumber} className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer">
              {isSavingNumber ? <Loader2 className="w-4 h-4 animate-spin" /> : null}<span>Salvar</span>
            </button>
          </form>
        </div>
      )}

      {/* ── Templates ── */}
      {subTab === 'templates' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white">Templates de Marketing (metadados)</h2>
            <button onClick={() => { resetTemplateForm(); setIsTemplateModalOpen(true); }} className="py-2 px-3.5 bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer">
              <Plus className="w-4 h-4" /><span>Cadastrar template</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-500">A criação/aprovação do template continua manual no Meta Business Manager — aqui só cadastramos os metadados pra usar no disparo.</p>
          {templates.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">{templatesLoaded ? 'Nenhum template cadastrado ainda.' : 'Carregando...'}</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map((t) => (
                <div key={t.id} className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-1.5">
                  <div className="flex items-start justify-between">
                    <span className="text-xs font-bold text-white">{t.name}</span>
                    <div className="flex gap-1">
                      <button onClick={() => openEditTemplate(t)} className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer"><Pencil className="w-3 h-3" /></button>
                      <button onClick={() => handleDeleteTemplate(t)} className="p-1 bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 rounded cursor-pointer"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">{t.language} • {t.category === 'marketing' ? 'Marketing' : 'Utilitário'} • cabeçalho: {t.headerType === 'image' ? 'imagem' : 'nenhum'}</p>
                  {t.bodyVariableLabels.length > 0 && <p className="text-[11px] text-slate-500">Variáveis: {t.bodyVariableLabels.join(', ')}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
          <form onSubmit={handleSaveTemplate} className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative space-y-4 my-8">
            <button type="button" onClick={() => setIsTemplateModalOpen(false)} className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg cursor-pointer"><X className="w-5 h-5" /></button>
            <h3 className="text-sm font-bold text-white">{editingTemplate ? 'Editar template' : 'Novo template'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-semibold text-slate-300 mb-1">Nome exato (Meta)</label><input value={templateForm.name} onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })} required className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" /></div>
              <div><label className="block text-xs font-semibold text-slate-300 mb-1">Idioma (ex: pt_BR)</label><input value={templateForm.language} onChange={(e) => setTemplateForm({ ...templateForm, language: e.target.value })} required className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-semibold text-slate-300 mb-1">Categoria</label><select value={templateForm.category} onChange={(e) => setTemplateForm({ ...templateForm, category: e.target.value as any })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"><option value="marketing">Marketing</option><option value="utility">Utilitário</option></select></div>
              <div><label className="block text-xs font-semibold text-slate-300 mb-1">Cabeçalho</label><select value={templateForm.headerType} onChange={(e) => setTemplateForm({ ...templateForm, headerType: e.target.value as any })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"><option value="none">Nenhum</option><option value="image">Imagem</option></select></div>
            </div>
            {templateForm.headerType === 'image' && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Imagem de cabeçalho</label>
                <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setTemplateHeaderImage(await fileToBase64(f)); }} className="w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-800 file:text-slate-200 file:text-xs cursor-pointer" />
                {templateHeaderImage && <img src={templateHeaderImage} alt="preview" className="mt-2 max-h-32 rounded-lg border border-slate-800" />}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Variáveis do corpo (rótulos separados por vírgula, na ordem do template)</label>
              <input value={templateForm.bodyVariableLabelsText} onChange={(e) => setTemplateForm({ ...templateForm, bodyVariableLabelsText: e.target.value })} placeholder="nome, data" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Texto do corpo (só pra exibição no Atendimento — use {'{{rotulo}}'})</label>
              <textarea value={templateForm.bodyText} onChange={(e) => setTemplateForm({ ...templateForm, bodyText: e.target.value })} rows={3} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" placeholder="Oi {{nome}}! ..." />
              <p className="text-[10px] text-slate-500 mt-1">Nunca é enviado à Meta — ela usa o template já aprovado no Business Manager. Isso é só pra a mensagem aparecer legível na conversa do Atendimento.</p>
            </div>
            {templateError && <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-lg px-3 py-2">{templateError}</p>}
            <button type="submit" disabled={isSavingTemplate} className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer">
              {isSavingTemplate ? <Loader2 className="w-4 h-4 animate-spin" /> : null}<span>Salvar</span>
            </button>
          </form>
        </div>
      )}

      {/* ── Listas de contatos ── */}
      {subTab === 'lists' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h2 className="text-base font-bold text-white">Listas de contatos (CSV)</h2>
          <p className="text-[11px] text-slate-500">CSV precisa de uma coluna "phone" (obrigatória) e opcionalmente "name" — qualquer outra coluna vira variável do template. Máximo de 10.000 linhas por arquivo.</p>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-300 mb-1">Nome da lista</label>
              <input value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="Ex.: Inscritos Corrida ELAS 2026" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" />
            </div>
            <label className={`py-2 px-3.5 bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer ${isImportingList ? 'opacity-50 pointer-events-none' : ''}`}>
              {isImportingList ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              <span>Importar CSV</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportCsv(f); }} />
            </label>
          </div>
          {listImportMessage && <p className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 rounded-lg px-3 py-2">{listImportMessage}</p>}
          {listError && <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-lg px-3 py-2">{listError}</p>}
          {lists.length === 0 ? (
            <p className="text-xs text-slate-500 py-8 text-center">{listsLoaded ? 'Nenhuma lista importada ainda.' : 'Carregando...'}</p>
          ) : (
            <table className="w-full text-xs text-left">
              <thead className="text-slate-500 border-b border-slate-800"><tr><th className="py-2 pr-3">Nome</th><th className="py-2 pr-3">Contatos</th><th></th></tr></thead>
              <tbody>
                {lists.map((l) => (
                  <tr key={l.id} className="border-b border-slate-800/60">
                    <td className="py-2 pr-3 text-slate-200 font-semibold">{l.name}</td>
                    <td className="py-2 pr-3 text-slate-400 flex items-center gap-1"><UsersIcon className="w-3.5 h-3.5" />{l.contactCount}</td>
                    <td className="py-2 flex justify-end"><button onClick={() => handleDeleteList(l)} className="p-1.5 bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 rounded-lg cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Campanhas ── */}
      {subTab === 'campaigns' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Campanhas</h2>
              <button onClick={() => { resetCampaignForm(); setIsCampaignFormOpen((v) => !v); }} className="py-2 px-3.5 bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer">
                <Plus className="w-4 h-4" /><span>{isCampaignFormOpen ? 'Fechar' : 'Nova campanha'}</span>
              </button>
            </div>

            {isCampaignFormOpen && (
              <form onSubmit={handleCreateCampaign} className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Nome da campanha</label>
                  <input value={campaignForm.name} onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} required className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Template</label>
                    <select value={campaignForm.templateId} onChange={(e) => setCampaignForm({ ...campaignForm, templateId: e.target.value })} required className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white">
                      <option value="">Selecione...</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Lista de contatos</label>
                    <select value={campaignForm.contactListId} onChange={(e) => { setCampaignForm({ ...campaignForm, contactListId: e.target.value }); setPreview(null); }} required className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white">
                      <option value="">Selecione...</option>
                      {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.contactCount})</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">Números (dividido em blocos, na ordem abaixo)</label>
                  {allocations.map((a, idx) => (
                    <div key={idx} className="flex items-center gap-2 mb-2">
                      <select value={a.broadcastNumberId} onChange={(e) => setAllocations(allocations.map((x, i) => i === idx ? { ...x, broadcastNumberId: e.target.value } : x))} className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white">
                        <option value="">Selecione um número...</option>
                        {numbers.map((n) => <option key={n.id} value={n.id}>{n.label} ({STATUS_LABELS[n.status]})</option>)}
                      </select>
                      <input type="number" placeholder="Qtd." value={a.count} onChange={(e) => setAllocations(allocations.map((x, i) => i === idx ? { ...x, count: e.target.value } : x))} className="w-24 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" />
                      {allocations.length > 1 && <button type="button" onClick={() => setAllocations(allocations.filter((_, i) => i !== idx))} className="p-1.5 bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 rounded-lg cursor-pointer"><X className="w-3.5 h-3.5" /></button>}
                    </div>
                  ))}
                  <button type="button" onClick={() => setAllocations([...allocations, { broadcastNumberId: '', count: '' }])} className="text-[11px] text-violet-400 hover:text-violet-300 font-semibold cursor-pointer">+ adicionar outro número</button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Não reenviar se já campanhado há menos de (dias)</label>
                    <input type="number" value={campaignForm.dedupeWindowDays} onChange={(e) => setCampaignForm({ ...campaignForm, dedupeWindowDays: e.target.value })} className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white" />
                  </div>
                  <div className="flex items-end">
                    <button type="button" onClick={handlePreview} disabled={!campaignForm.contactListId || isLoadingPreview} className="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-bold text-xs rounded-lg flex items-center justify-center gap-2 cursor-pointer">
                      {isLoadingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : null}<span>Calcular prévia</span>
                    </button>
                  </div>
                </div>

                {preview && (
                  <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-[11px] text-slate-300 space-y-1">
                    <p>{preview.totalContacts} contatos na lista — <strong className="text-emerald-400">{preview.toSend} vão receber</strong> no ritmo seguro de cada número.</p>
                    {preview.skippedExistingContact > 0 && (
                      <label className="flex items-center gap-2"><input type="checkbox" checked={campaignForm.includeExistingContacts} onChange={(e) => setCampaignForm({ ...campaignForm, includeExistingContacts: e.target.checked })} />{preview.skippedExistingContact} já são contatos conhecidos — pulados por padrão (marque pra incluir mesmo assim, via o número que já conversam)</label>
                    )}
                    {preview.skippedRecentDuplicate > 0 && (
                      <label className="flex items-center gap-2"><input type="checkbox" checked={campaignForm.includeRecentDuplicates} onChange={(e) => setCampaignForm({ ...campaignForm, includeRecentDuplicates: e.target.checked })} />{preview.skippedRecentDuplicate} já receberam campanha recente — pulados por padrão (marque pra incluir mesmo assim)</label>
                    )}
                  </div>
                )}

                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={campaignForm.consentConfirmed} onChange={(e) => setCampaignForm({ ...campaignForm, consentConfirmed: e.target.checked })} required />
                  Confirmo que esta lista tem consentimento pra receber comunicação deste negócio.
                </label>

                {campaignError && <p className="text-xs text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-lg px-3 py-2">{campaignError}</p>}
                <button type="submit" disabled={isSavingCampaign} className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer">
                  {isSavingCampaign ? <Loader2 className="w-4 h-4 animate-spin" /> : null}<span>Criar campanha (rascunho)</span>
                </button>
              </form>
            )}

            {campaigns.length === 0 ? (
              <p className="text-xs text-slate-500 py-8 text-center">{campaignsLoaded ? 'Nenhuma campanha criada ainda.' : 'Carregando...'}</p>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="text-slate-500 border-b border-slate-800"><tr><th className="py-2 pr-3">Nome</th><th className="py-2 pr-3">Status</th><th></th></tr></thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-b border-slate-800/60 cursor-pointer hover:bg-slate-950/60" onClick={() => loadCampaignDetail(c.id)}>
                      <td className="py-2 pr-3 text-slate-200 font-semibold">{c.name}</td>
                      <td className="py-2 pr-3 text-slate-400">{c.status}</td>
                      <td className="py-2 text-right text-violet-400 font-semibold">Ver &rarr;</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {campaignDetail && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">{campaignDetail.campaign.name}</h3>
                <span className="text-[11px] text-slate-400 uppercase font-bold">{campaignDetail.campaign.status}</span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-slate-950 border border-emerald-800/40 rounded-lg p-2"><p className="text-lg font-bold text-emerald-400">{campaignDetail.counts.sent + campaignDetail.counts.delivered}</p><p className="text-[10px] text-slate-500">Enviado</p></div>
                <div className="bg-slate-950 border border-rose-800/40 rounded-lg p-2"><p className="text-lg font-bold text-rose-400">{campaignDetail.counts.failed}</p><p className="text-[10px] text-slate-500">Falhou</p></div>
                <div className="bg-slate-950 border border-amber-800/40 rounded-lg p-2"><p className="text-lg font-bold text-amber-400">{campaignDetail.counts.skippedExistingContact}</p><p className="text-[10px] text-slate-500">Pulado (conhecido)</p></div>
                <div className="bg-slate-950 border border-amber-800/40 rounded-lg p-2"><p className="text-lg font-bold text-amber-400">{campaignDetail.counts.skippedRecentDuplicate}</p><p className="text-[10px] text-slate-500">Pulado (duplicata)</p></div>
              </div>
              <p className="text-[11px] text-slate-500">Pendentes: {campaignDetail.counts.pending} • Em envio: {campaignDetail.counts.sending}</p>

              {campaignDetail.campaign.status === 'draft' && (
                <div className="space-y-2">
                  <button onClick={handleTestSend} disabled={isTestSending} className="py-2 px-3.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer">
                    {isTestSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}<span>Enviar teste</span>
                  </button>
                  {testSendMessage && (
                    <p className={`text-xs rounded-lg px-3 py-2 flex items-center gap-2 ${testSendSucceeded ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-800/60' : 'text-rose-400 bg-rose-950/40 border border-rose-800/60'}`}>
                      {testSendSucceeded ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}{testSendMessage}
                    </p>
                  )}
                  <button onClick={() => handleChangeCampaignStatus('running')} disabled={!testSendSucceeded} title={!testSendSucceeded ? 'Envie um teste com sucesso antes de iniciar' : ''} className="py-2 px-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer">
                    <Play className="w-4 h-4" /><span>Iniciar campanha</span>
                  </button>
                </div>
              )}
              {campaignDetail.campaign.status === 'running' && (
                <div className="flex gap-2">
                  <button onClick={() => handleChangeCampaignStatus('paused')} className="py-2 px-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer"><Pause className="w-4 h-4" /><span>Pausar</span></button>
                  <button onClick={() => handleChangeCampaignStatus('canceled')} className="py-2 px-3.5 bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer"><Ban className="w-4 h-4" /><span>Cancelar</span></button>
                </div>
              )}
              {campaignDetail.campaign.status === 'paused' && (
                <div className="flex gap-2">
                  <button onClick={() => handleChangeCampaignStatus('running')} className="py-2 px-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer"><Play className="w-4 h-4" /><span>Retomar</span></button>
                  <button onClick={() => handleChangeCampaignStatus('canceled')} className="py-2 px-3.5 bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-400 font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer"><Ban className="w-4 h-4" /><span>Cancelar</span></button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
