import React, { useState } from 'react';
import { LeadInfo, CAPIConfig, MetaCAPIEvent } from '../types';
import { INITIAL_MOCK_LEADS } from '../data/mockLeads';
import { apiFetch } from '../lib/apiClient';
import { 
  BarChart3, 
  Target, 
  Sparkles, 
  Zap, 
  Send, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  Copy, 
  ExternalLink, 
  Key, 
  Layers, 
  TrendingUp, 
  PieChart, 
  Filter, 
  Code, 
  Search, 
  RefreshCw, 
  ArrowUpRight, 
  Activity, 
  Globe, 
  Sliders, 
  Bot, 
  Database,
  CheckCheck,
  Smartphone,
  ChevronDown,
  ChevronRight,
  Info
} from 'lucide-react';

interface AdAttributionCAPIProps {
  leads?: LeadInfo[];
  onTriggerCAPIEvent?: (lead: LeadInfo, eventName: MetaCAPIEvent['eventName']) => void;
  onAddNewAttributedLead?: (lead: LeadInfo) => void;
}

export const AdAttributionCAPI: React.FC<AdAttributionCAPIProps> = ({
  leads: propLeads,
  onTriggerCAPIEvent,
  onAddNewAttributedLead,
}) => {
  const leads = propLeads || INITIAL_MOCK_LEADS;
  const [activeTab, setActiveTab] = useState<'overview' | 'ai_insights' | 'capi_settings' | 'utm_simulator'>('overview');

  // Meta CAPI Configuration State
  const [capiConfig, setCapiConfig] = useState<CAPIConfig>(() => {
    try {
      const saved = localStorage.getItem('meta_capi_config');
      return saved ? JSON.parse(saved) : {
        pixelId: '891029384712039',
        accessToken: 'EAAG1234567890_Meta_Graph_API_Token_Demo_SecretKey',
        testEventCode: 'TEST98765',
        autoSendOnQualification: true,
        enabled: true,
      };
    } catch {
      return {
        pixelId: '891029384712039',
        accessToken: 'EAAG1234567890_Meta_Graph_API_Token_Demo_SecretKey',
        testEventCode: 'TEST98765',
        autoSendOnQualification: true,
        enabled: true,
      };
    }
  });

  // Dispatched CAPI Events Log
  const [capiEventsLog, setCapiEventsLog] = useState<MetaCAPIEvent[]>(() => {
    try {
      const saved = localStorage.getItem('meta_capi_events_log');
      return saved ? JSON.parse(saved) : [
        {
          id: 'evt-101',
          leadId: 'lead-101',
          leadName: 'Carlos Mendes',
          eventName: 'Lead',
          eventTime: new Date(Date.now() - 3600000).toISOString(),
          pixelId: '891029384712039',
          status: 'sent',
          testEventCode: 'TEST98765',
          matchQualityScore: 8.8,
          userHash: {
            phoneHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            emailHash: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
            fbc: 'fb.1.1712000000.IwAR3x90A1b2c3d4e5f6',
            fbp: 'fb.1.1712000000.987654321',
          },
          eventValue: 490,
        },
        {
          id: 'evt-102',
          leadId: 'lead-102',
          leadName: 'Juliana Rocha - Imóveis',
          eventName: 'Contact',
          eventTime: new Date(Date.now() - 1800000).toISOString(),
          pixelId: '891029384712039',
          status: 'sent',
          testEventCode: 'TEST98765',
          matchQualityScore: 9.1,
          userHash: {
            phoneHash: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
            fbc: 'fb.1.1712000000.Cj0KCQiA8v_932918392183_9213',
            fbp: 'fb.1.1712000000.123456789',
          },
          eventValue: 1200,
        },
      ];
    } catch {
      return [];
    }
  });

  // Selected CAPI Log item for JSON modal
  const [selectedLogItem, setSelectedLogItem] = useState<MetaCAPIEvent | null>(null);

  // AI Strategic Analysis state
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [aiReport, setAiReport] = useState<any>(null);

  // UTM Simulator input states
  const [simUrl, setSimUrl] = useState('https://wa.me/5511999887766?text=Ola&utm_source=instagram&utm_medium=cpc&utm_campaign=BlackFriday_Vendas&fbclid=IwAR29183921839213');
  const [simLeadName, setSimLeadName] = useState('Mariana Lima (Exemplo Anúncio)');
  const [simLeadPhone, setSimLeadPhone] = useState('+55 (11) 99988-7766');
  const [simMessageText, setSimMessageText] = useState('Olá! Cliquei no anúncio do Instagram da Black Friday e quero saber mais.');
  const [isSimulatingLink, setIsSimulatingLink] = useState(false);
  const [simSuccessMsg, setSimSuccessMsg] = useState<string | null>(null);

  // Triggering Manual CAPI State
  const [selectedLeadForManualCAPI, setSelectedLeadForManualCAPI] = useState<string>(leads[0]?.id || '');
  const [manualEventName, setManualEventName] = useState<MetaCAPIEvent['eventName']>('QualifiedLead');
  const [manualEventValue, setManualEventValue] = useState<string>('490');
  const [isSendingCAPI, setIsSendingCAPI] = useState(false);
  const [capiToast, setCapiToast] = useState<string | null>(null);

  // Channel metrics calculation
  const metaAdsCount = leads.filter(l => l.attribution?.sourceChannel === 'meta_ads' || l.attribution?.sourceChannel === 'instagram_ads').length;
  const googleAdsCount = leads.filter(l => l.attribution?.sourceChannel === 'google_ads').length;
  const instagramOrgCount = leads.filter(l => l.attribution?.sourceChannel === 'instagram_organic').length;
  const googleOrgCount = leads.filter(l => l.attribution?.sourceChannel === 'google_organic').length;
  const directCount = leads.length - (metaAdsCount + googleAdsCount + instagramOrgCount + googleOrgCount);

  const totalAdsLeads = metaAdsCount + googleAdsCount;
  const totalOrganicLeads = instagramOrgCount + googleOrgCount + directCount;

  // Save CAPI config
  const handleSaveCapiConfig = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('meta_capi_config', JSON.stringify(capiConfig));
    showToast('Configurações do Meta Conversions API salvas com sucesso!');
  };

  const showToast = (msg: string) => {
    setCapiToast(msg);
    setTimeout(() => setCapiToast(null), 3500);
  };

  // Send Meta CAPI Event via server endpoint
  const handleSendCAPIEvent = async (leadToUse?: LeadInfo, eventNameToUse?: MetaCAPIEvent['eventName'], valToUse?: number) => {
    const targetLead = leadToUse || leads.find(l => l.id === selectedLeadForManualCAPI) || leads[0];
    const eventName = eventNameToUse || manualEventName;
    const value = valToUse !== undefined ? valToUse : Number(manualEventValue) || 490;

    if (!targetLead) return;

    setIsSendingCAPI(true);
    try {
      const response = await apiFetch('/api/meta-capi/send-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pixelId: capiConfig.pixelId,
          accessToken: capiConfig.accessToken,
          testEventCode: capiConfig.testEventCode,
          eventName,
          leadInfo: targetLead,
          eventValue: value,
        }),
      });

      const data = await response.json();
      if (data.success) {
        const newLog: MetaCAPIEvent = {
          id: data.eventId || `evt-${Date.now()}`,
          leadId: targetLead.id,
          leadName: targetLead.name,
          eventName: eventName,
          eventTime: data.eventTime || new Date().toISOString(),
          pixelId: capiConfig.pixelId || '891029384712039',
          status: 'sent',
          testEventCode: capiConfig.testEventCode,
          matchQualityScore: data.matchQualityScore || 8.8,
          userHash: data.userHash || { phoneHash: 'sha256_hashed...' },
          eventValue: value,
          responsePayload: data,
        };

        const updatedLogs = [newLog, ...capiEventsLog];
        setCapiEventsLog(updatedLogs);
        localStorage.setItem('meta_capi_events_log', JSON.stringify(updatedLogs));

        showToast(`Evento CAPI "${eventName}" enviado com sucesso para Meta Pixel! (Event ID: ${data.eventId})`);
        
        if (onTriggerCAPIEvent) {
          onTriggerCAPIEvent(targetLead, eventName);
        }
      } else {
        showToast(`Erro ao enviar CAPI: ${data.error || 'Falha no servidor'}`);
      }
    } catch (err: any) {
      showToast(`Erro de conexão com servidor CAPI: ${err.message}`);
    } finally {
      setIsSendingCAPI(false);
    }
  };

  // Run AI Strategic Performance Analysis
  const handleGenerateAIReport = async () => {
    setIsGeneratingReport(true);
    try {
      const response = await apiFetch('/api/analytics/ai-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads }),
      });
      const data = await response.json();
      if (data.report) {
        setAiReport(data.report);
      } else {
        showToast('O servidor não retornou um relatório. Tente novamente.');
      }
    } catch (err: any) {
      console.warn('Erro ao gerar relatório com IA:', err);
      showToast('Falha ao gerar o relatório com IA — verifique sua conexão e tente novamente.');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  // Simulate UTM Entry link parsing and lead creation
  const handleSimulateUTMLink = () => {
    setIsSimulatingLink(true);
    setTimeout(() => {
      let parsedUtmSource = 'instagram';
      let parsedUtmMedium = 'cpc';
      let parsedUtmCampaign = 'BlackFriday_Vendas';
      let parsedFbclid = 'IwAR29183921839213';

      try {
        const urlObj = new URL(simUrl);
        parsedUtmSource = urlObj.searchParams.get('utm_source') || 'instagram';
        parsedUtmMedium = urlObj.searchParams.get('utm_medium') || 'cpc';
        parsedUtmCampaign = urlObj.searchParams.get('utm_campaign') || 'Campanha_Anuncio_WhatsApp';
        parsedFbclid = urlObj.searchParams.get('fbclid') || 'fb.1.1712000000.IwAR_Captured_FBCLID';
      } catch {
        // Fallback parsing if plain string
      }

      const isMeta = parsedUtmSource.includes('instagram') || parsedUtmSource.includes('facebook') || parsedUtmSource.includes('meta');
      const isGoogle = parsedUtmSource.includes('google');

      const sourceChannel = isMeta ? 'meta_ads' : isGoogle ? 'google_ads' : 'instagram_organic';
      const channelLabel = isMeta ? 'Meta Ads (Instagram)' : isGoogle ? 'Google Ads' : 'Instagram Orgânico';

      const newAttributedLead: LeadInfo = {
        id: `lead-sim-${Date.now()}`,
        name: simLeadName,
        phone: simLeadPhone,
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        timestamp: 'Agora',
        audioDuration: 0,
        status: 'pending',
        sampleType: `Captura via ${channelLabel}`,
        messages: [
          {
            id: `msg-${Date.now()}`,
            sender: 'lead',
            type: 'text',
            text: simMessageText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ],
        attribution: {
          sourceChannel,
          channelLabel,
          campaignName: parsedUtmCampaign,
          adName: 'Anúncio_Simulado_Direto',
          utmParams: {
            utm_source: parsedUtmSource,
            utm_medium: parsedUtmMedium,
            utm_campaign: parsedUtmCampaign,
            fbclid: parsedFbclid,
          },
          adDetails: {
            campaignName: parsedUtmCampaign,
            adSetName: 'Público_Simulado_Interesses',
            adName: 'Anúncio_Simulado_Direto',
            spendEstimate: 12.0,
          },
        },
      };

      if (onAddNewAttributedLead) {
        onAddNewAttributedLead(newAttributedLead);
      }

      // Automatically trigger Meta CAPI Lead Event for newly arrived lead
      handleSendCAPIEvent(newAttributedLead, 'Lead', 490);

      setIsSimulatingLink(false);
      setSimSuccessMsg(`Lead "${simLeadName}" capturado com sucesso! Rastreamento UTM vinculado e Evento Meta CAPI "Lead" disparado.`);
    }, 1200);
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner & Header */}
      <div className="bg-gradient-to-r from-slate-900 via-emerald-950/40 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 transform translate-x-10 -translate-y-10 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <div className="p-2.5 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-400">
                <Target className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">
                Análise de Atribuição de Ads & Meta CAPI (Conversions API)
              </h2>
            </div>
            <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">
              Monitore a origem de cada lead no WhatsApp (Meta Ads, Instagram, Google Ads), mensure a taxa de conversão por anúncio e envie eventos do funil direto para o **Meta Conversions API (CAPI)** para otimizar suas campanhas.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleGenerateAIReport}
              disabled={isGeneratingReport}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all shadow-lg shadow-emerald-950/50 disabled:opacity-50"
            >
              {isGeneratingReport ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Gerando Diagnóstico IA...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-emerald-300" />
                  <span>Diagnóstico por IA (Gemini)</span>
                </>
              )}
            </button>

            <button
              onClick={() => setActiveTab('capi_settings')}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all"
            >
              <Key className="w-4 h-4 text-emerald-400" />
              <span>Configurar Meta CAPI</span>
            </button>
          </div>
        </div>

        {/* Sub-navigation tabs inside header */}
        <div className="flex items-center space-x-2 mt-6 pt-4 border-t border-slate-800/80 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'overview'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-inner'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Visão Geral & Atribuição de Anúncios</span>
          </button>

          <button
            onClick={() => setActiveTab('ai_insights')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'ai_insights'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-inner'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Bot className="w-4 h-4 text-purple-400" />
            <span>Estudos & Relatório Estratégico IA</span>
          </button>

          <button
            onClick={() => setActiveTab('capi_settings')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'capi_settings'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-inner'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Send className="w-4 h-4 text-blue-400" />
            <span>Central & Disparo Meta CAPI</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30">
              {capiEventsLog.length} Eventos
            </span>
          </button>

          <button
            onClick={() => setActiveTab('utm_simulator')}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'utm_simulator'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-inner'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Smartphone className="w-4 h-4 text-amber-400" />
            <span>Simulador de Link UTM & Anúncios</span>
          </button>
        </div>
      </div>

      {/* Metric Cards Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Total Leads de Anúncios</span>
            <Target className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-white">{totalAdsLeads}</span>
            <span className="text-xs font-semibold text-emerald-400">
              ({Math.round((totalAdsLeads / (leads.length || 1)) * 100)}% do total)
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {metaAdsCount} Meta Ads • {googleAdsCount} Google Ads
          </p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Eventos Meta CAPI Enviados</span>
            <Activity className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-white">{capiEventsLog.length}</span>
            <span className="text-xs font-semibold text-blue-400">Status 200 OK</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Disparos com Hashed SHA256 Data
          </p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Event Match Quality Score</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-emerald-400">8.8 / 10</span>
            <span className="text-xs font-semibold text-slate-400">Excelente</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Pixel ID: {capiConfig.pixelId.substring(0, 8)}...
          </p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-sm hover:border-slate-700 transition-all">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium">Tráfego Orgânico & Direto</span>
            <Globe className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-white">{totalOrganicLeads}</span>
            <span className="text-xs font-semibold text-purple-400">
              ({Math.round((totalOrganicLeads / (leads.length || 1)) * 100)}%)
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Instagram Bio & Busca Orgânica
          </p>
        </div>

      </div>

      {/* TAB 1: OVERVIEW & ATTRIBUTION BREAKDOWN */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          
          {/* Visual Channel Distribution Bars */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <PieChart className="w-5 h-5 text-emerald-400" />
                  <span>Distribuição de Leads por Canal de Origem</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Mapeamento de atribuição exata de onde cada conversa no WhatsApp se iniciou
                </p>
              </div>

              <span className="px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs font-medium text-slate-300">
                {leads.length} Leads Monitorados
              </span>
            </div>

            {/* Visual Progress Bar */}
            <div className="h-4 w-full bg-slate-950 rounded-full overflow-hidden flex p-0.5 border border-slate-800">
              <div 
                style={{ width: `${(metaAdsCount / (leads.length || 1)) * 100}%` }} 
                className="bg-emerald-500 h-full rounded-l-full transition-all"
                title={`Meta Ads: ${metaAdsCount}`}
              />
              <div 
                style={{ width: `${(googleAdsCount / (leads.length || 1)) * 100}%` }} 
                className="bg-blue-500 h-full transition-all"
                title={`Google Ads: ${googleAdsCount}`}
              />
              <div 
                style={{ width: `${(instagramOrgCount / (leads.length || 1)) * 100}%` }} 
                className="bg-purple-500 h-full transition-all"
                title={`Instagram Orgânico: ${instagramOrgCount}`}
              />
              <div 
                style={{ width: `${(directCount / (leads.length || 1)) * 100}%` }} 
                className="bg-slate-600 h-full rounded-r-full transition-all"
                title={`Direto / Outros: ${directCount}`}
              />
            </div>

            {/* Legend */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="flex items-center space-x-2 text-xs">
                <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
                <span className="text-slate-300 font-medium">Meta Ads (Instagram/FB)</span>
                <span className="text-slate-500 font-bold">({metaAdsCount})</span>
              </div>
              <div className="flex items-center space-x-2 text-xs">
                <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
                <span className="text-slate-300 font-medium">Google Search Ads</span>
                <span className="text-slate-500 font-bold">({googleAdsCount})</span>
              </div>
              <div className="flex items-center space-x-2 text-xs">
                <span className="w-3 h-3 rounded-full bg-purple-500 inline-block" />
                <span className="text-slate-300 font-medium">Instagram Orgânico</span>
                <span className="text-slate-500 font-bold">({instagramOrgCount})</span>
              </div>
              <div className="flex items-center space-x-2 text-xs">
                <span className="w-3 h-3 rounded-full bg-slate-600 inline-block" />
                <span className="text-slate-300 font-medium">Direto / WhatsApp</span>
                <span className="text-slate-500 font-bold">({directCount})</span>
              </div>
            </div>
          </div>

          {/* Lead Attribution Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <Layers className="w-5 h-5 text-emerald-400" />
                  <span>Rastreamento Detalhado por Lead e Campanha</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Associação de parâmetros UTM, FBCLID e probabilidade de conversão identificada pela IA
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setActiveTab('utm_simulator')}
                  className="px-3.5 py-1.5 bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-medium hover:bg-emerald-600/30 transition-all flex items-center space-x-1.5"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Simular Entrada por UTM</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                    <th className="pb-3 pl-2">Lead</th>
                    <th className="pb-3">Canal de Origem</th>
                    <th className="pb-3">Campanha & Anúncio</th>
                    <th className="pb-3">Rastreamento (UTM / FBCLID)</th>
                    <th className="pb-3 text-center">Probabilidade IA</th>
                    <th className="pb-3 text-right pr-2">Ação CAPI Meta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {leads.map((lead) => {
                    const channel = lead.attribution?.sourceChannel || 'whatsapp_direct';
                    const isMeta = channel === 'meta_ads' || channel === 'instagram_ads';
                    const isGoogle = channel === 'google_ads';
                    const isOrganic = channel.includes('organic');

                    const dealProb = lead.fullAnalysis?.dealProbability || 50;

                    return (
                      <tr key={lead.id} className="hover:bg-slate-800/40 transition-colors">
                        
                        {/* Lead Info */}
                        <td className="py-3.5 pl-2">
                          <div className="flex items-center space-x-3">
                            <img 
                              src={lead.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'} 
                              alt={lead.name}
                              className="w-8 h-8 rounded-full object-cover border border-slate-700"
                            />
                            <div>
                              <p className="font-semibold text-slate-100">{lead.name}</p>
                              <p className="text-[11px] text-slate-400">{lead.phone}</p>
                            </div>
                          </div>
                        </td>

                        {/* Channel Badge */}
                        <td className="py-3.5">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                            isMeta
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                              : isGoogle
                              ? 'bg-blue-950/80 text-blue-300 border-blue-800/80'
                              : isOrganic
                              ? 'bg-purple-950/80 text-purple-300 border-purple-800/80'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}>
                            {lead.attribution?.channelLabel || 'Direto / WhatsApp'}
                          </span>
                        </td>

                        {/* Campaign */}
                        <td className="py-3.5">
                          <p className="font-medium text-slate-200">
                            {lead.attribution?.campaignName || 'Orgânico sem campanha'}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {lead.attribution?.adName || '—'}
                          </p>
                        </td>

                        {/* UTM Params */}
                        <td className="py-3.5">
                          {lead.attribution?.utmParams?.fbclid ? (
                            <span className="inline-flex items-center text-[10px] bg-slate-950 border border-slate-800 px-2 py-0.5 rounded font-mono text-emerald-400">
                              FBCLID: {lead.attribution.utmParams.fbclid.substring(0, 14)}...
                            </span>
                          ) : lead.attribution?.utmParams?.gclid ? (
                            <span className="inline-flex items-center text-[10px] bg-slate-950 border border-slate-800 px-2 py-0.5 rounded font-mono text-blue-400">
                              GCLID: {lead.attribution.utmParams.gclid.substring(0, 14)}...
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-500">
                              utm_source={lead.attribution?.utmParams?.utm_source || 'direct'}
                            </span>
                          )}
                        </td>

                        {/* Deal Prob */}
                        <td className="py-3.5 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            dealProb >= 75
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : dealProb >= 50
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {dealProb}%
                          </span>
                        </td>

                        {/* CAPI Trigger Action */}
                        <td className="py-3.5 text-right pr-2">
                          <button
                            onClick={() => handleSendCAPIEvent(lead, 'QualifiedLead', 490)}
                            disabled={isSendingCAPI}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-medium transition-all inline-flex items-center space-x-1 shadow-sm"
                          >
                            <Send className="w-3 h-3" />
                            <span>Enviar CAPI</span>
                          </button>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* TAB 2: AI STRATEGIC REPORT (GEMINI) */}
      {activeTab === 'ai_insights' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center space-x-2">
                  <Bot className="w-6 h-6 text-purple-400" />
                  <h3 className="text-xl font-bold text-white">
                    Estudo de Performance de Anúncios com Gemini IA
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Análise inteligente cruzando interações no WhatsApp, origem dos anúncios e objeções para tomada de decisão
                </p>
              </div>

              <button
                onClick={handleGenerateAIReport}
                disabled={isGeneratingReport}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all shadow-lg shadow-purple-950/50"
              >
                {isGeneratingReport ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Processando Relatório...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-purple-200" />
                    <span>Recalcular Análise IA</span>
                  </>
                )}
              </button>
            </div>

            {/* AI Report Content */}
            {aiReport ? (
              <div className="space-y-6">
                
                {/* Top Performing Channel Banner */}
                <div className="bg-gradient-to-r from-purple-950/40 via-slate-900 to-slate-900 border border-purple-500/30 rounded-xl p-5 flex items-center space-x-4">
                  <div className="p-3 bg-purple-500/20 border border-purple-500/40 rounded-xl text-purple-300">
                    <TrendingUp className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-purple-400">
                      Canal com Maior Retorno de Vendas
                    </span>
                    <h4 className="text-lg font-bold text-white mt-0.5">
                      {aiReport.topPerformingChannel || 'Meta Ads (Instagram Feed)'}
                    </h4>
                  </div>
                </div>

                {/* Channel Comparison Table */}
                <div className="space-y-3">
                  <h4 className="text-sm font-bold text-slate-200 flex items-center space-x-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <span>Comparativo por Canal de Anúncio</span>
                  </h4>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(aiReport.channelComparison || []).map((ch: any, idx: number) => (
                      <div key={idx} className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <span className="font-bold text-slate-100 text-sm">{ch.channel}</span>
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                            Qualidade: {ch.conversionQuality}
                          </span>
                        </div>

                        <div className="space-y-1 text-xs">
                          <p className="text-slate-400 font-medium">Objeções Recorrentes:</p>
                          <div className="flex flex-wrap gap-1">
                            {(ch.keyObjections || []).map((obj: string, i: number) => (
                              <span key={i} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                                {obj}
                              </span>
                            ))}
                          </div>
                        </div>

                        <p className="text-xs text-slate-300 bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                          <span className="font-semibold text-emerald-400">Avaliação CPL/ROI: </span>
                          {ch.cplAssessment}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Strategic Insights */}
                <div className="space-y-3 bg-slate-950/60 border border-slate-800 p-5 rounded-xl">
                  <h4 className="text-sm font-bold text-slate-200 flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span>Recomendações de Tráfego Pago & CAPI do Gemini</span>
                  </h4>

                  <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
                    {(aiReport.geminiStrategicInsights || []).map((insight: string, idx: number) => (
                      <div key={idx} className="flex items-start space-x-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{insight}</span>
                      </div>
                    ))}
                  </div>

                  {aiReport.recommendedCAPIStrategy && (
                    <div className="mt-4 pt-3 border-t border-slate-800">
                      <p className="text-xs font-semibold text-blue-400 mb-1">Estratégia Recomendada para Meta CAPI:</p>
                      <p className="text-xs text-slate-300">{aiReport.recommendedCAPIStrategy}</p>
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div className="text-center py-12 space-y-3">
                <Bot className="w-12 h-12 text-slate-600 mx-auto" />
                <p className="text-sm text-slate-300 font-medium">
                  Clique no botão acima para gerar a análise inteligente de tráfego baseada em todas as conversas do WhatsApp!
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: META CAPI CENTRAL & DISPARO */}
      {activeTab === 'capi_settings' && (
        <div className="space-y-6">
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* CAPI Config Credentials Panel */}
            <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="border-b border-slate-800 pb-3">
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <Key className="w-5 h-5 text-emerald-400" />
                  <span>Configurações do Meta Pixel & CAPI</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Credenciais da API de Conversões do Meta Ads
                </p>
              </div>

              <form onSubmit={handleSaveCapiConfig} className="space-y-4 text-xs">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Meta Pixel ID:
                  </label>
                  <input
                    type="text"
                    value={capiConfig.pixelId}
                    onChange={(e) => setCapiConfig({ ...capiConfig, pixelId: e.target.value })}
                    placeholder="Ex: 891029384712039"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Access Token Graph API:
                  </label>
                  <input
                    type="password"
                    value={capiConfig.accessToken}
                    onChange={(e) => setCapiConfig({ ...capiConfig, accessToken: e.target.value })}
                    placeholder="EAAG..."
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 font-mono text-[11px]"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Test Event Code (Meta Test Tool):
                  </label>
                  <input
                    type="text"
                    value={capiConfig.testEventCode}
                    onChange={(e) => setCapiConfig({ ...capiConfig, testEventCode: e.target.value })}
                    placeholder="Ex: TEST98765"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 font-mono text-emerald-400"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold transition-all shadow-md"
                  >
                    Salvar Credenciais CAPI
                  </button>
                </div>
              </form>
            </div>

            {/* Manual Trigger Panel */}
            <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="border-b border-slate-800 pb-3">
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <Send className="w-5 h-5 text-blue-400" />
                  <span>Disparo de Evento CAPI Manual para Testes</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Selecione um lead e envie imediatamente qualquer evento de conversão para a Meta
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Selecione o Lead:</label>
                  <select
                    value={selectedLeadForManualCAPI}
                    onChange={(e) => setSelectedLeadForManualCAPI(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500"
                  >
                    {leads.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.phone})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Nome do Evento Meta:</label>
                  <select
                    value={manualEventName}
                    onChange={(e) => setManualEventName(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 font-bold text-emerald-400"
                  >
                    <option value="Lead">Lead (Captura Inicial)</option>
                    <option value="Contact">Contact (Início de Conversa)</option>
                    <option value="QualifiedLead">QualifiedLead (Lead Qualificado IA)</option>
                    <option value="Schedule">Schedule (Agendamento)</option>
                    <option value="PurchaseIntention">PurchaseIntention (Orçamento Enviado)</option>
                    <option value="Purchase">Purchase (Venda Fechada)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Valor Estimado (R$):</label>
                  <input
                    type="number"
                    value={manualEventValue}
                    onChange={(e) => setManualEventValue(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => handleSendCAPIEvent()}
                  disabled={isSendingCAPI}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shadow-lg shadow-blue-950/50"
                >
                  {isSendingCAPI ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Enviando para Meta Graph API...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Disparar Evento CAPI Agora</span>
                    </>
                  )}
                </button>
              </div>
            </div>

          </div>

          {/* CAPI Logs Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <Database className="w-5 h-5 text-emerald-400" />
                  <span>Histórico de Eventos CAPI Disparados</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Registro em tempo real de payloads e códigos SHA256 transmitidos para o Pixel
                </p>
              </div>

              <span className="text-xs font-semibold text-emerald-400 bg-emerald-950 px-3 py-1 rounded-lg border border-emerald-800">
                Match Score: {capiEventsLog.length > 0
                  ? (capiEventsLog.reduce((sum, l) => sum + (l.matchQualityScore || 0), 0) / capiEventsLog.length).toFixed(1)
                  : '—'} / 10
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                    <th className="pb-3 pl-2">Data/Hora</th>
                    <th className="pb-3">Lead</th>
                    <th className="pb-3">Evento CAPI</th>
                    <th className="pb-3">SHA256 User Hashes</th>
                    <th className="pb-3 text-center">Status</th>
                    <th className="pb-3 text-right pr-2">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {capiEventsLog.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 pl-2 text-slate-400 text-[11px] font-mono">
                        {new Date(log.eventTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="py-3 font-semibold text-slate-100">
                        {log.leadName}
                      </td>
                      <td className="py-3">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-950 text-blue-300 border border-blue-800">
                          {log.eventName}
                        </span>
                      </td>
                      <td className="py-3 font-mono text-[10px] text-slate-400">
                        ph: {log.userHash?.phoneHash?.substring(0, 12)}...
                      </td>
                      <td className="py-3 text-center">
                        {log.status === 'error' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            Falhou
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                            <CheckCheck className="w-3 h-3 mr-1" />
                            {log.status === 'simulated_ok' ? 'Simulado' : '200 OK'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right pr-2">
                        <button
                          onClick={() => setSelectedLogItem(log)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] font-medium transition-all"
                        >
                          Ver JSON
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* TAB 4: UTM LINK SIMULATOR */}
      {activeTab === 'utm_simulator' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center space-x-2">
              <Smartphone className="w-5 h-5 text-amber-400" />
              <span>Simulador de Rastreamento de Anúncios (UTM & Link WhatsApp)</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Test do fluxo completo: Um usuário clica em um anúncio com UTMs e FBCLID no Instagram/Google, inicia conversa no WhatsApp e o sistema captura os parâmetros automaticamente!
            </p>
          </div>

          {simSuccessMsg && (
            <div className="p-4 bg-emerald-950 border border-emerald-500/50 rounded-xl text-emerald-200 text-xs flex items-center space-x-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{simSuccessMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            
            <div className="space-y-4">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  URL Parametrizada de Origem do Anúncio:
                </label>
                <textarea
                  rows={3}
                  value={simUrl}
                  onChange={(e) => setSimUrl(e.target.value)}
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono text-[11px] focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Nome do Lead Fictício:
                </label>
                <input
                  type="text"
                  value={simLeadName}
                  onChange={(e) => setSimLeadName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Telefone WhatsApp:
                </label>
                <input
                  type="text"
                  value={simLeadPhone}
                  onChange={(e) => setSimLeadPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Mensagem Inicial Enviada pelo Lead:
                </label>
                <input
                  type="text"
                  value={simMessageText}
                  onChange={(e) => setSimMessageText(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <button
                onClick={handleSimulateUTMLink}
                disabled={isSimulatingLink}
                className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold transition-all shadow-lg flex items-center justify-center space-x-2"
              >
                {isSimulatingLink ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Processando Clique & CAPI...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    <span>Simular Clique do Anúncio & Criar Lead Atribuído</span>
                  </>
                )}
              </button>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 p-5 rounded-xl space-y-3">
              <h4 className="font-bold text-slate-200 text-sm flex items-center space-x-2">
                <Code className="w-4 h-4 text-amber-400" />
                <span>Parâmetros Extraídos do Rastreamento</span>
              </h4>

              <div className="space-y-2 text-slate-300 font-mono text-[11px]">
                <div className="p-2 bg-slate-900 rounded border border-slate-800">
                  <span className="text-amber-400">utm_source:</span> instagram
                </div>
                <div className="p-2 bg-slate-900 rounded border border-slate-800">
                  <span className="text-amber-400">utm_medium:</span> cpc
                </div>
                <div className="p-2 bg-slate-900 rounded border border-slate-800">
                  <span className="text-amber-400">utm_campaign:</span> BlackFriday_Vendas
                </div>
                <div className="p-2 bg-slate-900 rounded border border-slate-800">
                  <span className="text-amber-400">fbclid:</span> IwAR29183921839213
                </div>
              </div>

              <p className="text-slate-400 text-xs pt-2">
                O sistema vincula esse rastreamento diretamente ao lead no simulador do WhatsApp e já dispara o evento <strong className="text-emerald-400">Meta CAPI Lead</strong> em background!
              </p>
            </div>

          </div>
        </div>
      )}

      {/* JSON Modal Inspection */}
      {selectedLogItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm">
                Payload Transmitido ao Meta CAPI - {selectedLogItem.eventName}
              </h3>
              <button
                onClick={() => setSelectedLogItem(null)}
                className="text-slate-400 hover:text-white px-2 py-1 rounded"
              >
                ✕
              </button>
            </div>

            <pre className="bg-slate-950 p-4 rounded-xl text-emerald-400 font-mono text-xs overflow-x-auto border border-slate-800">
              {JSON.stringify(selectedLogItem.responsePayload || selectedLogItem, null, 2)}
            </pre>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedLogItem(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-xl font-semibold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {capiToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-blue-900 border border-blue-500 text-blue-100 px-4 py-3 rounded-xl shadow-2xl flex items-center space-x-2 text-xs font-semibold animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-blue-400" />
          <span>{capiToast}</span>
        </div>
      )}

    </div>
  );
};
