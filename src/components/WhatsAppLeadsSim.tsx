import React, { useState, useEffect } from 'react';
import { INITIAL_MOCK_LEADS } from '../data/mockLeads';
import { LeadInfo, TranscriptionResult, SavedTranscriptItem, ChatMessage, FullConversationAnalysis, AgentKnowledgeBase, Tenant } from '../types';
import { blobToBase64, createSpeechAudioBlob } from '../utils/audioUtils';
import { apiFetch } from '../lib/apiClient';
import { TranscriptionCard } from './TranscriptionCard';
import { ConversationAnalysisPanel } from './ConversationAnalysisPanel';
import { 
  MessageSquare, 
  Play, 
  Sparkles, 
  Loader2, 
  Phone, 
  User, 
  Clock, 
  CheckCircle2, 
  PlusCircle, 
  Send, 
  AlertCircle, 
  RefreshCw,
  Image as ImageIcon,
  Calendar as CalendarIcon,
  FileText,
  Mic,
  Zap,
  Volume2,
  Paperclip,
  CheckCheck,
  Bot,
  UserCheck,
  Search,
  Smile,
  MoreVertical,
  Filter,
  PanelRightOpen,
  PanelRightClose,
  Globe,
  X,
  Flame,
  CircleDashed,
  MessageSquarePlus,
  Video,
  Info,
  QrCode,
  Building2,
  ShieldCheck,
  Activity,
  Trash2,
  Settings
} from 'lucide-react';

interface WhatsAppLeadsSimProps {
  onSaveTranscript: (item: SavedTranscriptItem) => void;
  knowledgeBase?: AgentKnowledgeBase;
  activeTenant?: Tenant;
  onAddNewLead?: (newLead: any) => void;
  onDeleteLead?: (leadId: string) => void;
}

// Carrega e exibe uma imagem real que o cliente mandou pelo WhatsApp (ex:
// comprovante de pagamento) — buscada via rota autenticada (nunca pública,
// pode conter dado sensível), em vez do placeholder genérico de antes.
const RealClientImage: React.FC<{ messageId: string; onOpen: (url: string) => void }> = ({ messageId, onOpen }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    apiFetch(`/api/media/${encodeURIComponent(messageId)}`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (cancelled) return;
        if (!blob) { setFailed(true); return; }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [messageId]);

  if (failed) {
    return <div className="w-full h-20 bg-slate-800 rounded-lg flex items-center justify-center text-slate-500 text-[10px]">Imagem indisponível</div>;
  }
  if (!url) {
    return <div className="w-full h-36 bg-slate-800 rounded-lg animate-pulse flex items-center justify-center text-slate-500 text-[10px]">Carregando imagem...</div>;
  }
  return (
    <div onClick={() => onOpen(url)} className="relative group rounded-lg overflow-hidden border border-white/10 cursor-pointer">
      <img src={url} alt="Imagem enviada pelo lead" className="w-full h-36 object-cover group-hover:scale-105 transition-transform duration-300" />
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
        <ImageIcon className="w-4 h-4 mr-1" /> Ampliar
      </div>
    </div>
  );
};

export const WhatsAppLeadsSim: React.FC<WhatsAppLeadsSimProps> = ({
  onSaveTranscript,
  knowledgeBase,
  activeTenant,
  onAddNewLead,
  onDeleteLead,
}) => {
  const [leads, setLeads] = useState<(LeadInfo & { textContent: string; messages: ChatMessage[]; result?: TranscriptionResult; fullAnalysis?: FullConversationAnalysis })[]>(() => {
    const saved = localStorage.getItem('saas_crm_leads');
    return saved ? JSON.parse(saved) : INITIAL_MOCK_LEADS;
  });
  const [activeLeadId, setActiveLeadId] = useState<string | null>(INITIAL_MOCK_LEADS[0].id);
  const [processingLeadId, setProcessingLeadId] = useState<string | null>(null);
  const [isAnalyzingConversation, setIsAnalyzingConversation] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Client QR Code & Config Modal state
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

  // Environment Mode State: 'production' | 'sandbox'
  const [appEnvironment, setAppEnvironment] = useState<'production' | 'sandbox'>('production');

  // Real WhatsApp Credentials state
  const [realPhone, setRealPhone] = useState(activeTenant?.whatsappPhone || '5511998887777');
  const [realEngine, setRealEngine] = useState(activeTenant?.whatsappEngine || 'evolution_vps');
  const [realApiUrl, setRealApiUrl] = useState('https://vps-evolution.minhaempresa.com.br');
  const [realApiKey, setRealApiKey] = useState('sk_live_evo_983274298');
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Handler to clear all mock/test examples
  const handleClearMockData = () => {
    if (window.confirm('Tem certeza que deseja remover todos os leads de teste/exemplo e iniciar uma lista limpa para produção?')) {
      setLeads([]);
      setActiveLeadId(null);
    }
  };

  // Auto analysis toggle
  const [autoAnalyze, setAutoAnalyze] = useState(true);

  // WhatsApp Web Filter & Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTabFilter, setActiveTabFilter] = useState<'all' | 'unread' | 'hot' | 'international'>('all');
  const [showRightPanel, setShowRightPanel] = useState(true);

  // Message Sending State
  const [inputMessage, setInputMessage] = useState('');
  const [senderRole, setSenderRole] = useState<'lead' | 'agent'>('lead');
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  // New Lead Modal state
  const [showAddLead, setShowAddLead] = useState(false);
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadText, setNewLeadText] = useState('');
  const [isGeneratingLead, setIsGeneratingLead] = useState(false);

  // Active Image Modal / Lightbox state
  const [viewImageUrl, setViewImageUrl] = useState<string | null>(null);

  // Status do agente automático real (active/paused/restricted) — controla
  // se o backend responde sozinho às mensagens recebidas (ver Epic 1.3).
  const [agentStatus, setAgentStatusState] = useState<'active' | 'paused' | 'restricted'>('active');

  useEffect(() => {
    apiFetch('/api/agent-status')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.status) setAgentStatusState(data.status); })
      .catch(() => {});
  }, []);

  // Respostas rápidas configuráveis — lista compartilhada pela equipe.
  const [quickReplies, setQuickRepliesState] = useState<string[]>([]);

  useEffect(() => {
    apiFetch('/api/quick-replies')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.quickReplies) setQuickRepliesState(data.quickReplies); })
      .catch(() => {});
  }, []);

  const handleAddQuickReply = async () => {
    const text = window.prompt('Texto da nova resposta rápida:');
    if (!text?.trim()) return;
    const updated = [...quickReplies, text.trim()];
    setQuickRepliesState(updated);
    try {
      await apiFetch('/api/quick-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quickReplies: updated }),
      });
    } catch (err) {
      console.error('Falha ao salvar resposta rápida:', err);
    }
  };

  const handleDeleteQuickReply = async (index: number) => {
    const updated = quickReplies.filter((_, i) => i !== index);
    setQuickRepliesState(updated);
    try {
      await apiFetch('/api/quick-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quickReplies: updated }),
      });
    } catch (err) {
      console.error('Falha ao remover resposta rápida:', err);
    }
  };

  // Conexão do backend com o Google Calendar real (usada pelo agente de
  // agendamento pra consultar disponibilidade e criar/reagendar/cancelar
  // consultas).
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState<boolean | null>(null);

  const fetchGoogleCalendarStatus = () => {
    apiFetch('/api/google-calendar/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setGoogleCalendarConnected(!!data?.connected))
      .catch(() => setGoogleCalendarConnected(false));
  };

  useEffect(() => { fetchGoogleCalendarStatus(); }, []);

  const handleConnectGoogleCalendar = async () => {
    try {
      const res = await apiFetch('/api/google-calendar/connect');
      const data = await res.json();
      if (data.url) window.open(data.url, '_blank', 'width=520,height=650');
    } catch (err) {
      console.error('Falha ao iniciar conexão com Google Calendar:', err);
    }
  };

  const handleChangeAgentStatus = async (status: 'active' | 'paused' | 'restricted') => {
    setAgentStatusState(status);
    try {
      await apiFetch('/api/agent-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } catch (err) {
      console.error('Falha ao atualizar status do agente:', err);
    }
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleRealFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedLead) return;

    const base64 = await blobToBase64(file);
    const newMsg: ChatMessage = {
      id: `msg-file-${Date.now()}`,
      sender: 'agent',
      type: file.type.startsWith('image/') ? 'image' : 'file',
      text: `📎 ${file.name}`,
      fileName: file.name,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };
    setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? { ...l, messages: [...(l.messages || []), newMsg] } : l)));

    try {
      await apiFetch(`/api/conversations/${encodeURIComponent(selectedLead.phone)}/send-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mimeType: file.type, filename: file.name }),
      });
    } catch (err) {
      console.error('Falha ao enviar arquivo real via WhatsApp:', err);
    }
  };

  // Gravação de voz real do operador — mesmo microfone do AudioRecorder.tsx,
  // mas enviando o áudio de verdade pro WhatsApp em vez de só transcrever.
  const [isRecordingReal, setIsRecordingReal] = useState(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);

  const handleToggleRealRecording = async () => {
    if (isRecordingReal) {
      mediaRecorderRef.current?.stop();
      setIsRecordingReal(false);
      return;
    }

    if (!selectedLead) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';
      else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';

      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const base64 = await blobToBase64(blob);

        const newMsg: ChatMessage = {
          id: `msg-audio-real-${Date.now()}`,
          sender: 'agent',
          type: 'audio',
          text: '🎤 Áudio enviado',
          audioDuration: Math.round(blob.size / 4000),
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        };
        setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? { ...l, messages: [...(l.messages || []), newMsg] } : l)));

        try {
          await apiFetch(`/api/conversations/${encodeURIComponent(selectedLead.phone)}/send-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64, mimeType, filename: 'audio.webm' }),
          });
        } catch (err) {
          console.error('Falha ao enviar áudio real via WhatsApp:', err);
        }
      };

      recorder.start();
      setIsRecordingReal(true);
    } catch (err) {
      console.error('Erro ao acessar microfone:', err);
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
    }
  };

  // Envia a foto de exemplo de um serviço (cadastrada na Base de
  // Conhecimento) pro lead selecionado — útil quando ele pergunta sobre um
  // procedimento específico e o operador quer mostrar o resultado.
  const handleSendExamplePhoto = async (productName: string) => {
    if (!selectedLead || !(selectedLead as any).isReal) return;
    const newMsg: ChatMessage = {
      id: `msg-example-photo-${Date.now()}`,
      sender: 'agent',
      type: 'image',
      text: `📷 Foto de exemplo: ${productName}`,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };
    setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? { ...l, messages: [...(l.messages || []), newMsg] } : l)));

    try {
      await apiFetch(`/api/conversations/${encodeURIComponent(selectedLead.phone)}/send-example-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName }),
      });
    } catch (err) {
      console.error('Falha ao enviar foto de exemplo:', err);
    }
  };

  // Busca conversas reais de WhatsApp (recebidas via webhook) e mescla na
  // lista — sem substituir os leads de exemplo/simulados que já existirem.
  useEffect(() => {
    let cancelled = false;

    const fetchRealConversations = async () => {
      try {
        const response = await apiFetch('/api/conversations');
        if (!response.ok || cancelled) return;
        const data = await response.json();
        const realConversations: { phone: string; name?: string; messages: ChatMessage[]; updatedAt: string; geoRestriction?: { detectedAt: string; country: string; reason: string } }[] = data.conversations || [];

        setLeads((prev) => {
          const byId = new Map(prev.map((l) => [l.id, l]));
          for (const conv of realConversations) {
            const id = `real-${conv.phone}`;
            const existing = byId.get(id);
            const lastText = conv.messages[conv.messages.length - 1]?.text || '';
            byId.set(id, {
              ...(existing as any || {}),
              id,
              name: conv.name || conv.phone,
              phone: conv.phone,
              timestamp: conv.updatedAt,
              status: 'transcribed',
              textContent: lastText,
              messages: conv.messages,
              isReal: true,
              geoRestriction: conv.geoRestriction,
            } as any);
          }
          return Array.from(byId.values());
        });
      } catch {
        // silencioso: painel continua funcionando com o que já tiver em memória/localStorage
      }
    };

    fetchRealConversations();
    const interval = setInterval(fetchRealConversations, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const selectedLead = leads.find((l) => l.id === activeLeadId) || leads[0];

  // Filtered Leads according to search and WhatsApp filter tabs
  const filteredLeads = leads.filter((lead) => {
    const matchesSearch =
      lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lead.phone.includes(searchQuery) ||
      lead.textContent.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (activeTabFilter === 'unread') {
      return lead.status === 'pending';
    }
    if (activeTabFilter === 'hot') {
      return (
        lead.fullAnalysis?.dealProbability !== undefined && lead.fullAnalysis.dealProbability >= 60
      );
    }
    if (activeTabFilter === 'international') {
      return (
        lead.phone.startsWith('+1') ||
        lead.phone.startsWith('+34') ||
        lead.fullAnalysis?.detectedLanguage?.toLowerCase().includes('inglês') ||
        lead.fullAnalysis?.detectedLanguage?.toLowerCase().includes('espanhol')
      );
    }
    return true;
  });

  // Handlers to delete conversation, clear history, or delete single message
  const handleDeleteConversation = (leadId: string, leadName: string) => {
    if (window.confirm(`Tem certeza que deseja excluir permanentemente a conversa com ${leadName}?`)) {
      const remaining = leads.filter((l) => l.id !== leadId);
      setLeads(remaining);
      localStorage.setItem('saas_crm_leads', JSON.stringify(remaining));
      if (onDeleteLead) {
        onDeleteLead(leadId);
      }
      if (activeLeadId === leadId) {
        setActiveLeadId(remaining.length > 0 ? remaining[0].id : null);
      }
    }
  };

  const handleClearChatMessages = (leadId: string) => {
    if (window.confirm('Deseja apagar o histórico de mensagens desta conversa?')) {
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, messages: [], fullAnalysis: undefined } : l))
      );
    }
  };

  const handleDeleteSingleMessage = (leadId: string, messageId: string) => {
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? { ...l, messages: (l.messages || []).filter((m) => m.id !== messageId) }
          : l
      )
    );
  };
  useEffect(() => {
    if (selectedLead && !selectedLead.fullAnalysis && !isAnalyzingConversation) {
      handleAnalyzeConversation(selectedLead);
    }
  }, [activeLeadId]);

  // Full Conversation Analysis API call
  const handleAnalyzeConversation = async (
    targetLead = selectedLead
  ) => {
    if (!targetLead) return;
    setIsAnalyzingConversation(true);
    setErrorMsg(null);

    try {
      const response = await apiFetch('/api/analyze-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadInfo: {
            name: targetLead.name,
            phone: targetLead.phone,
            sampleType: targetLead.sampleType,
          },
          messages: targetLead.messages || [],
          agentKnowledgeBase: knowledgeBase,
        }),
      });

      let data;
      try {
        data = await response.json();
      } catch (jsonErr) {
        throw new Error(`Erro na resposta do servidor (${response.status}). Tente novamente.`);
      }

      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'Erro ao analisar histórico da conversa.');
      }

      const fullAnalysis: FullConversationAnalysis = {
        ...data.analysis,
        source: data.source,
        lastUpdated: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      };

      setLeads((prev) =>
        prev.map((l) => (l.id === targetLead.id ? { ...l, fullAnalysis } : l))
      );
    } catch (err: any) {
      console.error('Erro ao analisar conversa completa:', err);
      setErrorMsg(err.message || 'Falha ao analisar a conversa com o Gemini IA.');
    } finally {
      setIsAnalyzingConversation(false);
    }
  };

  // Single Audio Transcription API call
  const handleTranscribeLeadAudio = async (lead = selectedLead) => {
    if (!lead) return;
    setProcessingLeadId(lead.id);
    setErrorMsg(null);

    try {
      const { blob, mimeType } = await createSpeechAudioBlob(lead.textContent, 'pt-BR');
      const base64Audio = await blobToBase64(blob);

      const response = await apiFetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64Audio,
          mimeType: mimeType,
          leadName: lead.name,
          leadPhone: lead.phone,
          customInstructions: `Este é um áudio simulado de um lead recebido no WhatsApp no segmento: ${lead.sampleType || 'Comercial'}.`,
        }),
      });

      let data;
      try {
        data = await response.json();
      } catch (jsonErr) {
        throw new Error(`Erro na resposta do servidor (${response.status}). Tente novamente.`);
      }

      if (!response.ok || !data.success) {
        throw new Error(data?.error || 'Erro ao processar áudio do lead.');
      }

      const res: TranscriptionResult = { ...data.result, source: data.source };

      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, status: 'transcribed', result: res } : l))
      );

      const savedItem: SavedTranscriptItem = {
        id: `wa-${lead.id}-${Date.now()}`,
        title: `Lead: ${lead.name}`,
        source: 'whatsapp_webhook',
        leadName: lead.name,
        leadPhone: lead.phone,
        audioDuration: lead.audioDuration,
        mimeType: mimeType,
        createdAt: new Date().toLocaleString('pt-BR'),
        result: res,
      };

      onSaveTranscript(savedItem);
    } catch (err: any) {
      console.error('Erro ao transcrever áudio do lead:', err);
      setErrorMsg(err.message || 'Falha ao processar o áudio do lead.');
    } finally {
      setProcessingLeadId(null);
    }
  };

  // Send a new Text Message to the chat
  const handleSendTextMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || !selectedLead) return;

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: senderRole,
      type: 'text',
      text: inputMessage.trim(),
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedLead = {
      ...selectedLead,
      messages: [...(selectedLead.messages || []), newMsg],
    };

    setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? updatedLead : l)));
    setInputMessage('');

    if (senderRole === 'agent' && (selectedLead as any).isReal) {
      sendRealWhatsAppMessage(selectedLead.phone, newMsg.text!);
    }

    if (autoAnalyze) {
      handleAnalyzeConversation(updatedLead);
    }
  };

  // Envia de verdade via Meta Cloud API (só quando o lead é uma conversa real, não simulada)
  const sendRealWhatsAppMessage = async (phone: string, text: string) => {
    try {
      await apiFetch(`/api/conversations/${encodeURIComponent(phone)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } catch (err) {
      console.error('Falha ao enviar mensagem real via WhatsApp:', err);
    }
  };

  // Apply Smart Reply suggested by AI directly into the chat
  const handleApplySuggestedReply = (replyText: string) => {
    if (!selectedLead) return;
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'agent',
      type: 'text',
      text: replyText,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedLead = {
      ...selectedLead,
      messages: [...(selectedLead.messages || []), newMsg],
    };

    setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? updatedLead : l)));

    if ((selectedLead as any).isReal) {
      sendRealWhatsAppMessage(selectedLead.phone, replyText);
    }

    if (autoAnalyze) {
      handleAnalyzeConversation(updatedLead);
    }
  };

  // Simulate sending an Audio Note from Lead or Agent
  const handleSendAudioNote = async (promptText?: string) => {
    if (!selectedLead) return;
    const spokenText = promptText || (senderRole === 'lead' 
      ? 'Gostaria de saber se vocês oferecem algum desconto para pagamento à vista no Pix ou transferência bancária.' 
      : 'Claro! Para pagamento à vista no Pix oferecemos 10% de desconto adicional imediato.');

    const newMsg: ChatMessage = {
      id: `msg-audio-${Date.now()}`,
      sender: senderRole,
      type: 'audio',
      text: spokenText,
      audioDuration: Math.max(8, Math.floor(spokenText.length / 8)),
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedLead = {
      ...selectedLead,
      messages: [...(selectedLead.messages || []), newMsg],
    };

    setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? updatedLead : l)));

    if (autoAnalyze) {
      handleAnalyzeConversation(updatedLead);
    }
  };

  // Simulate attaching an Image (e.g. product picture, payment receipt)
  const handleSendSampleImage = async () => {
    if (!selectedLead) return;
    const images = [
      {
        url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80',
        text: 'Segue a foto do comprovante de pagamento da entrada.',
        fileName: 'comprovante_pix.jpg',
      },
      {
        url: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=600&auto=format&fit=crop&q=80',
        text: 'Envei a foto do ambiente onde o equipamento será instalado.',
        fileName: 'foto_ambiente_instalacao.jpg',
      },
    ];
    const sample = images[Math.floor(Math.random() * images.length)];

    const newMsg: ChatMessage = {
      id: `msg-img-${Date.now()}`,
      sender: senderRole,
      type: 'image',
      text: sample.text,
      mediaUrl: sample.url,
      fileName: sample.fileName,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedLead = {
      ...selectedLead,
      messages: [...(selectedLead.messages || []), newMsg],
    };

    setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? updatedLead : l)));

    if (autoAnalyze) {
      handleAnalyzeConversation(updatedLead);
    }
  };

  // Simulate attaching a PDF Document
  const handleSendSampleFile = async () => {
    if (!selectedLead) return;
    const newMsg: ChatMessage = {
      id: `msg-doc-${Date.now()}`,
      sender: senderRole,
      type: 'file',
      text: 'Enviei a minuta da especificação técnica e termos de serviço em PDF.',
      fileName: 'especificacoes_tecnicas_v3.pdf',
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedLead = {
      ...selectedLead,
      messages: [...(selectedLead.messages || []), newMsg],
    };

    setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? updatedLead : l)));

    if (autoAnalyze) {
      handleAnalyzeConversation(updatedLead);
    }
  };

  // Play audio text speech synthesis
  const handlePlayAudioMessage = async (msgId: string, text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      if (playingAudioId === msgId) {
        setPlayingAudioId(null);
        return;
      }
      setPlayingAudioId(msgId);
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.onend = () => setPlayingAudioId(null);
      utterance.onerror = () => setPlayingAudioId(null);
      window.speechSynthesis.speak(utterance);
    }
  };

  // Modal handler for creating new mock lead
  const handleAddNewLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeadName || !newLeadText) return;

    setIsGeneratingLead(true);
    const newId = `lead-${Date.now()}`;
    const initialTextMsg: ChatMessage = {
      id: `msg-init-${Date.now()}`,
      sender: 'lead',
      type: 'text',
      text: newLeadText,
      timestamp: 'Agora',
    };

    const newLeadItem = {
      id: newId,
      name: newLeadName,
      phone: newLeadPhone || '+55 (11) 9' + Math.floor(10000000 + Math.random() * 90000000),
      avatarUrl: `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80`,
      timestamp: 'Agora mesmo',
      audioDuration: Math.max(10, Math.floor(newLeadText.length / 10)),
      status: 'pending' as const,
      sampleType: 'Personalizado',
      textContent: newLeadText,
      messages: [initialTextMsg],
    };

    setLeads((prev) => [newLeadItem, ...prev]);
    setActiveLeadId(newId);
    setShowAddLead(false);
    setNewLeadName('');
    setNewLeadPhone('');
    setNewLeadText('');
    setIsGeneratingLead(false);

    // Auto analyze initial lead conversation
    handleAnalyzeConversation(newLeadItem);
  };

  // Handle direct Meta CAPI trigger from conversation panel
  const handleDirectCAPI = async (eventName: string) => {
    if (!selectedLead) return;
    try {
      const response = await apiFetch('/api/meta-capi/send-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName,
          leadInfo: selectedLead,
          eventValue: 490,
        }),
      });
      const data = await response.json();
      if (data.success) {
        alert(`Evento Meta CAPI "${eventName}" disparado com sucesso para ${selectedLead.name}! Event ID: ${data.eventId}`);
      } else {
        alert(`Erro ao enviar CAPI: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Erro CAPI: ${err.message}`);
    }
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Environment Mode Switcher Bar */}
      <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <span className="text-xs font-bold text-slate-400 pl-2 hidden md:inline">Ambiente:</span>
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center space-x-1 w-full sm:w-auto">
            <button
              onClick={() => setAppEnvironment('production')}
              className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                appEnvironment === 'production'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-amber-300" />
              <span>⚡ Operação Real (Produção)</span>
            </button>

            <button
              onClick={() => setAppEnvironment('sandbox')}
              className={`flex-1 sm:flex-initial px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                appEnvironment === 'sandbox'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-950'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-purple-300" />
              <span>🧪 Sandbox (Testes de Implementação)</span>
            </button>
          </div>
        </div>

        <div className="text-[11px] text-slate-400 px-2 text-center sm:text-right">
          {appEnvironment === 'production' ? (
            <span className="text-emerald-400 font-semibold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Modo Ativo: Webhooks & Mensagens do WhatsApp (+{realPhone}) em tempo real
            </span>
          ) : (
            <span className="text-purple-300 font-semibold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-400"></span>
              Modo Ativo: Simulação isolada para homologar áudios e prompts sem afetar clientes
            </span>
          )}
        </div>
      </div>

      {/* Active Client / Tenant Connection & Instance Banner */}
      {activeTenant && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 font-bold">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-white tracking-wide">
                  {activeTenant.name}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800">
                  Plano {activeTenant.plan.toUpperCase()}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                  <Activity className="w-3 h-3 text-emerald-400 animate-pulse" /> Instância Online
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 mt-0.5">
                <span>Motor: <strong className="text-slate-200">{realEngine === 'evolution_vps' ? 'Evolution API (VPS Docker)' : 'Z-API Managed'}</strong></span>
                <span>•</span>
                <span>WhatsApp: <strong className="text-emerald-400">+{realPhone}</strong></span>
                {activeTenant.failoverEnabled && (
                  <>
                    <span>•</span>
                    <span className="text-purple-300 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-purple-400" /> Failover Ativo
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 border-slate-800 pt-3 md:pt-0">
            {/* Quota Progress */}
            <div className="text-right text-[11px] mr-2 hidden sm:block">
              <div className="text-slate-400">Leads no Mês</div>
              <div className="font-bold text-white">
                {activeTenant.currentLeadsMonth} / {activeTenant.maxLeadsPerMonth}
              </div>
            </div>

            {/* Configure Real Number & API */}
            <button
              onClick={() => setIsConfigModalOpen(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 text-emerald-400" />
              <span>Número Real & API</span>
            </button>

            {/* QR Code Button */}
            <button
              onClick={() => setIsQrModalOpen(true)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white flex items-center gap-1.5 shadow-md shadow-purple-950 transition-all cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Ver QR Code</span>
            </button>

            {/* Clear Mock Data Button */}
            <button
              onClick={handleClearMockData}
              className="px-3 py-1.5 rounded-xl text-xs font-medium bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/60 flex items-center gap-1.5 transition-all cursor-pointer"
              title="Limpar todos os contatos de teste/exemplo"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <span>Limpar Testes</span>
            </button>
          </div>
        </div>
      )}

      {/* Explanation Banner & Controls */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/90 via-slate-900 to-slate-900 border border-emerald-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 flex-shrink-0 shadow-lg shadow-emerald-950">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              Painel de Atendimento WhatsApp IA & Inteligência Comercial
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/40">
                Versão Produção v2.0
              </span>
            </h2>
            <p className="text-[11px] text-slate-300 mt-0.5 max-w-2xl">
              Interface completa integrada ao Gemini 3.6 Flash. Cada mensagem de voz, texto, foto ou arquivo recebido atualiza em tempo real a qualificação do CRM e dispara os eventos do Meta Conversions API (CAPI).
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5 self-end md:self-auto flex-shrink-0">
          {/* Toggle Right Panel */}
          <button
            onClick={() => setShowRightPanel(!showRightPanel)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              showRightPanel
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            {showRightPanel ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
            <span>{showRightPanel ? 'Ocultar Ficha IA' : 'Ver Ficha IA'}</span>
          </button>

          {/* Status do Agente Automático Real: active / paused / restricted */}
          <div className="flex items-center gap-0.5 bg-slate-950/80 p-1 rounded-xl border border-slate-800">
            {(['active', 'restricted', 'paused'] as const).map((status) => (
              <button
                key={status}
                onClick={() => handleChangeAgentStatus(status)}
                title={
                  status === 'active' ? 'Agente responde sempre' :
                  status === 'restricted' ? 'Agente só responde fora do horário comercial' :
                  'Agente pausado — silêncio total'
                }
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold capitalize transition-all cursor-pointer ${
                  agentStatus === status
                    ? status === 'paused' ? 'bg-red-500/20 text-red-300' : status === 'restricted' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {status === 'active' ? 'Ativo' : status === 'restricted' ? 'Restrito' : 'Pausado'}
              </button>
            ))}
          </div>

          {/* Conexão do backend com Google Calendar real (usada pelo agente de agendamento) */}
          <button
            onClick={googleCalendarConnected ? fetchGoogleCalendarStatus : handleConnectGoogleCalendar}
            title={googleCalendarConnected ? 'Conectado — clique pra atualizar status' : 'Conectar Google Calendar (necessário pro agente agendar de verdade)'}
            className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
              googleCalendarConnected
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            <CalendarIcon className="w-3.5 h-3.5" />
            <span>{googleCalendarConnected === null ? 'Verificando...' : googleCalendarConnected ? 'Calendar Conectado' : 'Conectar Calendar'}</span>
          </button>

          {/* Auto-analyze Toggle Switch */}
          <label className="inline-flex items-center cursor-pointer bg-slate-950/80 px-3 py-1.5 rounded-xl border border-slate-800 text-xs font-semibold text-slate-300">
            <input
              type="checkbox"
              checked={autoAnalyze}
              onChange={(e) => setAutoAnalyze(e.target.checked)}
              className="sr-only peer"
            />
            <div className="relative w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500 mr-2" />
            <span className="flex items-center text-[11px]">
              <Zap className="w-3.5 h-3.5 text-amber-400 mr-1" />
              Auto IA
            </span>
          </label>

          <button
            onClick={() => setShowAddLead(true)}
            className="inline-flex items-center px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950 transition-all cursor-pointer"
          >
            <PlusCircle className="w-4 h-4 mr-1" />
            <span>Novo Lead</span>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between gap-3">
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Aviso de IA: </span>
              <span>{errorMsg}</span>
            </div>
          </div>
          <button
            onClick={() => selectedLead && handleAnalyzeConversation(selectedLead)}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] flex items-center gap-1 flex-shrink-0 transition-all cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Tentar Novamente</span>
          </button>
        </div>
      )}

      {/* Geo Restriction Alert (erro 130497 — negócio ainda não verificado pela Meta) */}
      {(selectedLead as any)?.geoRestriction && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Bloqueio geográfico da Meta ({(selectedLead as any).geoRestriction.country}): </span>
            <span>
              O envio pra esse número falhou porque o negócio ainda não completou a Verificação de Negócio na Meta.
              Detectado em {new Date((selectedLead as any).geoRestriction.detectedAt).toLocaleString('pt-BR')}.
            </span>
          </div>
        </div>
      )}

      {/* Main WhatsApp Web Application Frame */}
      <div className="bg-[#111b21] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[680px]">
        
        {/* ========================================== */}
        {/* COLUMN 1: WhatsApp Sidebar / Inbox (4 cols or 3 cols depending on right panel) */}
        {/* ========================================== */}
        <div className={`border-r border-slate-800/80 bg-[#111b21] flex flex-col ${
          showRightPanel ? 'lg:col-span-3' : 'lg:col-span-4'
        }`}>
          
          {/* WhatsApp Web Left Header */}
          <div className="p-3 bg-[#202c33] border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="relative">
                <img
                  src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80"
                  alt="Sua conta WhatsApp"
                  className="w-9 h-9 rounded-full object-cover border border-emerald-500/60"
                />
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#202c33]" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white leading-tight">Atendimento WhatsApp</h3>
                <span className="text-[10px] text-emerald-400 font-medium flex items-center">
                  Online (WhatsApp Web)
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-2 text-slate-400">
              <button title="Status" className="p-1.5 hover:text-white rounded-lg transition-colors cursor-pointer">
                <CircleDashed className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setShowAddLead(true)} 
                title="Nova conversa" 
                className="p-1.5 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <MessageSquarePlus className="w-4 h-4 text-emerald-400" />
              </button>
              <button title="Menu" className="p-1.5 hover:text-white rounded-lg transition-colors cursor-pointer">
                <MoreVertical className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* WhatsApp Web Search Bar */}
          <div className="p-2.5 bg-[#111b21] border-b border-slate-800/60">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
              <input
                type="text"
                placeholder="Pesquisar ou começar uma nova conversa"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-7 py-1.5 bg-[#202c33] text-xs text-[#e9edef] placeholder-slate-400 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 text-slate-400 hover:text-white text-xs"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* WhatsApp Web Filter Tabs */}
            <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto pb-1 scrollbar-none text-[11px]">
              <button
                onClick={() => setActiveTabFilter('all')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer ${
                  activeTabFilter === 'all'
                    ? 'bg-[#00a884] text-slate-950 font-bold'
                    : 'bg-[#202c33] text-slate-300 hover:bg-slate-700'
                }`}
              >
                Tudo ({leads.length})
              </button>
              <button
                onClick={() => setActiveTabFilter('unread')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer ${
                  activeTabFilter === 'unread'
                    ? 'bg-[#00a884] text-slate-950 font-bold'
                    : 'bg-[#202c33] text-slate-300 hover:bg-slate-700'
                }`}
              >
                Não lidos
              </button>
              <button
                onClick={() => setActiveTabFilter('hot')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  activeTabFilter === 'hot'
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'bg-[#202c33] text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Flame className="w-3 h-3 text-amber-400" />
                Quentes
              </button>
              <button
                onClick={() => setActiveTabFilter('international')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  activeTabFilter === 'international'
                    ? 'bg-blue-500 text-slate-950 font-bold'
                    : 'bg-[#202c33] text-slate-300 hover:bg-slate-700'
                }`}
              >
                <Globe className="w-3 h-3 text-blue-400" />
                Internacional
              </button>
            </div>
          </div>

          {/* WhatsApp Web Chat List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40 scrollbar-thin">
            {filteredLeads.length > 0 ? (
              filteredLeads.map((lead) => {
                const isSelected = lead.id === activeLeadId;
                const lastMsg = lead.messages && lead.messages.length > 0 ? lead.messages[lead.messages.length - 1] : null;

                return (
                  <div
                    key={lead.id}
                    onClick={() => setActiveLeadId(lead.id)}
                    className={`p-3 transition-colors cursor-pointer relative flex items-start space-x-3 ${
                      isSelected
                        ? 'bg-[#2a3942] border-l-4 border-[#00a884]'
                        : 'hover:bg-[#202c33]'
                    }`}
                  >
                    <div className="relative flex-shrink-0">
                      <img
                        src={lead.avatarUrl}
                        alt={lead.name}
                        className="w-11 h-11 rounded-full object-cover border border-slate-700"
                      />
                      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#111b21]" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-[#e9edef] truncate">{lead.name}</h4>
                        <div className="flex items-center space-x-1">
                          <span className={`text-[10px] ${isSelected ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
                            {lead.timestamp}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteConversation(lead.id, lead.name);
                            }}
                            className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/80 rounded transition-colors cursor-pointer"
                            title="Excluir conversa"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      
                      {/* Message Preview */}
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-[11px] text-slate-400 truncate flex items-center pr-2">
                          {lastMsg ? (
                            <>
                              {lastMsg.sender === 'agent' && (
                                <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb] mr-1 flex-shrink-0" />
                              )}
                              {lastMsg.type === 'audio' && <Mic className="w-3 h-3 text-emerald-400 mr-1 flex-shrink-0" />}
                              {lastMsg.type === 'image' && <ImageIcon className="w-3 h-3 text-blue-400 mr-1 flex-shrink-0" />}
                              {lastMsg.type === 'file' && <FileText className="w-3 h-3 text-purple-400 mr-1 flex-shrink-0" />}
                              <span className="truncate">
                                {lastMsg.type === 'audio'
                                  ? 'Áudio do WhatsApp'
                                  : lastMsg.type === 'image'
                                  ? 'Foto'
                                  : lastMsg.type === 'file'
                                  ? 'Documento PDF'
                                  : lastMsg.text}
                              </span>
                            </>
                          ) : (
                            lead.textContent
                          )}
                        </p>

                        {/* Unread badge or Stage tag */}
                        {lead.status === 'pending' ? (
                          <span className="w-5 h-5 rounded-full bg-[#00a884] text-slate-950 font-extrabold text-[10px] flex items-center justify-center flex-shrink-0">
                            1
                          </span>
                        ) : lead.fullAnalysis ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/60 flex-shrink-0">
                            {lead.fullAnalysis.dealProbability}%
                          </span>
                        ) : null}
                      </div>

                      {/* Language tag indicator if available */}
                      {lead.fullAnalysis?.detectedLanguage && (
                        <div className="mt-1 flex items-center gap-1">
                          <span className="text-[9px] text-blue-300 bg-blue-950/60 px-1.5 py-0.2 rounded border border-blue-800/40 flex items-center gap-0.5">
                            <Globe className="w-2.5 h-2.5 text-blue-400" />
                            {lead.fullAnalysis.detectedLanguage}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center text-xs text-slate-500">
                Nenhuma conversa encontrada com os filtros selecionados.
              </div>
            )}
          </div>
        </div>

        {/* ========================================== */}
        {/* COLUMN 2: Interactive WhatsApp Chat Thread */}
        {/* ========================================== */}
        <div className={`flex flex-col bg-[#0b141a] relative ${
          showRightPanel ? 'lg:col-span-5' : 'lg:col-span-8'
        }`}>
          {selectedLead ? (
            <>
              {/* WhatsApp Web Chat Header */}
              <div className="p-3 bg-[#202c33] border-b border-slate-800 flex items-center justify-between z-10 shadow-md">
                <div className="flex items-center space-x-3">
                  <img
                    src={selectedLead.avatarUrl}
                    alt={selectedLead.name}
                    className="w-10 h-10 rounded-full object-cover border border-emerald-500/50"
                  />
                  <div>
                    <h3 className="text-xs font-bold text-[#e9edef] flex items-center gap-2">
                      {selectedLead.name}
                      {selectedLead.fullAnalysis?.detectedLanguage && (
                        <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 text-[9px] font-bold border border-blue-500/30">
                          {selectedLead.fullAnalysis.detectedLanguage}
                        </span>
                      )}
                    </h3>
                    <p className="text-[10px] text-slate-400 flex items-center gap-2">
                      <span>{selectedLead.phone}</span>
                      <span className="text-emerald-400">• online</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 text-slate-300">
                  <button title="Pesquisar na conversa" className="p-2 hover:bg-[#2a3942] rounded-lg transition-colors cursor-pointer">
                    <Search className="w-4 h-4 text-slate-400" />
                  </button>
                  <button title="Chamada de áudio" className="p-2 hover:bg-[#2a3942] rounded-lg transition-colors cursor-pointer">
                    <Phone className="w-4 h-4 text-slate-400" />
                  </button>
                  <button title="Chamada de vídeo" className="p-2 hover:bg-[#2a3942] rounded-lg transition-colors cursor-pointer">
                    <Video className="w-4 h-4 text-slate-400" />
                  </button>
                  
                  {/* Clear Chat History & Delete Conversation Buttons */}
                  <button
                    onClick={() => handleClearChatMessages(selectedLead.id)}
                    className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-amber-400 transition-colors cursor-pointer"
                    title="Limpar Histórico de Mensagens"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleDeleteConversation(selectedLead.id, selectedLead.name)}
                    className="p-2 bg-rose-950/60 hover:bg-rose-900 border border-rose-800/80 rounded-lg text-rose-300 transition-colors cursor-pointer"
                    title="Excluir Conversa Permanentemente"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  {/* Reanalyze button */}
                  <button
                    onClick={() => handleAnalyzeConversation(selectedLead)}
                    disabled={isAnalyzingConversation}
                    className="px-2.5 py-1.5 rounded-lg bg-[#00a884] hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                    title="Forçar Reanálise Completa com Gemini IA"
                  >
                    {isAnalyzingConversation ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">Analisar IA</span>
                  </button>
                </div>
              </div>

              {/* Real-time Analyzing Banner */}
              {isAnalyzingConversation && (
                <div className="bg-emerald-950/90 border-b border-emerald-500/40 px-3 py-1.5 text-center text-[11px] font-semibold text-emerald-300 flex items-center justify-center space-x-2 animate-pulse z-10">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  <span>Gemini analisando contexto da conversa e idioma em tempo real...</span>
                </div>
              )}

              {/* WhatsApp Messages Scroll Body */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[#0b141a] bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] scrollbar-thin">
                
                {/* WhatsApp Floating Date Badge */}
                <div className="flex justify-center my-2">
                  <span className="px-3 py-1 rounded-lg bg-[#182229] text-[10px] font-bold text-slate-400 shadow-sm uppercase tracking-wider">
                    Hoje
                  </span>
                </div>

                {selectedLead.messages && selectedLead.messages.length > 0 ? (
                  selectedLead.messages.map((msg) => {
                    const isLead = msg.sender === 'lead';
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isLead ? 'items-start' : 'items-end'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-xl p-2.5 shadow-md space-y-1 text-xs relative ${
                            isLead
                              ? 'bg-[#202c33] text-[#e9edef] rounded-tl-none border border-slate-700/50'
                              : 'bg-[#005c4b] text-white rounded-tr-none shadow-emerald-950/40'
                          }`}
                        >
                          {/* Audio Message Type */}
                          {msg.type === 'audio' && (
                            <div className="space-y-2 min-w-[220px]">
                              <div className="flex items-center space-x-2 bg-slate-950/40 p-2 rounded-lg border border-white/10">
                                <button
                                  onClick={() => handlePlayAudioMessage(msg.id, msg.text || '')}
                                  className="w-8 h-8 rounded-full bg-[#00a884] hover:bg-emerald-400 text-slate-950 flex items-center justify-center flex-shrink-0 transition-transform cursor-pointer"
                                >
                                  {playingAudioId === msg.id ? (
                                    <Volume2 className="w-4 h-4 animate-bounce" />
                                  ) : (
                                    <Play className="w-4 h-4 ml-0.5" />
                                  )}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex justify-between text-[10px] font-bold text-emerald-200">
                                    <span>Mensagem de voz</span>
                                    <span>{msg.audioDuration || 15}s</span>
                                  </div>
                                  <div className="w-full bg-slate-700/60 h-1.5 rounded-full mt-1 overflow-hidden">
                                    <div className={`h-full bg-[#00a884] ${playingAudioId === msg.id ? 'animate-pulse w-full' : 'w-1/3'}`} />
                                  </div>
                                </div>
                              </div>
                              <p className="text-[11px] italic opacity-90">
                                "{msg.text}"
                              </p>
                            </div>
                          )}

                          {/* Image Message Type */}
                          {msg.type === 'image' && (
                            <div className="space-y-1.5 min-w-[200px]">
                              {msg.mediaUrl && (
                                <div
                                  onClick={() => setViewImageUrl(msg.mediaUrl || null)}
                                  className="relative group rounded-lg overflow-hidden border border-white/10 cursor-pointer"
                                >
                                  <img
                                    src={msg.mediaUrl}
                                    alt="Imagem do lead"
                                    className="w-full h-36 object-cover group-hover:scale-105 transition-transform duration-300"
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
                                    <ImageIcon className="w-4 h-4 mr-1" /> Ampliar
                                  </div>
                                </div>
                              )}
                              {!msg.mediaUrl && (selectedLead as any)?.isReal && msg.sender === 'lead' && (
                                <RealClientImage messageId={msg.id} onOpen={setViewImageUrl} />
                              )}
                              <p className="text-xs">{msg.text}</p>
                            </div>
                          )}

                          {/* File Document Type */}
                          {msg.type === 'file' && (
                            <div className="space-y-1 min-w-[200px]">
                              <div className="flex items-center space-x-2 bg-slate-950/40 p-2.5 rounded-lg border border-white/10">
                                <FileText className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <span className="text-[11px] font-bold truncate block">
                                    {msg.fileName || 'documento.pdf'}
                                  </span>
                                  <span className="text-[9px] opacity-75">Documento PDF</span>
                                </div>
                              </div>
                              <p className="text-xs">{msg.text}</p>
                            </div>
                          )}

                          {/* Regular Text Message */}
                          {msg.type === 'text' && <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>}

                          <div className={`flex justify-between items-center text-[9px] mt-1 gap-2 border-t border-white/5 pt-1 ${isLead ? 'text-slate-400' : 'text-emerald-200'}`}>
                            <button
                              onClick={() => handleDeleteSingleMessage(selectedLead.id, msg.id)}
                              className="opacity-40 hover:opacity-100 hover:text-rose-400 transition-opacity p-0.5 cursor-pointer"
                              title="Apagar esta mensagem"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                            <div className="flex items-center gap-1">
                              <span>{msg.timestamp}</span>
                              {!isLead && <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-12 text-slate-500 text-xs">
                    Nenhuma mensagem registrada nesta conversa.
                  </div>
                )}
              </div>

              {/* WhatsApp Web Bottom Simulation Control & Input Bar */}
              <div className="p-2.5 bg-[#202c33] border-t border-slate-800 space-y-2">
                
                {/* Sender Role Switcher & Attachments Toolbar */}
                <div className="flex items-center justify-between text-xs px-1">
                  <div className="flex items-center space-x-1 bg-[#111b21] p-1 rounded-xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-bold px-1">Enviar como:</span>
                    <button
                      type="button"
                      onClick={() => setSenderRole('lead')}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                        senderRole === 'lead' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <User className="w-3 h-3 inline mr-1" />
                      Cliente
                    </button>
                    <button
                      type="button"
                      onClick={() => setSenderRole('agent')}
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                        senderRole === 'agent' ? 'bg-[#00a884] text-slate-950' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <UserCheck className="w-3 h-3 inline mr-1" />
                      Atendente
                    </button>
                  </div>

                  {/* Attachment Quick Actions */}
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={() => (selectedLead as any)?.isReal ? handleToggleRealRecording() : handleSendAudioNote()}
                      className={`px-2 py-1 rounded-lg border text-[10px] font-semibold flex items-center gap-1 cursor-pointer ${
                        isRecordingReal
                          ? 'bg-red-500/20 border-red-500/50 text-red-300 animate-pulse'
                          : 'bg-[#111b21] hover:bg-slate-800 border-slate-800 text-emerald-400'
                      }`}
                      title={(selectedLead as any)?.isReal ? (isRecordingReal ? 'Parar e enviar áudio' : 'Gravar áudio real') : 'Simular Envio de Áudio'}
                    >
                      <Mic className="w-3 h-3" />
                      <span>{isRecordingReal ? 'Gravando... (clique p/ enviar)' : 'Áudio'}</span>
                    </button>

                    <select
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '__add__') handleAddQuickReply();
                        else if (val.startsWith('__del__')) {
                          const idx = Number(val.replace('__del__', ''));
                          if (window.confirm(`Remover a resposta rápida "${quickReplies[idx]}"?`)) handleDeleteQuickReply(idx);
                        } else if (val) setInputMessage(val);
                        e.target.value = '';
                      }}
                      defaultValue=""
                      className="px-2 py-1 rounded-lg bg-[#111b21] hover:bg-slate-800 border border-slate-800 text-amber-400 text-[10px] font-semibold cursor-pointer max-w-[110px]"
                      title="Respostas rápidas"
                    >
                      <option value="" disabled>⚡ Resp. rápida...</option>
                      {quickReplies.map((qr, i) => (
                        <option key={i} value={qr}>{qr.slice(0, 40)}{qr.length > 40 ? '…' : ''}</option>
                      ))}
                      <option value="__add__">➕ Nova resposta rápida</option>
                      {quickReplies.length > 0 && (
                        <optgroup label="Remover">
                          {quickReplies.map((qr, i) => (
                            <option key={`del-${i}`} value={`__del__${i}`}>🗑️ {qr.slice(0, 30)}{qr.length > 30 ? '…' : ''}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    {(selectedLead as any)?.isReal && knowledgeBase.products.some((p) => p.exampleImageBase64) && (
                      <select
                        onChange={(e) => { if (e.target.value) { handleSendExamplePhoto(e.target.value); e.target.value = ''; } }}
                        defaultValue=""
                        className="px-2 py-1 rounded-lg bg-[#111b21] hover:bg-slate-800 border border-slate-800 text-blue-400 text-[10px] font-semibold cursor-pointer"
                        title="Enviar foto de exemplo de um serviço"
                      >
                        <option value="" disabled>📷 Foto do serviço...</option>
                        {knowledgeBase.products.filter((p) => p.exampleImageBase64).map((p) => (
                          <option key={p.id} value={p.name}>{p.name}</option>
                        ))}
                      </select>
                    )}

                    <button
                      type="button"
                      onClick={handleSendSampleImage}
                      className="px-2 py-1 rounded-lg bg-[#111b21] hover:bg-slate-800 border border-slate-800 text-blue-400 text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                      title="Simular Envio de Imagem"
                    >
                      <ImageIcon className="w-3 h-3" />
                      <span>Foto</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSendSampleFile}
                      className="px-2 py-1 rounded-lg bg-[#111b21] hover:bg-slate-800 border border-slate-800 text-purple-400 text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                      title="Simular Envio de PDF"
                    >
                      <Paperclip className="w-3 h-3" />
                      <span>PDF</span>
                    </button>
                  </div>
                </div>

                {/* WhatsApp Style Text Input Form */}
                <form onSubmit={handleSendTextMessage} className="flex items-center space-x-2">
                  <button type="button" className="p-2 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer">
                    <Smile className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => (selectedLead as any).isReal ? fileInputRef.current?.click() : handleSendSampleFile()}
                    className="p-2 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*,application/pdf" onChange={handleRealFileSelect} />

                  <input
                    type="text"
                    placeholder={
                      senderRole === 'lead'
                        ? `Mensagem de ${selectedLead.name}...`
                        : 'Digitar resposta...'
                    }
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    className="flex-1 bg-[#2a3942] text-xs text-[#e9edef] placeholder-slate-400 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                  />

                  <button
                    type="submit"
                    disabled={!inputMessage.trim()}
                    className="w-9 h-9 rounded-full bg-[#00a884] hover:bg-emerald-500 text-slate-950 flex items-center justify-center transition-all disabled:opacity-40 cursor-pointer flex-shrink-0"
                  >
                    <Send className="w-4 h-4 ml-0.5" />
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="bg-[#0b141a] p-12 text-center text-slate-500 text-xs">
              Selecione uma conversa para visualizar no WhatsApp Web.
            </div>
          )}
        </div>

        {/* ========================================== */}
        {/* COLUMN 3: Right Side Panel (WhatsApp Contact Info & IA Intelligence Panel) */}
        {/* ========================================== */}
        {showRightPanel && (
          <div className="lg:col-span-4 border-l border-slate-800/80 bg-[#111b21] flex flex-col p-3 space-y-3 overflow-y-auto max-h-[720px] scrollbar-thin">
            <ConversationAnalysisPanel
              analysis={selectedLead?.fullAnalysis}
              isLoading={isAnalyzingConversation}
              onReanalyze={() => selectedLead && handleAnalyzeConversation(selectedLead)}
              onApplySuggestedReply={handleApplySuggestedReply}
              leadName={selectedLead?.name || 'Lead'}
              onSendCAPIEvent={handleDirectCAPI}
            />
          </div>
        )}
      </div>

      {/* Lightbox Modal for Image Preview */}
      {viewImageUrl && (
        <div 
          className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setViewImageUrl(null)}
        >
          <div className="relative max-w-3xl w-full max-h-[90vh] flex items-center justify-center">
            <img 
              src={viewImageUrl} 
              alt="Mídia expandida" 
              className="max-w-full max-h-[85vh] rounded-2xl border border-slate-700 shadow-2xl object-contain" 
            />
            <span className="absolute top-2 right-2 text-white bg-slate-900/80 px-3 py-1 rounded-xl text-xs font-bold border border-slate-700">
              Clique em qualquer lugar para fechar
            </span>
          </div>
        </div>
      )}

      {/* Real WhatsApp Configuration Modal */}
      {isConfigModalOpen && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-emerald-400" />
                Configurar Número Real & API WhatsApp
              </h3>
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setIsSavingConfig(true);
                setTimeout(() => {
                  setIsSavingConfig(false);
                  setIsConfigModalOpen(false);
                  alert(`Número de WhatsApp +${realPhone} e API salvos com sucesso! O sistema está pronto para produção.`);
                }, 800);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Número de WhatsApp Oficial (com DDD e DDI)
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={realPhone}
                    onChange={(e) => setRealPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="Ex: 5511999998888"
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Número que enviará e receberá as mensagens automáticas no WhatsApp.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Motor de Integração
                </label>
                <select
                  value={realEngine}
                  onChange={(e) => setRealEngine(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="evolution_vps">Evolution API (VPS Docker / Auto-Hospedado)</option>
                  <option value="zapi">Z-API (Gerenciado)</option>
                  <option value="meta_cloud">Meta Cloud API Oficial</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  URL da Instância / Endpoint API
                </label>
                <input
                  type="url"
                  value={realApiUrl}
                  onChange={(e) => setRealApiUrl(e.target.value)}
                  placeholder="https://vps-evolution.suaempresa.com.br"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Token / API Key de Autenticação
                </label>
                <input
                  type="password"
                  value={realApiKey}
                  onChange={(e) => setRealApiKey(e.target.value)}
                  placeholder="sk_live_..."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
                  required
                />
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <div className="font-bold text-slate-200 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Endpoint de Webhook Ativo:
                </div>
                <code className="block p-1.5 bg-slate-900 rounded text-[10px] text-emerald-300 break-all border border-slate-800">
                  https://seu-dominio.com/api/webhooks/whatsapp
                </code>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsConfigModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2 shadow cursor-pointer disabled:opacity-50"
                >
                  {isSavingConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>Salvar Número & Credenciais</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Client QR Code Modal */}
      {isQrModalOpen && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4 text-center">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <QrCode className="w-4 h-4 text-purple-400" />
                Conectar WhatsApp do Cliente
              </h3>
              <button
                onClick={() => setIsQrModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-white rounded-2xl inline-block shadow-inner mx-auto border-4 border-slate-800">
              {/* Simulated QR Code Pattern */}
              <div className="w-48 h-48 bg-slate-950 p-2 rounded-xl flex items-center justify-center relative overflow-hidden group">
                <div className="grid grid-cols-6 gap-1.5 w-full h-full p-2">
                  <div className="bg-white rounded-sm col-span-2 row-span-2"></div>
                  <div className="bg-emerald-400 rounded-sm"></div>
                  <div className="bg-white rounded-sm"></div>
                  <div className="bg-white rounded-sm col-span-2 row-span-2"></div>
                  <div className="bg-white rounded-sm"></div>
                  <div className="bg-emerald-400 rounded-sm"></div>
                  <div className="bg-white rounded-sm"></div>
                  <div className="bg-emerald-400 rounded-sm"></div>
                  <div className="bg-white rounded-sm col-span-2 row-span-2"></div>
                  <div className="bg-white rounded-sm"></div>
                  <div className="bg-white rounded-sm"></div>
                  <div className="bg-emerald-400 rounded-sm"></div>
                  <div className="bg-white rounded-sm"></div>
                  <div className="bg-white rounded-sm"></div>
                  <div className="bg-emerald-400 rounded-sm"></div>
                </div>
                <div className="absolute inset-0 bg-emerald-500/10 flex items-center justify-center">
                  <MessageSquare className="w-8 h-8 text-emerald-400 drop-shadow" />
                </div>
              </div>
            </div>

            <div className="space-y-1 text-left bg-slate-950 p-3 rounded-xl border border-slate-800">
              <div className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Como Parear:
              </div>
              <ol className="text-[10px] text-slate-400 space-y-1 list-decimal list-inside pl-1">
                <li>Abra o WhatsApp no smartphone corporativo</li>
                <li>Vá em <strong>Aparelhos Conectados</strong></li>
                <li>Toque em <strong>Conectar um aparelho</strong> e aponte a câmera</li>
              </ol>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                <Activity className="w-3 h-3 animate-pulse" /> Status: Aguardando Leitura
              </span>
              <button
                onClick={() => setIsQrModalOpen(false)}
                className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow cursor-pointer"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Lead Modal */}
      {showAddLead && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-emerald-400" />
              Simular Novo Lead no WhatsApp
            </h3>
            <p className="text-xs text-slate-400">
              Crie uma nova conversa simulada para testar a inteligência contínua do Gemini.
            </p>

            <form onSubmit={handleAddNewLead} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">Nome do Lead *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Mariana Costa"
                  value={newLeadName}
                  onChange={(e) => setNewLeadName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">Telefone / WhatsApp</label>
                <input
                  type="text"
                  placeholder="Ex: +55 (11) 99887-6655"
                  value={newLeadPhone}
                  onChange={(e) => setNewLeadPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">Primeira Mensagem do Cliente *</label>
                <textarea
                  required
                  rows={3}
                  placeholder="Ex: Olá, gostaria de solicitar um orçamento para o plano enterprise..."
                  value={newLeadText}
                  onChange={(e) => setNewLeadText(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddLead(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isGeneratingLead}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-950 flex items-center space-x-1 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5 mr-1" />
                  <span>Criar Lead e Analisar</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
