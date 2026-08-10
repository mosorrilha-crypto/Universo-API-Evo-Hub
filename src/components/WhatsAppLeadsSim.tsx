import React, { useState, useEffect, useRef } from 'react';
import { INITIAL_MOCK_LEADS } from '../data/mockLeads';
import { LeadInfo, TranscriptionResult, SavedTranscriptItem, ChatMessage, FullConversationAnalysis, AgentKnowledgeBase, Tenant } from '../types';
import { blobToBase64, createSpeechAudioBlob } from '../utils/audioUtils';
import { apiFetch, getAuthToken } from '../lib/apiClient';
import { TranscriptionCard } from './TranscriptionCard';
import { ConversationAnalysisPanel } from './ConversationAnalysisPanel';
import {
  Play,
  Sparkles,
  Loader2,
  User,
  Clock,
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
  Info,
  Trash2,
  Reply,
  Forward,
  Pencil,
  Tag,
  Plus,
  Pin,
  PinOff,
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Mail,
  ChevronUp,
  ChevronDown,
  ArrowLeft,
  Ban,
  CheckCircle2,
  XCircle,
  AlertTriangle
} from 'lucide-react';

// Paleta de cores dos chips de etiqueta — a cor de cada etiqueta vem de um
// hash do próprio texto (determinístico, sem precisar de seletor de cor
// manual nem de tabela de catálogo de etiquetas).
const LABEL_COLOR_PALETTE = [
  'bg-emerald-950 text-emerald-300 border-emerald-800/60',
  'bg-blue-950 text-blue-300 border-blue-800/60',
  'bg-amber-950 text-amber-300 border-amber-800/60',
  'bg-rose-950 text-rose-300 border-rose-800/60',
  'bg-purple-950 text-purple-300 border-purple-800/60',
  'bg-cyan-950 text-cyan-300 border-cyan-800/60',
  'bg-pink-950 text-pink-300 border-pink-800/60',
  'bg-lime-950 text-lime-300 border-lime-800/60',
];

function labelColorClasses(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return LABEL_COLOR_PALETTE[Math.abs(hash) % LABEL_COLOR_PALETTE.length];
}

// Avatar de iniciais — a Meta Cloud API não expõe foto de perfil de contato
// (diferente do app pessoal do WhatsApp, que é P2P), então lead real nunca
// tem avatarUrl e caía num <img> quebrado; mock/demo tinha o problema
// inverso, todo lead com a mesma foto de stock. Cor determinística por hash
// do nome/telefone — mesmo padrão de labelColorClasses acima.
const AVATAR_COLOR_PALETTE = [
  'bg-emerald-600',
  'bg-blue-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-purple-600',
  'bg-cyan-600',
  'bg-pink-600',
  'bg-lime-600',
];

function avatarColorClasses(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_COLOR_PALETTE[Math.abs(hash) % AVATAR_COLOR_PALETTE.length];
}

function getInitials(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Só placeholders/exemplos pro operador do segmento beauty_studio — texto
// livre, não um enum fixo. O operador pode digitar qualquer coisa.
const BEAUTY_STUDIO_LABEL_SUGGESTIONS = [
  'Interesada en pestañas',
  'Interesada en cejas',
  'Interesada en labios',
  'Precio informado',
  'Duda sobre dolor',
  'Seña pendiente',
  'Comprobante recibido',
  'Turno confirmado',
];

interface WhatsAppLeadsSimProps {
  onSaveTranscript: (item: SavedTranscriptItem) => void;
  knowledgeBase?: AgentKnowledgeBase;
  activeTenant?: Tenant;
  onAddNewLead?: (newLead: any) => void;
  onDeleteLead?: (leadId: string) => void;
  /** Contador de escalonamentos pendentes (não resolvidos) do tenant — pro atalho na caixa de ferramentas do operador, mesmo dado que já alimenta o badge da aba "Escalonamentos" no Header. */
  escalationsPendingCount?: number;
  /** Troca a aba ativa do app pra "Escalonamentos" — pedido real do operador: ter um atalho aqui, sem precisar navegar pela barra de abas do topo. */
  onGoToEscalations?: () => void;
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
  escalationsPendingCount = 0,
  onGoToEscalations,
}) => {
  const [leads, setLeads] = useState<(LeadInfo & { textContent: string; messages: ChatMessage[]; result?: TranscriptionResult; fullAnalysis?: FullConversationAnalysis })[]>(() => {
    const saved = localStorage.getItem('saas_crm_leads');
    return saved ? JSON.parse(saved) : INITIAL_MOCK_LEADS;
  });
  type PanelLead = (typeof leads)[number];
  const [activeLeadId, setActiveLeadId] = useState<string | null>(INITIAL_MOCK_LEADS[0].id);
  // No mobile (abaixo do breakpoint lg), lista e conversa não cabem lado a
  // lado como no desktop — achado real do Lucas: com a lista cheia, o
  // operador tinha que rolar por dezenas de conversas até chegar na caixa de
  // mensagem, porque as duas colunas sempre ficavam empilhadas e montadas ao
  // mesmo tempo (grid-cols-1). Alterna via classe CSS (não desmonta nenhuma
  // coluna) qual das duas aparece no mobile, igual ao WhatsApp mobile real;
  // no desktop (lg:flex fixo) as duas colunas continuam sempre visíveis.
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  // Achado real em produção: a coluna 3 (Ficha IA) ficou hidden no mobile
  // (PR #70, evitava sobrepor a lista) mas o botão "Ver Ficha IA" continuou
  // visível e clicável lá, sem fazer nada — parecia quebrado. Este estado é
  // só do mobile: abre a mesma análise como um painel deslizante por cima
  // da conversa, sem mexer no showRightPanel (que continua controlando só a
  // coluna fixa do desktop).
  const [mobileAnalysisOpen, setMobileAnalysisOpen] = useState(false);
  const [processingLeadId, setProcessingLeadId] = useState<string | null>(null);
  const [isAnalyzingConversation, setIsAnalyzingConversation] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Handler to clear all mock/test examples
  const handleClearMockData = () => {
    if (window.confirm('Tem certeza que deseja remover todos os leads de teste/exemplo e iniciar uma lista limpa para produção?')) {
      setLeads([]);
      setActiveLeadId(null);
      setMobileThreadOpen(false);
    }
  };

  // Auto analysis toggle — cada análise consome tokens reais do Gemini (ver
  // tokenUsageStore.ts), inclusive só de abrir uma conversa pra dar uma
  // olhada (a primeira análise de uma conversa roda sem debounce nenhum, ver
  // useEffect abaixo). Padrão agora é DESLIGADO — análise só roda quando o
  // operador pedir (botão "Analisar IA") ou ligar isso explicitamente.
  // Persiste em localStorage pra respeitar a última escolha do operador.
  const [autoAnalyze, setAutoAnalyze] = useState(() => {
    const saved = localStorage.getItem('saas_auto_analyze_ia');
    return saved === null ? false : saved === 'true';
  });

  useEffect(() => {
    localStorage.setItem('saas_auto_analyze_ia', String(autoAnalyze));
  }, [autoAnalyze]);

  // WhatsApp Web Filter & Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTabFilter, setActiveTabFilter] = useState<'all' | 'unread' | 'hot' | 'international'>('all');
  const [showRightPanel, setShowRightPanel] = useState(true);

  // Etiquetas livres por conversa (tipo WhatsApp Business) — ver
  // server/services/conversationLabelStore.ts.
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [tenantLabelSuggestions, setTenantLabelSuggestions] = useState<string[]>([]);
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
  const [newLabelInput, setNewLabelInput] = useState('');

  // Organização de conversas — arquivar, fixar, silenciar, não lida manual.
  // Metadados só do painel (ver server/services/conversationStore.ts).
  const [showArchived, setShowArchived] = useState(false);
  const [openMenuForLeadId, setOpenMenuForLeadId] = useState<string | null>(null);

  // Message Sending State
  const [inputMessage, setInputMessage] = useState('');
  const [senderRole, setSenderRole] = useState<'lead' | 'agent'>('lead');
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  // Elemento de áudio real compartilhado (Bloco de correção "áudio não fica
  // na conversa") — antes o botão só disparava speechSynthesis lendo o
  // texto/transcrição da mensagem, nunca tocava o áudio de verdade. Cache
  // evita rebaixar o mesmo clipe do servidor a cada clique.
  const realAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlCacheRef = React.useRef<Map<string, string>>(new Map());

  // New Lead Modal state
  const [showAddLead, setShowAddLead] = useState(false);
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');
  const [newLeadText, setNewLeadText] = useState('');
  const [isGeneratingLead, setIsGeneratingLead] = useState(false);

  // Active Image Modal / Lightbox state
  const [viewImageUrl, setViewImageUrl] = useState<string | null>(null);

  // Ações de mensagem — responder (quote), encaminhar, reagir, editar.
  // Metadados só do painel (não refletem no WhatsApp real via Meta Cloud API).
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  const scrollToMessage = (messageId: string) => {
    document.getElementById(`msg-anchor-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

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

  // Achado real em produção: a rota POST /api/google-calendar/disconnect já
  // existia no backend, mas nunca foi ligada a nenhum botão — não tinha como
  // desconectar/trocar de conta pelo painel, só conectar pela primeira vez.
  const handleDisconnectGoogleCalendar = async () => {
    if (!window.confirm('Desconectar o Google Calendar? O agente de agendamento para de conseguir consultar/criar horários reais até você reconectar (pode ser com outra conta).')) return;
    try {
      const res = await apiFetch('/api/google-calendar/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGoogleCalendarConnected(false);
    } catch (err) {
      console.error('Falha ao desconectar Google Calendar:', err);
      setErrorMsg('Não foi possível desconectar o Google Calendar agora — tente de novo.');
    }
  };

  const handleChangeAgentStatus = async (status: 'active' | 'paused' | 'restricted') => {
    const previous = agentStatus;
    setAgentStatusState(status);
    try {
      const res = await apiFetch('/api/agent-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Falha ao atualizar status do agente:', err);
      setAgentStatusState(previous);
      setErrorMsg('Não foi possível atualizar o status do agente no servidor — tente de novo (o agente continua com o status anterior).');
    }
  };

  // Marca uma mensagem específica como "não entregue de verdade" — usado por
  // todos os envios reais (texto/mídia/áudio/foto de exemplo) quando a
  // chamada à Meta Cloud API falha. Sem isso, a mensagem ficava só no chat
  // local parecendo entregue, e o cliente real nunca recebia nada.
  const markMessageFailed = (leadId: string, messageId: string, errorText: string) => {
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? { ...l, messages: (l.messages || []).map((m) => (m.id === messageId ? { ...m, sendFailed: true } : m)) }
          : l
      )
    );
    setErrorMsg(errorText);
  };

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

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
      const res = await apiFetch(`/api/conversations/${encodeURIComponent(selectedLead.phone)}/send-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mimeType: file.type, filename: file.name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Falha ao enviar arquivo real via WhatsApp:', err);
      markMessageFailed(selectedLead.id, newMsg.id, `Falha ao enviar "${file.name}" pro cliente — ele NÃO recebeu este arquivo. Tente reenviar.`);
    }
  };

  // Gravação de voz real do operador — mesmo microfone do AudioRecorder.tsx,
  // mas enviando o áudio de verdade pro WhatsApp em vez de só transcrever.
  const [isRecordingReal, setIsRecordingReal] = useState(false);
  // Nome do lead pra quem a gravação em andamento vai — separado de
  // `selectedLead` de propósito: se o operador trocar de conversa no meio da
  // gravação, o áudio ainda vai pro lead onde ela começou (correto), mas sem
  // isso não havia nenhum aviso visual de qual conversa vai receber o áudio.
  const [recordingForLeadName, setRecordingForLeadName] = useState<string | null>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);

  const handleToggleRealRecording = async () => {
    if (isRecordingReal) {
      mediaRecorderRef.current?.stop();
      setIsRecordingReal(false);
      setRecordingForLeadName(null);
      return;
    }

    if (!selectedLead) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Achado numa investigação do "botão de áudio não funciona": prioriza
      // formatos que a Meta aceita nativamente como nota de voz (evita uma
      // conversão desnecessária no servidor quando o navegador já grava num
      // formato bom). Mas em navegadores como o Chrome, NENHUM desses é
      // suportado pra gravação — sempre cai em webm mesmo assim. Isso é
      // esperado e sem problema: POST /send-media agora reencoda qualquer
      // áudio não aceito pra Ogg/Opus no servidor antes de subir pra Meta
      // (server/services/audioTranscode.ts) — achado real em produção que o
      // upload de webm retornava sucesso mas o áudio nunca tocava de
      // verdade no WhatsApp do cliente, uma falha silenciosa sem erro nenhum
      // de volta.
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/mp4')) mimeType = 'audio/mp4';
      else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) mimeType = 'audio/ogg;codecs=opus';
      else if (MediaRecorder.isTypeSupported('audio/ogg')) mimeType = 'audio/ogg';
      else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType = 'audio/webm;codecs=opus';

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
          const extension = mimeType.startsWith('audio/mp4') ? 'mp4' : mimeType.startsWith('audio/ogg') ? 'ogg' : 'webm';
          const res = await apiFetch(`/api/conversations/${encodeURIComponent(selectedLead.phone)}/send-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64, mimeType, filename: `audio.${extension}` }),
          });
          if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.error || `HTTP ${res.status}`);
          }
        } catch (err: any) {
          console.error('Falha ao enviar áudio real via WhatsApp:', err);
          markMessageFailed(selectedLead.id, newMsg.id, err?.message || `Falha ao enviar o áudio pro cliente ${selectedLead.name} — ele NÃO recebeu. Tente reenviar.`);
        }
      };

      recorder.start();
      setIsRecordingReal(true);
      setRecordingForLeadName(selectedLead.name);
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
      const res = await apiFetch(`/api/conversations/${encodeURIComponent(selectedLead.phone)}/send-example-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Falha ao enviar foto de exemplo:', err);
      markMessageFailed(selectedLead.id, newMsg.id, `Falha ao enviar a foto de exemplo pro cliente — ele NÃO recebeu. Tente reenviar.`);
    }
  };

  // Busca conversas reais de WhatsApp (recebidas via webhook) e mescla na
  // lista — sem substituir os leads de exemplo/simulados que já existirem.
  useEffect(() => {
    let cancelled = false;

    const fetchRealConversations = async () => {
      try {
        // ?archived=true traz também as conversas arquivadas — a seção
        // "Arquivadas" do painel precisa delas, e não vale a pena um segundo
        // request/polling só pra isso (poucas conversas no volume atual).
        const response = await apiFetch('/api/conversations?archived=true');
        if (!response.ok || cancelled) return;
        const data = await response.json();
        const realConversations: { phone: string; name?: string; messages: ChatMessage[]; updatedAt: string; geoRestriction?: { detectedAt: string; country: string; reason: string }; labels?: string[]; archivedAt?: string; pinnedAt?: string; muted?: boolean; manuallyUnread?: boolean; aiBlockedAt?: string; unreadCount: number }[] = data.conversations || [];

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
              // Achado real em produção: a lista mostrava o ISO cru
              // ("2026-08-08T22:21:05.751+00:00") em vez de só o horário —
              // mesmo formato usado em todo o resto do painel (toLocaleTimeString).
              timestamp: new Date(conv.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
              // updatedAt cru (ISO completo) só pra ordenação — timestamp
              // acima já virou "HH:MM" pra exibição, e new Date("HH:MM") é
              // Invalid Date, então o comparador de ordenação abaixo nunca
              // conseguia comparar conversas reais de verdade (ficava sempre
              // na ordem que já estava, nunca subia a mais recente pro topo).
              updatedAtIso: conv.updatedAt,
              status: 'transcribed',
              textContent: lastText,
              // Mesmo achado do timestamp da lista (ISO cru em vez de só o
              // horário) também acontecia em CADA bolha de mensagem dentro
              // da conversa — msg.timestamp vem de created_at (Postgres) sem
              // nenhuma formatação, diferente das mensagens mock/locais que
              // já nascem formatadas via toLocaleTimeString.
              messages: conv.messages.map((m) => ({
                ...m,
                timestamp: new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
              })),
              isReal: true,
              geoRestriction: conv.geoRestriction,
              // Etiquetas e estado de organização vêm sempre do servidor
              // (fonte da verdade), igual ao geoRestriction acima —
              // sobrescreve qualquer valor otimista local a cada rodada do
              // polling.
              conversationLabels: conv.labels || [],
              archivedAt: conv.archivedAt,
              pinnedAt: conv.pinnedAt,
              muted: !!conv.muted,
              manuallyUnread: !!conv.manuallyUnread,
              aiBlockedAt: conv.aiBlockedAt,
              unreadCount: conv.unreadCount ?? 0,
            } as any);
          }
          return Array.from(byId.values());
        });
      } catch {
        // silencioso: painel continua funcionando com o que já tiver em memória/localStorage
      }
    };

    fetchRealConversations();

    // Aviso em tempo real (SSE) no lugar do polling de 8s — ver
    // server/services/conversationEvents.ts e a rota /api/conversations/stream.
    // EventSource não manda header Authorization, então o token vai por
    // query string (a mesma rota valida com jwt.verify no backend).
    let source: EventSource | null = null;
    const token = getAuthToken();
    if (token) {
      source = new EventSource(`/api/conversations/stream?token=${encodeURIComponent(token)}`);
      // O evento só carrega o telefone que mudou — reaproveita o mesmo
      // fetch da lista em vez de montar um merge separado por telefone,
      // então cobre também o caso de conversa apagada.
      source.onmessage = () => { fetchRealConversations(); };
      // EventSource já reconecta sozinho no browser depois de erro/queda de
      // conexão — não precisa de lógica de retry manual aqui.
    }

    // Rede de segurança: cobre o intervalo entre uma queda do processo (o
    // pub/sub do SSE é em memória, ver conversationEvents.ts) e a
    // reconexão real do EventSource, sem voltar a bater a cada 8s.
    const safetyPoll = setInterval(fetchRealConversations, 90000);

    return () => { cancelled = true; source?.close(); clearInterval(safetyPoll); };
  }, []);

  // Sugestões de etiqueta pro autocomplete — todas as já usadas nesse tenant
  // (evita "Interesada en pestañas" e "Interessada em Pestañas" como duas
  // etiquetas por erro de digitação). Refeito depois de cada etiqueta nova.
  const refreshLabelSuggestions = async () => {
    try {
      const res = await apiFetch('/api/conversation-labels');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.labels)) setTenantLabelSuggestions(data.labels);
    } catch {
      // silencioso — sugestões são só conveniência, não bloqueiam a função principal
    }
  };

  useEffect(() => {
    refreshLabelSuggestions();
  }, []);

  const normalizeLabelText = (label: string) =>
    label.trim().normalize('NFD').replace(new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g'), '').toLowerCase();

  // Adiciona/remove etiqueta — metadado só do painel (conversationLabelStore.ts),
  // nunca reflete no WhatsApp real. Leads de demonstração (sem backend) só
  // atualizam o estado local, com a mesma regra de normalização de duplicata.
  const handleAddLabel = async (leadId: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;

    if ((lead as any).isReal) {
      try {
        const res = await apiFetch(`/api/conversations/${encodeURIComponent(lead.phone)}/labels`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: trimmed }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, conversationLabels: data.labels } : l)));
        refreshLabelSuggestions();
      } catch (err) {
        console.error('Falha ao adicionar etiqueta no servidor:', err);
        setErrorMsg('Não foi possível adicionar essa etiqueta no servidor. Tente de novo.');
      }
      return;
    }

    setLeads((prev) => prev.map((l) => {
      if (l.id !== leadId) return l;
      const existing = l.conversationLabels || [];
      if (existing.some((e) => normalizeLabelText(e) === normalizeLabelText(trimmed))) return l;
      return { ...l, conversationLabels: [...existing, trimmed] };
    }));
  };

  const handleRemoveLabel = async (leadId: string, label: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;

    if ((lead as any).isReal) {
      try {
        const res = await apiFetch(`/api/conversations/${encodeURIComponent(lead.phone)}/labels/${encodeURIComponent(label)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, conversationLabels: data.labels } : l)));
      } catch (err) {
        console.error('Falha ao remover etiqueta no servidor:', err);
        setErrorMsg('Não foi possível remover essa etiqueta no servidor. Tente de novo.');
      }
      return;
    }

    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, conversationLabels: (l.conversationLabels || []).filter((x) => x !== label) } : l)));
  };

  const selectedLead = leads.find((l) => l.id === activeLeadId) || leads[0];

  // Achado a pedido do dono do tenant: numa conversa real, "Enviar como:
  // Cliente" não faz sentido nenhum — não existe como forjar uma mensagem
  // de entrada de um cliente de verdade no WhatsApp, só resta atendente.
  // Esse toggle é resquício do modo demo (simular os dois lados de uma
  // conversa de teste); trava sempre em 'agent' assim que a conversa
  // selecionada é real, pra nunca ficar num estado que não bate com o que
  // o botão de enviar realmente faz.
  useEffect(() => {
    if ((selectedLead as any)?.isReal && senderRole !== 'agent') {
      setSenderRole('agent');
    }
  }, [selectedLead?.id, (selectedLead as any)?.isReal]);

  // Agora que a área de mensagens tem altura fixa e rola por conta própria
  // (em vez de crescer a página inteira), precisa rolar sozinha até o fim
  // quando chega mensagem nova ou o operador troca de conversa — igual ao
  // WhatsApp Web real.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [selectedLead?.id, selectedLead?.messages?.length]);

  // Issue #82, item 3 — o backend de verificação de pagamento
  // (setPaymentVerification/verify-payment) já existia e funcionava, mas o
  // agendamento com o status do comprovante nunca chegava até aqui: não
  // tinha botão nenhum pra confirmar. Achado real em produção: agendamento
  // com sinal pago preso em "pending_verification" por dias, cliente
  // perguntando "confirmou?" sem ninguém conseguir clicar em nada.
  const [paymentAppointment, setPaymentAppointment] = useState<{ summary: string; startIso: string; paymentStatus?: string } | null>(null);
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);

  useEffect(() => {
    if (!selectedLead?.phone || !(selectedLead as any)?.isReal) {
      setPaymentAppointment(null);
      return;
    }
    let cancelled = false;
    apiFetch(`/api/conversations/${encodeURIComponent(selectedLead.phone)}/appointment`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setPaymentAppointment(data?.appointment || null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedLead?.phone, (selectedLead as any)?.isReal]);

  const handleVerifyPayment = async (status: 'verified' | 'rejected') => {
    if (!selectedLead?.phone) return;
    setIsVerifyingPayment(true);
    try {
      const res = await apiFetch(`/api/conversations/${encodeURIComponent(selectedLead.phone)}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPaymentAppointment(data.appointment);
    } catch (err) {
      console.error('Falha ao verificar pagamento:', err);
      setErrorMsg('Não foi possível registrar a verificação de pagamento agora — tente de novo.');
    } finally {
      setIsVerifyingPayment(false);
    }
  };

  // Conversas arquivadas saem da lista principal e ficam numa seção própria,
  // colapsável — igual à seção "Arquivadas" do WhatsApp Web real.
  const archivedLeads = leads.filter((lead) => !!lead.archivedAt);

  // Contagem real de não lidas: pra conversa real, vem de unreadCount
  // (calculado no backend a partir de last_read_at — ver
  // server/services/conversationStore.ts), combinada com manuallyUnread (o
  // "Marcar como não lida" manual do menu ⋮, PR #57) — reconciliação
  // documentada na migration 0008: uma conversa conta como não lida se
  // QUALQUER um dos dois for verdadeiro, mesmo que o operador já tenha lido
  // tudo de verdade (unreadCount real 0) e só queira lembrar de voltar nela.
  // Pra lead de demonstração (sem backend por trás), não existe rastreamento
  // real de leitura — usa o status de transcrição pendente como aproximação
  // só pra manter a demonstração funcional, igual já era antes.
  const getUnreadCount = (lead: LeadInfo): number => {
    if ((lead as any).isReal) {
      const real = (lead as any).unreadCount ?? 0;
      return (lead as any).manuallyUnread ? Math.max(real, 1) : real;
    }
    return lead.status === 'pending' ? 1 : 0;
  };
  const unreadLeadsCount = leads.filter((lead) => getUnreadCount(lead) > 0).length;

  // Filtered Leads according to search and WhatsApp filter tabs
  const filteredLeads = leads
    .filter((lead) => {
      if (lead.archivedAt) return false;

      const query = searchQuery.toLowerCase();
      const matchesSearch =
        lead.name.toLowerCase().includes(query) ||
        lead.phone.includes(searchQuery) ||
        lead.textContent.toLowerCase().includes(query) ||
        (lead.messages || []).some((m) => m.text?.toLowerCase().includes(query));

      if (!matchesSearch) return false;

      if (labelFilter && !(lead.conversationLabels || []).some((l) => normalizeLabelText(l) === normalizeLabelText(labelFilter))) {
        return false;
      }

      if (activeTabFilter === 'unread') {
        return getUnreadCount(lead) > 0;
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
    })
    // Achado a pedido do dono do tenant: a lista não se comportava como o
    // WhatsApp real — uma conversa recebendo mensagem nova não subia pro
    // topo, e conversa nova entrava no fim da lista em vez do topo. Ordena
    // pela atividade mais recente (lead.timestamp é o `updated_at` real do
    // backend pra conversas reais). Quando o timestamp não é uma data válida
    // (leads de demonstração com hora solta tipo "14:32", ou "Agora mesmo"),
    // mantém a ordem relativa em vez de embaralhar a lista.
    .sort((a, b) => {
      // Fixadas sempre primeiro (a mais recentemente fixada primeiro),
      // igual ao WhatsApp Web real — só depois disso desempata por atividade.
      if (a.pinnedAt || b.pinnedAt) {
        if (a.pinnedAt && b.pinnedAt) return b.pinnedAt.localeCompare(a.pinnedAt);
        return a.pinnedAt ? -1 : 1;
      }
      // Lead real: usa updatedAtIso (ISO completo, sortável de verdade).
      // Lead de demonstração: timestamp já vem como data completa/parseável
      // (ou "Agora mesmo"/hora solta, que cai no NaN abaixo e mantém a
      // ordem relativa de propósito).
      const dateA = new Date((a as any).updatedAtIso || a.timestamp).getTime();
      const dateB = new Date((b as any).updatedAtIso || b.timestamp).getTime();
      if (Number.isNaN(dateA) || Number.isNaN(dateB)) return 0;
      return dateB - dateA;
    });

  // Seleciona a conversa e, se for real e tiver mensagens não lidas (contagem
  // real vinda do servidor E/OU marcação manual do operador via menu ⋮),
  // zera os dois: manuallyUnread (PATCH /state, já existente) e unreadCount
  // (POST /read, zera localmente pra feedback imediato sem esperar o
  // próximo polling de 8s).
  const handleSelectLead = (lead: LeadInfo) => {
    setActiveLeadId(lead.id);
    setMobileThreadOpen(true);
    if ((lead as any).isReal) {
      if ((lead as any).manuallyUnread) {
        handleUpdateConversationState(lead.id, { unread: false });
      }
      if ((lead as any).unreadCount > 0) {
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? ({ ...l, unreadCount: 0 } as any) : l)));
        apiFetch(`/api/conversations/${encodeURIComponent(lead.phone)}/read`, { method: 'POST' }).catch((err) => {
          console.error('Falha ao marcar conversa como lida:', err);
        });
      }
    }
  };

  // Handlers to delete conversation, clear history, or delete single message
  const handleDeleteConversation = async (leadId: string, leadName: string) => {
    if (!window.confirm(`Tem certeza que deseja excluir permanentemente a conversa com ${leadName}?`)) return;

    const lead = leads.find((l) => l.id === leadId);
    // Numa conversa real, apaga no servidor primeiro — sem isso, o polling
    // de /api/conversations (a cada 8s) trazia a conversa de volta sozinha,
    // porque o contato continuava existindo no backend.
    if ((lead as any)?.isReal) {
      try {
        const res = await apiFetch(`/api/conversations/${encodeURIComponent(lead!.phone)}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('Falha ao excluir conversa real no servidor:', err);
        setErrorMsg('Não foi possível excluir a conversa no servidor — ela pode voltar a aparecer. Tente de novo.');
        return;
      }
    }

    const remaining = leads.filter((l) => l.id !== leadId);
    setLeads(remaining);
    localStorage.setItem('saas_crm_leads', JSON.stringify(remaining));
    if (onDeleteLead) {
      onDeleteLead(leadId);
    }
    if (activeLeadId === leadId) {
      setActiveLeadId(remaining.length > 0 ? remaining[0].id : null);
      // Volta pra lista no mobile — a próxima conversa não foi uma escolha
      // do operador, então não faz sentido abrir a thread dela sozinha.
      setMobileThreadOpen(false);
    }
  };

  // Arquivar/fixar/silenciar/marcar como não lida — menu ⋮ de cada conversa.
  // Metadados só do painel (server/services/conversationStore.ts), nunca
  // refletem no WhatsApp real. Leads de demonstração (sem backend) só
  // atualizam o estado local, igual ao padrão de handleSaveEditedMessage.
  const handleUpdateConversationState = async (leadId: string, patch: { archived?: boolean; pinned?: boolean; muted?: boolean; unread?: boolean; name?: string; aiBlocked?: boolean }) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;

    if ((lead as any).isReal) {
      try {
        const res = await apiFetch(`/api/conversations/${encodeURIComponent(lead.phone)}/state`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setLeads((prev) => prev.map((l) => (l.id === leadId ? {
          ...l,
          name: data.conversation?.name || l.phone,
          archivedAt: data.conversation?.archivedAt,
          pinnedAt: data.conversation?.pinnedAt,
          muted: !!data.conversation?.muted,
          manuallyUnread: !!data.conversation?.manuallyUnread,
          aiBlockedAt: data.conversation?.aiBlockedAt,
        } : l)));
      } catch (err) {
        console.error('Falha ao atualizar organização da conversa no servidor:', err);
        setErrorMsg('Não foi possível salvar essa ação no servidor. Tente de novo.');
      }
      return;
    }

    setLeads((prev) => prev.map((l) => {
      if (l.id !== leadId) return l;
      const updated: PanelLead = { ...l };
      if (patch.archived !== undefined) updated.archivedAt = patch.archived ? new Date().toISOString() : undefined;
      if (patch.pinned !== undefined) updated.pinnedAt = patch.pinned ? new Date().toISOString() : undefined;
      if (patch.muted !== undefined) updated.muted = patch.muted;
      if (patch.unread !== undefined) updated.manuallyUnread = patch.unread;
      if (patch.name !== undefined) updated.name = patch.name;
      if (patch.aiBlocked !== undefined) updated.aiBlockedAt = patch.aiBlocked ? new Date().toISOString() : undefined;
      return updated;
    }));
  };

  // Identifica o lead — troca/adiciona o nome do contato. Achado real em
  // produção: leads chegam só com o número (595985407441) porque a Meta só
  // manda o nome de perfil de WhatsApp quando o cliente tem um definido; o
  // operador precisa poder anotar o nome de verdade do cliente.
  const handleRenameLead = (leadId: string, currentName: string) => {
    const input = window.prompt('Nome do contato:', currentName);
    if (input === null) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    handleUpdateConversationState(leadId, { name: trimmed });
  };

  const handleClearChatMessages = async (leadId: string) => {
    if (!window.confirm('Deseja apagar o histórico de mensagens desta conversa?')) return;

    const lead = leads.find((l) => l.id === leadId);
    if ((lead as any)?.isReal) {
      try {
        const res = await apiFetch(`/api/conversations/${encodeURIComponent(lead!.phone)}/history`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('Falha ao limpar histórico real no servidor:', err);
        setErrorMsg('Não foi possível limpar o histórico no servidor — as mensagens podem voltar a aparecer. Tente de novo.');
        return;
      }
    }

    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, messages: [], fullAnalysis: undefined } : l))
    );
  };

  const handleDeleteSingleMessage = async (leadId: string, messageId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if ((lead as any)?.isReal) {
      try {
        const res = await apiFetch(`/api/conversations/${encodeURIComponent(lead!.phone)}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('Falha ao apagar mensagem real no servidor:', err);
        setErrorMsg('Não foi possível apagar a mensagem no servidor — ela pode voltar a aparecer.');
        return;
      }
    }

    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? { ...l, messages: (l.messages || []).filter((m) => m.id !== messageId) }
          : l
      )
    );
  };
  // Quantas mensagens a conversa tinha na última análise gerada, por lead —
  // sem isso, a análise só rodava na primeira vez que a conversa era aberta
  // e ficava "congelada" pra sempre depois (mesmo com mensagens novas
  // chegando de verdade pelo polling de /api/conversations a cada 8s).
  const lastAnalyzedCountRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!selectedLead || !autoAnalyze || isAnalyzingConversation) return;
    const msgCount = selectedLead.messages?.length || 0;
    if (lastAnalyzedCountRef.current[selectedLead.id] === msgCount) return;

    // Primeira análise da conversa: roda na hora. Mensagens novas chegando
    // depois: espera um respiro de 5s, pra não reanalisar a cada mensagem
    // picotada ou a cada rodada do polling.
    const delay = selectedLead.fullAnalysis ? 5000 : 0;
    const timer = setTimeout(() => {
      handleAnalyzeConversation(selectedLead);
    }, delay);
    return () => clearTimeout(timer);
  }, [activeLeadId, selectedLead?.messages?.length, autoAnalyze, isAnalyzingConversation]);

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
      // Registra a contagem mesmo quando falha — senão a reanálise automática
      // (debounce de 5s) tenta de novo pra sempre a cada erro, num loop que
      // trava o painel entre "Analisando..." e erro. Numa falha, só tenta de
      // novo quando chegar mensagem nova ou o usuário clicar "Atualizar".
      lastAnalyzedCountRef.current[targetLead.id] = (targetLead.messages || []).length;
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

    if (editingMessageId) {
      await handleSaveEditedMessage(editingMessageId, inputMessage.trim());
      return;
    }

    const replyToMessageId = replyingTo?.id;
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: senderRole,
      type: 'text',
      text: inputMessage.trim(),
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      replyToMessageId,
    };

    const updatedLead = {
      ...selectedLead,
      messages: [...(selectedLead.messages || []), newMsg],
    };

    setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? updatedLead : l)));
    setInputMessage('');
    setReplyingTo(null);

    if (senderRole === 'agent' && (selectedLead as any).isReal) {
      sendRealWhatsAppMessage(selectedLead.id, selectedLead.phone, newMsg.id, newMsg.text!, replyToMessageId);
    }

    if (autoAnalyze) {
      handleAnalyzeConversation(updatedLead);
    }
  };

  // Envia de verdade via Meta Cloud API (só quando o lead é uma conversa real, não simulada)
  const sendRealWhatsAppMessage = async (leadId: string, phone: string, messageId: string, text: string, replyToMessageId?: string) => {
    try {
      const res = await apiFetch(`/api/conversations/${encodeURIComponent(phone)}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...(replyToMessageId ? { replyToMessageId } : {}) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Falha ao enviar mensagem real via WhatsApp:', err);
      markMessageFailed(leadId, messageId, 'Falha ao enviar a mensagem pro cliente — ele NÃO recebeu. Tente reenviar.');
    }
  };

  const handleReplyToMessage = (msg: ChatMessage) => {
    setEditingMessageId(null);
    setReplyingTo(msg);
  };

  const handleStartEditMessage = (msg: ChatMessage) => {
    setReplyingTo(null);
    setEditingMessageId(msg.id);
    setInputMessage(msg.text || '');
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setInputMessage('');
  };

  // Edita o texto de uma mensagem já enviada — só mensagens do agente/
  // operador (o botão de editar só aparece nelas), nunca do lead (seria
  // falsificar o que o cliente disse). Metadado só do painel.
  const handleSaveEditedMessage = async (messageId: string, newText: string) => {
    if (!selectedLead) return;
    if ((selectedLead as any).isReal) {
      try {
        const res = await apiFetch(`/api/conversations/${encodeURIComponent(selectedLead.phone)}/messages/${encodeURIComponent(messageId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: newText }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('Falha ao editar mensagem real no servidor:', err);
        setErrorMsg('Não foi possível editar a mensagem no servidor. Tente de novo.');
        return;
      }
    }

    setLeads((prev) =>
      prev.map((l) =>
        l.id === selectedLead.id
          ? { ...l, messages: (l.messages || []).map((m) => (m.id === messageId ? { ...m, text: newText, editedAt: new Date().toISOString() } : m)) }
          : l
      )
    );
    setEditingMessageId(null);
    setInputMessage('');
  };

  // Encaminha uma mensagem existente pra outro contato — metadado só do
  // painel, não reflete no WhatsApp real via Meta Cloud API.
  const handleForwardMessage = async (toLead: LeadInfo) => {
    if (!forwardingMessage || !selectedLead) return;
    if ((selectedLead as any).isReal) {
      try {
        const res = await apiFetch(
          `/api/conversations/${encodeURIComponent(selectedLead.phone)}/messages/${encodeURIComponent(forwardingMessage.id)}/forward`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toPhone: toLead.phone }) }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('Falha ao encaminhar mensagem no servidor:', err);
        setErrorMsg('Não foi possível encaminhar a mensagem. Tente de novo.');
        return;
      }
    }

    const forwardedMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'agent',
      type: forwardingMessage.type,
      text: forwardingMessage.text,
      mediaUrl: forwardingMessage.mediaUrl,
      fileName: forwardingMessage.fileName,
      audioDuration: forwardingMessage.audioDuration,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      forwardedFromMessageId: forwardingMessage.id,
    };

    setLeads((prev) =>
      prev.map((l) => (l.id === toLead.id ? { ...l, messages: [...(l.messages || []), forwardedMsg] } : l))
    );
    setForwardingMessage(null);
  };

  // Reage a uma mensagem com um emoji — upsert por ator: reagir de novo
  // troca a reação anterior do mesmo operador, nunca acumula.
  const handleReactToMessage = async (msg: ChatMessage, emoji: string) => {
    if (!selectedLead) return;
    setReactionPickerFor(null);
    if ((selectedLead as any).isReal) {
      try {
        const res = await apiFetch(
          `/api/conversations/${encodeURIComponent(selectedLead.phone)}/messages/${encodeURIComponent(msg.id)}/react`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }) }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.error('Falha ao reagir à mensagem no servidor:', err);
        setErrorMsg('Não foi possível reagir à mensagem. Tente de novo.');
        return;
      }
    }

    setLeads((prev) =>
      prev.map((l) =>
        l.id === selectedLead.id
          ? {
              ...l,
              messages: (l.messages || []).map((m) =>
                m.id === msg.id
                  ? { ...m, reactions: [...(m.reactions || []).filter((r) => r.by !== 'agent'), { emoji, by: 'agent' as const, at: new Date().toISOString() }] }
                  : m
              ),
            }
          : l
      )
    );
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
      sendRealWhatsAppMessage(selectedLead.id, selectedLead.phone, newMsg.id, replyText);
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

  // Toca o áudio real (recebido do cliente ou gravado pelo operador),
  // buscado via rota autenticada (GET /api/media/:messageId) — corrige um
  // achado real em produção: o "player" de áudio nunca tocava o áudio de
  // verdade, só lia o texto/transcrição em voz sintetizada
  // (handlePlayAudioMessage acima), porque o áudio real nunca era salvo em
  // lugar nenhum. Só vale pra conversa real (isReal); leads de demonstração
  // continuam no fallback de speechSynthesis.
  const handlePlayRealAudioMessage = async (messageId: string) => {
    const audioEl = realAudioRef.current;
    if (!audioEl) return;

    if (playingAudioId === messageId) {
      audioEl.pause();
      setPlayingAudioId(null);
      return;
    }

    try {
      let url = audioObjectUrlCacheRef.current.get(messageId);
      if (!url) {
        const res = await apiFetch(`/api/media/${encodeURIComponent(messageId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        audioObjectUrlCacheRef.current.set(messageId, url);
      }
      audioEl.src = url;
      audioEl.onended = () => setPlayingAudioId(null);
      audioEl.onerror = () => setPlayingAudioId(null);
      await audioEl.play();
      setPlayingAudioId(messageId);
    } catch (err) {
      console.error('Falha ao tocar áudio real:', err);
      setPlayingAudioId(null);
      setErrorMsg('Não foi possível tocar esse áudio — ele pode ainda não ter sido salvo (aguarde alguns segundos após enviar) ou o arquivo se perdeu.');
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

    setLeads((prev) => {
      const updated = [newLeadItem, ...prev];
      localStorage.setItem('saas_crm_leads', JSON.stringify(updated));
      return updated;
    });
    // Propaga pro state do App.tsx (usado pelo CRM/Financeiro/Atribuição) —
    // sem isso, o lead criado aqui só existia dentro deste componente e
    // sumia ao recarregar a página, nunca aparecendo no CRM.
    onAddNewLead?.(newLeadItem);
    setActiveLeadId(newId);
    setMobileThreadOpen(true);
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

  // Uma linha da lista de conversas — usada tanto na lista principal quanto
  // na seção "Arquivadas" colapsável, pra não duplicar o JSX.
  const renderLeadRow = (lead: PanelLead) => {
    const isSelected = lead.id === activeLeadId;
    const lastMsg = lead.messages && lead.messages.length > 0 ? lead.messages[lead.messages.length - 1] : null;
    const isPinned = !!lead.pinnedAt;
    const isMuted = !!lead.muted;
    const isArchived = !!lead.archivedAt;
    const isManuallyUnread = !!lead.manuallyUnread;
    const isAiBlocked = !!lead.aiBlockedAt;
    const isMenuOpen = openMenuForLeadId === lead.id;
    const unreadCount = getUnreadCount(lead);

    return (
      <div
        key={lead.id}
        onClick={() => handleSelectLead(lead)}
        className={`p-3 transition-colors cursor-pointer relative flex items-start space-x-3 ${
          isSelected
            ? 'bg-[#2a3942] border-l-4 border-[#00a884]'
            : 'hover:bg-[#202c33]'
        }`}
      >
        <div className="relative flex-shrink-0">
          <div
            className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-xs border border-slate-700 ${avatarColorClasses(lead.name || lead.phone)}`}
          >
            {getInitials(lead.name || lead.phone)}
          </div>
          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#111b21]" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-[#e9edef] truncate flex items-center gap-1">
              {isPinned && <Pin className="w-3 h-3 text-slate-400 flex-shrink-0" />}
              <span className="truncate">{lead.name}</span>
            </h4>
            <div className="flex items-center space-x-1">
              {isAiBlocked && <Ban className="w-3 h-3 text-rose-400 flex-shrink-0" title="IA bloqueada — lead não qualificado" />}
              {isMuted && <BellOff className="w-3 h-3 text-slate-500 flex-shrink-0" title="Silenciada" />}
              <span className={`text-[10px] ${isSelected ? 'text-emerald-400 font-bold' : 'text-slate-400'}`}>
                {lead.timestamp}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuForLeadId(isMenuOpen ? null : lead.id);
                }}
                className="p-1 text-slate-400 hover:text-white hover:bg-slate-700/60 rounded transition-colors cursor-pointer"
                title="Mais opções"
              >
                <MoreVertical className="w-3.5 h-3.5" />
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
            {unreadCount > 0 ? (
              <span className="w-5 h-5 rounded-full bg-[#00a884] text-slate-950 font-extrabold text-[10px] flex items-center justify-center flex-shrink-0">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : lead.fullAnalysis ? (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800/60 flex-shrink-0">
                {lead.fullAnalysis.dealProbability}%
              </span>
            ) : null}
          </div>

          {/* Etiquetas livres (tipo WhatsApp Business) */}
          {lead.conversationLabels && lead.conversationLabels.length > 0 && (
            <div className="mt-1 flex items-center gap-1 flex-wrap">
              {lead.conversationLabels.map((label) => (
                <span
                  key={label}
                  className={`text-[9px] px-1.5 py-0.5 rounded border flex-shrink-0 ${labelColorClasses(label)}`}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>

        {isMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => { e.stopPropagation(); setOpenMenuForLeadId(null); }}
            />
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-2 top-10 z-50 w-52 bg-[#233138] border border-slate-700 rounded-xl shadow-2xl overflow-hidden text-xs origin-top-right animate-pop-in"
            >
              <button
                onClick={() => { setOpenMenuForLeadId(null); handleRenameLead(lead.id, lead.name); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Editar nome do contato</span>
              </button>
              <button
                onClick={() => { handleUpdateConversationState(lead.id, { aiBlocked: !isAiBlocked }); setOpenMenuForLeadId(null); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-slate-700/60 transition-colors cursor-pointer ${isAiBlocked ? 'text-emerald-300' : 'text-rose-300'}`}
                title="Lead não qualificado/insistente — a IA para de responder só pra esse número, o resto do atendimento automático continua normal"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>{isAiBlocked ? 'Reativar IA pra esse lead' : 'Bloquear IA pra esse lead'}</span>
              </button>
              <button
                onClick={() => { handleUpdateConversationState(lead.id, { pinned: !isPinned }); setOpenMenuForLeadId(null); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
              >
                {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                <span>{isPinned ? 'Desafixar conversa' : 'Fixar conversa'}</span>
              </button>
              <button
                onClick={() => { handleUpdateConversationState(lead.id, { unread: !isManuallyUnread }); setOpenMenuForLeadId(null); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>{isManuallyUnread ? 'Marcar como lida' : 'Marcar como não lida'}</span>
              </button>
              <button
                onClick={() => { handleUpdateConversationState(lead.id, { muted: !isMuted }); setOpenMenuForLeadId(null); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
              >
                {isMuted ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                <span>{isMuted ? 'Ativar notificações' : 'Silenciar notificações'}</span>
              </button>
              <button
                onClick={() => { handleUpdateConversationState(lead.id, { archived: !isArchived }); setOpenMenuForLeadId(null); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
              >
                {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                <span>{isArchived ? 'Desarquivar conversa' : 'Arquivar conversa'}</span>
              </button>
              <button
                onClick={() => { setOpenMenuForLeadId(null); handleDeleteConversation(lead.id, lead.name); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-rose-300 hover:bg-rose-950/60 transition-colors cursor-pointer border-t border-slate-700"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Excluir conversa</span>
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Controls Bar — achado real em produção: as duas barras acima disso
          (seletor "Ambiente" produção/sandbox e o card "Instância Online" /
          "Motor: Z-API Managed" / "Failover Ativo" / botões "Número Real &
          API" e "Ver QR Code") eram inteiramente decorativas — vinham de
          campos mock do Tenant local (nunca sincronizados com o backend
          real), o alerta do próprio modal de config já admitia "esta tela
          ainda NÃO envia a configuração pro servidor", e o QR Code era um
          padrão de quadrados fixo, nunca gerado de verdade (a geração real
          já existe em server/routes/admin.ts, Epic 4.6, sem UI ligada a
          ela ainda). Removidas — poluíam a tela com informação falsa sobre
          o estado da conexão real (que é sempre a resolvida pelo JWT/
          phone_number_id no backend, nunca essa seleção local). "Limpar
          Testes" era o único botão real desse trecho — preservado abaixo. */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/90 via-slate-900 to-slate-900 border border-emerald-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center space-x-3.5">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 flex-shrink-0 shadow-lg shadow-emerald-950">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">
              Atendimento WhatsApp
            </h2>
            {activeTenant && (
              <p className="text-[11px] text-slate-400 mt-0.5">{activeTenant.name}</p>
            )}
          </div>
        </div>

        {/* Achado real em produção: no mobile o pai é flex-col com
            items-start, então esta linha de botões (sem w-full) ficava com
            largura "shrink-to-fit" — cresce pra caber todos os botões numa
            linha só em vez de quebrar, empurrando a PÁGINA INTEIRA pra
            rolar na horizontal (cortava até o cabeçalho/abas). flex-wrap
            sozinho não resolve: só quebra linha quando o container tem uma
            largura limitada pra quebrar contra — w-full dá esse limite. */}
        <div className="flex items-center space-x-2.5 self-end md:self-auto md:w-auto w-full flex-shrink-0 flex-wrap gap-y-2">
          {/* Clear Mock Data Button */}
          <button
            onClick={handleClearMockData}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/60 flex items-center gap-1.5 transition-all cursor-pointer"
            title="Limpar todos os leads/conversas da tela (não apaga nada no servidor — conversas reais voltam no próximo carregamento)"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
            <span>Limpar Testes</span>
          </button>

          {/* Atalho pra Escalonamentos — pedido real do operador: ter acesso
              direto daqui, sem precisar navegar até a barra de abas do topo
              (Header.tsx já tem a aba "Escalonamentos" com o mesmo contador,
              esta é só uma segunda entrada mais rápida). */}
          {onGoToEscalations && (
            <button
              onClick={onGoToEscalations}
              className="px-3 py-1.5 rounded-xl text-xs font-medium bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-800/60 flex items-center gap-1.5 transition-all cursor-pointer"
              title="Ir para a fila de Escalonamentos"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>Escalonamentos</span>
              {escalationsPendingCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-red-500 text-white font-bold">
                  {escalationsPendingCount}
                </span>
              )}
            </button>
          )}

          {/* Toggle Right Panel — só desktop (lg+). No mobile a coluna 3 já
              fica hidden por CSS (ver PR #70) e o painel real é o drawer
              deslizante (mobileAnalysisOpen, ícone ⓘ no cabeçalho da
              conversa) — sem este `hidden lg:flex`, este botão ficava visível
              e clicável no mobile sem produzir NENHUM efeito visual, porque
              alterna showRightPanel (que só controla classes lg:col-span-*),
              confundindo quem tentava abrir a Ficha IA por aqui. */}
          <button
            onClick={() => setShowRightPanel(!showRightPanel)}
            className={`hidden lg:flex px-3 py-1.5 rounded-xl border text-xs font-semibold items-center gap-1.5 transition-all cursor-pointer ${
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
          <div className="flex items-center gap-1">
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
            {googleCalendarConnected && (
              <button
                onClick={handleDisconnectGoogleCalendar}
                title="Desconectar Google Calendar (pra trocar de conta)"
                className="p-1.5 rounded-lg border border-slate-800 bg-slate-950/80 text-slate-400 hover:text-rose-300 hover:border-rose-800/60 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

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

      {/* Confirmação de pagamento (issue #82, item 3) — comprovante chegou,
          precisa de uma pessoa real pra confirmar ou rejeitar antes do
          agente poder informar o turno como fechado pro cliente. */}
      {paymentAppointment?.paymentStatus === 'pending_verification' && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Comprovante de pagamento aguardando verificação: </span>
              <span>
                {paymentAppointment.summary} em {new Date(paymentAppointment.startIso).toLocaleString('pt-BR')}.
              </span>
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => handleVerifyPayment('verified')}
              disabled={isVerifyingPayment}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-[11px] flex items-center gap-1 transition-all cursor-pointer"
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>Confirmar pagamento</span>
            </button>
            <button
              onClick={() => handleVerifyPayment('rejected')}
              disabled={isVerifyingPayment}
              className="px-3 py-1.5 rounded-lg bg-rose-950 hover:bg-rose-900 disabled:opacity-50 text-rose-300 border border-rose-800/60 font-bold text-[11px] flex items-center gap-1 transition-all cursor-pointer"
            >
              <XCircle className="w-3 h-3" />
              <span>Rejeitar</span>
            </button>
          </div>
        </div>
      )}

      {/* Main WhatsApp Web Application Frame — altura fixa em todo breakpoint
          (igual ao WhatsApp Web/Desktop real: a página não cresce, cada
          coluna rola por conta própria). Achado real em produção: a correção
          anterior só trocava qual coluna fica visível no mobile
          (mobileThreadOpen), mas o frame continuava só com min-h — sem altura
          MÁXIMA, a coluna visível cresce livremente com o conteúdo (todos os
          leads ou todas as mensagens) em vez de rolar por dentro, e o campo
          de digitar mensagem (fixo no fim da coluna) acaba empurrado pra
          baixo de tudo, exigindo rolar a página inteira até ele. `dvh` (não
          `vh`) porque no mobile a barra de endereço do navegador
          recolhe/expande — `vh` mediria a altura errada (com a barra
          expandida) e sobraria espaço em branco ou cortaria conteúdo. */}
      <div className="bg-[#111b21] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 h-[85dvh] lg:h-[720px]">
        
        {/* ========================================== */}
        {/* COLUMN 1: WhatsApp Sidebar / Inbox (4 cols or 3 cols depending on right panel) */}
        {/* ========================================== */}
        <div className={`border-r border-slate-800/80 bg-[#111b21] ${mobileThreadOpen ? 'hidden' : 'flex'} lg:flex flex-col min-h-0 ${
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
                Tudo ({leads.length - archivedLeads.length})
              </button>
              <button
                onClick={() => setActiveTabFilter('unread')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all whitespace-nowrap cursor-pointer ${
                  activeTabFilter === 'unread'
                    ? 'bg-[#00a884] text-slate-950 font-bold'
                    : 'bg-[#202c33] text-slate-300 hover:bg-slate-700'
                }`}
              >
                Não lidos ({unreadLeadsCount})
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

              {tenantLabelSuggestions.length > 0 && (
                <select
                  value={labelFilter || ''}
                  onChange={(e) => setLabelFilter(e.target.value || null)}
                  title="Filtrar por etiqueta"
                  className="px-2 py-1 rounded-full text-[11px] font-medium bg-[#202c33] text-slate-300 border border-slate-700 cursor-pointer focus:outline-none flex-shrink-0"
                >
                  <option value="">🏷️ Todas etiquetas</option>
                  {tenantLabelSuggestions.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* WhatsApp Web Chat List */}
          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-800/40 scrollbar-thin">
            {/* Seção "Arquivadas" — colapsável, fixa no topo da lista, igual ao WhatsApp Web real */}
            {archivedLeads.length > 0 && (
              <div className="border-b border-slate-800/40">
                <button
                  onClick={() => setShowArchived((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-slate-300 hover:bg-[#202c33] transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <Archive className="w-3.5 h-3.5 text-slate-400" />
                    Arquivadas · {archivedLeads.length}
                  </span>
                  {showArchived ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {showArchived && (
                  <div className="divide-y divide-slate-800/40">
                    {archivedLeads.map((lead) => renderLeadRow(lead))}
                  </div>
                )}
              </div>
            )}

            {filteredLeads.length > 0 ? (
              filteredLeads.map((lead) => renderLeadRow(lead))
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
        <div className={`${mobileThreadOpen ? 'flex' : 'hidden'} lg:flex flex-col min-h-0 bg-[#0b141a] relative ${
          showRightPanel ? 'lg:col-span-5' : 'lg:col-span-8'
        }`}>
          {selectedLead ? (
            <>
              {/* WhatsApp Web Chat Header */}
              <div className="p-3 bg-[#202c33] border-b border-slate-800 flex items-center justify-between gap-2 z-10 shadow-md">
                {/* min-w-0 é o que deixa esta metade encolher/truncar de
                    verdade — sem isso, um nome de lead comprido (achado ao
                    vivo: nome tipo e-mail sem espaço nenhum pra quebrar,
                    "Sofiamaldonado694966@gmai...") empurrava os botões de
                    ação inteiros pra fora da tela no mobile, igual ao bug de
                    overflow que a linha de botões já teve (agora corrigido
                    do lado deles com flex-shrink-0 abaixo). */}
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  {/* Botão "voltar pra lista" — só no mobile (lg:hidden), onde
                      lista e conversa nunca ficam visíveis ao mesmo tempo. */}
                  <button
                    onClick={() => { setMobileThreadOpen(false); setMobileAnalysisOpen(false); }}
                    className="lg:hidden flex-shrink-0 p-1.5 -ml-1.5 hover:bg-[#2a3942] rounded-lg text-slate-300 transition-colors cursor-pointer"
                    title="Voltar pra lista de conversas"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs border border-emerald-500/50 flex-shrink-0 ${avatarColorClasses(selectedLead.name || selectedLead.phone)}`}
                  >
                    {getInitials(selectedLead.name || selectedLead.phone)}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold text-[#e9edef] flex items-center gap-2">
                      <span className="truncate">{selectedLead.name}</span>
                    </h3>
                    <p className="text-[10px] text-slate-400 flex items-center gap-2">
                      <span className="truncate">{selectedLead.phone}</span>
                      <span className="text-emerald-400 flex-shrink-0">• online</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-1.5 text-slate-300 flex-shrink-0">
                  {/* Achado ao vivo: "Pesquisar na conversa"/"Chamada de áudio"/
                      "Chamada de vídeo" eram 100% decorativos — sem onClick,
                      sem estado nenhum ligado a eles, cursor-pointer só de
                      mentira. Além de fingir funcionar, essa linha inteira
                      (sem wrap/scroll) estourava a largura no mobile e
                      empurrava os dois botões reais mais importantes
                      (Analisar IA, Ficha IA) pra fora da tela, invisíveis.
                      Removidos os 3 — mesmo padrão já aplicado a outras telas
                      decorativas deste painel (ver PRs #74, #86). */}

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

                  {/* Ficha IA — só no mobile, onde a coluna 3 fica hidden (ver PR #70) */}
                  <button
                    onClick={() => setMobileAnalysisOpen(true)}
                    className="lg:hidden p-2 hover:bg-[#2a3942] rounded-lg text-slate-300 transition-colors cursor-pointer"
                    title="Ver Ficha IA"
                  >
                    <Info className="w-4 h-4" />
                  </button>

                  {/* Achado ao vivo: as ações da conversa (bloquear IA pra
                      esse lead, fixar, marcar não lida, silenciar, arquivar)
                      só existiam no menu ⋮ de cada linha na LISTA — abrindo a
                      conversa não dava pra fazer nada disso sem voltar pra
                      lista e achar a linha de novo. Reusa o mesmo
                      openMenuForLeadId (já keyed por id) e as mesmas ações de
                      handleUpdateConversationState do menu da lista — mesmo
                      comportamento, só acessível também de dentro da
                      conversa aberta. */}
                  <div className="relative">
                    <button
                      onClick={() => setOpenMenuForLeadId(openMenuForLeadId === selectedLead.id ? null : selectedLead.id)}
                      className="p-2 hover:bg-[#2a3942] rounded-lg text-slate-300 transition-colors cursor-pointer"
                      title="Mais opções"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {openMenuForLeadId === selectedLead.id && (() => {
                      const isAiBlocked = !!(selectedLead as any).aiBlockedAt;
                      const isPinned = !!(selectedLead as any).pinnedAt;
                      const isManuallyUnread = !!(selectedLead as any).manuallyUnread;
                      const isMuted = !!(selectedLead as any).muted;
                      const isArchived = !!(selectedLead as any).archivedAt;
                      return (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setOpenMenuForLeadId(null)} />
                          <div className="absolute right-0 top-10 z-50 w-52 bg-[#233138] border border-slate-700 rounded-xl shadow-2xl overflow-hidden text-xs origin-top-right animate-pop-in">
                            <button
                              onClick={() => { handleUpdateConversationState(selectedLead.id, { aiBlocked: !isAiBlocked }); setOpenMenuForLeadId(null); }}
                              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-slate-700/60 transition-colors cursor-pointer ${isAiBlocked ? 'text-emerald-300' : 'text-rose-300'}`}
                              title="Lead não qualificado/insistente — a IA para de responder só pra esse número, o resto do atendimento automático continua normal"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              <span>{isAiBlocked ? 'Reativar IA pra esse lead' : 'Bloquear IA pra esse lead'}</span>
                            </button>
                            <button
                              onClick={() => { handleUpdateConversationState(selectedLead.id, { pinned: !isPinned }); setOpenMenuForLeadId(null); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                            >
                              {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                              <span>{isPinned ? 'Desafixar conversa' : 'Fixar conversa'}</span>
                            </button>
                            <button
                              onClick={() => { handleUpdateConversationState(selectedLead.id, { unread: !isManuallyUnread }); setOpenMenuForLeadId(null); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              <span>{isManuallyUnread ? 'Marcar como lida' : 'Marcar como não lida'}</span>
                            </button>
                            <button
                              onClick={() => { handleUpdateConversationState(selectedLead.id, { muted: !isMuted }); setOpenMenuForLeadId(null); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                            >
                              {isMuted ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                              <span>{isMuted ? 'Ativar notificações' : 'Silenciar notificações'}</span>
                            </button>
                            <button
                              onClick={() => { handleUpdateConversationState(selectedLead.id, { archived: !isArchived }); setOpenMenuForLeadId(null); setMobileThreadOpen(false); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                            >
                              {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                              <span>{isArchived ? 'Desarquivar conversa' : 'Arquivar conversa'}</span>
                            </button>
                            <div className="border-t border-slate-700" />
                            <button
                              onClick={() => { handleClearChatMessages(selectedLead.id); setOpenMenuForLeadId(null); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                              title="Apaga as mensagens desta conversa, mantendo o contato"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Limpar histórico de mensagens</span>
                            </button>
                            <button
                              onClick={() => { setOpenMenuForLeadId(null); handleDeleteConversation(selectedLead.id, selectedLead.name); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-rose-300 hover:bg-rose-950/60 transition-colors cursor-pointer"
                              title="Exclui a conversa e o contato permanentemente"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Excluir conversa permanentemente</span>
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Etiquetas livres da conversa (tipo WhatsApp Business) */}
              <div className="px-3 py-2 bg-[#0f191e] border-b border-slate-800/60 flex items-center gap-1.5 flex-wrap relative">
                <Tag className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                {(selectedLead.conversationLabels || []).map((label) => (
                  <span
                    key={label}
                    className={`text-[10px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${labelColorClasses(label)}`}
                  >
                    {label}
                    <button
                      onClick={() => handleRemoveLabel(selectedLead.id, label)}
                      className="hover:opacity-70 cursor-pointer"
                      title="Remover etiqueta"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
                <button
                  onClick={() => { setIsLabelPickerOpen((v) => !v); setNewLabelInput(''); }}
                  className="text-[10px] px-2 py-0.5 rounded-full border border-dashed border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-2.5 h-2.5" />
                  Etiqueta
                </button>

                {isLabelPickerOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsLabelPickerOpen(false)} />
                    <div className="absolute left-3 top-9 z-50 w-72 bg-[#233138] border border-slate-700 rounded-xl shadow-2xl p-3 space-y-2 origin-top-left animate-pop-in">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (newLabelInput.trim()) {
                            handleAddLabel(selectedLead.id, newLabelInput);
                            setNewLabelInput('');
                            setIsLabelPickerOpen(false);
                          }
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          type="text"
                          value={newLabelInput}
                          onChange={(e) => setNewLabelInput(e.target.value)}
                          placeholder="Nova etiqueta..."
                          autoFocus
                          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                        />
                        <button
                          type="submit"
                          className="p-1.5 bg-[#00a884] hover:bg-emerald-500 text-slate-950 rounded-lg cursor-pointer flex-shrink-0"
                          title="Adicionar"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </form>

                      {(() => {
                        const alreadyOn = new Set((selectedLead.conversationLabels || []).map((l) => normalizeLabelText(l)));
                        const suggestions = Array.from(new Set([...tenantLabelSuggestions, ...BEAUTY_STUDIO_LABEL_SUGGESTIONS]))
                          .filter((l) => !alreadyOn.has(normalizeLabelText(l)));
                        if (suggestions.length === 0) return null;
                        return (
                          <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto pt-1 border-t border-slate-700">
                            {suggestions.map((l) => (
                              <button
                                key={l}
                                onClick={() => { handleAddLabel(selectedLead.id, l); setIsLabelPickerOpen(false); }}
                                className={`text-[10px] px-2 py-0.5 rounded-full border cursor-pointer hover:opacity-80 ${labelColorClasses(l)}`}
                              >
                                {l}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </>
                )}
              </div>

              {/* Real-time Analyzing Banner */}
              {isAnalyzingConversation && (
                <div className="bg-emerald-950/90 border-b border-emerald-500/40 px-3 py-1.5 text-center text-[11px] font-semibold text-emerald-300 flex items-center justify-center space-x-2 animate-pulse z-10">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  <span>Gemini analisando contexto da conversa e idioma em tempo real...</span>
                </div>
              )}

              {/* WhatsApp Messages Scroll Body */}
              <div className="flex-1 min-h-0 p-4 overflow-y-auto space-y-3 bg-[#0b141a] bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] scrollbar-thin">
                
                {/* WhatsApp Floating Date Badge */}
                <div className="flex justify-center my-2">
                  <span className="px-3 py-1 rounded-lg bg-[#182229] text-[10px] font-bold text-slate-400 shadow-sm uppercase tracking-wider">
                    Hoje
                  </span>
                </div>

                {selectedLead.messages && selectedLead.messages.length > 0 ? (
                  selectedLead.messages.map((msg) => {
                    const isLead = msg.sender === 'lead';
                    const quotedMessage = msg.replyToMessageId
                      ? selectedLead.messages?.find((m) => m.id === msg.replyToMessageId)
                      : undefined;
                    return (
                      <div
                        key={msg.id}
                        id={`msg-anchor-${msg.id}`}
                        className={`group relative flex flex-col ${isLead ? 'items-start' : 'items-end'}`}
                      >
                        {/* Hover Action Toolbar — Responder, Encaminhar, Reagir, Editar (só agente) */}
                        <div
                          className={`absolute -top-6 ${isLead ? 'left-0' : 'right-0'} hidden group-hover:flex items-center gap-0.5 bg-[#233138] border border-slate-700 rounded-lg px-1 py-0.5 shadow-lg z-10`}
                        >
                          <button
                            type="button"
                            onClick={() => handleReplyToMessage(msg)}
                            className="p-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors cursor-pointer"
                            title="Responder"
                          >
                            <Reply className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setForwardingMessage(msg)}
                            className="p-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors cursor-pointer"
                            title="Encaminhar"
                          >
                            <Forward className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setReactionPickerFor(reactionPickerFor === msg.id ? null : msg.id)}
                            className="p-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors cursor-pointer"
                            title="Reagir"
                          >
                            <Smile className="w-3 h-3" />
                          </button>
                          {!isLead && (
                            <button
                              type="button"
                              onClick={() => handleStartEditMessage(msg)}
                              className="p-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors cursor-pointer"
                              title="Editar"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        {/* Reaction Emoji Picker */}
                        {reactionPickerFor === msg.id && (
                          <div
                            className={`absolute -top-16 ${isLead ? 'left-0' : 'right-0'} flex items-center gap-1 bg-[#233138] border border-slate-700 rounded-full px-2 py-1 shadow-lg z-20`}
                          >
                            {REACTION_EMOJIS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => handleReactToMessage(msg, emoji)}
                                className="text-sm hover:scale-125 transition-transform cursor-pointer"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        )}

                        <div
                          className={`max-w-[85%] rounded-xl p-2.5 shadow-md space-y-1 text-xs relative ${
                            isLead
                              ? 'bg-[#202c33] text-[#e9edef] rounded-tl-none border border-slate-700/50'
                              : msg.sentBy === 'operator'
                                ? 'bg-[#1f4287] text-white rounded-tr-none shadow-blue-950/40'
                                : 'bg-[#005c4b] text-white rounded-tr-none shadow-emerald-950/40'
                          }`}
                        >
                          {/* Distingue resposta automática da IA de mensagem digitada manualmente pelo operador — cor de balão sozinha pode não bastar (daltonismo, print em P&B), então reforça com ícone+texto. Ver issue #126. */}
                          {!isLead && msg.sentBy && (
                            <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide opacity-70">
                              {msg.sentBy === 'ai' ? <Bot className="w-2.5 h-2.5" /> : <UserCheck className="w-2.5 h-2.5" />}
                              {msg.sentBy === 'ai' ? 'IA' : 'Operador'}
                            </div>
                          )}

                          {msg.forwardedFromMessageId && (
                            <div className="flex items-center gap-1 text-[9px] italic opacity-60">
                              <Forward className="w-2.5 h-2.5" /> Encaminhada
                            </div>
                          )}

                          {quotedMessage && (
                            <button
                              type="button"
                              onClick={() => scrollToMessage(quotedMessage.id)}
                              className={`block w-full text-left rounded-lg px-2 py-1 border-l-4 cursor-pointer ${
                                isLead ? 'bg-slate-800/60 border-emerald-500' : 'bg-black/20 border-emerald-300'
                              }`}
                            >
                              <div className="text-[9px] font-bold text-emerald-400">
                                {quotedMessage.sender === 'lead' ? selectedLead.name : 'Você'}
                              </div>
                              <div className="text-[10px] opacity-80 truncate">
                                {quotedMessage.text ||
                                  (quotedMessage.type === 'image' ? '📷 Imagem' : quotedMessage.type === 'audio' ? '🎤 Áudio' : quotedMessage.type === 'file' ? '📎 Arquivo' : '')}
                              </div>
                            </button>
                          )}

                          {msg.reactions && msg.reactions.length > 0 && (
                            <div
                              className={`absolute -bottom-2.5 ${isLead ? 'left-2' : 'right-2'} bg-[#233138] border border-slate-700 rounded-full px-1.5 py-0.5 text-[10px] shadow-md`}
                            >
                              {msg.reactions.map((r) => r.emoji).join(' ')}
                            </div>
                          )}

                          {/* Audio Message Type */}
                          {msg.type === 'audio' && (
                            <div className="space-y-2 min-w-[220px]">
                              <div className="flex items-center space-x-2 bg-slate-950/40 p-2 rounded-lg border border-white/10">
                                <button
                                  onClick={() => ((selectedLead as any)?.isReal ? handlePlayRealAudioMessage(msg.id) : handlePlayAudioMessage(msg.id, msg.text || ''))}
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
                              {/* Achado ao vivo: imagens que O PRÓPRIO operador enviava (upload
                                  pelo painel, POST /send-media) nunca apareciam — RealClientImage
                                  só carregava pra mensagens do lead (msg.sender === 'lead'), então
                                  uma imagem nossa sem mediaUrl caía direto no fallback de texto puro
                                  ("📎 nome-do-arquivo.png"), sem preview nenhum. GET /api/media/:messageId
                                  já serve mídia enviada nos dois sentidos (ver /send-media em
                                  conversations.ts, que salva sob o mesmo messageId da mensagem) — só
                                  faltava carregar pro sender 'agent' também. */}
                              {!msg.mediaUrl && (selectedLead as any)?.isReal && (
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

                          {msg.sendFailed && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-rose-300 bg-rose-950/60 border border-rose-700/60 rounded-lg px-2 py-1 mt-1">
                              <AlertCircle className="w-3 h-3 flex-shrink-0" />
                              <span>Falha no envio — o cliente NÃO recebeu isto.</span>
                            </div>
                          )}

                          <div className={`flex justify-between items-center text-[9px] mt-1 gap-2 border-t border-white/5 pt-1 ${isLead ? 'text-slate-400' : 'text-emerald-200'}`}>
                            <button
                              onClick={() => handleDeleteSingleMessage(selectedLead.id, msg.id)}
                              className="opacity-40 hover:opacity-100 hover:text-rose-400 transition-opacity p-0.5 cursor-pointer"
                              title="Apagar esta mensagem"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                            <div className="flex items-center gap-1">
                              <span>
                                {msg.timestamp}
                                {msg.editedAt && <span className="italic opacity-70"> (editado)</span>}
                              </span>
                              {!isLead && (msg.sendFailed ? (
                                <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                              ) : (
                                <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
                              ))}
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
                <div ref={messagesEndRef} />
                <audio ref={realAudioRef} className="hidden" />
              </div>

              {/* WhatsApp Web Bottom Simulation Control & Input Bar */}
              <div className="p-2.5 bg-[#202c33] border-t border-slate-800 space-y-2">
                
                {/* Sender Role Switcher & Attachments Toolbar */}
                <div className="flex items-center justify-between text-xs px-1">
                  {/* Numa conversa real não existe "enviar como Cliente" — o
                      toggle só faz sentido em conversas de teste/demo, onde
                      dá pra simular os dois lados. Escondido em conversas
                      reais pra não sobrar vestígio de modo demo na tela que
                      a operadora usa todo dia. */}
                  {!(selectedLead as any)?.isReal ? (
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
                  ) : (
                    <div />
                  )}

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
                      title={
                        isRecordingReal
                          ? `Gravando pra ${recordingForLeadName} — clique aqui (em qualquer conversa) pra parar e enviar`
                          : (selectedLead as any)?.isReal ? 'Gravar áudio real' : 'Simular Envio de Áudio'
                      }
                    >
                      <Mic className="w-3 h-3" />
                      <span>{isRecordingReal ? `Gravando p/ ${recordingForLeadName}...` : 'Áudio'}</span>
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

                    {/* Botões de SIMULAÇÃO (lead/agente fake) — escondidos numa conversa
                        real pra não confundir com o clipe de anexo real logo abaixo, que
                        de fato envia pro cliente via Meta Cloud API. */}
                    {!(selectedLead as any)?.isReal && (
                      <>
                        <button
                          type="button"
                          onClick={handleSendSampleImage}
                          className="px-2 py-1 rounded-lg bg-[#111b21] hover:bg-slate-800 border border-slate-800 text-blue-400 text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                          title="Simular Envio de Imagem (conversa de teste)"
                        >
                          <ImageIcon className="w-3 h-3" />
                          <span>Foto</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleSendSampleFile}
                          className="px-2 py-1 rounded-lg bg-[#111b21] hover:bg-slate-800 border border-slate-800 text-purple-400 text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                          title="Simular Envio de PDF (conversa de teste)"
                        >
                          <Paperclip className="w-3 h-3" />
                          <span>PDF</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Reply / Edit Preview Bar — mesma ideia do WhatsApp: mostra o que está sendo respondido/editado acima do campo de texto */}
                {(replyingTo || editingMessageId) && (
                  <div className="flex items-center justify-between bg-[#111b21] border-l-4 border-[#00a884] rounded-lg px-3 py-1.5">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold text-[#00a884]">
                        {editingMessageId ? 'Editando mensagem' : `Respondendo a: ${replyingTo?.sender === 'lead' ? selectedLead.name : 'Você'}`}
                      </div>
                      <div className="text-[11px] text-slate-300 truncate">
                        {editingMessageId
                          ? selectedLead.messages?.find((m) => m.id === editingMessageId)?.text
                          : replyingTo?.text || (replyingTo?.type === 'image' ? '📷 Imagem' : replyingTo?.type === 'audio' ? '🎤 Áudio' : replyingTo?.type === 'file' ? '📎 Arquivo' : '')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={editingMessageId ? handleCancelEdit : () => setReplyingTo(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer flex-shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

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
          // Achado real em produção: essa coluna nunca teve o toggle
          // hidden/flex por mobileThreadOpen que as colunas 1 e 2 têm — no
          // mobile (grid-cols-1) ela sempre empilhava atrás da lista/thread
          // visível, e virou sobreposição visual real depois que o frame
          // ganhou altura fixa (h-[85dvh]). Escondida no mobile — o
          // equivalente lá é o painel deslizante controlado por
          // mobileAnalysisOpen, logo abaixo, aberto pelo ícone (i) no
          // cabeçalho da conversa.
          <div className="hidden lg:flex lg:col-span-4 border-l border-slate-800/80 bg-[#111b21] flex-col p-3 space-y-3 overflow-y-auto max-h-[720px] scrollbar-thin">
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

      {/* Ficha IA no mobile — painel deslizante por cima da conversa (a
          coluna 3 fica hidden abaixo do breakpoint lg). Mesmo componente e
          mesmas props do painel de desktop acima, só a apresentação muda. */}
      {mobileAnalysisOpen && mobileThreadOpen && selectedLead && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end animate-fade-in"
          onClick={() => setMobileAnalysisOpen(false)}
        >
          <div
            className="bg-[#111b21] w-full max-h-[85vh] rounded-t-2xl border-t border-slate-800 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b border-slate-800 flex-shrink-0">
              <h3 className="text-sm font-bold text-white">Ficha IA</h3>
              <button
                onClick={() => setMobileAnalysisOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 space-y-3 overflow-y-auto">
              <ConversationAnalysisPanel
                analysis={selectedLead.fullAnalysis}
                isLoading={isAnalyzingConversation}
                onReanalyze={() => handleAnalyzeConversation(selectedLead)}
                onApplySuggestedReply={handleApplySuggestedReply}
                leadName={selectedLead.name || 'Lead'}
                onSendCAPIEvent={handleDirectCAPI}
              />
            </div>
          </div>
        </div>
      )}

      {/* Forward Message Modal — escolher outro lead da lista pra encaminhar */}
      {forwardingMessage && (
        <div
          className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setForwardingMessage(null)}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 max-w-sm w-full shadow-2xl space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Forward className="w-4 h-4 text-emerald-400" />
                Encaminhar mensagem
              </h3>
              <button onClick={() => setForwardingMessage(null)} className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] text-slate-400 truncate">"{forwardingMessage.text || 'Mídia'}"</p>
            <div className="max-h-64 overflow-y-auto space-y-1 scrollbar-thin">
              {leads.filter((l) => l.id !== selectedLead?.id).length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">Nenhum outro contato disponível.</p>
              )}
              {leads
                .filter((l) => l.id !== selectedLead?.id)
                .map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => handleForwardMessage(l)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-slate-800 text-left transition-colors cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                      {l.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{l.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">{l.phone}</div>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

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
