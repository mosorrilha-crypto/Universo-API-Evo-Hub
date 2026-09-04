import React, { useState, useEffect, useRef } from 'react';
import { LeadInfo, TranscriptionResult, SavedTranscriptItem, ChatMessage, FullConversationAnalysis, AgentKnowledgeBase, Tenant, type ContactAgentContext, type EscalationInfo } from '../types';
import { blobToBase64, createSpeechAudioBlob } from '../utils/audioUtils';
import { apiFetch, getAuthToken, getTenantOverride } from '../lib/apiClient';
import { getExistingPushSubscription, enablePushNotifications, disablePushNotifications } from '../lib/pushNotifications';
import { formatChatDateLabel, isNewChatDateGroup } from '../lib/chatDate';
import { labelColorClasses, avatarColorClasses, getInitials } from '../utils/leadDisplay';
import { ConversationAnalysisPanel, type HintReplyResult, type AskAiResult } from './ConversationAnalysisPanel';
import { ContactContextPanel, type OperatorMemoryEditPayload } from './ContactContextPanel';
import { ForwardMessageModal } from './chat/ForwardMessageModal';
import { ImageLightboxModal } from './chat/ImageLightboxModal';
import { LeadListRow } from './chat/LeadListRow';
import { QuickRepliesMenu } from './chat/QuickRepliesMenu';
import { AddLeadModal } from './leads/AddLeadModal';
import { ManualAppointmentModal } from './leads/ManualAppointmentModal';
import { ManageLabelsModal, type LabelCatalogEntry } from './leads/ManageLabelsModal';
import { StatusModal } from './status/StatusModal';
import { UpcomingEventsPanel, type UpcomingEvent } from './calendar/UpcomingEventsPanel';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import { ContractModal } from './contracts/ContractModal';
import { ReopenConversationModal } from './owner-panel/ReopenConversationModal';
import { ConversationContextSidebar } from './owner-panel/ConversationContextSidebar';
import type { ContactProfileData } from './owner-panel/ownerPanelTypes';
import { useAppPreferences } from '../contexts/AppPreferencesContext';
import {
  Play,
  Sparkles,
  Loader2,
  User,
  Clock,
  Send,
  AlertCircle,
  RefreshCw,
  Lock,
  Image as ImageIcon,
  Calendar as CalendarIcon,
  CalendarPlus,
  FileText,
  Mic,
  Volume2,
  Paperclip,
  CheckCheck,
  Bot,
  IdCard,
  UserCheck,
  Search,
  Smile,
  MoreVertical,
  Filter,
  PanelRightOpen,
  PanelRightClose,
  X,
  CircleDashed,
  Trash2,
  Reply,
  Forward,
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
  ArrowDown,
  Ban,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Phone,
  Settings,
  Video,
  Copy,
  Megaphone,
  MessageCircle
} from 'lucide-react';

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

// Item 3 do checklist visual (issue #100): emoji picker de verdade no
// composer, no lugar do botão de emoji que era só decoração (sem onClick).
// Curadoria curta de emojis de uso comum num atendimento (saudação,
// confirmação, agradecimento) — não é o teclado de emoji completo do
// sistema operacional, mas cobre o uso real de digitação de mensagens.
const COMPOSER_EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😉', '😍', '😘', '🥰', '😎',
  '🤔', '😅', '😢', '😭', '😮', '😴', '🙄', '😬', '🤗', '🥳',
  '👍', '👎', '🙏', '👏', '🙌', '💪', '🤝', '✌️', '👌', '🤞',
  '❤️', '💚', '💛', '💙', '💜', '🖤', '💕', '✨', '🎉', '🔥',
  '💇', '💅', '💄', '✂️', '💇‍♀️', '👄', '👁️', '💆', '🌸', '🌟',
  '✅', '❌', '⏰', '📅', '📍', '💰', '💳', '📷', '📄', '❓',
];

// Botão "Gerar Contrato" (pedido real, 15/08/2026): o modelo de contrato em
// ContractModal.tsx é o texto fixo específico da Clic Piscinas (compra-venda
// de piscina) — não faz sentido nenhum aparecer pra outros tenants (ex: a
// Monique, que vende serviço de estética, não piscina). Decisão explícita
// do dono do produto: só a Clic Piscinas por agora; generalizar pra modelo
// por tenant fica pra quando outro tenant precisar de contrato de verdade.
const CLIC_PISCINAS_TENANT_ID = '45dbb383-522e-400b-9804-0ea65f589d40';

interface WhatsAppLeadsSimProps {
  onSaveTranscript: (item: SavedTranscriptItem) => void;
  knowledgeBase?: AgentKnowledgeBase;
  activeTenant?: Tenant;
  onAddNewLead?: (newLead: any) => void;
  onDeleteLead?: (leadId: string) => void;
  /** Contador de escalonamentos pendentes (não resolvidos) do tenant — pro atalho na caixa de ferramentas do operador, mesmo dado que já alimenta o badge da aba "Escalonamentos" no Header. */
  escalationsPendingCount?: number;
  /** TASK-0187 (pedido direto, 01/09/2026): lista completa (não só o
      contador) — usada pra achar e manter visível dentro da própria
      conversa aberta um escalonamento real ainda não resolvido do lead
      atual (revisor pré-envio bloqueou uma resposta, IA escalou pra
      humano, etc.). O sinal que já existia (aiReplyStatusByPhone via SSE)
      é transitório — some sozinho depois de 9s mesmo que ninguém tenha
      visto, achado real relatado: "às vezes o revisor trava a conversa e eu
      não consigo perceber". Este é persistente até o escalonamento ser
      resolvido de verdade. */
  escalations?: EscalationInfo[];
  /** Troca a aba ativa do app pra "Escalonamentos" — pedido real do operador: ter um atalho aqui, sem precisar navegar pela barra de abas do topo. */
  onGoToEscalations?: () => void;
  /** Telefone de um lead pra abrir a conversa dele automaticamente — usado pelo botão "Voltar pra conversa" no card de Escalonamento (App.tsx troca a aba pra "whatsapp" e passa o telefone aqui). */
  openLeadPhone?: string;
  /** Muda a cada clique em "Voltar pra conversa", mesmo pro mesmo telefone — garante que clicar de novo no mesmo lead depois de já ter navegado manualmente reabra a conversa mesmo assim. */
  openLeadRequestId?: number;
  /** Avisa App.tsx sempre que mobileThreadOpen mudar — usado pra esconder o
   * cabeçalho global (Header.tsx: marca "Universo", seletor de idioma/tema)
   * e o cabeçalho fino do Atendimento enquanto uma conversa está aberta no
   * mobile (pedido direto, 29/08/2026, com print comparando ao app real do
   * WhatsApp: "esse menu e cabeçalho não precisa em cima"). No desktop as
   * três colunas ficam sempre visíveis, então isso não afeta nada lá. */
  onThreadOpenChange?: (open: boolean) => void;
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
    <div onClick={() => onOpen(url)} className="relative group rounded-lg overflow-hidden cursor-pointer">
      <img src={url} alt="Imagem enviada pelo lead" className="w-full h-36 object-cover group-hover:scale-105 transition-transform duration-300" />
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
        <ImageIcon className="w-4 h-4 mr-1" /> Ampliar
      </div>
    </div>
  );
};

// Achado real em produção (15/08/2026, Clic Piscinas): o vídeo (primeiro
// contato, ou exemplo de produto) abria normalmente no WhatsApp real do
// lead, mas o painel nunca tocava nada — só um card estático "Vídeo
// enviado" (ver bloco `msg.type === 'file'` abaixo). Toca o vídeo de
// verdade agora, buscando o binário salvo sob o mesmo id da mensagem
// (GET /api/media/:messageId, mesmo mecanismo de RealClientImage acima).
// Mensagens antigas (enviadas antes desta correção) nunca tiveram o
// binário salvo — cai no aviso "Vídeo indisponível" em vez de travar
// carregando pra sempre.
const RealClientVideo: React.FC<{ messageId: string }> = ({ messageId }) => {
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
    return <div className="w-full h-36 bg-slate-800 rounded-lg flex items-center justify-center text-slate-500 text-[10px]">Vídeo indisponível (mensagem antiga, salva antes do preview existir)</div>;
  }
  if (!url) {
    return <div className="w-full h-36 bg-slate-800 rounded-lg animate-pulse flex items-center justify-center text-slate-500 text-[10px]">Carregando vídeo...</div>;
  }
  return <video src={url} controls preload="metadata" className="w-full max-h-64 rounded-lg bg-black" />;
};

export const WhatsAppLeadsSim: React.FC<WhatsAppLeadsSimProps> = ({
  onSaveTranscript,
  knowledgeBase,
  activeTenant,
  onThreadOpenChange,
  onAddNewLead,
  onDeleteLead,
  escalationsPendingCount = 0,
  escalations = [],
  onGoToEscalations,
  openLeadPhone,
  openLeadRequestId,
}) => {
  const { t, language } = useAppPreferences();
  const isSpanish = language === 'es';
  // Bug real em produção (12/08/2026): sem cache local (navegador novo, aba
  // anônima, ou depois de limpar dados do site), essa lista caía pro
  // conjunto inteiro de leads fictícios de demonstração — e como os leads
  // reais (buscados em App.tsx e sincronizados de volta nesta mesma chave)
  // só são ADICIONADOS, nunca removidos, os fictícios ficavam misturados
  // com clientes reais pra sempre. Começa vazia agora.
  // Bug real relatado (18/08/2026): esta lista usava a MESMA chave global
  // 'saas_crm_leads' que App.tsx usa pra um formato de dado diferente (CRM),
  // e nenhuma delas era separada por tenant — trocar de empresa no seletor
  // (saas_admin) e atualizar a página podia mostrar, por um instante,
  // contatos reais de OUTRO tenant (chave própria + por tenant corrige).
  // Achado real de auditoria (CodeQL, "Clear text storage of sensitive
  // information"): esse cache guardava nome, telefone e o histórico
  // completo de mensagens de clientes reais em localStorage sem nenhuma
  // criptografia. Servia só pra pintura instantânea (nenhum caminho de
  // fallback real depende dele — ver fetchRealConversations), então a
  // correção foi parar de gravar/ler em vez de tentar reduzir campos (o
  // sink continuaria existindo) ou cifrar no cliente (a chave ficaria no
  // próprio JS, não protege de verdade). Lista começa vazia e é populada
  // pelo fetch real (/api/conversations) a cada carregamento/troca de tenant.
  const [leads, setLeads] = useState<(LeadInfo & { textContent: string; messages: ChatMessage[]; result?: TranscriptionResult; fullAnalysis?: FullConversationAnalysis; historyLoaded?: boolean; historyLoading?: boolean; lastMessageId?: string })[]>([]);
  // Purga ativa, uma vez por montagem: navegadores que já usaram o painel
  // antes desta correção podem ter PII de cliente em texto puro gravada de
  // uma sessão anterior — sem isso, ela ficaria lá indefinidamente, já que
  // parar de escrever não apaga o que já foi escrito. Varre todos os
  // tenants (não só o ativo), não só o do logout (clearCachedTenantScopedData
  // em App.tsx continua existindo, mas só roda no logout).
  useEffect(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('saas_whatsapp_leads_')) localStorage.removeItem(key);
    }
  }, []);
  type PanelLead = (typeof leads)[number];
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  // No mobile (abaixo do breakpoint lg), lista e conversa não cabem lado a
  // lado como no desktop — achado real do Lucas: com a lista cheia, o
  // operador tinha que rolar por dezenas de conversas até chegar na caixa de
  // mensagem, porque as duas colunas sempre ficavam empilhadas e montadas ao
  // mesmo tempo (grid-cols-1). Alterna via classe CSS (não desmonta nenhuma
  // coluna) qual das duas aparece no mobile, igual ao WhatsApp mobile real;
  // no desktop (lg:flex fixo) as duas colunas continuam sempre visíveis.
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  useEffect(() => {
    onThreadOpenChange?.(mobileThreadOpen);
  }, [mobileThreadOpen, onThreadOpenChange]);
  // Achado real em produção: a coluna 3 (Ficha IA) ficou hidden no mobile
  // (PR #70, evitava sobrepor a lista) mas o botão "Ver Ficha IA" continuou
  // visível e clicável lá, sem fazer nada — parecia quebrado. Este estado é
  // só do mobile: abre a mesma análise como um painel deslizante por cima
  // da conversa, sem mexer no showRightPanel (que continua controlando só a
  // coluna fixa do desktop).
  const [mobileAnalysisOpen, setMobileAnalysisOpen] = useState(false);
  // Contexto operacional redigido: leitura exclusiva, tenant-scoped e sem
  // poder de ação. O painel nunca usa memória para confirmar agenda/pagamento.
  const [contactContext, setContactContext] = useState<ContactAgentContext | null>(null);
  const [contactContextPhone, setContactContextPhone] = useState<string | null>(null);
  const [contactContextTenantId, setContactContextTenantId] = useState<string | null>(null);
  const [isContactContextLoading, setIsContactContextLoading] = useState(false);
  // TASK-0187 (pedido direto, 01/09/2026): "x pra fechar o contexto da
  // conversa quando ele aparece". Guarda uma assinatura (telefone + horário
  // da última atualização) em vez de só um booleano — fechar não vira um
  // opt-out permanente: assim que a IA gerar uma memória/decisão NOVA pra
  // esse lead (assinatura muda), a faixa volta a aparecer sozinha.
  const [dismissedContextSignature, setDismissedContextSignature] = useState<string | null>(null);
  const contactContextRequestRef = useRef(0);
  const [processingLeadId, setProcessingLeadId] = useState<string | null>(null);
  const [isAnalyzingConversation, setIsAnalyzingConversation] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Achado real em produção: o aviso de erro ficava preso na tela pra sempre —
  // "Tentar Novamente" sempre reanalisava a conversa com IA, mesmo quando o
  // que falhou foi outra coisa (ex: arquivar/fixar/silenciar conversa), e não
  // havia nenhum jeito de simplesmente dispensar o aviso. Guarda a ação que
  // realmente falhou pra retentar a coisa certa; undefined = sem retry
  // específico (cai no fallback de reanalisar), null = falha já resolvida
  // (não mostra botão de retry, só dispensar).
  const [errorRetryAction, setErrorRetryAction] = useState<(() => void) | null | undefined>(undefined);

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
  const [activeTabFilter, setActiveTabFilter] = useState<'all' | 'unread' | 'window_closed'>('all');
  // Painel lateral de contexto do contato (Referência 1: 3 colunas ativas no desktop)
  const [showRightPanel, setShowRightPanel] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1200 : false));
  const [rightPanelTab, setRightPanelTab] = useState<'profile' | 'analysis'>('profile');
  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  // Se o tenant ativo tem WABA (WhatsApp Business Account) configurado —
  // usado pra bloquear "Reabrir a conversa" já na página, antes de abrir o
  // modal, quando não há como enviar nenhum modelo de verdade (achado real
  // de auditoria: o botão continuava sempre clicável mesmo sem WABA, e o
  // aviso só aparecia depois de abrir o modal). Cacheado por tenant: a
  // disponibilidade de WABA depende da conta do tenant, não da conversa.
  const [reopenAvailability, setReopenAvailability] = useState<{ tenantId: string; wabaConfigured: boolean } | null>(null);

  // Item 2 do checklist visual (issue #100): flash breve na linha da lista
  // quando chega mensagem nova do cliente — mesmo em conversa que não está
  // aberta no momento, pra chamar atenção do operador na visão periférica.
  // Guarda os ids em flash; cada um se remove sozinho via setTimeout depois
  // de ~1.4s (duração da animação `animate-flash-new-message` no CSS).
  const [flashLeadIds, setFlashLeadIds] = useState<Set<string>>(new Set());

  // Etiquetas livres por conversa (tipo WhatsApp Business) — ver
  // server/services/conversationLabelStore.ts.
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [tenantLabelSuggestions, setTenantLabelSuggestions] = useState<string[]>([]);
  // TASK-0190 — achado real (01/09/2026): BEAUTY_STUDIO_LABEL_SUGGESTIONS é
  // texto fixo no código (não vem do catálogo do tenant), então excluir uma
  // dessas sugestões pelo X só apagava (sem efeito nenhum, já que nunca
  // existia linha correspondente em conversation_labels) e a sugestão
  // reaparecia imediatamente no próximo render — "as etiquetas não apagam no
  // x". Guardado por navegador+tenant (não é dado real de negócio, só
  // preferência de UI) pra filtrar essas sugestões já dispensadas.
  const dismissedDefaultSuggestionsKey = (tenantId: string) => `saas_dismissed_label_suggestions_${tenantId}`;
  const [dismissedDefaultSuggestions, setDismissedDefaultSuggestions] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(dismissedDefaultSuggestionsKey(activeTenant.id));
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [isLabelPickerOpen, setIsLabelPickerOpen] = useState(false);
  const [newLabelInput, setNewLabelInput] = useState('');
  // Tela "{isSpanish ? 'Gestionar etiquetas' : 'Gerenciar etiquetas'}" (pedido real, 20/08/2026) — renomear/apagar
  // uma etiqueta em todas as conversas do tenant de uma vez (ver
  // ManageLabelsModal e as rotas PATCH/DELETE /api/conversation-labels/:label).
  const [isLabelManagerOpen, setIsLabelManagerOpen] = useState(false);
  const [labelCatalog, setLabelCatalog] = useState<LabelCatalogEntry[]>([]);
  const [isLoadingLabelCatalog, setIsLoadingLabelCatalog] = useState(false);

  // Organização de conversas — arquivar, fixar, silenciar, não lida manual.
  // Metadados só do painel (ver server/services/conversationStore.ts).
  const [showArchived, setShowArchived] = useState(false);
  const [openMenuForLeadId, setOpenMenuForLeadId] = useState<string | null>(null);
  // Achado real em produção ("botão de excluir quebrado, conectado com o
  // outro botão de excluir"): o menu ⋮ do cabeçalho da conversa aberta
  // reusava openMenuForLeadId (mesmo estado do menu ⋮ de cada linha da
  // lista). Quando a conversa aberta também aparece na lista (caso comum),
  // os dois menus checavam a mesma condição pro mesmo id — abrir um abria o
  // outro junto, entrelaçando os dois "Excluir". Estado próprio pro menu do
  // cabeçalho resolve — só existe uma conversa aberta por vez, então um
  // boolean simples basta, sem precisar de key por id.
  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);

  // Feedback supervisionado — o operador pode registrar uma melhoria ou bug
  // ligado à conversa aberta. A decisão de publicar qualquer mudança continua
  // restrita ao admin na Central de Qualidade.
  const [operatorFeedbackKind, setOperatorFeedbackKind] = useState<'bug' | 'operator_idea' | null>(null);
  const [operatorFeedbackTitle, setOperatorFeedbackTitle] = useState('');
  const [operatorFeedbackDescription, setOperatorFeedbackDescription] = useState('');
  const [isSubmittingOperatorFeedback, setIsSubmittingOperatorFeedback] = useState(false);

  // Message Sending State
  const [inputMessage, setInputMessage] = useState('');
  // Item 3 do checklist visual (issue #100): o botão de emoji do composer
  // era só decorativo (sem onClick) — clicável na aparência mas fake,
  // violando a própria regra do checklist ("nunca deixar um ícone parecer
  // clicável sem função real por trás"). Agora abre um seletor de verdade.
  const [showComposerEmojiPicker, setShowComposerEmojiPicker] = useState(false);
  // TASK-0184: anexo (arquivo real + foto/vídeo de exemplo) unificados num
  // só menu por trás do clipe, em vez de 1-2 <select> soltos disputando
  // espaço na linha de composição com o clipe de verdade (pedido direto do
  // dono do produto, comparação lado a lado com o WhatsApp Business real).
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [senderRole, setSenderRole] = useState<'lead' | 'agent'>('lead');

  // TASK-0259 (pedido direto): aviso de assunção de controle vira banner
  // discreto na primeira vez que o operador toca no campo de digitação,
  // em vez de ícone/parágrafo permanentes. Flag em localStorage garante
  // que só apareça uma vez por navegador.
  const [showComposerHint, setShowComposerHint] = useState(false);
  const handleComposerFirstFocus = () => {
    try {
      if (localStorage.getItem('saas_composer_takeover_hint_seen')) return;
      localStorage.setItem('saas_composer_takeover_hint_seen', '1');
    } catch {
      // localStorage indisponível (modo privado etc.) — mostra mesmo assim,
      // só não persiste a preferência de "já vi".
    }
    setShowComposerHint(true);
    window.setTimeout(() => setShowComposerHint(false), 6000);
  };

  // TASK-0184: caixa de texto dinâmica igual ao WhatsApp real — cresce com
  // o texto (até um teto) em vez do <input> de altura fixa que só rolava o
  // texto por dentro, dando a falsa impressão de pouco espaço pra digitar.
  useEffect(() => {
    const el = composerTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [inputMessage]);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [retryingTranscriptionId, setRetryingTranscriptionId] = useState<string | null>(null);
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

  // Ações de mensagem — responder (quote, chega no WhatsApp real quando a
  // mensagem citada tem id de provedor — ver getMessageForReply no
  // backend), encaminhar, reagir. "Editar" foi removido (18/08/2026,
  // pedido direto): só alterava nosso registro interno, nunca o que o
  // cliente já tinha recebido de verdade — só confundia o operador.
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  /** Achado real (pedido direto, com print do WhatsApp de referência): a barra de ícones sempre visível no hover (Responder/Encaminhar/Reagir) mais o botão de apagar solto no rodapé do balão eram poluição visual — o WhatsApp de verdade usa um único gatilho "⋮" que abre um menu discreto, igual ao menu ⋮ do cabeçalho da conversa (ver isHeaderMenuOpen) já usado neste mesmo arquivo. Substituído por esse único estado. */
  const [openMessageMenuFor, setOpenMessageMenuFor] = useState<string | null>(null);

  const scrollToMessage = (messageId: string) => {
    document.getElementById(`msg-anchor-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Status do agente automático real (active/paused/restricted) — controla
  // se o backend responde sozinho às mensagens recebidas (ver Epic 1.3).
  //
  // Achado real em produção (15/08/2026): começava em 'active' e, se o GET
  // inicial falhasse (rede, token expirado etc.), o catch engolia o erro em
  // silêncio e o pill "Ativo" continuava destacado pra sempre — o operador
  // via "Ativo" enquanto o backend de verdade podia estar "Restrito"/
  // "Pausado", sem nenhum sinal de que a tela não confirmou o valor real.
  // Começa null (estado "ainda não sei") em vez de assumir 'active' — só
  // acende um dos três pills depois que o GET realmente confirma o valor.
  const [agentStatus, setAgentStatusState] = useState<'active' | 'paused' | 'restricted' | null>(null);
  const [agentStatusLoadFailed, setAgentStatusLoadFailed] = useState(false);
  // Pedido real (20/08/2026): o "digitando..." só aparecia pro lead
  // (WhatsApp), sem nenhum sinal no próprio painel de que a IA está
  // processando a última mensagem — o operador ficava sem saber se ia
  // chegar resposta em instantes ou se precisava assumir. Vem pelo mesmo SSE
  // de conversas (aiReplyStatus no payload, ver emitAiReplyStatus em
  // conversationEvents.ts). Chave = telefone; o aviso é transitório porque a
  // linha do tempo persistida e os Escalonamentos são a fonte de verdade.
  const [aiReplyStatusByPhone, setAiReplyStatusByPhone] = useState<Record<string, 'generating' | 'awaiting_human' | 'delivery_failed'>>({});

  // Modo "somente anúncios" (pedido real, 14/08/2026): quando ativo, o
  // agente só responde automaticamente contatos com atribuição de anúncio
  // real (ctwa_clid) — nunca contatos pessoais. Útil quando o dono do
  // negócio conecta o número pessoal dele além do número dedicado do
  // agente, pra não perder mensagem enquanto valida confiança no agente.
  const [adsOnly, setAdsOnlyState] = useState(false);
  // Gatilhos de texto pro modo "somente anúncios" (achado real, 15/08/2026):
  // o ctwa_clid quase nunca vem preenchido no tráfego real — o tenant
  // cadastra o texto exato do "ice breaker" que a Meta oferece no botão do
  // anúncio (ex: "Me gustaría reservar un horario para el combo de cejas y
  // labios 💕") pra identificar esses leads mesmo sem ctwa_clid (ver
  // matchesAdTriggerMessage no backend).
  const [adTriggerMessages, setAdTriggerMessagesState] = useState<string[]>([]);

  const loadAgentStatus = () => {
    apiFetch('/api/agent-status')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        setAgentStatusState(data?.status || 'active');
        if (typeof data?.adsOnly === 'boolean') setAdsOnlyState(data.adsOnly);
        if (Array.isArray(data?.adTriggerMessages)) setAdTriggerMessagesState(data.adTriggerMessages);
        setAgentStatusLoadFailed(false);
      })
      .catch((err) => {
        console.error('Falha ao carregar o status real do agente:', err);
        setAgentStatusLoadFailed(true);
      });
  };

  useEffect(() => {
    loadAgentStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Respostas rápidas configuráveis — lista compartilhada pela equipe.
  const [quickReplies, setQuickRepliesState] = useState<string[]>([]);
  const [quickRepliesSaving, setQuickRepliesSaving] = useState(false);

  useEffect(() => {
    apiFetch('/api/quick-replies')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (Array.isArray(data?.quickReplies)) setQuickRepliesState(data.quickReplies); })
      .catch(() => {});
  }, []);

  const persistQuickReplies = async (updated: string[]) => {
    const previous = quickReplies;
    setQuickRepliesState(updated);
    setQuickRepliesSaving(true);
    try {
      const response = await apiFetch('/api/quick-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quickReplies: updated }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Não foi possível salvar as respostas rápidas.');
      }
    } catch (error) {
      setQuickRepliesState(previous);
      throw error;
    } finally {
      setQuickRepliesSaving(false);
    }
  };

  const handleCreateQuickReply = async (text: string) => {
    const normalized = text.trim();
    if (quickReplies.some((reply) => reply.trim() === normalized)) {
      throw new Error('Essa resposta rápida já está cadastrada.');
    }
    await persistQuickReplies([...quickReplies, normalized]);
  };

  const handleUpdateQuickReply = async (index: number, text: string) => {
    const normalized = text.trim();
    if (quickReplies.some((reply, replyIndex) => replyIndex !== index && reply.trim() === normalized)) {
      throw new Error('Essa resposta rápida já está cadastrada.');
    }
    await persistQuickReplies(quickReplies.map((reply, replyIndex) => replyIndex === index ? normalized : reply));
  };

  const handleDeleteQuickReply = async (index: number) => {
    await persistQuickReplies(quickReplies.filter((_, replyIndex) => replyIndex !== index));
  };

  // Postar Status/Stories da empresa (pedido real do dono do produto,
  // 12/08/2026: fotos de antes/depois de procedimento já aquecem lead
  // comprovadamente). Só existe pra tenants conectados via Evolution API
  // (QR Code) — a Meta Cloud API oficial (canal da Monique hoje) não tem
  // Status nenhum, então o ícone fica desabilitado com tooltip explicando
  // isso em vez de "Em breve" quando não disponível.
  const [statusAvailable, setStatusAvailable] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [statusBackgroundColor, setStatusBackgroundColor] = useState('#25D366');
  const [statusImageBase64, setStatusImageBase64] = useState<string | null>(null);
  const [statusImageFileName, setStatusImageFileName] = useState('');
  const [statusVideoBase64, setStatusVideoBase64] = useState<string | null>(null);
  const [statusVideoFileName, setStatusVideoFileName] = useState('');
  const [statusCaption, setStatusCaption] = useState('');
  const [isPostingStatus, setIsPostingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusSuccess, setStatusSuccess] = useState(false);

  useEffect(() => {
    apiFetch('/api/status/available')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setStatusAvailable(!!data?.available))
      .catch(() => {});
  }, []);

  const handleStatusImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStatusImageBase64(await blobToBase64(file));
    setStatusImageFileName(file.name);
    setStatusVideoBase64(null);
    setStatusVideoFileName('');
  };

  const handleStatusVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setStatusVideoBase64(await blobToBase64(file));
    setStatusVideoFileName(file.name);
    setStatusImageBase64(null);
    setStatusImageFileName('');
  };

  const handlePostStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusText.trim() && !statusImageBase64 && !statusVideoBase64) return;
    setIsPostingStatus(true);
    setStatusError(null);
    try {
      const res = await apiFetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          statusVideoBase64
            ? { videoBase64: statusVideoBase64, caption: statusCaption.trim() || undefined }
            : statusImageBase64
              ? { imageBase64: statusImageBase64, caption: statusCaption.trim() || undefined }
              : { text: statusText.trim(), backgroundColor: statusBackgroundColor }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setIsStatusModalOpen(false);
      setStatusText('');
      setStatusImageBase64(null);
      setStatusImageFileName('');
      setStatusVideoBase64(null);
      setStatusVideoFileName('');
      setStatusCaption('');
      setStatusSuccess(true);
      setTimeout(() => setStatusSuccess(false), 4000);
    } catch (err: any) {
      setStatusError(err.message || 'Não foi possível postar o Status agora.');
    } finally {
      setIsPostingStatus(false);
    }
  };

  // Conexão do backend com o Google Calendar real (usada pelo agente de
  // agendamento pra consultar disponibilidade e criar/reagendar/cancelar
  // consultas).
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState<boolean | null>(null);
  // TASK-0185 — link da planilha de backup no Google Sheets, exibido no
  // painel de Agenda junto do botão de desconectar (só existe depois da
  // primeira sincronização de um lead deste tenant).
  const [backupSheetUrl, setBackupSheetUrl] = useState<string | undefined>(undefined);

  const fetchGoogleCalendarStatus = () => {
    apiFetch('/api/google-calendar/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { setGoogleCalendarConnected(!!data?.connected); setBackupSheetUrl(data?.backupSheetUrl); })
      .catch(() => setGoogleCalendarConnected(false));
  };

  useEffect(() => { fetchGoogleCalendarStatus(); }, []);

  // Push notification do PWA do atendente (issue #159) — segundo canal de
  // alerta pro operador (escalação nova, agente pausado com lead sem
  // resposta), além do WhatsApp template já existente. `null` = ainda
  // verificando se já existe assinatura salva no navegador; `false` cobre
  // tanto "nunca ativou" quanto "navegador não suporta" (a mensagem de erro
  // específica só aparece se o operador tentar ativar).
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    getExistingPushSubscription()
      .then((sub) => setPushEnabled(!!sub))
      .catch(() => setPushEnabled(false));
  }, []);

  const handleTogglePush = async () => {
    // Achado real em produção: o aviso de erro (setErrorMsg) nunca se
    // limpava sozinho — se uma tentativa falhasse, o banner laranja ficava
    // preso na tela pra sempre, mesmo numa tentativa seguinte bem-sucedida,
    // fazendo parecer que continuava falhando quando na verdade já tinha
    // ativado. Limpa aqui no início de cada tentativa nova.
    setErrorMsg(null);
    setPushBusy(true);
    try {
      if (pushEnabled) {
        await disablePushNotifications();
        setPushEnabled(false);
      } else {
        const result = await enablePushNotifications();
        if (result.success) {
          setPushEnabled(true);
        } else {
          setErrorMsg(result.error || 'Não foi possível ativar notificações agora.');
        }
      }
    } finally {
      setPushBusy(false);
    }
  };

  const handleConnectGoogleCalendar = async () => {
    try {
      const res = await apiFetch('/api/google-calendar/connect');
      const data = await res.json();
      if (data.url) window.open(data.url, '_blank', 'width=520,height=650');
    } catch (err) {
      console.error('Falha ao iniciar conexão com Google Calendar:', err);
    }
  };

  // Widget de agenda (atendente pedia pra ver o que a IA já marcou sem sair
  // da plataforma) — busca só quando o painel é aberto, não em polling
  // constante (é um "olhar por baixo demanda", não um dado que muda a cada
  // segundo).
  const [isUpcomingEventsPanelOpen, setIsUpcomingEventsPanelOpen] = useState(false);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [isLoadingUpcomingEvents, setIsLoadingUpcomingEvents] = useState(false);
  const [upcomingEventsError, setUpcomingEventsError] = useState<string | null>(null);
  // Mês em exibição na Agenda (pedido real, 15/08/2026: só mostrar "os
  // próximos dias a partir de agora" fazia a agenda parecer desatualizada —
  // sem jeito de olhar um mês específico, nem o corrente inteiro). `month` é
  // 1-12, igual o parâmetro que a rota espera.
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const calendarMonthLabel = new Date(calendarMonth.year, calendarMonth.month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const fetchUpcomingEvents = (month: { year: number; month: number } = calendarMonth) => {
    setIsLoadingUpcomingEvents(true);
    setUpcomingEventsError(null);
    apiFetch(`/api/google-calendar/upcoming-events?year=${month.year}&month=${month.month}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setUpcomingEvents(data.events || []))
      .catch((err) => setUpcomingEventsError(err.message || 'Não foi possível carregar a agenda agora.'))
      .finally(() => setIsLoadingUpcomingEvents(false));
  };

  const handleOpenUpcomingEvents = () => {
    setIsUpcomingEventsPanelOpen(true);
    fetchUpcomingEvents();
  };

  const changeCalendarMonth = (delta: number) => {
    setCalendarMonth((prev) => {
      const base = new Date(prev.year, prev.month - 1 + delta, 1);
      const next = { year: base.getFullYear(), month: base.getMonth() + 1 };
      fetchUpcomingEvents(next);
      return next;
    });
  };

  const handleToggleEventCompleted = async (eventId: string, completed: boolean) => {
    setUpcomingEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, completed } : e)));
    try {
      const res = await apiFetch(`/api/google-calendar/events/${encodeURIComponent(eventId)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Falha ao atualizar conclusão do atendimento:', err);
      setUpcomingEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, completed: !completed } : e)));
      setUpcomingEventsError('Não foi possível salvar isso no servidor agora — tente de novo.');
    }
  };

  /**
   * Corrige o título (serviço) de um evento já criado — pedido real
   * (19/08/2026): não existia nenhum jeito de editar isso depois de
   * criado. Atualiza o evento real no Google Calendar (via backend) e,
   * se der erro, propaga pro EditableSummary decidir o que mostrar (fica
   * em modo de edição, o operador tenta de novo).
   */
  const handleEditEventSummary = async (eventId: string, newSummary: string) => {
    try {
      const res = await apiFetch(`/api/google-calendar/events/${encodeURIComponent(eventId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: newSummary }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setUpcomingEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, summary: newSummary } : e)));
    } catch (err: any) {
      console.error('Falha ao editar o título do evento:', err);
      setUpcomingEventsError(err.message || 'Não foi possível corrigir o evento agora — tente de novo.');
      throw err;
    }
  };

  /**
   * Remarcar/excluir a partir do widget de agenda — pedido real (20/08/2026):
   * "hoje não consigo remarcar horário, editar ou excluir agendamento" pelo
   * painel. Ambos propagam o erro pro EventRowControls decidir o que mostrar
   * (mesmo padrão de handleEditEventSummary acima) — ex: 409 quando o novo
   * horário já está ocupado.
   */
  const handleRescheduleEvent = async (eventId: string, newStartIso: string, newEndIso: string) => {
    try {
      const res = await apiFetch(`/api/google-calendar/events/${encodeURIComponent(eventId)}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newStartIso, newEndIso }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setUpcomingEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, startIso: newStartIso, endIso: newEndIso } : e)));
    } catch (err: any) {
      console.error('Falha ao remarcar o evento:', err);
      throw err;
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    try {
      const res = await apiFetch(`/api/google-calendar/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setUpcomingEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch (err: any) {
      console.error('Falha ao cancelar o evento:', err);
      setUpcomingEventsError(err.message || 'Não foi possível cancelar o agendamento agora — tente de novo.');
    }
  };

  /**
   * Registra um pagamento direto do card do agendamento na Agenda (pedido
   * real, 20/08/2026) — cria a transação financeira ligada ao evento no
   * backend e já atualiza o badge local, sem precisar sair pro Financeiro.
   */
  const handleRegisterEventPayment = async (eventId: string, amount: number, paymentMethod: string, status: string) => {
    const res = await apiFetch(`/api/google-calendar/events/${encodeURIComponent(eventId)}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, paymentMethod, status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setUpcomingEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, payment: { amount: data.transaction.amount, paymentMethod: data.transaction.paymentMethod, status: data.transaction.status } } : e))
    );
  };

  /** Edita um pagamento já lançado (etapa 2 do mesmo pedido, 20/08/2026) — mesmo card, agora com PATCH em vez de POST. */
  const handleEditEventPayment = async (eventId: string, amount: number, paymentMethod: string, status: string) => {
    const res = await apiFetch(`/api/google-calendar/events/${encodeURIComponent(eventId)}/payment`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, paymentMethod, status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setUpcomingEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, payment: { amount: data.transaction.amount, paymentMethod: data.transaction.paymentMethod, status: data.transaction.status } } : e))
    );
  };

  // Escolher um lead a partir do widget de agenda (sem conversa aberta
  // ainda) reaproveita 100% o fluxo já existente de agendamento manual —
  // só seleciona a conversa e abre o mesmo modal que já é aberto de dentro
  // dela.
  const handlePickLeadForNewAppointment = (lead: LeadInfo, prefillDateKey?: string) => {
    setIsUpcomingEventsPanelOpen(false);
    handleSelectLead(lead);
    if (prefillDateKey) setManualDate(prefillDateKey);
    setIsManualAppointmentModalOpen(true);
  };

  // Contato que veio de outra fonte (indicação, telefone, presencial) e
  // ainda não tem conversa/lead nenhum registrado aqui — achado real de uso
  // do widget de agenda: nem todo agendamento manual é de alguém que já
  // mandou mensagem no WhatsApp. Cria um lead local mínimo (mesmo padrão de
  // "+ Novo Lead", que também injeta na lista sem depender do backend) só
  // pra dar um `phone` real pro fluxo de agendamento manual já existente —
  // o backend (POST .../manual-appointment) não exige que o telefone já
  // tenha conversa ou estado de CRM.
  const handleCreateAdHocContactForAppointment = (name: string, phone: string, prefillDateKey?: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone) return;
    const adHocLead: LeadInfo = {
      id: `manual-${cleanPhone}-${Date.now()}`,
      name: name.trim() || cleanPhone,
      phone: cleanPhone,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      status: 'transcribed',
    };
    setLeads((prev) => [adHocLead, ...prev]);
    handlePickLeadForNewAppointment(adHocLead, prefillDateKey);
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

  const handleToggleAdsOnly = async () => {
    const previous = adsOnly;
    const next = !adsOnly;
    setAdsOnlyState(next);
    try {
      const res = await apiFetch('/api/agent-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adsOnly: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Falha ao atualizar modo somente anúncios:', err);
      setAdsOnlyState(previous);
      setErrorMsg('Não foi possível atualizar o modo "somente anúncios" no servidor — tente de novo.');
    }
  };

  const [isAdTriggersModalOpen, setIsAdTriggersModalOpen] = useState(false);
  const [adTriggersDraft, setAdTriggersDraft] = useState('');
  const [isSavingAdTriggers, setIsSavingAdTriggers] = useState(false);

  const openAdTriggersModal = () => {
    setAdTriggersDraft(adTriggerMessages.join('\n'));
    setIsAdTriggersModalOpen(true);
  };

  const handleSaveAdTriggerMessages = async () => {
    const messages = adTriggersDraft.split('\n').map((m) => m.trim()).filter(Boolean);
    setIsSavingAdTriggers(true);
    try {
      const res = await apiFetch('/api/agent-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adTriggerMessages: messages }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAdTriggerMessagesState(Array.isArray(data.adTriggerMessages) ? data.adTriggerMessages : messages);
      setIsAdTriggersModalOpen(false);
    } catch (err) {
      console.error('Falha ao salvar gatilhos de anúncio:', err);
      setErrorMsg('Não foi possível salvar os gatilhos de anúncio no servidor — tente de novo.');
    } finally {
      setIsSavingAdTriggers(false);
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
  const messagesContainerRef = React.useRef<HTMLDivElement>(null);
  const lastMessageCountRef = React.useRef(0);
  const activeConversationForScrollRef = React.useRef<string | undefined>(undefined);
  const shouldAutoScrollRef = React.useRef(true);
  const [isAtLatestMessage, setIsAtLatestMessage] = useState(true);
  const [newMessagesWhileAway, setNewMessagesWhileAway] = useState(0);

  const scrollToLatestMessage = (behavior: ScrollBehavior = 'smooth') => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    }
    shouldAutoScrollRef.current = true;
    setIsAtLatestMessage(true);
    setNewMessagesWhileAway(0);
  };

  const handleMessagesScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 48;
    shouldAutoScrollRef.current = isNearBottom;
    setIsAtLatestMessage(isNearBottom);
    if (isNearBottom) setNewMessagesWhileAway(0);
  };

  // Achado real testando com o Lucas em produção ("dá pra otimizar as
  // caixas de ferramenta"): a barra de controles tinha 7-8 botões numa
  // linha só, quebrando em 3-4 linhas no mobile. Ações de configuração
  // pontual (limpar testes, conectar Calendar, Auto IA, notificações) —
  // usadas uma vez e esquecidas, não no dia a dia — ficam atrás deste
  // menu; só o que o operador mexe com frequência (status do agente,
  // escalonamentos, novo lead) continua sempre visível.
  const [isToolbarSettingsOpen, setIsToolbarSettingsOpen] = useState(false);

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
  // Nome do lead pra quem a gravação em andamento (ou pendente de revisão) vai
  // — separado de `selectedLead` de propósito: se o operador trocar de
  // conversa no meio da gravação/revisão, o áudio ainda vai pro lead onde ela
  // começou (correto), mas sem isso não havia nenhum aviso visual de qual
  // conversa vai receber o áudio.
  const [recordingForLeadName, setRecordingForLeadName] = useState<string | null>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const audioChunksRef = React.useRef<Blob[]>([]);
  // Alvo real (id/telefone/nome) capturado no início da gravação — usado só
  // no momento de enviar/descartar, pra não depender de `selectedLead` já
  // ter mudado durante a pausa de revisão do áudio (ver pendingAudioPreview).
  const recordingTargetLeadRef = React.useRef<{ id: string; phone: string; name: string } | null>(null);
  // Achado real de produção (29/08/2026): a gravação saía pro cliente assim
  // que o operador parava de gravar, sem nenhuma chance de ouvir de volta e
  // corrigir/descartar — um áudio gravado sem querer (silêncio, corte, mic
  // não pegou a fala) já saiu de verdade pra uma cliente real antes de
  // qualquer revisão. Agora o "parar" só monta uma prévia local (player +
  // descartar/enviar); nada sai pro WhatsApp até o operador confirmar.
  const [pendingAudioPreview, setPendingAudioPreview] = useState<{ blob: Blob; url: string; mimeType: string } | null>(null);
  const [isSendingRecordedAudio, setIsSendingRecordedAudio] = useState(false);

  const handleToggleRealRecording = async () => {
    if (isRecordingReal) {
      mediaRecorderRef.current?.stop();
      setIsRecordingReal(false);
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
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setPendingAudioPreview({ blob, url: URL.createObjectURL(blob), mimeType });
      };

      recorder.start();
      setIsRecordingReal(true);
      setRecordingForLeadName(selectedLead.name);
      recordingTargetLeadRef.current = { id: selectedLead.id, phone: selectedLead.phone, name: selectedLead.name };
    } catch (err) {
      console.error('Erro ao acessar microfone:', err);
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.');
    }
  };

  const handleDiscardRecordedAudio = () => {
    if (pendingAudioPreview) URL.revokeObjectURL(pendingAudioPreview.url);
    setPendingAudioPreview(null);
    setRecordingForLeadName(null);
    recordingTargetLeadRef.current = null;
  };

  const handleSendRecordedAudio = async () => {
    const target = recordingTargetLeadRef.current;
    if (!pendingAudioPreview || !target || isSendingRecordedAudio) return;
    const { blob, mimeType, url } = pendingAudioPreview;
    setIsSendingRecordedAudio(true);
    try {
      const base64 = await blobToBase64(blob);
      const newMsg: ChatMessage = {
        id: `msg-audio-real-${Date.now()}`,
        sender: 'agent',
        type: 'audio',
        text: '🎤 Áudio enviado',
        audioDuration: Math.round(blob.size / 4000),
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      };
      setLeads((prev) => prev.map((l) => (l.id === target.id ? { ...l, messages: [...(l.messages || []), newMsg] } : l)));

      try {
        const extension = mimeType.startsWith('audio/mp4') ? 'mp4' : mimeType.startsWith('audio/ogg') ? 'ogg' : 'webm';
        const res = await apiFetch(`/api/conversations/${encodeURIComponent(target.phone)}/send-media`, {
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
        markMessageFailed(target.id, newMsg.id, err?.message || `Falha ao enviar o áudio pro cliente ${target.name} — ele NÃO recebeu. Tente reenviar.`);
      }
    } finally {
      URL.revokeObjectURL(url);
      setPendingAudioPreview(null);
      setRecordingForLeadName(null);
      recordingTargetLeadRef.current = null;
      setIsSendingRecordedAudio(false);
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

  // Mesma ideia do handleSendExamplePhoto acima, pro vídeo de exemplo de um
  // serviço (cadastrado na Base de Conhecimento, upload real no Storage —
  // ver AgentKnowledgeBase.tsx).
  const handleSendExampleVideo = async (productName: string) => {
    if (!selectedLead || !(selectedLead as any).isReal) return;
    const newMsg: ChatMessage = {
      id: `msg-example-video-${Date.now()}`,
      sender: 'agent',
      type: 'file',
      text: `🎥 Vídeo de exemplo: ${productName}`,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };
    setLeads((prev) => prev.map((l) => (l.id === selectedLead.id ? { ...l, messages: [...(l.messages || []), newMsg] } : l)));

    try {
      const res = await apiFetch(`/api/conversations/${encodeURIComponent(selectedLead.phone)}/send-example-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Falha ao enviar vídeo de exemplo:', err);
      markMessageFailed(selectedLead.id, newMsg.id, `Falha ao enviar o vídeo de exemplo pro cliente — ele NÃO recebeu. Tente reenviar.`);
    }
  };

  // A lista resumida devolve apenas a última mensagem. Um ID estável detecta
  // novidade sem transportar o histórico inteiro em cada polling.
  const lastMessageIdRef = useRef<Map<string, string | null>>(new Map());
  const activeLeadPhoneRef = useRef<string | null>(null);
  const fetchConversationsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRequestsInFlightRef = useRef<Set<string>>(new Set());
  // Cada request captura o tenant em que começou. Quando o operador troca de
  // empresa, respostas atrasadas do tenant anterior não podem alterar a fila,
  // o histórico aberto nem o aviso de erro do tenant novo.
  const activeTenantIdRef = useRef(activeTenant.id);
  activeTenantIdRef.current = activeTenant.id;

  const loadRealConversationHistory = async (phone: string, leadId: string) => {
    const requestTenantId = activeTenantIdRef.current;
    if (historyRequestsInFlightRef.current.has(phone)) return;
    historyRequestsInFlightRef.current.add(phone);
    setLeads((prev) => prev.map((lead) => lead.id === leadId ? { ...lead, historyLoading: true } : lead));
    try {
      const response = await apiFetch(`/api/conversations/${encodeURIComponent(phone)}`);
      const data = await response.json().catch(() => null);
      if (activeTenantIdRef.current !== requestTenantId || !response.ok || !data?.conversation) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      const messages: ChatMessage[] = (data.conversation.messages || []).map((message: ChatMessage) => ({
        ...message,
        timestamp: new Date(message.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      }));
      if (activeTenantIdRef.current !== requestTenantId) return;
      const lastMessage = messages[messages.length - 1];
      setLeads((prev) => prev.map((lead) => lead.id === leadId ? {
        ...lead,
        messages,
        textContent: lastMessage?.text || lead.textContent,
        historyLoaded: true,
        historyLoading: false,
        lastMessageId: lastMessage?.id,
      } : lead));
    } catch (err: any) {
      if (activeTenantIdRef.current !== requestTenantId) return;
      setLeads((prev) => prev.map((lead) => lead.id === leadId ? { ...lead, historyLoading: false } : lead));
      setErrorMsg(err?.message || 'Não foi possível carregar o histórico desta conversa.');
    } finally {
      historyRequestsInFlightRef.current.delete(phone);
    }
  };

  // Busca conversas reais de WhatsApp (recebidas via webhook) e mescla na
  // lista — sem substituir os leads de exemplo/simulados que já existirem.
  useEffect(() => {
    let cancelled = false;
    const requestTenantId = activeTenant.id;
    // Zera a contagem anterior a cada (re)início do efeito — inclui a troca
    // de tenant, pra não arriscar comparar a contagem de mensagens de um
    // telefone contra o valor guardado de um tenant diferente.
    lastMessageIdRef.current = new Map();
    activeLeadPhoneRef.current = null;
    // Troca de tenant: zera a lista na hora (o cache em localStorage foi
    // removido, ver achado de auditoria acima) — fica vazia até
    // fetchRealConversations() terminar logo abaixo, em vez de arriscar
    // mostrar a lista do tenant anterior.
    setLeads([]);

    const fetchRealConversations = async () => {
      try {
        // ?archived=true traz também as conversas arquivadas — a seção
        // "Arquivadas" do painel precisa delas, e não vale a pena um segundo
        // request/polling só pra isso (poucas conversas no volume atual).
        const response = await apiFetch('/api/conversations?archived=true');
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (cancelled || activeTenantIdRef.current !== requestTenantId) return;
        const realConversations: { phone: string; name?: string; messages?: ChatMessage[]; lastMessageId?: string; lastMessageSender?: ChatMessage['sender']; updatedAt: string; geoRestriction?: { detectedAt: string; country: string; reason: string }; labels?: string[]; archivedAt?: string; pinnedAt?: string; muted?: boolean; manuallyUnread?: boolean; aiBlockedAt?: string; adHeadline?: string; adGreetingMatchedAt?: string; unreadCount: number; lastLeadMessageAt?: string; phoneNumberId?: string | null }[] = data.conversations || [];

        // Ids que ganharam mensagem nova de CLIENTE nesta rodada (não conta
        // mensagem enviada pelo próprio operador/IA, nem a primeira carga —
        // só dispara quando já existia uma contagem anterior pra comparar).
        const newlyArrivedIds: string[] = [];
        for (const conv of realConversations) {
          const id = `real-${conv.phone}`;
          const currentLastMessageId = conv.lastMessageId || conv.messages?.[0]?.id || null;
          const hadPrevious = lastMessageIdRef.current.has(id);
          const previousLastMessageId = lastMessageIdRef.current.get(id);
          const lastIncomingSender = conv.lastMessageSender || conv.messages?.[0]?.sender;
          if (hadPrevious && previousLastMessageId !== currentLastMessageId && lastIncomingSender === 'lead') {
            newlyArrivedIds.push(id);
          }
          lastMessageIdRef.current.set(id, currentLastMessageId);
        }

        // Ids de conversa real que o servidor confirmou existir AGORA, pro
        // tenant do usuário logado — usado logo abaixo pra descartar
        // qualquer lead "isReal" que sobrou de um tenant anterior (achado
        // real em produção: trocar de conta no mesmo aparelho sem dar reload
        // deixava os contatos do tenant anterior presos na lista pra sempre,
        // porque esse merge só ADICIONAVA/ATUALIZAVA por id, nunca removia
        // quem não vinha mais na resposta).
        const currentRealIds = new Set(realConversations.map((conv) => `real-${conv.phone}`));

        setLeads((prev) => {
          const byId = new Map(
            prev.filter((l) => !(l as any).isReal || currentRealIds.has(l.id)).map((l) => [l.id, l])
          );
          for (const conv of realConversations) {
            const id = `real-${conv.phone}`;
            const existing = byId.get(id);
            const previewMessages = conv.messages || [];
            const lastText = previewMessages[previewMessages.length - 1]?.text || '';
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
              // O polling não deve apagar o histórico completo já aberto nem
              // baixá-lo novamente; para leads ainda fechados, mantém somente
              // a última mensagem da prévia.
              messages: (existing as any)?.historyLoaded
                ? ((existing as any).messages || [])
                : previewMessages.map((m) => ({
                    ...m,
                    timestamp: new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                  })),
              historyLoaded: Boolean((existing as any)?.historyLoaded),
              historyLoading: Boolean((existing as any)?.historyLoading),
              lastMessageId: conv.lastMessageId,
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
              adHeadline: conv.adHeadline,
              adGreetingMatchedAt: conv.adGreetingMatchedAt,
              unreadCount: conv.unreadCount ?? 0,
              lastLeadMessageAt: conv.lastLeadMessageAt,
              phoneNumberId: conv.phoneNumberId ?? null,
            } as any);
          }
          return Array.from(byId.values());
        });

        if (newlyArrivedIds.length > 0) {
          setFlashLeadIds((prev) => {
            const next = new Set(prev);
            newlyArrivedIds.forEach((id) => next.add(id));
            return next;
          });
          newlyArrivedIds.forEach((id) => {
            setTimeout(() => {
              setFlashLeadIds((prev) => {
                if (!prev.has(id)) return prev;
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            }, 1400);
          });
        }
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
      // EventSource nativo não manda header customizado (nem X-Tenant-Id que
      // apiFetch já anexa sozinho) — o tenant do seletor (saas_admin) vai por
      // querystring aqui, mesma exceção de resolveTenantId no backend.
      const tenantOverride = getTenantOverride();
      const streamUrl = tenantOverride
        ? `/api/conversations/stream?token=${encodeURIComponent(token)}&tenantId=${encodeURIComponent(tenantOverride)}`
        : `/api/conversations/stream?token=${encodeURIComponent(token)}`;
      source = new EventSource(streamUrl);
      // O evento carrega o telefone que mudou — reaproveita o mesmo fetch da
      // lista em vez de montar um merge separado por telefone, então cobre
      // também o caso de conversa apagada. `aiReplyStatus` (opcional) é um
      // sinal à parte, não liga a nenhuma mudança de mensagem por si só —
      // ver aiReplyStatusByPhone acima.
      source.onmessage = (event) => {
        // Achado real de consumo de egress do Supabase (01/09/2026): cada
        // evento SSE (inclusive um simples "entregue"/"lida", sem nenhuma
        // mudança visível na lista) disparava um GET /api/conversations
        // completo — com WhatsApp real trocando mensagens o dia todo, isso
        // rebuscava a lista inteira dezenas de vezes por minuto. Um debounce
        // curto agrupa uma rajada de eventos próximos (comum quando várias
        // mensagens/status chegam quase juntos) numa única busca, sem mudar
        // o comportamento percebido — a lista já atualiza via
        // loadRealConversationHistory pra conversa aberta, então 400ms de
        // atraso na lista de fora não é perceptível.
        if (fetchConversationsDebounceRef.current) clearTimeout(fetchConversationsDebounceRef.current);
        fetchConversationsDebounceRef.current = setTimeout(fetchRealConversations, 400);
        try {
          const payload = JSON.parse(event.data);
          const phone: string | undefined = payload?.phone;
          if (phone && phone === activeLeadPhoneRef.current) {
            void loadRealConversationHistory(phone, `real-${phone}`);
          }
          const status: 'generating' | 'drafted' | 'safety_blocked' | 'escalated' | 'awaiting_human' | 'template_sent' | 'sent' | 'delivery_failed' | 'failed' | undefined = payload?.aiReplyStatus;
          if (!phone || !status) return;
          if (status === 'generating' || status === 'drafted') {
            setAiReplyStatusByPhone((prev) => ({ ...prev, [phone]: 'generating' }));
          } else if (status === 'sent' || status === 'template_sent') {
            setAiReplyStatusByPhone((prev) => {
              if (!(phone in prev)) return prev;
              const { [phone]: _removed, ...rest } = prev;
              return rest;
            });
          } else {
            const localStatus = status === 'delivery_failed' ? 'delivery_failed' : 'awaiting_human';
            setAiReplyStatusByPhone((prev) => ({ ...prev, [phone]: localStatus }));
            // Some sozinho depois de alguns segundos — o escalonamento e os
            // eventos persistidos permanecem disponíveis para auditoria.
            setTimeout(() => {
              setAiReplyStatusByPhone((prev) => {
                if (prev[phone] !== localStatus) return prev;
                const { [phone]: _removed, ...rest } = prev;
                return rest;
              });
            }, 9000);
          }
        } catch {
          // Heartbeat (": heartbeat\n\n") ou payload antigo sem JSON válido — ignora.
        }
      };
      // EventSource já reconecta sozinho no browser depois de erro/queda de
      // conexão — não precisa de lógica de retry manual aqui.
    }

    // Rede de segurança: cobre o intervalo entre uma queda do processo (o
    // pub/sub do SSE é em memória, ver conversationEvents.ts) e a
    // reconexão real do EventSource, sem voltar a bater a cada 8s.
    const safetyPoll = setInterval(fetchRealConversations, 90000);

    return () => {
      cancelled = true;
      source?.close();
      clearInterval(safetyPoll);
      if (fetchConversationsDebounceRef.current) clearTimeout(fetchConversationsDebounceRef.current);
    };
    // `activeTenant.id` como dependência: sem isso, trocar de conta (ou o
    // saas_admin trocar de tenant) no mesmo componente montado (ele nunca
    // desmonta, ver comentário em App.tsx) deixava o fetch/SSE presos no
    // token/tenant de quando o componente montou pela primeira vez —
    // só se atualizava depois de até 90s (o poll de segurança) ou de uma
    // reconexão de SSE por acaso, nunca de forma imediata.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id]);

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

  // TASK-0190 — recarrega a lista de sugestões-padrão já dispensadas ao
  // trocar de tenant (saas_admin usa o seletor de tenant no Header), senão
  // ficaria comparando o Set carregado no mount contra o tenant errado.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(dismissedDefaultSuggestionsKey(activeTenant.id));
      setDismissedDefaultSuggestions(saved ? new Set(JSON.parse(saved)) : new Set());
    } catch {
      setDismissedDefaultSuggestions(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id]);

  const openLabelManager = async () => {
    setIsLabelManagerOpen(true);
    setIsLoadingLabelCatalog(true);
    try {
      const res = await apiFetch('/api/conversation-labels/catalog');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.labels)) setLabelCatalog(data.labels);
      }
    } finally {
      setIsLoadingLabelCatalog(false);
    }
  };

  // Renomear/apagar agem em TODAS as conversas do tenant de uma vez (ver
  // renameLabelForTenant/deleteLabelForTenant em conversationLabelStore.ts).
  // fetchRealConversations vive só dentro do useEffect de polling/SSE (não dá
  // pra chamar daqui) — em vez de recarregar tudo do servidor, aplica a mesma
  // transformação direto no estado local de `leads`, já sabendo exatamente
  // qual etiqueta mudou.
  const handleRenameLabelCatalog = async (oldLabel: string, newLabel: string) => {
    const trimmedNew = newLabel.trim();
    const res = await apiFetch(`/api/conversation-labels/${encodeURIComponent(oldLabel)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newLabel: trimmedNew }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    const oldKey = normalizeLabelText(oldLabel);
    setLeads((prev) => prev.map((l) => {
      const current = (l as any).conversationLabels as string[] | undefined;
      if (!current?.some((x) => normalizeLabelText(x) === oldKey)) return l;
      const alreadyHasNew = current.some((x) => normalizeLabelText(x) === normalizeLabelText(trimmedNew) && normalizeLabelText(x) !== oldKey);
      const next = alreadyHasNew
        ? current.filter((x) => normalizeLabelText(x) !== oldKey)
        : current.map((x) => (normalizeLabelText(x) === oldKey ? trimmedNew : x));
      return { ...l, conversationLabels: next } as any;
    }));
    setLabelCatalog((prev) => {
      const withoutOld = prev.filter((entry) => normalizeLabelText(entry.label) !== oldKey);
      const existingNew = prev.find((entry) => normalizeLabelText(entry.label) === normalizeLabelText(trimmedNew));
      const oldEntry = prev.find((entry) => normalizeLabelText(entry.label) === oldKey);
      const mergedCount = (existingNew?.usageCount || 0) + (oldEntry?.usageCount || 0);
      return [...withoutOld.filter((entry) => normalizeLabelText(entry.label) !== normalizeLabelText(trimmedNew)), { label: trimmedNew, usageCount: mergedCount || 1 }]
        .sort((a, b) => b.usageCount - a.usageCount);
    });
    refreshLabelSuggestions();
  };

  const handleDeleteLabelCatalog = async (label: string) => {
    const res = await apiFetch(`/api/conversation-labels/${encodeURIComponent(label)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    const key = normalizeLabelText(label);
    setLeads((prev) => prev.map((l) => {
      const current = (l as any).conversationLabels as string[] | undefined;
      if (!current?.some((x) => normalizeLabelText(x) === key)) return l;
      return { ...l, conversationLabels: current.filter((x) => normalizeLabelText(x) !== key) } as any;
    }));
    setLabelCatalog((prev) => prev.filter((entry) => normalizeLabelText(entry.label) !== key));
    refreshLabelSuggestions();

    // TASK-0190 — se a etiqueta excluída é uma das sugestões-padrão fixas no
    // código (BEAUTY_STUDIO_LABEL_SUGGESTIONS), o DELETE acima não apaga
    // nada de verdade (nunca existiu como conversation_labels — é só texto
    // fixo) e ela reapareceria imediatamente sem isto. Guarda a dispensa por
    // navegador+tenant pra filtrar essas sugestões na renderização.
    setDismissedDefaultSuggestions((prev) => {
      const next = new Set(prev);
      next.add(key);
      try {
        localStorage.setItem(dismissedDefaultSuggestionsKey(activeTenant.id), JSON.stringify(Array.from(next)));
      } catch {
        // localStorage indisponível (modo privado, quota) — a dispensa só não sobrevive a um refresh
      }
      return next;
    });
  };

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

  const refreshContactContext = React.useCallback(async () => {
    const phone = selectedLead?.phone;
    const tenantId = activeTenant?.id;
    const isRealConversation = Boolean((selectedLead as any)?.isReal);
    const requestId = ++contactContextRequestRef.current;
    if (!phone || !tenantId || !isRealConversation) {
      setContactContext(null);
      setContactContextPhone(null);
      setContactContextTenantId(null);
      setIsContactContextLoading(false);
      return;
    }

    // Vincula o estado ao telefone E tenant antes do request. Durante a troca
    // de lead/empresa, o render nunca pode reaproveitar a memória anterior.
    setContactContextPhone(phone);
    setContactContextTenantId(tenantId);
    setContactContext(null);
    setIsContactContextLoading(true);
    try {
      const response = await apiFetch(`/api/conversations/${encodeURIComponent(phone)}/context`);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || typeof data.available !== 'boolean') throw new Error(data?.error || `HTTP ${response.status}`);
      if (requestId === contactContextRequestRef.current) setContactContext(data as ContactAgentContext);
    } catch {
      if (requestId === contactContextRequestRef.current) {
        setContactContext({ available: false, unavailable: { memory: true, trace: true }, memory: null, latestDecision: null });
      }
    } finally {
      if (requestId === contactContextRequestRef.current) setIsContactContextLoading(false);
    }
  }, [activeTenant?.id, selectedLead?.phone, (selectedLead as any)?.isReal]);

  useEffect(() => {
    void refreshContactContext();
  }, [refreshContactContext]);

  const visibleContactContext = contactContextTenantId === activeTenant?.id && contactContextPhone === selectedLead?.phone ? contactContext : null;

  // Checa 1x por tenant se há WABA configurado, pra já bloquear "Reabrir a
  // conversa" na página quando não há (ver GET /api/conversations/:phone/templates
  // em conversations.ts — reason: 'waba_not_configured'). Falha de rede não
  // marca nada (evita bloquear a página por causa de instabilidade
  // passageira; o modal ainda mostra o estado real e permite tentar de novo).
  useEffect(() => {
    const tenantId = activeTenant?.id;
    const phone = selectedLead?.phone;
    const isRealConversation = Boolean((selectedLead as any)?.isReal);
    // Só faz sentido no canal Meta — é o único com a restrição de
    // template/WABA fora da janela de 24h (ver aviso provider-aware acima).
    const isMetaChannel = Boolean((selectedLead as any)?.phoneNumberId);
    if (!tenantId || !phone || !isRealConversation || !isMetaChannel) return;
    if (reopenAvailability?.tenantId === tenantId) return;
    let cancelled = false;
    apiFetch(`/api/conversations/${encodeURIComponent(phone)}/templates`)
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        setReopenAvailability({ tenantId, wabaConfigured: data?.reason !== 'waba_not_configured' });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeTenant?.id, selectedLead?.phone, (selectedLead as any)?.isReal, (selectedLead as any)?.phoneNumberId, reopenAvailability?.tenantId]);

  const isReopenBlockedByWaba = reopenAvailability?.tenantId === activeTenant?.id && reopenAvailability.wabaConfigured === false;

  const handleSaveContactMemory = React.useCallback(async (patch: Partial<OperatorMemoryEditPayload>) => {
    const phone = selectedLead?.phone;
    if (!phone || !(selectedLead as any)?.isReal) throw new Error('Selecione uma conversa real para corrigir a memória.');
    const response = await apiFetch(`/api/conversations/${encodeURIComponent(phone)}/context/memory`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) throw new Error(data?.error || 'Não foi possível salvar a correção de memória.');
    await refreshContactContext();
  }, [refreshContactContext, selectedLead?.phone, (selectedLead as any)?.isReal]);

  const openOperatorFeedback = (kind: 'bug' | 'operator_idea') => {
    setOperatorFeedbackKind(kind);
    setOperatorFeedbackTitle('');
    setOperatorFeedbackDescription('');
    setIsHeaderMenuOpen(false);
  };

  const submitOperatorFeedback = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!operatorFeedbackKind || !selectedLead || !operatorFeedbackTitle.trim() || !operatorFeedbackDescription.trim()) return;
    setIsSubmittingOperatorFeedback(true);
    try {
      const response = await apiFetch('/api/quality-audit/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: operatorFeedbackKind,
          title: operatorFeedbackTitle.trim(),
          description: operatorFeedbackDescription.trim(),
          context: {
            source: 'whatsapp_conversation',
            conversationPhone: selectedLead.phone,
            leadName: selectedLead.name,
            conversationId: selectedLead.id,
          },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível registrar o feedback.');
      setOperatorFeedbackKind(null);
      setOperatorFeedbackTitle('');
      setOperatorFeedbackDescription('');
      setErrorMsg(null);
      console.info('Feedback operacional registrado:', data?.review?.id);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível registrar o feedback. Tente de novo.');
    } finally {
      setIsSubmittingOperatorFeedback(false);
    }
  };

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

  // Rola automaticamente quando o operador está no fim ou troca de conversa.
  // Se ele subiu para ler o histórico, a chegada de novas mensagens não o
  // empurra para baixo: o botão flutuante e o contador ficam disponíveis.
  useEffect(() => {
    const conversationId = selectedLead?.id;
    const messageCount = selectedLead?.messages?.length ?? 0;
    const conversationChanged = activeConversationForScrollRef.current !== conversationId;
    const previousMessageCount = lastMessageCountRef.current;

    if (conversationChanged) {
      activeConversationForScrollRef.current = conversationId;
      lastMessageCountRef.current = 0;
      shouldAutoScrollRef.current = true;
      setIsAtLatestMessage(true);
      setNewMessagesWhileAway(0);
    }

    if (conversationChanged || shouldAutoScrollRef.current) {
      window.requestAnimationFrame(() => scrollToLatestMessage(conversationChanged ? 'auto' : 'smooth'));
    } else if (messageCount > previousMessageCount) {
      setNewMessagesWhileAway((count) => count + (messageCount - previousMessageCount));
    }

    lastMessageCountRef.current = messageCount;
  }, [selectedLead?.id, selectedLead?.messages?.length]);

  // Issue #82, item 3 — o backend de verificação de pagamento
  // (setPaymentVerification/verify-payment) já existia e funcionava, mas o
  // agendamento com o status do comprovante nunca chegava até aqui: não
  // tinha botão nenhum pra confirmar.
  //
  // Achado depois (pedido real do dono do produto, 12/08/2026): o botão
  // "Confirmar"/"Rejeitar" que existia bem aqui virou um SEGUNDO lugar
  // desconectado do escalonamento que webhooks.ts já cria automaticamente
  // pro mesmo comprovante — confirmar por aqui não avisava o cliente do
  // motivo, e o operador podia se perder entre os dois lugares. Unificado
  // no card de escalonamento (kind: 'payment_proof' — ver EscalationsPanel.tsx
  // e App.tsx, handleResolvePaymentEscalation): aqui fica só o aviso,
  // sem ação, apontando pra onde decidir de verdade. paymentReceiptHint
  // (dica gerada pelo Gemini a partir da imagem, ver paymentReceiptAnalysis.ts)
  // continua exibida aqui, só como informação extra pro operador decidir
  // mais rápido lá no card.
  const [paymentAppointment, setPaymentAppointment] = useState<{ summary: string; startIso: string; paymentStatus?: string; paymentReceiptHint?: string; heldUntil?: string } | null>(null);

  // Issue #182 — antes disso, um agendamento fechado fora da IA (WhatsApp
  // pessoal, telefone, presencial) era invisível pro sistema inteiro: sem
  // linha em appointments, sem lembrete automático, e o comprovante de
  // pagamento do cliente caía num "buraco" (nenhuma verificação disparava).
  // Botão só aparece quando NÃO há agendamento já rastreado pra esse
  // contato (evita tentar cadastrar dois pro mesmo número).
  const [isManualAppointmentModalOpen, setIsManualAppointmentModalOpen] = useState(false);
  const [isContractModalOpen, setIsContractModalOpen] = useState(false);
  const [manualServiceName, setManualServiceName] = useState('');
  const [isManualServiceCustom, setIsManualServiceCustom] = useState(false);
  const [manualCustomDurationMinutes, setManualCustomDurationMinutes] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualTime, setManualTime] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualPaymentReceived, setManualPaymentReceived] = useState(false);
  // Pedido real (20/08/2026): "a cliente enviar um valor diferente dos
  // 50.000 guaranis" precisa atualizar o Financeiro com o valor REAL
  // recebido, não sempre o preço do catálogo. Vazio = usa o preço do
  // catálogo (comportamento de sempre).
  const [manualPaymentAmountReceived, setManualPaymentAmountReceived] = useState('');
  const [isCreatingManualAppointment, setIsCreatingManualAppointment] = useState(false);
  const [manualAppointmentError, setManualAppointmentError] = useState<string | null>(null);
  const [manualAppointmentSuccess, setManualAppointmentSuccess] = useState(false);

  // Pedido real (20/08/2026): o operador digitava a hora "no escuro" e só
  // descobria conflito depois de tentar salvar. Busca os horários REALMENTE
  // livres (mesma lógica que a IA usa, `findAvailabilityForDate`) assim que
  // data + duração do serviço estão definidas, e mostra como botões — o
  // input de hora livre continua existindo como fallback (Google
  // desconectado, erro, ou o operador quer digitar um horário fora da
  // amostra mesmo assim).
  const [manualFreeSlots, setManualFreeSlots] = useState<string[]>([]);
  const [isLoadingManualFreeSlots, setIsLoadingManualFreeSlots] = useState(false);
  const [manualFreeSlotsError, setManualFreeSlotsError] = useState<string | null>(null);

  const manualServiceDurationMinutes = isManualServiceCustom
    ? Number(manualCustomDurationMinutes)
    : knowledgeBase.products.find((p) => p.name === manualServiceName)?.durationMinutes || 90;

  useEffect(() => {
    if (!isManualAppointmentModalOpen || !manualDate || !(manualServiceDurationMinutes > 0)) {
      setManualFreeSlots([]);
      setManualFreeSlotsError(null);
      return;
    }
    let cancelled = false;
    setIsLoadingManualFreeSlots(true);
    setManualFreeSlotsError(null);
    apiFetch(`/api/google-calendar/free-slots?date=${manualDate}&durationMinutes=${manualServiceDurationMinutes}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => { if (!cancelled) setManualFreeSlots((data.slots || []).map((s: { start: string }) => s.start)); })
      .catch((err) => { if (!cancelled) { setManualFreeSlots([]); setManualFreeSlotsError(err.message || 'Não foi possível carregar os horários livres.'); } })
      .finally(() => { if (!cancelled) setIsLoadingManualFreeSlots(false); });
    return () => { cancelled = true; };
  }, [isManualAppointmentModalOpen, manualDate, manualServiceDurationMinutes]);

  const handleCreateManualAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead?.phone || !manualServiceName || !manualDate || !manualTime) return;
    // Serviço personalizado (só pra este agendamento, nunca entra na Base
    // de Conhecimento) exige a duração digitada na hora — não tem entrada
    // no catálogo pra puxar; sem número válido, não dá pra calcular o fim
    // do evento real na agenda.
    if (isManualServiceCustom && !(Number(manualCustomDurationMinutes) > 0)) {
      setManualAppointmentError('Informe a duração (minutos) do serviço personalizado.');
      return;
    }
    setIsCreatingManualAppointment(true);
    setManualAppointmentError(null);
    try {
      const durationMinutes = manualServiceDurationMinutes;
      const startIso = `${manualDate}T${manualTime}:00`;
      const endDate = new Date(`${manualDate}T${manualTime}:00`);
      endDate.setMinutes(endDate.getMinutes() + durationMinutes);
      const endIso = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}T${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}:00`;

      const res = await apiFetch(`/api/conversations/${encodeURIComponent(selectedLead.phone)}/manual-appointment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceName: manualServiceName,
          startIso,
          endIso,
          notes: manualNotes.trim() || undefined,
          paymentReceived: manualPaymentReceived,
          paymentAmountReceived: manualPaymentReceived && manualPaymentAmountReceived.trim() ? Number(manualPaymentAmountReceived) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPaymentAppointment(data.appointment);
      setIsManualAppointmentModalOpen(false);
      setManualServiceName('');
      setIsManualServiceCustom(false);
      setManualCustomDurationMinutes('');
      setManualDate('');
      setManualTime('');
      setManualNotes('');
      setManualPaymentReceived(false);
      setManualPaymentAmountReceived('');
      setManualAppointmentSuccess(true);
      setTimeout(() => setManualAppointmentSuccess(false), 4000);
    } catch (err: any) {
      setManualAppointmentError(err.message || 'Não foi possível cadastrar o agendamento agora.');
    } finally {
      setIsCreatingManualAppointment(false);
    }
  };

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

  // TASK-0243 — janela de 24h desde a última mensagem do LEAD (não da
  // conversa em geral). `undefined` quando o lead nunca escreveu (conversa
  // criada manualmente/via anúncio antes de qualquer resposta) — trata como
  // fechada, igual getCustomerServiceWindowStatus no backend. Só é
  // tecnicamente uma restrição de envio no canal Meta (phoneNumberId
  // presente); em Evolution/Instagram é só informativo (ver aviso na faixa
  // de status da conversa, mais abaixo).
  const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
  const isWithin24hWindow = (lead: LeadInfo): boolean => {
    const lastLeadMessageAt = (lead as any).lastLeadMessageAt;
    if (!lastLeadMessageAt) return false;
    return Date.now() - new Date(lastLeadMessageAt).getTime() < CUSTOMER_SERVICE_WINDOW_MS;
  };
  const windowClosedLeadsCount = leads.filter((lead) => (lead as any).isReal && !isWithin24hWindow(lead)).length;

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
      if (activeTabFilter === 'window_closed') {
        return Boolean((lead as any).isReal) && !isWithin24hWindow(lead);
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

  // Regra R3 do handoff: a fila é organizada pelo tempo que o cliente espera
  // por uma resposta humana. O modelo atual não persiste waitingSince, então
  // ele é derivado com segurança da última mensagem do cliente sem resposta.
  type WaitingGroupId = 'over30' | 'under30' | 'awaitingClient';
  const getWaitingGroup = (lead: LeadInfo): WaitingGroupId => {
    const latestMessage = lead.messages?.[lead.messages.length - 1];
    if (!latestMessage || latestMessage.sender !== 'lead') return 'awaitingClient';

    const waitingSince = Date.parse(latestMessage.timestamp);
    // Em registros legados cujo horário não é ISO, prioriza não lidas sem
    // inventar uma data: elas entram em "até 30 min" até a próxima mensagem.
    if (Number.isNaN(waitingSince)) return getUnreadCount(lead) > 0 ? 'under30' : 'awaitingClient';
    return Date.now() - waitingSince > 30 * 60 * 1000 ? 'over30' : 'under30';
  };

  const waitingGroupMeta: Record<WaitingGroupId, { label: string; className: string }> = {
    over30: { label: 'ESPERANDO HÁ MAIS DE 30 MIN', className: 'text-[#A33A22] bg-[#231412]' },
    under30: { label: 'ESPERANDO ATÉ 30 MIN', className: 'text-[#8A5A00] bg-[#231C10]' },
    awaitingClient: { label: 'AGUARDANDO CLIENTE', className: 'text-[var(--text-label)] bg-[var(--surface-raised)]' },
  };

  const waitingGroups = (['over30', 'under30', 'awaitingClient'] as WaitingGroupId[]).map((id) => ({
    id,
    leads: filteredLeads
      .filter((lead) => getWaitingGroup(lead) === id)
      .sort((a, b) => {
        if (id === 'awaitingClient') return 0;
        const timeA = Date.parse(a.messages?.[a.messages.length - 1]?.timestamp || '') || 0;
        const timeB = Date.parse(b.messages?.[b.messages.length - 1]?.timestamp || '') || 0;
        return timeA - timeB;
      }),
  }));

  // Seleciona a conversa e, se for real e tiver mensagens não lidas (contagem
  // real vinda do servidor E/OU marcação manual do operador via menu ⋮),
  // zera os dois: manuallyUnread (PATCH /state, já existente) e unreadCount
  // (POST /read, zera localmente pra feedback imediato sem esperar o
  // próximo polling de 8s).
  const handleSelectLead = (lead: LeadInfo) => {
    setActiveLeadId(lead.id);
    setMobileThreadOpen(true);
    setIsHeaderMenuOpen(false);
    activeLeadPhoneRef.current = (lead as any).isReal ? lead.phone : null;
    if ((lead as any).isReal) {
      if (!(lead as any).historyLoaded && !(lead as any).historyLoading) {
        void loadRealConversationHistory(lead.phone, lead.id);
      }
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

  // Abre automaticamente a conversa de um lead quando o painel de
  // Escalonamentos manda o operador "voltar pra conversa" (App.tsx troca a
  // aba pra "whatsapp" e passa telefone + requestId). Compara com o
  // requestId (não só o telefone) num ref — sem isso, o polling de leads (a
  // cada 8s) reexecutaria o efeito à toa, E clicar de novo no mesmo lead
  // depois de já ter navegado manualmente pra outra conversa não reabriria
  // nada, porque o telefone sozinho não muda entre um clique e outro.
  const lastOpenedRequestIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!openLeadPhone || openLeadRequestId === undefined || openLeadRequestId === lastOpenedRequestIdRef.current) return;
    const lead = leads.find((l) => (l as any).isReal && l.phone === openLeadPhone);
    if (!lead) return;
    lastOpenedRequestIdRef.current = openLeadRequestId;
    setShowArchived(false);
    setActiveTabFilter('all');
    handleSelectLead(lead);
  }, [openLeadPhone, openLeadRequestId, leads]);

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
  // atualizam o estado local.
  const handleUpdateConversationState = async (leadId: string, patch: { archived?: boolean; pinned?: boolean; muted?: boolean; unread?: boolean; name?: string; aiBlocked?: boolean; adLead?: true; releaseAiNow?: true }): Promise<boolean> => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return false;

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
          adGreetingMatchedAt: data.conversation?.adGreetingMatchedAt,
        } : l)));
        setErrorMsg(null);
        setErrorRetryAction(undefined);
        return true;
      } catch (err) {
        console.error('Falha ao atualizar organização da conversa no servidor:', err);
        setErrorMsg('Não foi possível salvar essa ação no servidor. Tente de novo.');
        setErrorRetryAction(() => () => handleUpdateConversationState(leadId, patch));
        return false;
      }
    }

    setLeads((prev) => prev.map((l) => {
      if (l.id !== leadId) return l;
      const updated: PanelLead = { ...l };
      if (patch.archived !== undefined) updated.archivedAt = patch.archived ? new Date().toISOString() : undefined;
      if (patch.pinned !== undefined) updated.pinnedAt = patch.pinned ? new Date().toISOString() : undefined;
      if (patch.unread !== undefined) updated.manuallyUnread = patch.unread;
      if (patch.name !== undefined) updated.name = patch.name;
      if (patch.aiBlocked !== undefined) updated.aiBlockedAt = patch.aiBlocked ? new Date().toISOString() : undefined;
      return updated;
    }));
    return true;
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

  // Recupera a última Ficha versionada no servidor ao trocar de conversa. Isso
  // evita que uma recarga ou outro operador perca uma leitura já validada.
  useEffect(() => {
    if (!selectedLead?.phone || selectedLead.fullAnalysis || isAnalyzingConversation) return;
    let cancelled = false;
    const loadPersistedAnalysis = async () => {
      try {
        const messageCount = selectedLead.messages?.length || 0;
        const response = await apiFetch(`/api/conversation-analysis/${encodeURIComponent(selectedLead.phone)}?messageCount=${messageCount}`);
        const data = await response.json();
        if (cancelled || !response.ok || !data.success || !data.analysis || !data.persisted) return;
        const fullAnalysis: FullConversationAnalysis = {
          ...data.analysis,
          source: data.persisted.source,
          lastUpdated: new Date(data.persisted.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          persistence: {
            generatedAt: data.persisted.generatedAt,
            contextHash: data.persisted.contextHash,
            messageCount: data.persisted.messageCount,
            model: data.persisted.model,
            newMessages: data.freshness?.newMessages || 0,
            isFresh: Boolean(data.freshness?.isFresh),
          },
        };
        setLeads((prev) => prev.map((lead) => lead.id === selectedLead.id ? { ...lead, fullAnalysis } : lead));
      } catch (error) {
        console.warn('Não foi possível recuperar a Ficha Inteligente persistida:', error);
      }
    };
    void loadPersistedAnalysis();
    return () => { cancelled = true; };
  }, [activeLeadId, selectedLead?.phone, selectedLead?.messages?.length, selectedLead?.fullAnalysis, isAnalyzingConversation]);

  // Full Conversation Analysis API call
  const handleAnalyzeConversation = async (
    targetLead = selectedLead,
    options: { draftAfterAnalysis?: boolean } = {}
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

      // Uma indisponibilidade do modelo nunca substitui a última Ficha confiável
      // por um fallback vazio: o operador mantém a leitura persistida e recebe
      // a falha para decidir se tenta de novo.
      if (data.source === 'fallback' && targetLead.fullAnalysis?.persistence) {
        setErrorMsg(data.analysis?.conversationSummary || 'A Ficha não pôde ser atualizada agora; a última leitura confiável foi preservada.');
        return;
      }

      const fullAnalysis: FullConversationAnalysis = {
        ...data.analysis,
        source: data.source,
        lastUpdated: new Date(data.persisted?.generatedAt || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        persistence: data.persisted ? {
          generatedAt: data.persisted.generatedAt,
          contextHash: data.persisted.contextHash,
          messageCount: data.persisted.messageCount,
          newMessages: 0,
          isFresh: true,
        } : undefined,
      };

      setLeads((prev) =>
        prev.map((l) => (l.id === targetLead.id ? { ...l, fullAnalysis } : l))
      );

      // Continuidade assistida: o operador pode acionar a IA numa conversa
      // já existente sem esperar uma nova mensagem do lead. A análise usa o
      // histórico real e leva a resposta sugerida APENAS ao compositor,
      // mantendo revisão humana e envio explícito separados.
      if (options.draftAfterAnalysis && fullAnalysis.suggestedSmartReply?.trim()) {
        setInputMessage(fullAnalysis.suggestedSmartReply.trim());
      }
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
    setReplyingTo(msg);
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

  /**
   * "Tentar novamente" na transcrição de um áudio que falhou (pedido real,
   * 19/08/2026): a causa mais comum não é falta de crédito, é uma
   * instabilidade passageira do Gemini (timeout de 20s) — tentar de novo
   * minutos depois costuma resolver. O áudio original já fica salvo no
   * backend (mesmo bucket da imagem recebida), então não precisa reenviar
   * nada daqui, só disparar o reprocessamento. `updateMessageText` no
   * backend já emite o SSE de conversas — o texto atualiza sozinho no
   * painel quando o evento chegar, sem precisar mexer no estado local aqui.
   */
  const handleRetryTranscription = async (msg: ChatMessage) => {
    if (!selectedLead || !(selectedLead as any).isReal) return;
    setRetryingTranscriptionId(msg.id);
    try {
      const res = await apiFetch(
        `/api/conversations/${encodeURIComponent(selectedLead.phone)}/messages/${encodeURIComponent(msg.id)}/retry-transcription`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (!data.success) {
        setErrorMsg('Ainda não foi possível transcrever este áudio — tente de novo em alguns instantes.');
      }
    } catch (err) {
      console.error('Falha ao tentar transcrever o áudio de novo:', err);
      setErrorMsg('Não foi possível tentar transcrever de novo. Tente mais tarde.');
    } finally {
      setRetryingTranscriptionId(null);
    }
  };

  // Preenche o compositor para revisão humana antes de qualquer envio real.
  const handleDraftSuggestedReply = (replyText: string) => {
    if (!selectedLead) return;
    setInputMessage(replyText);
  };

  // Evolution não tem conceito de template (diferente do fluxo Meta em
  // operatorFollowUpService.ts) — o texto já sai pronto, sem placeholder,
  // pro operador revisar/editar antes do envio de texto livre normal.
  const buildReengagementDraft = (leadName: string, tenantName: string): string =>
    `Oi ${leadName}! Aqui é a equipe da ${tenantName}, ainda estamos por aqui pra te ajudar 😊 Responde essa mensagem quando puder!`;

  // Preenche o compositor com sugestão de retomada — sem modal de
  // template como na Meta, só um rascunho pra revisão humana.
  const handleDraftReengagementMessage = (lead: LeadInfo) => {
    if (!activeTenant?.name) return;
    handleDraftSuggestedReply(buildReengagementDraft(lead.name, activeTenant.name));
    composerTextareaRef.current?.focus();
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

  // Handle direct Meta CAPI trigger from conversation panel (botões da Ficha
  // IA). Achado real (15/08/2026): este handler nunca mandava pixelId/
  // accessToken no corpo da requisição — POST /api/meta-capi/send-event
  // sempre rejeitava com 400 ("configure pixelId e accessToken"), então o
  // botão nunca funcionou de verdade desde que foi criado. A aba "Central &
  // Disparo Meta CAPI" (AdAttributionCAPI.tsx) já salva essas credenciais em
  // localStorage sob a chave 'meta_capi_config' — reusa a mesma aqui, em vez
  // de duplicar o formulário de configuração nesta ficha.
  const handleDirectCAPI = async (eventName: string) => {
    if (!selectedLead) return;
    let pixelId = '';
    let accessToken = '';
    let testEventCode: string | undefined;
    try {
      const saved = localStorage.getItem('meta_capi_config');
      if (saved) {
        const cfg = JSON.parse(saved);
        pixelId = cfg.pixelId || '';
        accessToken = cfg.accessToken || '';
        testEventCode = cfg.testEventCode || undefined;
      }
    } catch {
      // config corrompida no localStorage — segue com campos vazios, o
      // backend recusa com a mensagem já orientando a configurar de novo.
    }
    try {
      const response = await apiFetch('/api/meta-capi/send-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventName,
          pixelId,
          accessToken,
          testEventCode,
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

  // Gerar Resposta a partir de uma Sugestão (pedido real, 15/08/2026, Ficha
  // IA) — POST /api/ai/reply-from-hint. Mesmo shape de leadInfo/messages/
  // agentKnowledgeBase já usado em handleAnalyzeConversation, pra manter a
  // resposta gerada consistente com o que o Gemini já sabe sobre este lead.
  const handleGenerateReplyFromHint = async (hint: string): Promise<HintReplyResult> => {
    if (!selectedLead) return { reply: '', error: 'Nenhum lead selecionado.' };
    try {
      const response = await apiFetch('/api/ai/reply-from-hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadInfo: {
            name: selectedLead.name,
            phone: selectedLead.phone,
            sampleType: (selectedLead as any).sampleType,
          },
          messages: selectedLead.messages || [],
          agentKnowledgeBase: knowledgeBase,
          hint,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        return { reply: '', error: data?.error || 'Erro ao gerar resposta.' };
      }
      return { reply: data.reply || '', translation: data.translation || undefined, detectedLanguage: data.detectedLanguage || undefined, error: data.error };
    } catch (err: any) {
      return { reply: '', error: err.message || 'Falha ao gerar resposta.' };
    }
  };

  // Perguntar à IA (pedido real, 15/08/2026, Ficha IA) — POST /api/ai/ask.
  const handleAskAi = async (question: string): Promise<AskAiResult> => {
    if (!selectedLead) return { answer: '', error: 'Nenhum lead selecionado.' };
    try {
      const response = await apiFetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadInfo: { name: selectedLead.name, phone: selectedLead.phone },
          messages: selectedLead.messages || [],
          question,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        return { answer: '', error: data?.error || 'Erro ao consultar a IA.' };
      }
      return { answer: data.answer || '', error: data.error };
    } catch (err: any) {
      return { answer: '', error: err.message || 'Falha ao consultar a IA.' };
    }
  };

  // Uma linha da lista de conversas — usada tanto na lista principal quanto
  // na seção "Arquivadas" colapsável, pra não duplicar o JSX.
  const renderLeadRow = (lead: PanelLead) => {
    const isMenuOpen = openMenuForLeadId === lead.id;
    return (
      <LeadListRow
        key={lead.id}
        lead={lead}
        isSelected={lead.id === activeLeadId}
        isFlashing={flashLeadIds.has(lead.id)}
        unreadCount={getUnreadCount(lead)}
        isMenuOpen={isMenuOpen}
        onSelect={() => handleSelectLead(lead)}
        onToggleMenu={() => setOpenMenuForLeadId(isMenuOpen ? null : lead.id)}
        onCloseMenu={() => setOpenMenuForLeadId(null)}
        onRename={() => handleRenameLead(lead.id, lead.name)}
        onToggleAiBlocked={() => handleUpdateConversationState(lead.id, { aiBlocked: !lead.aiBlockedAt })}
        onTogglePinned={() => handleUpdateConversationState(lead.id, { pinned: !lead.pinnedAt })}
        onToggleManuallyUnread={() => handleUpdateConversationState(lead.id, { unread: !lead.manuallyUnread })}
        onToggleMuted={() => handleUpdateConversationState(lead.id, { muted: !lead.muted })}
        onToggleArchived={() => handleUpdateConversationState(lead.id, { archived: !lead.archivedAt })}
        onDelete={() => handleDeleteConversation(lead.id, lead.name)}
      />
    );
  };

  // Achado real, 29/08/2026 (pedido do dono do produto): no mobile, abrir
  // "Ferramentas" (aba inferior) empurrava a lista de conversas inteira pra
  // baixo — o painel entrava no fluxo normal do documento, dentro do
  // Controls Bar. Conteúdo extraído numa variável pra ser reaproveitado sem
  // duplicar JSX à mão: no desktop continua inline (ver `hidden sm:flex`
  // logo abaixo, mesmo lugar de sempre); no mobile vira uma gaveta que sobe
  // por cima da tela, mesmo padrão já usado pela Ficha IA
  // (`atendimento-analysis-drawer`, mais abaixo).
  // Achado real, 29/08/2026 (pedido do dono do produto, print com o painel
  // de Ferramentas aberto): "Apenas Anúncios"/"Gatilhos" e o botão "Agenda"
  // (que já existe como ícone próprio na barra inferior) só ocupavam espaço
  // aqui repetindo controles que já existem em outro lugar mais óbvio —
  // movidos pra dentro da faixa "Status do agente" (os dois primeiros) e
  // removida a duplicata do botão Agenda (o ícone da barra inferior já cobre
  // exatamente a mesma ação em qualquer largura de tela).
  const toolbarSettingsBody = (
    <>
      {/* Reconectar WhatsApp mudou de lugar (pedido real, 29/08/2026):
          "pode ficar nas configurações do tenant quando admin" — morava
          aqui, dentro de Ferramentas; agora vive na Base de Conhecimento
          (`AgentKnowledgeBase.tsx`), que já é a tela de configuração
          operacional do tenant vista por admins. Componente extraído pra
          `ReconectarWhatsAppQrCode.tsx` (arquivo próprio) pra ser
          reaproveitado lá sem duplicar a lógica de QR Code/polling. */}

      {/* Desconectar Calendar mudou de lugar DE NOVO (TASK-0263, pedido
          direto): morou aqui dentro de Ferramentas, depois dentro do popup
          "Agenda" (UpcomingEventsPanel) — mas é uma ação rara de
          configuração, não de uso diário, e não fazia sentido inflar o
          cabeçalho desse popup. Mora agora na aba Agenda de verdade (menu
          principal, `AgendaWorkspace.tsx`/`GoogleCalendarConnectionControl.tsx`),
          junto de outras configurações raras. */}

      {/* Auto IA mudou de lugar (pedido real, 29/08/2026): "pode ir para
          ficha de ia" — é uma configuração de análise automática da
          conversa, faz mais sentido perto da Ficha IA (ConversationAnalysisPanel)
          do que dentro de um painel genérico de Ferramentas. Ver o toggle
          dentro do componente, tanto na coluna de desktop quanto na gaveta
          mobile. */}

      {/* Push notification do PWA do atendente (issue #159) — pra não
          depender só de estar olhando o painel pra perceber escalação
          nova ou agente pausado com lead sem resposta. */}
      <button
        onClick={handleTogglePush}
        disabled={pushBusy}
        title={pushEnabled ? 'Desativar notificações push neste dispositivo' : 'Ativar notificações push (escalação nova, agente pausado com lead sem resposta)'}
        className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 ${
          pushEnabled
            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 cursor-pointer'
            : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:text-white cursor-pointer'
        }`}
      >
        {pushEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
        <span>{pushBusy ? 'Aguarde...' : pushEnabled ? 'Notificações ativas' : 'Ativar notificações'}</span>
      </button>
    </>
  );

  return (
    // flex flex-col min-h-0 — achado real, 29/08/2026: sem isso, este div
    // (pai direto do .atendimento-chat-shell) tinha altura `auto`
    // (conteúdo), então `h-full`/`flex-1` no chat-shell não tinha nada de
    // concreto pra herdar e caía de volta pro `min-h-[560px]` — a causa
    // raiz real por trás de TODAS as tentativas anteriores (TASK-0150/
    // 0153/0155/0157/0158) de acertar a altura no mobile. Com este div
    // sendo flex-col, o chat-shell (último filho, `flex-1 min-h-0`) passa
    // a ocupar de verdade o espaço que sobra depois da barra de controles
    // acima dele.
    //
    // TASK-0225 (achado real, 03/09/2026): este `max-w-7xl mx-auto` era um
    // teto de largura RESQUÍCIO que a TASK-0222 ("Atendimento borda a
    // borda em desktop") não pegou — ela só zerou o padding/max-width do
    // `.app-main` por fora e a borda/cantos do `.atendimento-chat-shell`,
    // mas este wrapper interno continuava capando a área de conversa em
    // 1280px e centralizando com `mx-auto`. Resultado real reportado pelo
    // dono do produto: em monitor mais largo que isso, o FUNDO da página
    // ia até a borda (TASK-0222 funcionando), mas a conversa em si ficava
    // presa numa "janelinha" de 1280px flutuando no meio de um vão vazio
    // — "a caixa está muito estreita ... e a janela muito pequena".
    // Removido — a área de conversa agora estica de verdade até onde o
    // `.app-main` já permite.
    <div className="atendimento-conversations space-y-4 animate-page-enter flex flex-col flex-1 min-h-0">
      {/* TASK-0225 (pedido direto, 03/09/2026): a barra de ferramentas
          exclusiva de desktop (Pendências/Agenda/Ferramentas, `hidden
          lg:block`, histórico completo nas TASK-0212/0213/0221) foi
          removida — o dono do produto apontou que "Ferramentas" só tinha
          UM item de verdade (o toggle de notificação push) e pediu pra
          excluir a barra inteira. As 3 ações migraram:
          - Pendências (escalonamento) → ícone com badge no `Header.tsx`,
            ao lado do seletor de idioma (sempre visível, qualquer aba,
            não depende de conversa aberta).
          - Agenda (atalho rápido pra ver/conectar Google Calendar) → sem
            substituto próprio; "unificar as agendas" — a aba "Agenda"
            completa que já existe no menu superior do Header cobre a
            necessidade.
          - Ferramentas (toggle "Ativar notificações", `handleTogglePush`)
            → item novo dentro do menu ⋮ do cabeçalho da conversa aberta
            (ver `isHeaderMenuOpen` mais abaixo).
          Mobile/tablet não muda em nada — a `.atendimento-bottom-nav`
          mantém seus próprios ícones de Pendências/Agenda/Ferramentas
          (com a gaveta que reaproveita `toolbarSettingsBody`), intocados. */}

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
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => {
                if (errorRetryAction) {
                  errorRetryAction();
                } else if (selectedLead) {
                  handleAnalyzeConversation(selectedLead);
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] flex items-center gap-1 transition-all cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Tentar Novamente</span>
            </button>
            <button
              onClick={() => { setErrorMsg(null); setErrorRetryAction(undefined); }}
              className="p-1.5 rounded-lg text-amber-400 hover:text-amber-200 hover:bg-amber-500/10 transition-all cursor-pointer"
              title="Dispensar aviso"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
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

      {/* Issue #289 (18/08/2026) — horário reservado pela IA, mas ainda SEM
          evento real na agenda: o evento só é criado quando o comprovante é
          aprovado. Só informativo (nada pra decidir ainda — o card de
          escalonamento só aparece quando um comprovante chega de verdade). */}
      {paymentAppointment?.paymentStatus === 'awaiting_payment' && (
        <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-200 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
          <span>
            <span className="font-bold">Horário reservado, aguardando comprovante: </span>
            {paymentAppointment.summary} em {new Date(paymentAppointment.startIso).toLocaleString('pt-BR')}.
            {paymentAppointment.heldUntil && ` Reserva expira às ${new Date(paymentAppointment.heldUntil).toLocaleString('pt-BR')} se o comprovante não chegar — o evento real na agenda só é criado depois de aprovado.`}
          </span>
        </div>
      )}

      {/* Confirmação de pagamento (issue #82, item 3) — comprovante chegou,
          precisa de uma pessoa real pra confirmar ou rejeitar antes do
          agente poder informar o turno como fechado pro cliente.
          Ação em si mora só no card de escalonamento (kind: 'payment_proof')
          desde a unificação — aqui é só o aviso, com atalho pra decidir. */}
      {paymentAppointment?.paymentStatus === 'pending_verification' && (
        <div className="atendimento-payment-verification p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Comprovante de pagamento aguardando verificação: </span>
              <span>
                {paymentAppointment.summary} em {new Date(paymentAppointment.startIso).toLocaleString('pt-BR')}.
              </span>
              {/* Dica da IA a partir da imagem do comprovante — nunca confirma
                  sozinha, só ajuda a decidir mais rápido (resposta a uma
                  pergunta real do dono do produto: hoje o sistema não olhava
                  o conteúdo da foto, só o contexto). */}
              {paymentAppointment.paymentReceiptHint && (
                <p className="atendimento-payment-verification__hint text-amber-300/80 mt-1 flex items-start gap-1">
                  <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>IA: "{paymentAppointment.paymentReceiptHint}"</span>
                </p>
              )}
            </div>
          </div>
          {onGoToEscalations && (
            <button
              onClick={onGoToEscalations}
              className="atendimento-payment-verification__action px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-[11px] flex items-center gap-1 transition-all cursor-pointer flex-shrink-0"
            >
              <AlertTriangle className="w-3 h-3" />
              <span>Confirmar/rejeitar em Escalonamentos</span>
            </button>
          )}
        </div>
      )}

      {manualAppointmentSuccess && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          Agendamento cadastrado! Já entra no lembrete automático da véspera.
        </div>
      )}
      {statusSuccess && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          Status postado!
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
          baixo de tudo, exigindo rolar a página inteira até ele.
          No mobile a altura vem de `flex-1 min-h-0` — este div é o último
          filho do `.atendimento-conversations` pai (agora `flex flex-col`),
          que por sua vez é filho de `.atendimento-workspace__content`
          (`flex:1` dentro de `.atendimento-workspace`, `height:100%` dentro
          do wrapper com altura real calculada em App.tsx). Depois de QUATRO
          rodadas tentando acertar isso com valores fixos de `dvh`/`%`
          chutados (TASK-0150/0153/0157/0158, cada um sobrando ou faltando
          espaço em telas reais diferentes — a raiz real só foi encontrada
          na TASK-0159: o `.atendimento-conversations` pai não tinha altura
          nem era flex, então nenhum valor de altura no chat-shell tinha o
          que herdar, incluindo o `h-full` da TASK-0158), essa cadeia de
          flexbox elimina o chute de vez: o frame sempre ocupa exatamente o
          que sobrar do chrome visível, sem precisar saber de antemão quanto
          esse chrome mede.

          TASK-0212 (pedido direto, 01/09/2026, achado real): o cálculo fixo
          de `lg` (`lg:h-[calc(100dvh-154px)]`) NÃO "já funcionava" como o
          comentário acima dizia — 154px foi chutado uma vez (commit
          `de470b5`, 23/08) e nunca soube que a shell é IRMÃ de outro
          conteúdo (a caixa de ferramentas logo acima, ~60-70px) dentro do
          MESMO fluxo de documento, nem que o `.app-main` tem padding
          próprio (`lg:p-8` = 32px de cada lado) fora do que "154px" cobria.
          Resultado: a soma de tudo (Header + padding + caixa de ferramentas
          + a própria altura fixa da shell) ultrapassava `100dvh`, gerando
          uma barra de rolagem no documento inteiro — pedido direto pra
          eliminar ("otimizar pra ficar em apenas uma página", comparando
          com o WhatsApp Web, que não rola a página, só painéis internos).
          Trocado `lg:flex-none lg:h-[calc(100dvh-154px)]` por `lg:flex-1
          lg:min-h-0` — a shell agora divide o espaço de verdade com a caixa
          de ferramentas via flexbox (mesma técnica já usada no mobile logo
          acima, só que agora também em `lg`), sem depender de nenhuma
          constante chutada. Precisa de `App.tsx` também não escapar mais
          pra `lg:block lg:h-auto` no wrapper do Atendimento — ver lá.

          TASK-0221 (pedido direto, 03/09/2026): a borda/cantos
          arredondados/sombra que só existiam a partir de `lg`
          (`lg:border lg:rounded-2xl lg:shadow-lg`) davam à shell a cara de
          "cartão flutuante" no meio da tela — exatamente o que o dono do
          produto pediu pra tirar, comparando com o WhatsApp Web (edge to
          edge em qualquer largura). Removidas — a shell fica sempre
          `border-0 rounded-none shadow-none`, igual ao mobile, agora
          também em desktop. */}
      <div className="atendimento-chat-shell relative bg-[#111b21] border-0 rounded-none shadow-none overflow-hidden grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-[560px] lg:min-h-0">

        {/* ========================================== */}
        {/* COLUMN 1: Fila de conversas — 3/12 quando o painel auxiliar está fechado */}
        {/* ========================================== */}
        <div className={`atendimento-queue border-r border-slate-800/35 bg-[#111b21] ${mobileThreadOpen ? 'hidden' : 'flex'} lg:flex flex-col min-h-0 ${
          showRightPanel ? 'lg:col-span-3' : 'lg:col-span-3'
        }`}>
          
          {/* Achado real testando com o Lucas em produção ("muita redundância
              nesta tela"): esse header decorativo repetia o título
              "Atendimento WhatsApp" que já aparece na barra de controles
              logo acima (ícone+nome+empresa), e o ícone "Nova conversa"
              chamava exatamente o mesmo setShowAddLead(true) do botão
              "Novo Lead" também já presente ali — dois caminhos pro mesmo
              lugar, um deles sem rótulo nenhum. "Status" e "Menu" também
              nunca tiveram onClick (violava a própria regra do checklist
              de nunca deixar um ícone parecer clicável sem função real).
              Removido o bloco inteiro — o contexto já está estabelecido
              pela aba ativa + barra de controles, sem perda de informação. */}

          {/* Status do agente (Ativo/Restrito/Pausado) — subiu pro topo da
              coluna, como um cabeçalho fino (pedido direto, 28/08/2026, com
              print comparando com o app real do WhatsApp): antes ficava no
              meio da tela, ao lado da busca; agora é a primeira coisa
              visível, logo abaixo da faixa fina de "Atendimento". */}
          <div className="flex items-center justify-between gap-2 p-2 bg-[#111b21] border-b border-slate-800/30">
            <span className="pl-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">Status do agente</span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Modo "somente anúncios" + Gatilhos — achado real, 29/08/2026
                  (pedido do dono do produto com print): esses dois botões
                  viviam na barra de Ferramentas/Controles, ocupando espaço
                  de sobra numa fileira só de texto. Viraram ícones aqui, na
                  mesma faixa fina de "Status do agente" — mesma família de
                  configuração ("o agente responde a quem?"), sem precisar
                  abrir um painel à parte pra alternar. */}
              <button
                type="button"
                onClick={handleToggleAdsOnly}
                title={
                  adsOnly
                    ? 'Somente anúncios ATIVO — agente só responde contatos vindos de anúncio, silêncio pra contatos pessoais'
                    : 'Ativar modo somente anúncios — agente para de responder contatos pessoais automaticamente'
                }
                className={`rounded-lg p-1.5 transition-all cursor-pointer ${
                  adsOnly ? 'bg-[var(--action)] text-[var(--action-contrast)]' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Filter className="h-3.5 w-3.5" />
              </button>
              {adsOnly && (
                <button
                  type="button"
                  onClick={openAdTriggersModal}
                  title={`Configurar gatilhos de texto do modo "somente anúncios"${adTriggerMessages.length > 0 ? ` (${adTriggerMessages.length})` : ''}`}
                  className="rounded-lg p-1.5 text-slate-400 transition-all hover:bg-slate-800 hover:text-white cursor-pointer"
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
              )}
              {/* Achado real em produção (15/08/2026): enquanto agentStatus
                  ainda é null (GET inicial não confirmou nada) ou falhou de
                  vez, nenhum pill acende — antes disso "Ativo" ficava
                  destacado por padrão mesmo com o backend em outro estado,
                  passando confiança falsa pro operador de que a IA estava
                  respondendo. */}
              <div className="flex items-center gap-0.5 bg-slate-950/55 p-0.5 rounded-lg flex-shrink-0">
                {(['active', 'restricted', 'paused'] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => handleChangeAgentStatus(status)}
                    title={
                      agentStatus === null
                        ? 'Confirmando o status real do agente...'
                        : status === 'active' ? 'Agente responde sempre' :
                          status === 'restricted' ? 'Agente só responde fora do horário comercial' :
                          'Agente pausado — silêncio total'
                    }
                    className={`px-2 py-1 rounded-lg text-[11px] font-semibold capitalize transition-all cursor-pointer ${
                      agentStatus === status
                        ? status === 'paused' ? 'bg-red-500/20 text-red-300' : status === 'restricted' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {status === 'active' ? 'Ativo' : status === 'restricted' ? 'Restrito' : 'Pausado'}
                  </button>
                ))}
                {agentStatusLoadFailed && (
                  <button
                    type="button"
                    onClick={loadAgentStatus}
                    title="Não foi possível confirmar o status real do agente no servidor. Clique para tentar novamente."
                    className="ml-0.5 inline-flex items-center gap-1 rounded-lg border-l border-amber-500/30 px-1.5 py-1 text-[10px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/10"
                  >
                    <AlertCircle className="h-3 w-3" />
                    <span>Erro</span>
                    <span className="sr-only">Status incerto — recarregar</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* WhatsApp Web Search Bar — escala aumentada (pedido real,
              01/09/2026, print comparando lado a lado com o WhatsApp
              Business real): texto e altura ficavam bem menores que o
              campo de busca do app real, mesma proporção do ajuste já
              feito na caixa de digitação da conversa aberta (TASK-0164). */}
          <div className="p-2 bg-[#111b21] border-b border-slate-800/30">
            <div className="relative flex items-center min-w-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
              <input
                type="text"
                placeholder={t('searchConversation')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-7 py-2.5 bg-[#202c33] text-sm text-[#e9edef] placeholder-slate-400 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
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

            {/* WhatsApp Web Filter Tabs — "Quentes"/"Internacional" removidos
                (pedido direto, "eu acho que não funciona"): dependiam de
                lead.fullAnalysis, só preenchido depois de rodar a análise IA
                manual naquele lead específico — como a análise automática
                está desligada por padrão (ver isToolbarSettingsOpen), quase
                nenhum lead tem esse campo populado no dia a dia, então os
                dois filtros davam lista vazia quase sempre. "Tudo"/"Não
                lidos" não dependem de análise nenhuma, continuam confiáveis.
                "Esperando você" removido (pedido direto, 28/08/2026: "eu não
                sei qual a finalidade dele"). */}
            <div className="flex items-center gap-2 mt-2.5 overflow-x-auto pb-1 scrollbar-none text-xs">
              <button
                onClick={() => setActiveTabFilter('all')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  activeTabFilter === 'all'
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'bg-[#202c33] text-slate-300 hover:bg-slate-700'
                }`}
              >
                {t('all')} ({leads.length - archivedLeads.length})
              </button>
              <button
                onClick={() => setActiveTabFilter('unread')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  activeTabFilter === 'unread'
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'bg-[#202c33] text-slate-300 hover:bg-slate-700'
                }`}
              >
                {t('unread')} ({unreadLeadsCount})
              </button>
              <button
                onClick={() => setActiveTabFilter('window_closed')}
                title="Contatos sem mensagem do cliente há mais de 24h — na Meta isso exige modelo aprovado pra reabrir; no Evolution não é uma restrição técnica, mas reengajar aumenta o risco de o número ser sinalizado."
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  activeTabFilter === 'window_closed'
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'bg-[#202c33] text-slate-300 hover:bg-slate-700'
                }`}
              >
                Fora das 24h ({windowClosedLeadsCount})
              </button>

              {/* Status — só aparece pra números conectados via Evolution API
                  (QR Code); na Meta Cloud API oficial nunca funciona, então
                  nem mostra o ícone desabilitado (pedido direto, 18/08/2026:
                  ícone inútil/confuso pra quem tá na Meta). O botão de "Ver
                  Arquivadas" separado foi removido no mesmo pedido — ficou
                  redundante depois que a seção "Arquivadas" passou a
                  aparecer fixa no topo da própria lista quando há alguma
                  conversa arquivada (ver abaixo). */}
              {statusAvailable && (
                <button
                  type="button"
                  onClick={() => setIsStatusModalOpen(true)}
                  title="Postar Status"
                  className="flex-shrink-0 p-1.5 rounded-full bg-[#202c33] text-slate-300 hover:bg-slate-700 hover:text-white transition-all cursor-pointer"
                >
                  <CircleDashed className="w-3.5 h-3.5" />
                </button>
              )}

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
              waitingGroups.map((group) => group.leads.length > 0 && (
                <section key={group.id} aria-label={waitingGroupMeta[group.id].label}>
                  <div className={`px-3 py-2 text-[10px] font-bold tracking-[0.11em] ${waitingGroupMeta[group.id].className}`}>
                    {waitingGroupMeta[group.id].label} · {group.leads.length}
                  </div>
                  {group.leads.map((lead) => renderLeadRow(lead))}
                </section>
              ))
            ) : (
              <div className="p-8 text-center text-xs text-slate-500">
                {t('selectConversation')}
              </div>
            )}
          </div>

          {/* Barra inferior estilo WhatsApp (pedido direto, 28/08/2026, com
              print comparando lado a lado com o app real): Conversas,
              Pendências, Agenda e Ferramentas — substitui os antigos botões
              soltos "Pendências"/"Mais opções" da barra de controles (que
              seguem existindo, mas só no desktop). O slot "Atualizações" do
              WhatsApp real foi propositalmente deixado de fora (pedido
              direto: "não é funcional da forma em que está") — Agenda ocupa
              esse espaço em vez disso. Só no mobile: no desktop as mesmas
              ações já ficam na barra de controles/coluna 3, sem precisar
              duplicar aqui.

              Achado real, 29/08/2026 (pedido do dono do produto com print):
              "Ficha IA não precisa na página de lista de contatos, ela tem
              que ficar dentro da conversa" — removida desta barra (que só
              aparece na lista, nunca com uma conversa já aberta). O acesso
              de verdade continua existindo dentro da conversa, pelo ícone
              (i) no cabeçalho dela (ver mais abaixo, `setMobileAnalysisOpen`),
              que é o lugar que realmente faz sentido — a Ficha IA é sobre UM
              contato específico, não faz sentido abrir sem antes escolher
              qual. */}
          {/* TASK-0213 (achado real, 02/09/2026, print do dono do produto):
              esta barra continuava aparecendo em telas de desktop de verdade
              (≥1024px) junto com a caixa de ferramentas, exatamente a
              duplicação que a TASK-0212 devia ter eliminado. Causa raiz: a
              regra crua `.atendimento-bottom-nav { display: flex }` no
              index.css não está dentro de nenhum `@layer` — no Tailwind v4,
              CSS fora de `@layer` sempre vence sobre utilitários (que vivem
              dentro de `@layer utilities`), não importa a ordem no bundle
              nem a especificidade. `lg:hidden` sozinho nunca teve chance
              contra isso. Mesmo padrão de bug e mesma correção já usada na
              TASK-0159 pro `.atendimento-workspace__header` (`!important`
              via `lg:!hidden`).

              TASK-0216 (pedido direto, 02/09/2026, novo print): ícones
              22px->24px (w-6 h-6), acompanhando o bump de escala do CSS
              (`.atendimento-bottom-nav__item` no index.css) — ainda
              parecia pequena/desproporcional perto do resto da UI. */}
          <nav className="atendimento-bottom-nav lg:!hidden" aria-label="Navegação do Atendimento">
            <button
              type="button"
              onClick={() => { setSearchQuery(''); setActiveTabFilter('all'); }}
              className="atendimento-bottom-nav__item is-active"
            >
              <MessageCircle className="w-6 h-6" />
              <span>Conversas</span>
            </button>
            <button
              type="button"
              onClick={onGoToEscalations}
              disabled={!onGoToEscalations}
              className="atendimento-bottom-nav__item"
            >
              <AlertTriangle className="w-6 h-6" />
              <span>Pendências</span>
              {escalationsPendingCount > 0 && (
                <span className="atendimento-bottom-nav__badge">{escalationsPendingCount}</span>
              )}
            </button>
            <button
              type="button"
              onClick={googleCalendarConnected ? handleOpenUpcomingEvents : handleConnectGoogleCalendar}
              className="atendimento-bottom-nav__item"
            >
              <CalendarIcon className="w-6 h-6" />
              <span>Agenda</span>
            </button>
            <button
              type="button"
              onClick={() => setIsToolbarSettingsOpen((v) => !v)}
              className={`atendimento-bottom-nav__item${isToolbarSettingsOpen ? ' is-active' : ''}`}
            >
              <Settings className="w-6 h-6" />
              <span>Ferramentas</span>
            </button>
          </nav>
        </div>

        {/* ========================================== */}
        {/* COLUMN 2: Conversa principal com rascunho revisável da IA */}
        {/* ========================================== */}
        <div className={`atendimento-thread ${mobileThreadOpen ? 'flex' : 'hidden'} lg:flex flex-col min-h-0 bg-[#0b141a] relative ${
          showRightPanel ? 'lg:col-span-6' : 'lg:col-span-9'
        }`}>
          {selectedLead ? (
            <>
              {/* WhatsApp Web Chat Header */}
              {/* TASK-0184: agora que o padding vertical do .app-main some no
                  mobile (ver index.css), com uma conversa aberta o <Header/>
                  global fica escondido (var(--atendimento-header-h) = 0px) e
                  este cabeçalho de conversa passa a ser o elemento mais alto
                  da tela, colado na borda — mesmo risco real já documentado
                  no Header.tsx (notch/Dynamic Island cobrindo o conteúdo em
                  PWA fullscreen). paddingTop: env(safe-area-inset-top)
                  resolve pra 0 fora desse contexto, sem efeito colateral. */}
              {/* TASK-0185: sem border-b aqui — a fileira de etiquetas logo
                  abaixo virou a mesma cor de fundo (ver comentário lá), então
                  as duas fileiras agora formam um cabeçalho único, sem a
                  emenda visível entre duas cores diferentes que existia
                  antes ("unifica a cor do cabeçalho", pedido direto,
                  01/09/2026). A borda que fechava esse cabeçalho desceu pro
                  final da fileira de etiquetas. */}
              <div className="px-3 py-2.5 bg-[#202c33] flex items-center justify-between gap-2 z-10 shadow-none" style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top))' }}>
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
                    {/* TASK-0187: 4->[18px], escala mais perto do WhatsApp
                        real (mesmo tamanho já usado na barra inferior). */}
                    <ArrowLeft className="w-[18px] h-[18px]" />
                  </button>
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs ring-1 ring-emerald-500/40 flex-shrink-0 ${avatarColorClasses(selectedLead.name || selectedLead.phone)}`}
                  >
                    {getInitials(selectedLead.name || selectedLead.phone)}
                  </div>
                  {/* Telefone saiu daqui (pedido direto, 29/08/2026: "já
                      temos o Nome") — some do cabeçalho pra dar mais espaço
                      pro nome e pra fileira de etiquetas subir logo abaixo.
                      Continua visível no menu ⋮ (link "Abrir no WhatsApp") e
                      na lista de conversas pra quem precisar do número. */}
                  {/* TASK-0185 (pedido direto, 01/09/2026, comparação lado a
                      lado com o WhatsApp Business real): nome numa linha só
                      igual ao real (antes text-xs comprimido junto com o
                      status "online" na mesma linha) — escala mais perto do
                      app de verdade, hierarquia mais clara. */}
                  <div className="min-w-0">
                    {/* TASK-0259 (pedido direto): selo "ao vivo" removido —
                        indicava sessão de teste em tempo real, mas era mais
                        um badge poluindo o cabeçalho sem ação nenhuma
                        associada, e o usuário confirmou que não precisa. */}
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-[#e9edef] truncate">{selectedLead.name}</h3>
                    </div>
                    <p className="text-[11px] font-normal text-slate-400 flex items-center gap-1.5 min-w-0">
                      {/* TASK-0259 (pedido direto): telefone saiu daqui de
                          vez — fica só dentro da Ficha do Contato (Ficha
                          IA), que já recebe `selectedLead.phone` como prop.
                          Contador de mensagens continua, é útil no
                          cabeçalho e não é dado sensível. */}
                      <span className="truncate min-w-0">{selectedLead.messages?.length || 0} mensagens</span>
                      {/* TASK-0258 (pedido direto): quando a janela de 24h
                          está aberta e não há nenhuma ação pendente, a faixa
                          de status inteira (linha cheia, sempre visível)
                          virou este badge pequeno. Quando a janela FECHA (aí
                          sim há ação: reengajar/reabrir), o card cheio com
                          botão continua aparecendo igual a antes, na área do
                          composer mais abaixo. */}
                      {(() => {
                        const serviceWindow = visibleContactContext?.serviceWindow;
                        const isWindowOpen = serviceWindow ? serviceWindow.withinWindow : true;
                        if (!isWindowOpen) return null;
                        const hoursRemaining = serviceWindow?.hoursRemaining ?? 24;
                        return (
                          <span
                            className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-700/50 px-1.5 py-0.5 rounded-full"
                            title={isSpanish
                              ? `El agente puede responder normalmente. La ventana cierra ${hoursRemaining}h después de ahora, si el cliente no vuelve a escribir.`
                              : `O agente pode responder normalmente. A janela fecha ${hoursRemaining}h depois de agora, se o cliente não escrever de novo.`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            {hoursRemaining}h
                          </span>
                        );
                      })()}
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

                  {/* Botão "Analisar IA" removido daqui — duplicava exatamente
                      a mesma ação do botão "Analisar Conversa Completa" no
                      painel de Análise IA (mesmo handleAnalyzeConversation),
                      só que mais visível/fácil de clicar sem querer. Um
                      único controle de análise sob demanda evita gasto de
                      token duplicado por engano. */}

                  {/* Cadastrar agendamento manual (issue #182, agendamento
                      fechado fora da IA — WhatsApp pessoal, telefone,
                      presencial). Morava numa barra sempre visível acima da
                      lista de conversas (achado real: ficava redundante ao
                      lado do widget de Agenda) — junta com as outras ações
                      da conversa aberta aqui no cabeçalho. Só aparece quando
                      este contato ainda não tem nenhum agendamento
                      rastreado, senão a checagem do backend recusaria com
                      409 (o operador já vê o card do agendamento ativo). */}
                  {(selectedLead as any)?.isReal && !paymentAppointment && (
                    <button
                      onClick={() => setIsManualAppointmentModalOpen(true)}
                      className="hidden lg:flex p-2 hover:bg-[#2a3942] rounded-lg text-slate-300 transition-colors cursor-pointer"
                      title="Cadastrar agendamento manual (combinado fora do WhatsApp)"
                    >
                      <CalendarPlus className="w-[18px] h-[18px]" />
                    </button>
                  )}

                  {/* Gerar Contrato (pedido real, 15/08/2026) — modelo fixo
                      da Clic Piscinas, ver CLIC_PISCINAS_TENANT_ID acima. */}
                  {(selectedLead as any)?.isReal && activeTenant?.id === CLIC_PISCINAS_TENANT_ID && (
                    <button
                      onClick={() => setIsContractModalOpen(true)}
                      className="hidden lg:flex p-2 hover:bg-[#2a3942] rounded-lg text-slate-300 transition-colors cursor-pointer"
                      title="Gerar contrato"
                    >
                      <FileText className="w-[18px] h-[18px]" />
                    </button>
                  )}

                  {/* Ficha IA — só no mobile, onde a coluna 3 fica hidden (ver
                      PR #70). Único acesso à Ficha IA no mobile desde que a
                      TASK-0167 removeu o item redundante da barra inferior
                      (só fazia sentido dentro de uma conversa já aberta,
                      nunca na lista). Ícone trocado de `Info` genérico pra
                      `IdCard` — mesmo critério da TASK-0164 (representa uma
                      ficha de verdade). */}
                  <button
                    onClick={() => setMobileAnalysisOpen(true)}
                    className="atendimento-analysis-trigger lg:hidden p-2 hover:bg-[#2a3942] rounded-lg text-slate-300 transition-colors cursor-pointer"
                    title="Ver Ficha IA"
                  >
                    <IdCard className="w-[18px] h-[18px]" />
                  </button>

                  {/* Transferir pro WhatsApp pessoal do operador — abre um
                      link wa.me com o telefone deste lead numa aba nova, pro
                      operador continuar a conversa pelo próprio WhatsApp em
                      vez do painel. Só abre o link (client-side); nenhuma
                      mensagem automática é enviada nem nada é gravado no
                      backend. */}
                  <button
                    onClick={() => window.open(`https://wa.me/${selectedLead.phone.replace(/\D/g, '')}`, '_blank', 'noopener,noreferrer')}
                    className="hidden lg:flex p-2 hover:bg-[#2a3942] rounded-lg text-slate-300 transition-colors cursor-pointer"
                    title="Transferir pro WhatsApp pessoal do operador"
                  >
                    <Phone className="w-[18px] h-[18px]" />
                  </button>

                  {/* TASK-0212 (pedido direto, 01/09/2026, print comparando
                      com o WhatsApp Web): a Ficha IA só faz sentido com uma
                      conversa aberta, mas o botão "Abrir ficha" vivia numa
                      barra de ferramentas genérica, sempre visível mesmo
                      sem nenhum lead selecionado. Mudou pra cá, junto dos
                      outros ícones que já são exclusivos da conversa aberta
                      — mesma posição no mobile (IdCard) e no desktop agora,
                      em vez de dois lugares diferentes pra abrir a mesma
                      coisa. */}
                  <button
                    onClick={() => setShowRightPanel(!showRightPanel)}
                    className={`hidden lg:flex p-2 rounded-lg transition-colors cursor-pointer ${showRightPanel ? 'text-emerald-400 bg-[#2a3942]' : 'text-slate-300 hover:bg-[#2a3942]'}`}
                    title={showRightPanel ? 'Fechar Ficha IA' : 'Abrir Ficha IA'}
                  >
                    {showRightPanel ? <PanelRightClose className="w-[18px] h-[18px]" /> : <PanelRightOpen className="w-[18px] h-[18px]" />}
                  </button>

                  {/* TASK-0259 (pedido direto): a barra de etiquetas sempre
                      visível (fileira inteira só pra isso) virou este ícone,
                      ao lado da Ficha IA — "sobe o icon de etiqueta pro lado
                      do icon da ficha de ia... eliminamos mais uma barra".
                      Um botão pra mobile (junto do IdCard) e outro pra
                      desktop (junto do PanelRightOpen acima) — cada um só
                      aparece no seu breakpoint, mas os dois abrem o mesmo
                      popover, com as etiquetas já aplicadas (removíveis),
                      sugestões e criar nova — mesmo conteúdo/lógica de
                      antes, só que sob demanda em vez de sempre visível. Um
                      ponto verde no ícone avisa que já tem etiqueta aplicada
                      mesmo com o popover fechado. */}
                  <div className="relative">
                    {[true, false].map((isMobileVariant) => (
                      <button
                        key={isMobileVariant ? 'mobile' : 'desktop'}
                        onClick={() => { setIsLabelPickerOpen((v) => !v); setNewLabelInput(''); }}
                        className={`${isMobileVariant ? 'lg:hidden' : 'hidden lg:flex'} relative p-2 hover:bg-[#2a3942] rounded-lg text-slate-300 transition-colors cursor-pointer`}
                        title={isSpanish ? 'Etiquetas' : 'Etiquetas'}
                      >
                        <Tag className="w-[18px] h-[18px]" />
                        {(selectedLead.conversationLabels || []).length > 0 && (
                          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        )}
                      </button>
                    ))}
                    {isLabelPickerOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsLabelPickerOpen(false)} />
                        <div className="absolute right-0 top-10 z-50 w-72 bg-[#233138] border border-slate-700 rounded-xl shadow-2xl p-3 space-y-2 origin-top-right animate-pop-in">
                          {(selectedLead.conversationLabels || []).length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pb-2 border-b border-slate-700">
                              {(selectedLead.conversationLabels || []).map((label) => (
                                <span
                                  key={label}
                                  className="text-[10px] px-2 py-0.5 rounded-full border border-slate-600 bg-slate-800/70 text-slate-200 flex items-center gap-1"
                                >
                                  {label}
                                  <button
                                    onClick={() => handleRemoveLabel(selectedLead.id, label)}
                                    className="hover:opacity-70 cursor-pointer"
                                    title={isSpanish ? 'Quitar etiqueta' : 'Remover etiqueta'}
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}

                          {(() => {
                            const alreadyOn = new Set((selectedLead.conversationLabels || []).map((l) => normalizeLabelText(l)));
                            const suggestions = Array.from(new Set([...tenantLabelSuggestions, ...BEAUTY_STUDIO_LABEL_SUGGESTIONS]))
                              .filter((l) => !alreadyOn.has(normalizeLabelText(l)) && !dismissedDefaultSuggestions.has(normalizeLabelText(l)));
                            if (!suggestions.length) return null;
                            return (
                              <div className="flex flex-wrap gap-1.5 pb-2 border-b border-slate-700">
                                {suggestions.map((l) => (
                                  <span
                                    key={l}
                                    className="text-[10px] px-2 py-0.5 rounded-full border border-dashed border-slate-600 text-slate-400 flex items-center gap-1"
                                  >
                                    <button
                                      onClick={() => { handleAddLabel(selectedLead.id, l); setIsLabelPickerOpen(false); }}
                                      className="hover:text-white cursor-pointer"
                                      title={isSpanish ? 'Agregar etiqueta' : 'Adicionar etiqueta'}
                                    >
                                      + {l}
                                    </button>
                                    <button
                                      onClick={async () => {
                                        if (!window.confirm(isSpanish
                                          ? `¿Eliminar la etiqueta "${l}" del catálogo de la empresa? Afecta a todas las conversaciones.`
                                          : `Excluir a etiqueta "${l}" do catálogo da empresa? Afeta todas as conversas.`)) return;
                                        try {
                                          await handleDeleteLabelCatalog(l);
                                        } catch (err: any) {
                                          setErrorMsg(err?.message || (isSpanish ? 'No fue posible eliminar la etiqueta.' : 'Não foi possível excluir a etiqueta.'));
                                        }
                                      }}
                                      className="hover:text-rose-300 cursor-pointer"
                                      title={isSpanish ? 'Eliminar del catálogo' : 'Excluir do catálogo'}
                                    >
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            );
                          })()}

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
                              placeholder={isSpanish ? 'Nueva etiqueta...' : 'Nova etiqueta...'}
                              autoFocus
                              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                            />
                            <button
                              type="submit"
                              className="p-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 rounded-lg cursor-pointer flex-shrink-0"
                              title={isSpanish ? 'Agregar' : 'Adicionar'}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </form>

                          <button
                            type="button"
                            onClick={() => { setIsLabelPickerOpen(false); openLabelManager(); }}
                            className="w-full flex items-center justify-center gap-1.5 text-[10px] text-slate-400 hover:text-white pt-2 mt-1 border-t border-slate-700 cursor-pointer"
                          >
                            <Settings className="w-3 h-3" />
                            {isSpanish ? 'Gestionar etiquetas' : 'Gerenciar etiquetas'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Achado ao vivo: as ações da conversa (bloquear IA pra
                      esse lead, fixar, marcar não lida, silenciar, arquivar)
                      só existiam no menu ⋮ de cada linha na LISTA — abrindo a
                      conversa não dava pra fazer nada disso sem voltar pra
                      lista e achar a linha de novo. Mesmas ações de
                      handleUpdateConversationState do menu da lista, mas com
                      estado PRÓPRIO (isHeaderMenuOpen) — reusar
                      openMenuForLeadId aqui causava um bug real: quando a
                      conversa aberta também aparece na lista, os dois menus
                      ⋮ (linha e cabeçalho) checavam a mesma condição pro
                      mesmo id, então abrir um entrelaçava os dois "Excluir". */}
                  <div className="relative">
                    <button
                      onClick={() => setIsHeaderMenuOpen((open) => !open)}
                      className="p-2 hover:bg-[#2a3942] rounded-lg text-slate-300 transition-colors cursor-pointer"
                      title={t('moreOptions')}
                    >
                      <MoreVertical className="w-[18px] h-[18px]" />
                    </button>
                    {isHeaderMenuOpen && (() => {
                      const isAiBlocked = !!(selectedLead as any).aiBlockedAt;
                      const isPinned = !!(selectedLead as any).pinnedAt;
                      const isManuallyUnread = !!(selectedLead as any).manuallyUnread;
                      const isMuted = !!(selectedLead as any).muted;
                      const isArchived = !!(selectedLead as any).archivedAt;
                      const isAdLead = !!(selectedLead as any).adGreetingMatchedAt;
                      return (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setIsHeaderMenuOpen(false)} />
                          <div className="mobile-header-context-menu absolute right-0 top-10 z-50 w-52 bg-[#233138] border border-slate-700 rounded-xl shadow-2xl overflow-hidden text-xs origin-top-right animate-pop-in">
                            {(selectedLead as any)?.isReal && !paymentAppointment && (
                              <button
                                onClick={() => { setIsHeaderMenuOpen(false); setIsManualAppointmentModalOpen(true); }}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                                title="Cadastrar agendamento manual combinado fora do WhatsApp"
                              >
                                <CalendarPlus className="w-3.5 h-3.5" />
                                <span>Cadastrar agendamento</span>
                              </button>
                            )}
                            {(selectedLead as any)?.isReal && activeTenant?.id === CLIC_PISCINAS_TENANT_ID && (
                              <button
                                onClick={() => { setIsHeaderMenuOpen(false); setIsContractModalOpen(true); }}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                                title="Gerar contrato"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                <span>Gerar contrato</span>
                              </button>
                            )}
                            <button
                              onClick={() => { setIsHeaderMenuOpen(false); window.open(`https://wa.me/${selectedLead.phone.replace(/\D/g, '')}`, '_blank', 'noopener,noreferrer'); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                              title="Continuar no WhatsApp pessoal do operador"
                            >
                              <Phone className="w-3.5 h-3.5" />
                              <span>Abrir no WhatsApp</span>
                            </button>
                            {/* TASK-0225: "Ativar notificações" (push do PWA
                                do atendente, issue #159) mudou de casa — vinha
                                da barra de ferramentas exclusiva de desktop
                                que foi removida (só tinha esse item). Mesma
                                lógica (`handleTogglePush`/`pushEnabled`/
                                `pushBusy`), agora dentro deste menu — que já é
                                visível em qualquer largura (sem `hidden
                                lg:*`), então funciona igual em mobile e
                                desktop. */}
                            <button
                              onClick={() => { void handleTogglePush(); setIsHeaderMenuOpen(false); }}
                              disabled={pushBusy}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer disabled:opacity-50"
                              title={pushEnabled ? 'Desativar notificações push neste dispositivo' : 'Ativar notificações push (escalação nova, agente pausado com lead sem resposta)'}
                            >
                              {pushEnabled ? <Bell className="w-3.5 h-3.5 text-emerald-300" /> : <BellOff className="w-3.5 h-3.5" />}
                              <span>{pushBusy ? 'Aguarde...' : pushEnabled ? 'Notificações ativas' : 'Ativar notificações'}</span>
                            </button>
                            <div className="border-t border-slate-700" />
                            <button
                              onClick={() => { handleUpdateConversationState(selectedLead.id, { aiBlocked: !isAiBlocked }); setIsHeaderMenuOpen(false); }}
                              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-slate-700/60 transition-colors cursor-pointer ${isAiBlocked ? 'text-emerald-300' : 'text-rose-300'}`}
                              title="A IA para de responder automaticamente só pra esse número (manual ou automático, ex: falha de agenda) — o resto do atendimento continua normal"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              <span>{isAiBlocked ? (isSpanish ? 'Reactivar IA para este lead' : 'Reativar IA para este lead') : (isSpanish ? 'Bloquear IA para este lead' : 'Bloquear IA para este lead')}</span>
                            </button>
                            {!isAiBlocked && (
                              <button
                                onClick={() => { handleUpdateConversationState(selectedLead.id, { releaseAiNow: true }); setIsHeaderMenuOpen(false); }}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                                title="Achado real (01/09/2026): depois de responder manualmente, a IA fica em pausa por 5min pra não cruzar com sua resposta — cada mensagem manual sua renova essa pausa. Use isto pra devolver o controle pra IA agora, sem esperar os 5min."
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>{isSpanish ? 'Devolver la IA ahora' : 'Devolver a IA agora'}</span>
                              </button>
                            )}
                            {!isAdLead && (
                              <button
                                onClick={async () => {
                                  setIsHeaderMenuOpen(false);
                                  const activated = await handleUpdateConversationState(selectedLead.id, { adLead: true });
                                  if (activated) await handleAnalyzeConversation(selectedLead, { draftAfterAnalysis: true });
                                }}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-amber-300 hover:bg-slate-700/60 transition-colors cursor-pointer"
                                title='Libera a IA para as próximas mensagens deste lead e lê o histórico completo para preparar um rascunho contextual no compositor. O rascunho nunca é enviado sem revisão humana.'
                              >
                                <Megaphone className="w-3.5 h-3.5" />
                                <span>{isSpanish ? 'Activar IA y preparar borrador' : 'Ativar IA e preparar rascunho'}</span>
                              </button>
                            )}
                            <div className="border-t border-slate-700" />
                            <button
                              onClick={() => openOperatorFeedback('operator_idea')}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-amber-300 hover:bg-slate-700/60 transition-colors cursor-pointer"
                              title="Enviar uma melhoria contextual para a Central de Qualidade"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>{isSpanish ? 'Sugerir mejora' : 'Sugerir melhoria'}</span>
                            </button>
                            <button
                              onClick={() => openOperatorFeedback('bug')}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-rose-300 hover:bg-slate-700/60 transition-colors cursor-pointer"
                              title="Registrar um comportamento inesperado nesta conversa"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>{isSpanish ? 'Reportar bug' : 'Reportar bug'}</span>
                            </button>
                            <div className="border-t border-slate-700" />
                            <button
                              onClick={() => { handleUpdateConversationState(selectedLead.id, { pinned: !isPinned }); setIsHeaderMenuOpen(false); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                            >
                              {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                              <span>{isPinned ? (isSpanish ? 'Desfijar conversación' : 'Desafixar conversa') : (isSpanish ? 'Fijar conversación' : 'Fixar conversa')}</span>
                            </button>
                            <button
                              onClick={() => { handleUpdateConversationState(selectedLead.id, { unread: !isManuallyUnread }); setIsHeaderMenuOpen(false); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              <span>{isManuallyUnread ? (isSpanish ? 'Marcar como leída' : 'Marcar como lida') : (isSpanish ? 'Marcar como no leída' : 'Marcar como não lida')}</span>
                            </button>
                            <button
                              onClick={() => { handleUpdateConversationState(selectedLead.id, { muted: !isMuted }); setIsHeaderMenuOpen(false); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                            >
                              {isMuted ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
                              <span>{isMuted ? (isSpanish ? 'Activar notificaciones' : 'Ativar notificações') : (isSpanish ? 'Silenciar notificaciones' : 'Silenciar notificações')}</span>
                            </button>
                            <button
                              onClick={() => { handleUpdateConversationState(selectedLead.id, { archived: !isArchived }); setIsHeaderMenuOpen(false); setMobileThreadOpen(false); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                            >
                              {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                              <span>{isArchived ? (isSpanish ? 'Desarchivar conversación' : 'Desarquivar conversa') : (isSpanish ? 'Archivar conversación' : 'Arquivar conversa')}</span>
                            </button>
                            <div className="border-t border-slate-700" />
                            <button
                              onClick={() => { handleClearChatMessages(selectedLead.id); setIsHeaderMenuOpen(false); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                              title="Apaga as mensagens desta conversa, mantendo o contato"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>{isSpanish ? 'Limpiar historial de mensajes' : 'Limpar histórico de mensagens'}</span>
                            </button>
                            <button
                              onClick={() => { setIsHeaderMenuOpen(false); handleDeleteConversation(selectedLead.id, selectedLead.name); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-rose-300 hover:bg-rose-950/60 transition-colors cursor-pointer"
                              title="Exclui a conversa e o contato permanentemente"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>{isSpanish ? 'Eliminar conversación permanentemente' : 'Excluir conversa permanentemente'}</span>
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* TASK-0187 (pedido direto, 01/09/2026): alerta PERSISTENTE de
                  escalonamento aberto dentro da própria conversa — o único
                  sinal que existia (aiReplyStatusByPhone via SSE) some
                  sozinho depois de 9s mesmo sem ninguém ter visto, achado
                  real relatado: "às vezes o revisor trava a conversa ou tem
                  um escalonamento e eu não consigo perceber". Fica visível
                  até o escalonamento ser resolvido de verdade (não some
                  sozinho, não tem botão de fechar — é sinal de segurança,
                  não decoração). blockedDraft (quando existe) é o rascunho
                  real que o revisor pré-envio recusou mandar. TASK-0259
                  (pedido direto): cor volta pra âmbar/laranja (era rose) e
                  fonte/padding menores — mesma prioridade visual de antes,
                  só menos pesado na tela. */}
              {(selectedLead as any)?.isReal && (() => {
                const activeEscalation = escalations.find(
                  (e) => e.phone === selectedLead.phone && e.status !== 'resolved' && e.status !== 'archived' && !e.resolved,
                );
                if (!activeEscalation) return null;
                return (
                  <div className="bg-amber-950/40 border-b border-amber-800/40 px-3 py-1.5 flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-300 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold text-amber-200">
                        {activeEscalation.blockedDraft
                          ? (isSpanish ? 'El revisor bloqueó una respuesta automática' : 'O revisor bloqueou uma resposta automática')
                          : (isSpanish ? 'Conversación escalada para un humano' : 'Conversa escalada para humano')}
                      </p>
                      <p className="text-[10px] text-amber-300/90 truncate">{activeEscalation.reason}</p>
                    </div>
                    {onGoToEscalations && (
                      <button
                        type="button"
                        onClick={onGoToEscalations}
                        className="shrink-0 rounded-lg border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-bold text-amber-200 hover:bg-amber-500/10 transition-colors cursor-pointer"
                      >
                        {isSpanish ? 'Ver escalamiento' : 'Ver escalonamento'}
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Contexto compactado acompanha a conversa real. A ficha completa
                  continua opcional e apenas informa o operador: nunca autoriza
                  confirmação de agenda, pagamento ou qualquer exceção. */}
              {(selectedLead as any)?.isReal && (() => {
                const contextSignature = selectedLead.phone && visibleContactContext
                  ? `${selectedLead.phone}:${visibleContactContext.memory?.updatedAt || ''}:${visibleContactContext.latestDecision?.createdAt || ''}`
                  : null;
                if (contextSignature && contextSignature === dismissedContextSignature) return null;
                return (
                  <ContactContextPanel
                    context={visibleContactContext}
                    isLoading={isContactContextLoading}
                    isSpanish={isSpanish}
                    variant="compact"
                    onRetry={() => void refreshContactContext()}
                    onOpenDetails={() => {
                      if (window.innerWidth >= 1024) setShowRightPanel(true);
                      else setMobileAnalysisOpen(true);
                    }}
                    onDismiss={contextSignature ? () => setDismissedContextSignature(contextSignature) : undefined}
                  />
                );
              })()}

              {/* Real-time Analyzing Banner */}
              {isAnalyzingConversation && (
                <div className="bg-emerald-950/90 border-b border-emerald-500/40 px-3 py-1.5 text-center text-[11px] font-semibold text-emerald-300 flex items-center justify-center space-x-2 animate-pulse z-10">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  <span>{isSpanish ? 'Gemini está analizando el contexto y el idioma de la conversación en tiempo real...' : 'Gemini analisando contexto da conversa e idioma em tempo real...'}</span>
                </div>
              )}

              {/* WhatsApp Messages Scroll Body */}
              <div className="relative flex-1 min-h-0">
              <div
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
                className="h-full min-h-0 p-4 overflow-y-auto space-y-3 bg-[#0b141a] bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] scrollbar-thin"
              >
                
                {/* A saudação exibida pelo WhatsApp no clique do anúncio é uma
                    camada nativa do anúncio e não chega como uma mensagem
                    comum em `messages[]`. Mostramos a atribuição aqui sem
                    inventar uma bolha enviada pelo agente. `adHeadline` é
                    referral real; `adGreetingMatchedAt` também pode vir de
                    gatilho textual ou marcação manual do operador. */}
                {/* Achado real, 29/08/2026 (pedido do dono do produto com print):
                    "banner de lead muito grande" — no celular real, esse aviso
                    ocupava boa parte da primeira tela do chat. Compactado
                    (padding/ícone/fonte menores, entrelinha mais justa) sem
                    tirar nenhuma informação. */}
                {(selectedLead.adHeadline || selectedLead.adGreetingMatchedAt) && (
                  <div className="mx-auto w-full max-w-md rounded-lg border border-amber-500/25 bg-amber-950/20 px-2.5 py-2 shadow-sm">
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 rounded-md bg-amber-400/10 p-1 text-amber-300">
                        <Megaphone className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-amber-300">
                          {selectedLead.adHeadline ? 'Anúncio do Facebook' : 'Lead marcado como anúncio'}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-300">
                          {selectedLead.adHeadline
                            ? <>Esta conversa veio do anúncio <span className="font-semibold text-amber-100">“{selectedLead.adHeadline}”</span>.</>
                            : 'Esta conversa foi identificada como lead de anúncio por um gatilho ou por uma marcação do operador.'}
                        </p>
                        <p className="mt-1 text-[9px] text-slate-500">Origem da conversa · não é uma mensagem enviada pelo agente</p>
                      </div>
                    </div>
                  </div>
                )}

                {(selectedLead as any).historyLoading ? (
                  <div className="flex min-h-32 items-center justify-center text-xs text-slate-500">
                    {isSpanish ? 'Cargando el historial completo de esta conversación...' : 'Carregando histórico completo desta conversa...'}
                  </div>
                ) : selectedLead.messages && selectedLead.messages.length > 0 ? (
                  selectedLead.messages.map((msg, messageIndex) => {
                    const previousMessage = messageIndex > 0 ? selectedLead.messages?.[messageIndex - 1] : undefined;
                    const shouldShowDateSeparator = messageIndex === 0
                      || isNewChatDateGroup(msg.timestamp, previousMessage?.timestamp);
                    const dateLabel = formatChatDateLabel(msg.timestamp, isSpanish);
                    const isLead = msg.sender === 'lead';
                    const quotedMessage = msg.replyToMessageId
                      ? selectedLead.messages?.find((m) => m.id === msg.replyToMessageId)
                      : undefined;
                    // Design dos balões alinhado ao WhatsApp real (pedido direto,
                    // print de referência, 15/08/2026): antes disso o horário+check
                    // sempre ocupava uma linha própria com risco divisório em cima
                    // (mesmo numa mensagem de uma palavra só) e a imagem tinha uma
                    // margem visível dentro do balão em vez de tocar as bordas — o
                    // WhatsApp real flutua o horário ao final do último texto e deixa
                    // a foto rente às bordas do balão. hasHeaderContent decide se o
                    // bloco de mídia/texto precisa de um respiro no topo (quando não
                    // tem tag/encaminhada/citação acima) ou se a imagem pode tocar o
                    // canto arredondado do balão direto.
                    // Áudio e vídeo já mostram check de entrega dentro do próprio
                    // player/card — a borda colorida do balão (azul/verde) era
                    // redundante ali (pedido direto, 24/08/2026, print de referência).
                    // Esses dois tipos usam o mesmo cinza neutro do balão recebido, e
                    // o rótulo IA/Operador migra pra dentro do cartão cinza (bem
                    // pequeno) em vez do cabeçalho grande no topo do balão colorido.
                    const isVideoFile = msg.type === 'file' && !!msg.text?.trimStart().startsWith('🎥');
                    const isMediaBubble = !isLead && (msg.type === 'audio' || isVideoFile);
                    const hasSenderLabel = !isLead && !!msg.sentBy && !isMediaBubble;
                    const hasHeaderContent = hasSenderLabel || !!msg.forwardedFromMessageId || !!quotedMessage;
                    const mediaSenderLabel = !isLead && msg.sentBy && (
                      <div className="flex items-center gap-1 text-[8px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
                        {msg.sentBy === 'ai' ? <Bot className="w-2.5 h-2.5" /> : <UserCheck className="w-2.5 h-2.5" />}
                        {msg.sentBy === 'ai' ? 'IA' : 'Operador'}
                      </div>
                    );
                    // Horário + check de entrega — flutua à direita do último texto
                    // do balão (mesmo truque de CSS que o WhatsApp usa: float-right
                    // com margem, o texto quebra em volta dele) em vez de uma linha
                    // inteira só pra isso.
                    const timeFooter = (
                      <span
                        className={`float-right ml-2 mt-0.5 inline-flex items-center gap-1 text-[9px] whitespace-nowrap select-none ${
                          isLead ? 'text-slate-400' : msg.sentBy === 'operator' ? 'text-slate-300' : 'text-emerald-200'
                        }`}
                      >
                        {msg.sentBy === 'operator' && (
                          <span className="font-extrabold tracking-wider text-slate-300 mr-1 uppercase">
                            ESCRITA POR VOCÊ
                          </span>
                        )}
                        {msg.timestamp}
                        {!isLead && (msg.sendFailed ? (
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                        ) : (
                          <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
                        ))}
                      </span>
                    );
                    return (
                      <React.Fragment key={msg.id}>
                        {shouldShowDateSeparator && dateLabel && (
                          <div className="flex justify-center py-1" role="separator" aria-label={dateLabel}>
                            <span className="rounded-full bg-[#202c33]/90 px-3 py-1 text-[10px] font-semibold text-slate-400 backdrop-blur-sm">
                              {dateLabel}
                            </span>
                          </div>
                        )}
                        <div
                          id={`msg-anchor-${msg.id}`}
                          className={`group relative flex flex-col ${isLead ? 'items-start' : 'items-end'}`}
                        >
                        {/* Menu de ações da mensagem — gatilho único "⋮" que abre um
                            menu discreto (Responder/Copiar/Encaminhar/Reagir/
                            Apagar), igual ao menu nativo do WhatsApp (print de
                            referência) e ao mesmo padrão visual já usado no menu ⋮ do
                            cabeçalho da conversa (isHeaderMenuOpen). Substitui a barra
                            de ícones sempre visível no hover + o botão de apagar solto
                            no rodapé do balão — dois caminhos concorrendo pelo mesmo
                            espaço visual pra ações que cabem num só menu. */}
                        <div className={`absolute -top-6 ${isLead ? 'left-0' : 'right-0'} z-10`}>
                          <button
                            type="button"
                            onClick={() => setOpenMessageMenuFor(openMessageMenuFor === msg.id ? null : msg.id)}
                            className={`p-1 rounded-full bg-[#233138] border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 shadow-lg transition-opacity cursor-pointer ${
                              openMessageMenuFor === msg.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                            }`}
                            title={t('moreOptions')}
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>

                          {openMessageMenuFor === msg.id && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setOpenMessageMenuFor(null)} />
                              <div className={`absolute top-7 ${isLead ? 'left-0' : 'right-0'} z-50 w-44 bg-[#233138] border border-slate-700 rounded-xl shadow-2xl overflow-hidden text-xs origin-top animate-pop-in`}>
                                <button
                                  type="button"
                                  onClick={() => { handleReplyToMessage(msg); setOpenMessageMenuFor(null); }}
                                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                                >
                                  <Reply className="w-3.5 h-3.5" />
                                  <span>{isSpanish ? 'Responder' : 'Responder'}</span>
                                </button>
                                {msg.text && (
                                  <button
                                    type="button"
                                    onClick={() => { navigator.clipboard?.writeText(msg.text || ''); setOpenMessageMenuFor(null); }}
                                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>{isSpanish ? 'Copiar' : 'Copiar'}</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => { setForwardingMessage(msg); setOpenMessageMenuFor(null); }}
                                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                                >
                                  <Forward className="w-3.5 h-3.5" />
                                  <span>{isSpanish ? 'Reenviar' : 'Encaminhar'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setReactionPickerFor(reactionPickerFor === msg.id ? null : msg.id); setOpenMessageMenuFor(null); }}
                                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-slate-200 hover:bg-slate-700/60 transition-colors cursor-pointer"
                                >
                                  <Smile className="w-3.5 h-3.5" />
                                  <span>{isSpanish ? 'Reaccionar' : 'Reagir'}</span>
                                </button>
                                <div className="border-t border-slate-700" />
                                <button
                                  type="button"
                                  onClick={() => { setOpenMessageMenuFor(null); handleDeleteSingleMessage(selectedLead.id, msg.id); }}
                                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-rose-300 hover:bg-rose-950/60 transition-colors cursor-pointer"
                                  title="Apagar esta mensagem"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>{isSpanish ? 'Eliminar' : 'Apagar'}</span>
                                </button>
                              </div>
                            </>
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

                        {/* TASK-0225: `lg:max-w-2xl` some com o teto real da
                            coluna de conversa (removido acima, era um
                            `max-w-7xl` residual) — sem um teto absoluto, um
                            balão de mensagem curta esticaria até 85% de uma
                            coluna agora bem mais larga em monitores grandes,
                            prejudicando leitura. `max-w-[85%]` continua
                            sendo a regra em qualquer largura menor que isso. */}
                        <div
                          className={`max-w-[85%] lg:max-w-2xl rounded-xl shadow-sm text-sm relative overflow-hidden ${isLead ? 'rounded-tl-none' : 'rounded-tr-none'} ${
                            isLead || isMediaBubble
                              ? 'bg-[#202c33] text-[#e9edef]'
                              : msg.sentBy === 'operator'
                                ? 'bg-[#334155] text-slate-100 border border-slate-400/40 shadow-slate-950/40'
                                : 'bg-[#005c4b] text-white shadow-emerald-950/40'
                          }`}
                        >
                          {msg.reactions && msg.reactions.length > 0 && (
                            <div
                              className={`absolute -bottom-2.5 ${isLead ? 'left-2' : 'right-2'} bg-[#233138] border border-slate-700 rounded-full px-1.5 py-0.5 text-[10px] shadow-md z-10`}
                            >
                              {msg.reactions.map((r) => r.emoji).join(' ')}
                            </div>
                          )}

                          {hasHeaderContent && (
                            <div className="px-2.5 pt-2.5 pb-2 space-y-1">
                              {/* Distingue resposta automática da IA de mensagem digitada manualmente pelo operador — cor de balão sozinha pode não bastar (daltonismo, print em P&B), então reforça com ícone+texto. Ver issue #126. Áudio/vídeo mostram esse rótulo dentro do próprio cartão cinza (ver mediaSenderLabel), não aqui. */}
                              {hasSenderLabel && (
                                <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide">
                                  {msg.sentBy === 'ai' ? <Bot className="w-2.5 h-2.5 text-emerald-400" /> : <UserCheck className="w-2.5 h-2.5 text-slate-300" />}
                                  <span className={msg.sentBy === 'operator' ? 'text-slate-300' : 'text-emerald-400'}>
                                    {msg.sentBy === 'ai' ? 'Atendente' : 'Você (equipe)'}
                                  </span>
                                </div>
                              )}

                              {msg.forwardedFromMessageId && (
                                <div className="flex items-center gap-1 text-[9px] italic opacity-60">
                                  <Forward className="w-2.5 h-2.5" /> {isSpanish ? 'Reenviada' : 'Encaminhada'}
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
                                  <div className="text-[9px] font-bold text-emerald-400 truncate">
                                    {quotedMessage.sender === 'lead' ? selectedLead.name : (isSpanish ? 'Vos' : 'Você')}
                                  </div>
                                  <div className="text-[10px] opacity-80 truncate">
                                    {quotedMessage.text ||
                                      (quotedMessage.type === 'image' ? '📷 Imagem' : quotedMessage.type === 'audio' ? '🎤 Áudio' : quotedMessage.type === 'file' ? '📎 Arquivo' : '')}
                                  </div>
                                </button>
                              )}
                            </div>
                          )}

                          {/* Audio Message Type — cartão compacto (uma linha só, sem
                              caixa aninhada nem rótulo "Mensagem de voz" redundante),
                              seguindo o tamanho real de uma nota de voz do WhatsApp em
                              vez do card grande/pesado de antes (pedido direto,
                              24/08/2026, print de referência). */}
                          {msg.type === 'audio' && (
                            <div className={`px-2.5 pb-2 min-w-[190px] max-w-[240px] ${hasHeaderContent ? '' : 'pt-2'}`}>
                              {mediaSenderLabel}
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => ((selectedLead as any)?.isReal ? handlePlayRealAudioMessage(msg.id) : handlePlayAudioMessage(msg.id, msg.text || ''))}
                                  className="w-7 h-7 rounded-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 flex items-center justify-center flex-shrink-0 transition-transform cursor-pointer"
                                >
                                  {playingAudioId === msg.id ? (
                                    <Volume2 className="w-3.5 h-3.5 animate-bounce" />
                                  ) : (
                                    <Play className="w-3.5 h-3.5 ml-0.5" />
                                  )}
                                </button>
                                <div className="flex-1 min-w-0 bg-slate-700/60 h-1 rounded-full overflow-hidden">
                                  <div className={`h-full bg-emerald-500 ${playingAudioId === msg.id ? 'animate-pulse w-full' : 'w-1/3'}`} />
                                </div>
                                <span className="text-[9px] text-slate-400 flex-shrink-0">{msg.audioDuration || 15}s</span>
                              </div>
                              {msg.text && (
                                <p className="text-[10px] opacity-80 mt-1 leading-snug">
                                  {msg.text}
                                  {timeFooter}
                                </p>
                              )}
                              {/* Achado real (03/09/2026, TASK-0245): o botão só aparecia pro
                                  texto de falha explícita ("Não foi possível transcrever"), mas o
                                  bug real (TASK-0244, worker de transcrição sem contexto de tenant)
                                  deixava mensagens travadas pra sempre nos placeholders "Transcrevendo
                                  áudio..."/"Áudio enviado" — nenhum dos dois batia com a condição,
                                  então quem tinha áudio antigo travado não via nenhum jeito de
                                  reprocessar pelo painel. */}
                              {(msg.text?.includes('Não foi possível transcrever') || msg.text === '🎤 Transcrevendo áudio...' || msg.text === '🎤 Áudio enviado') && (selectedLead as any)?.isReal && (
                                <button
                                  type="button"
                                  onClick={() => handleRetryTranscription(msg)}
                                  disabled={retryingTranscriptionId === msg.id}
                                  className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-300 hover:text-amber-200 disabled:opacity-50 cursor-pointer mt-1"
                                >
                                  <RefreshCw className={`w-3 h-3 ${retryingTranscriptionId === msg.id ? 'animate-spin' : ''}`} />
                                  {retryingTranscriptionId === msg.id ? 'Tentando transcrever...' : 'Tentar transcrever de novo'}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Image Message Type — imagem rente às bordas do balão
                              (igual ao WhatsApp real), sem margem interna; a legenda
                              (quando tem) fica numa faixa com padding própria abaixo,
                              com o horário flutuando no final dela. overflow-hidden no
                              balão (acima) já corta os cantos da imagem no formato
                              certo — não precisa de rounded-* na própria img. */}
                          {msg.type === 'image' && (
                            <div className="min-w-[200px]">
                              {msg.mediaUrl && (
                                <div
                                  onClick={() => setViewImageUrl(msg.mediaUrl || null)}
                                  className="relative group cursor-pointer"
                                >
                                  <img
                                    src={msg.mediaUrl}
                                    alt={isSpanish ? 'Imagen del lead' : 'Imagem do lead'}
                                    className="w-full h-44 object-cover group-hover:scale-105 transition-transform duration-300"
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
                              <p className="text-xs px-2.5 pt-1.5 pb-2.5">
                                {msg.text}
                                {timeFooter}
                              </p>
                            </div>
                          )}

                          {/* File Document Type — vídeos mandados pelo agente (exemplo de
                              produto, mensagem de primeiro contato) usam type:'file' por
                              não existir um MessageType próprio pra vídeo (ver
                              runMidiaTool/firstContactMessage.ts) — mostrar "Documento PDF"
                              pra um vídeo é enganoso (achado real: gerou dúvida se o vídeo
                              tinha ido mesmo ou virado um arquivo/documento de verdade), daí
                              o isVideo abaixo (detecta pelo prefixo 🎥 do texto). Documento
                              de verdade (PDF/catálogo) continua só com o card estático — sem
                              preview real, igual sempre foi. */}
                          {msg.type === 'file' && (() => {
                            const isVideo = msg.text?.trimStart().startsWith('🎥');
                            // Preview de vídeo de verdade só existe pra lead real (mensagens
                            // do mock não têm messageId de banco pra buscar em /api/media).
                            if (isVideo && (selectedLead as any)?.isReal) {
                              return (
                                <div className="space-y-1.5 min-w-[220px]">
                                  {mediaSenderLabel && <div className="px-2.5 pt-2.5">{mediaSenderLabel}</div>}
                                  <RealClientVideo messageId={msg.id} />
                                  <p className="text-xs">{msg.text}</p>
                                </div>
                              );
                            }
                            return (
                              <div className={`px-2.5 pb-2.5 space-y-1 min-w-[200px] ${hasHeaderContent ? '' : 'pt-2.5'}`}>
                                <div className="flex items-center space-x-2 bg-slate-950/40 p-2.5 rounded-lg border border-white/10">
                                  {isVideo ? (
                                    <Video className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                                  ) : (
                                    <FileText className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    {isVideo && mediaSenderLabel}
                                    <span className="text-[11px] font-bold truncate block">
                                      {isVideo ? 'Vídeo enviado' : msg.fileName || 'documento.pdf'}
                                    </span>
                                    <span className="text-[9px] opacity-75">{isVideo ? 'Vídeo' : 'Documento PDF'}</span>
                                  </div>
                                </div>
                                <p className="text-xs">
                                  {msg.text}
                                  {timeFooter}
                                </p>
                              </div>
                            );
                          })()}

                          {/* Regular Text Message */}
                          {msg.type === 'text' && (
                            <p className={`px-2.5 pb-2.5 leading-relaxed whitespace-pre-wrap ${hasHeaderContent ? '' : 'pt-2.5'}`}>
                              {msg.text}
                              {timeFooter}
                            </p>
                          )}

                          {msg.sendFailed && (
                            <div className="flex items-center gap-1 text-[10px] font-bold text-rose-300 bg-rose-950/60 border border-rose-700/60 rounded-lg px-2 py-1 mx-2.5 mb-2.5">
                              <AlertCircle className="w-3 h-3 flex-shrink-0" />
                              <span>Falha no envio — o cliente NÃO recebeu isto.</span>
                            </div>
                          )}
                        </div>
                        </div>
                      </React.Fragment>
                    );
                  })
                ) : (
                  <div className="text-center py-12 text-slate-500 text-xs">
                    {isSpanish ? 'No hay mensajes registrados en esta conversación.' : 'Nenhuma mensagem registrada nesta conversa.'}
                  </div>
                )}
                <div ref={messagesEndRef} />
                <audio ref={realAudioRef} className="hidden" />
              </div>

              {!isAtLatestMessage && (
                <button
                  type="button"
                  onClick={() => scrollToLatestMessage('smooth')}
                  aria-label={
                    newMessagesWhileAway > 0
                      ? `${newMessagesWhileAway} ${isSpanish ? 'nuevas' : 'novas'} ${isSpanish ? 'mensajes' : 'mensagens'}. ${isSpanish ? 'Ir al último mensaje' : 'Ir para a última mensagem'}`
                      : (isSpanish ? 'Ir al último mensaje' : 'Ir para a última mensagem')
                  }
                  title={isSpanish ? 'Ir al último mensaje' : 'Ir para a última mensagem'}
                  className="absolute bottom-4 right-4 z-20 flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-full border border-slate-600 bg-[#202c33]/95 px-2 text-slate-100 shadow-xl shadow-black/30 backdrop-blur transition-all hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-[#26343c] focus:outline-none focus:ring-2 focus:ring-emerald-400/70"
                >
                  <ArrowDown className="h-4 w-4" />
                  {newMessagesWhileAway > 0 && (
                    <span className="min-w-5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-slate-950">
                      {newMessagesWhileAway > 99 ? '99+' : newMessagesWhileAway}
                    </span>
                  )}
                </button>
              )}
              </div>

              {/* WhatsApp Web Bottom Simulation Control & Input Bar —
                  rodapé sem caixa escura própria (pedido direto,
                  29/08/2026: "tira o fundo escuro do rodapé, ajusta a
                  posição da caixa de texto está alta"): antes existia uma
                  fileira inteira separada (fundo `#202c33`) só pra
                  respostas rápidas/foto/vídeo/simular, empurrando a caixa
                  de texto pra baixo. Essa fileira só sobrevive pra
                  conversas de teste/demo (troca "enviar como" + simular
                  imagem/PDF); numa conversa real ela some e os ícones que
                  sobram entram direto na linha de composição abaixo. */}
              {/* TASK-0184: mesmo raciocínio do cabeçalho acima — o padding
                  inferior do .app-main que sumiu no mobile também cobria a
                  barra de gestos do iOS/Android por baixo da caixa de
                  texto/mic. paddingBottom: env(safe-area-inset-bottom)
                  resolve pra 0 fora desse contexto. */}
              <div className="p-2 space-y-1.5" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>

                {!(selectedLead as any)?.isReal && (
                  <div className="flex items-center justify-between text-xs px-1">
                    <div className="flex items-center space-x-1 bg-[#111b21]/80 p-1 rounded-lg">
                      <span className="text-[10px] text-slate-400 font-bold px-1">{isSpanish ? 'Enviar como:' : 'Enviar como:'}</span>
                      <button
                        type="button"
                        onClick={() => setSenderRole('lead')}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                          senderRole === 'lead' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <User className="w-3 h-3 inline mr-1" />
                        {isSpanish ? 'Cliente' : 'Cliente'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSenderRole('agent')}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                          senderRole === 'agent' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <UserCheck className="w-3 h-3 inline mr-1" />
                        Atendente
                      </button>
                    </div>

                    {/* Botões de SIMULAÇÃO (lead/agente fake) — só existem em
                        conversas de teste/demo; numa conversa real o clipe de
                        anexo da linha de composição já cobre o envio de
                        verdade via Meta Cloud API. */}
                    <div className="flex items-center space-x-0.5">
                      <button
                        type="button"
                        onClick={handleSendSampleImage}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                        title="Simular Envio de Imagem (conversa de teste)"
                      >
                        <ImageIcon className="w-5 h-5" />
                      </button>

                      <button
                        type="button"
                        onClick={handleSendSampleFile}
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                        title="Simular Envio de PDF (conversa de teste)"
                      >
                        <Paperclip className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Aviso de resposta automática em andamento (pedido real, 20/08/2026):
                    o "digitando..." do header só aparece pro lead no WhatsApp — aqui é o
                    equivalente pro operador, pra saber que uma resposta está a caminho
                    (ou que falhou e foi escalada) sem precisar adivinhar. Ver
                    aiReplyStatusByPhone acima. */}
                {(selectedLead as any).isReal && aiReplyStatusByPhone[selectedLead.phone] === 'generating' && (
                  <div className="flex items-center gap-2 bg-emerald-950/40 border border-emerald-800/40 rounded-lg px-3 py-1.5 text-[11px] text-emerald-300">
                    <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                    <span>A IA está formulando uma resposta para {selectedLead.name}...</span>
                  </div>
                )}
                {(selectedLead as any).isReal && aiReplyStatusByPhone[selectedLead.phone] === 'awaiting_human' && (
                  <div className="flex items-center gap-2 bg-amber-950/40 border border-amber-800/40 rounded-lg px-3 py-1.5 text-[11px] text-amber-200">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Atendimento transferido para humano — verifique Escalonamentos antes de responder.</span>
                  </div>
                )}
                {(selectedLead as any).isReal && aiReplyStatusByPhone[selectedLead.phone] === 'delivery_failed' && (
                  <div className="flex items-center gap-2 bg-rose-950/40 border border-rose-800/40 rounded-lg px-3 py-1.5 text-[11px] text-rose-300">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>A entrega automática falhou e o caso foi escalado para acompanhamento manual.</span>
                  </div>
                )}

                {/* Status da Janela de 24h — a restrição de "só modelo aprovado"
                    é uma regra da API oficial da Meta, não existe no canal
                    Evolution (Baileys/QR code) nem no Instagram DM. Achado
                    real de auditoria: esta faixa tratava qualquer canal como
                    se tivesse a mesma restrição, mostrando "precisa de WABA"
                    até pra conversas Evolution que nunca tiveram (nem
                    precisam de) WABA nenhum. `phoneNumberId` só é preenchido
                    em conversas do canal Meta (ver conversationStore.ts) —
                    é o sinal que já existe pra distinguir os dois casos. */}
                {selectedLead && (() => {
                  const serviceWindow = visibleContactContext?.serviceWindow;
                  const isWindowOpen = serviceWindow ? serviceWindow.withinWindow : true;
                  const isMetaChannel = Boolean((selectedLead as any).phoneNumberId);

                  {/* TASK-0258 (pedido direto): janela aberta e sem ação
                      pendente não precisa de card de linha inteira — esse
                      mesmo sinal (aberta, quantas horas faltam) já aparece
                      como badge pequeno no cabeçalho da conversa, ao lado do
                      telefone. O card cheio com botão continua exatamente
                      como antes pros 3 casos que pedem decisão do operador
                      (janela fechada). */}
                  if (isWindowOpen) return null;

                  return (
                    <div className="flex items-center justify-between px-3 py-1.5 bg-[#111b21] rounded-xl border border-slate-800 text-[11px] mb-1">
                      {!isMetaChannel ? (
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-1.5 text-amber-400/90 font-semibold" title="Sem restrição técnica de envio nesse canal — mas mandar mensagem pra um contato inativo há muito tempo aumenta o risco desse número ser sinalizado como suspeito pelo WhatsApp. Prefira esperar o cliente escrever primeiro, ou modere o uso.">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>Mais de 24h sem {selectedLead.name} escrever. Você pode responder normalmente, mas reengajar aumenta o risco desse número ser sinalizado pelo WhatsApp.</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDraftReengagementMessage(selectedLead)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            <Sparkles className="w-3 h-3" />
                            Sugerir mensagem de retomada
                          </button>
                        </div>
                      ) : isReopenBlockedByWaba ? (
                        <div className="flex items-center gap-1.5 text-amber-400 font-semibold" title="Fale com o suporte para configurar a conta oficial do WhatsApp Business (WABA) desta empresa.">
                          <Lock className="w-3.5 h-3.5 shrink-0" />
                          <span>Janela de 24h fechada. Esta empresa ainda não tem WhatsApp Business (WABA) configurado — não é possível reabrir a conversa. Fale com o suporte.</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                            <Lock className="w-3.5 h-3.5" />
                            <span>Janela de 24 horas fechou. Só é permitido enviar modelo aprovado.</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsReopenModalOpen(true)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                          >
                            <Sparkles className="w-3 h-3" />
                            Reabrir a conversa
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Reply Preview Bar — mesma ideia do WhatsApp: mostra o que está sendo respondido acima do campo de texto */}
                {replyingTo && (
                  <div className="flex items-center justify-between bg-[#111b21] border-l-4 border-emerald-500 rounded-lg px-3 py-1.5">
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold text-emerald-400 truncate">
                        {`Respondendo a: ${replyingTo.sender === 'lead' ? selectedLead.name : 'Você'}`}
                      </div>
                      <div className="text-[11px] text-slate-300 truncate">
                        {replyingTo.text || (replyingTo.type === 'image' ? '📷 Imagem' : replyingTo.type === 'audio' ? '🎤 Áudio' : replyingTo.type === 'file' ? '📎 Arquivo' : '')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReplyingTo(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer flex-shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* TASK-0259 (pedido direto): o aviso de assunção de controle
                    deixou de ser um parágrafo fixo permanente (poluía a
                    tela em toda conversa) e virou este banner discreto, que
                    aparece só na primeira vez que o operador toca no campo
                    de digitação (`handleComposerFirstFocus`, flag salva em
                    localStorage — mesmo padrão de "não mostrar de novo" já
                    usado nas sugestões de etiqueta) e some sozinho depois
                    de alguns segundos. */}
                {showComposerHint && (
                  <div className="flex items-center gap-1.5 bg-[#111b21] border border-slate-800 rounded-lg px-3 py-1.5 text-[10px] text-slate-400 animate-pop-in">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400/80 shrink-0" />
                    <span className="flex-1">{isSpanish
                      ? 'Al enviar, asumes esta conversación: el agente deja de responder aquí hasta que la devuelvas. Las demás siguen normales.'
                      : 'Ao enviar, você assume esta conversa: o agente para de responder aqui até você devolver. As outras seguem normais.'}</span>
                    <button
                      type="button"
                      onClick={() => setShowComposerHint(false)}
                      className="p-0.5 text-slate-500 hover:text-white rounded cursor-pointer shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* WhatsApp Style Text Input Form */}
                {/* Achado real, 29/08/2026 (pedido do dono do produto,
                    comparação lado a lado com o app real): a caixa de texto
                    e os ícones estavam menores que o WhatsApp de verdade.
                    Ícones 20px -> 24px (w-5 -> w-6), campo de texto
                    text-xs/py-2.5 -> text-sm/py-3 (fonte e altura mais
                    perto do real), botão de enviar/mic 36px -> 44px
                    (w-9 -> w-11, ícone w-4 -> w-5) — mesma proporção do
                    círculo verde do WhatsApp. */}
                {/* space-x-1 (não -2) e min-w-0 na caixa de texto: sem
                    isso o <input> segura sua largura mínima padrão do
                    navegador e empurra tudo que vem depois (respostas
                    rápidas, mic/enviar) pra fora da tela em telas
                    estreitas — bug real reportado pelo dono do produto,
                    29/08/2026, print mostrando os ícones sumidos à
                    direita. Cada ícone fixo leva `flex-shrink-0` pra só o
                    campo de texto encolher. */}
                {pendingAudioPreview ? (
                  // Prévia da gravação (achado real, 29/08/2026): o áudio só
                  // sai pro WhatsApp quando o operador confirma aqui — nada
                  // de envio automático ao parar de gravar.
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDiscardRecordedAudio}
                      disabled={isSendingRecordedAudio}
                      className="p-2 text-red-400 hover:text-red-300 rounded-full transition-colors cursor-pointer flex-shrink-0 disabled:opacity-50"
                      title="Descartar gravação"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                    <audio controls src={pendingAudioPreview.url} className="flex-1 min-w-0 h-9" />
                    <button
                      type="button"
                      onClick={handleSendRecordedAudio}
                      disabled={isSendingRecordedAudio}
                      className="w-9 h-9 rounded-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 flex items-center justify-center transition-all cursor-pointer flex-shrink-0 disabled:opacity-50"
                      title={`Enviar áudio pra ${recordingForLeadName}`}
                    >
                      {isSendingRecordedAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
                    </button>
                  </div>
                ) : (
                <form onSubmit={handleSendTextMessage} className="flex items-end space-x-1">
                  {/* TASK-0187 (pedido direto, 01/09/2026, comparação lado a
                      lado com o WhatsApp Business real): emoji, texto e
                      anexo agora vivem dentro da MESMA caixa arredondada —
                      igual ao WhatsApp, onde só o microfone/enviar fica de
                      fora. Antes emoji e anexo eram botões soltos ANTES da
                      caixa; o anexo também mudou de lado (esquerda ->
                      direita, mesma posição do clipe no WhatsApp real). */}
                  <div className="flex-1 min-w-0 flex items-end gap-0.5 bg-[#2a3942] rounded-3xl pl-1 pr-1">
                    <div className="relative flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowComposerEmojiPicker((v) => !v)}
                        className="p-2 text-slate-400 hover:text-white rounded-full transition-colors cursor-pointer"
                        title="Emoji"
                      >
                        <Smile className="w-5 h-5" />
                      </button>
                      {showComposerEmojiPicker && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowComposerEmojiPicker(false)} />
                          <div className="absolute bottom-full left-0 mb-2 z-50 w-64 max-h-56 overflow-y-auto bg-[#233138] border border-slate-700 rounded-xl shadow-2xl p-2 grid grid-cols-8 gap-0.5 origin-bottom-left animate-pop-in">
                            {COMPOSER_EMOJIS.map((emoji, idx) => (
                              <button
                                key={`${emoji}-${idx}`}
                                type="button"
                                onClick={() => setInputMessage((prev) => prev + emoji)}
                                className="text-lg hover:bg-white/10 rounded p-1 cursor-pointer"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* <textarea> em vez de <input> — cresce com o texto até
                        um teto de 120px (mesma sensação do WhatsApp real:
                        mais espaço aparente pra digitar, sem rolar por
                        dentro de uma caixa de altura fixa). Enter envia,
                        Shift+Enter quebra linha — mesmo atalho do WhatsApp.
                        `bg-transparent` porque a cor de fundo agora é da
                        caixa inteira (div pai), não mais dela sozinha. */}
                    <textarea
                      ref={composerTextareaRef}
                      rows={1}
                      placeholder={
                        senderRole === 'lead'
                          ? (isSpanish ? `Mensaje de ${selectedLead.name}...` : `Mensagem de ${selectedLead.name}...`)
                          : 'Digitar resposta...'
                      }
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendTextMessage();
                        }
                      }}
                      onFocus={handleComposerFirstFocus}
                      className="atendimento-composer-textarea flex-1 min-w-0 bg-transparent text-sm text-[#e9edef] placeholder-slate-400 py-2.5 leading-6 resize-none overflow-y-auto focus:outline-none"
                      style={{ maxHeight: '120px' }}
                    />

                    {/* Anexo — pedido direto (TASK-0184/0187, comparação lado
                        a lado com o WhatsApp Business real): o clipe de
                        anexo real e os dois <select> de foto/vídeo de
                        exemplo viviam como 3 ícones soltos disputando espaço
                        na linha de composição. Agora é um único menu, com o
                        clipe como gatilho — igual ao WhatsApp real, que
                        também agrupa Documento/Câmera/Galeria atrás de um
                        clipe só, do lado direito da caixa. */}
                    <div className="relative flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowAttachMenu((v) => !v)}
                        className="p-2 text-slate-400 hover:text-white rounded-full transition-colors cursor-pointer"
                        title={isSpanish ? 'Adjuntar' : 'Anexar'}
                      >
                        <Paperclip className="w-5 h-5" />
                      </button>
                      {showAttachMenu && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowAttachMenu(false)} />
                          <div className="absolute bottom-full right-0 mb-2 z-50 w-60 max-h-64 overflow-y-auto bg-[#233138] border border-slate-700 rounded-xl shadow-2xl p-1.5 origin-bottom-right animate-pop-in">
                            <button
                              type="button"
                              onClick={() => {
                                setShowAttachMenu(false);
                                (selectedLead as any).isReal ? fileInputRef.current?.click() : handleSendSampleFile();
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-white/10 cursor-pointer text-left"
                            >
                              <Paperclip className="w-4 h-4 text-slate-400 flex-shrink-0" />
                              <span>{isSpanish ? 'Documento o foto' : 'Documento ou foto'}</span>
                            </button>

                            {(selectedLead as any)?.isReal && knowledgeBase.products.some((p) => p.exampleImageBase64) && (
                              <>
                                <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                  {isSpanish ? 'Foto de ejemplo' : 'Foto de exemplo'}
                                </div>
                                {knowledgeBase.products.filter((p) => p.exampleImageBase64).map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => { setShowAttachMenu(false); handleSendExamplePhoto(p.name); }}
                                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-white/10 cursor-pointer text-left"
                                  >
                                    <ImageIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                    <span className="truncate">{p.name}</span>
                                  </button>
                                ))}
                              </>
                            )}

                            {(selectedLead as any)?.isReal && knowledgeBase.products.some((p) => p.exampleVideoId) && (
                              <>
                                <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                  {isSpanish ? 'Video de ejemplo' : 'Vídeo de exemplo'}
                                </div>
                                {knowledgeBase.products.filter((p) => p.exampleVideoId).map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => { setShowAttachMenu(false); handleSendExampleVideo(p.name); }}
                                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-white/10 cursor-pointer text-left"
                                  >
                                    <Video className="w-4 h-4 text-slate-400 flex-shrink-0" />
                                    <span className="truncate">{p.name}</span>
                                  </button>
                                ))}
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*,application/pdf" onChange={handleRealFileSelect} />

                  {/* Respostas rápidas — recurso próprio do Universo, sem
                      equivalente no WhatsApp real; continua fora da caixa,
                      entre ela e o botão de mic/enviar (pedido direto,
                      29/08/2026: "msg rápida para Caixa de texto lado
                      direito discreto"). */}
                  <div className="flex-shrink-0">
                    <QuickRepliesMenu
                      quickReplies={quickReplies}
                      isSpanish={isSpanish}
                      saving={quickRepliesSaving}
                      onSelect={setInputMessage}
                      onCreate={handleCreateQuickReply}
                      onUpdate={handleUpdateQuickReply}
                      onDelete={handleDeleteQuickReply}
                      compact
                    />
                  </div>

                  {/* Mic/Enviar — mesmo padrão do WhatsApp real: sem texto
                      digitado, o botão do rodapé grava áudio; com texto,
                      vira o botão de enviar (pedido direto, 29/08/2026:
                      "áudio pode virar um ícone discreto igual o do
                      WhatsApp"). */}
                  {inputMessage.trim() ? (
                    <button
                      type="submit"
                      className="w-11 h-11 rounded-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 flex items-center justify-center transition-all cursor-pointer flex-shrink-0"
                    >
                      <Send className="w-5 h-5 ml-0.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => (selectedLead as any)?.isReal ? handleToggleRealRecording() : handleSendAudioNote()}
                      className={`w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer flex-shrink-0 ${
                        isRecordingReal ? 'bg-red-500/20 text-red-300 animate-pulse' : 'bg-emerald-500 hover:bg-emerald-600 text-slate-950'
                      }`}
                      title={
                        isRecordingReal
                          ? `Gravando pra ${recordingForLeadName} — clique aqui (em qualquer conversa) pra parar`
                          : (selectedLead as any)?.isReal ? 'Gravar áudio real' : 'Simular Envio de Áudio'
                      }
                    >
                      <Mic className="w-5 h-5" />
                    </button>
                  )}
                </form>
                )}
              </div>
            </>
          ) : (
            <div className="bg-[#0b141a] p-12 text-center text-slate-500 text-xs">
              {t('selectConversation')}
            </div>
          )}
        </div>

        {/* ========================================== */}
        {/* COLUMN 3: Painel contextual do contato e IA (Referência 1) */}
        {/* ========================================== */}
        {showRightPanel && (
          <div className="atendimento-analysis-panel hidden lg:flex lg:col-span-3 border-l border-slate-800/45 bg-[#111b21] flex-col overflow-y-auto scrollbar-thin">
            {/* Seletor de visualização: Ficha do Contato vs Análise IA */}
            <div className="flex border-b border-slate-800 bg-[#0f171d] px-3 pt-2 gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setRightPanelTab('profile')}
                className={`pb-2 px-2 text-xs font-bold transition-colors border-b-2 cursor-pointer ${
                  rightPanelTab === 'profile'
                    ? 'text-emerald-400 border-emerald-400'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                Ficha do Contato
              </button>
              <button
                type="button"
                onClick={() => setRightPanelTab('analysis')}
                className={`pb-2 px-2 text-xs font-bold transition-colors border-b-2 cursor-pointer ${
                  rightPanelTab === 'analysis'
                    ? 'text-emerald-400 border-emerald-400'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                Análise IA
              </button>
            </div>

            {rightPanelTab === 'profile' ? (
              <ConversationContextSidebar
                contact={selectedLead ? {
                  name: selectedLead.name,
                  phone: selectedLead.phone,
                  interest: selectedLead.interest || visibleContactContext?.memory?.serviceInterest || undefined,
                  hasBooked: Boolean(paymentAppointment),
                  firstContactAt: selectedLead.messages?.[0]?.timestamp || selectedLead.timestamp,
                  notes: visibleContactContext?.memory?.conversationSummary || undefined,
                  funnelStage: {
                    name: paymentAppointment ? 'Horário já passou' : (selectedLead.fullAnalysis?.stage || 'Em Qualificação'),
                    currentStep: paymentAppointment ? 5 : 3,
                    totalSteps: 5,
                  },
                  upcomingAppointments: upcomingEvents
                    .filter((ev) => ev.phone === selectedLead.phone)
                    .map((ev) => ({
                      id: ev.id,
                      date: ev.date || 'Hoje',
                      time: ev.time || '12:00',
                      title: ev.title || 'Consulta',
                      status: 'scheduled',
                    })),
                } : null}
                agentStatus={selectedLead?.aiBlockedAt ? 'paused' : 'active'}
                onToggleAgentStatus={() => selectedLead && handleUpdateConversationState(selectedLead.id, { aiBlocked: !selectedLead.aiBlockedAt })}
                onClose={() => setShowRightPanel(false)}
              />
            ) : (
              <div className="p-2.5 space-y-2.5">
                <label
                  className="inline-flex items-center gap-1.5 self-start cursor-pointer text-slate-500 hover:text-slate-400 transition-colors"
                  title='Analisar automaticamente a cada mensagem nova (consome tokens do Gemini a cada análise)'
                >
                  <input
                    type="checkbox"
                    checked={autoAnalyze}
                    onChange={(e) => setAutoAnalyze(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="relative w-6 h-3.5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:start-[1px] after:bg-slate-400 after:border after:border-slate-500 after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-emerald-600/70 peer-checked:after:bg-white" />
                  <span className="text-[10px]">Analisar automaticamente a cada mensagem</span>
                </label>
                <ConversationAnalysisPanel
                  analysis={selectedLead?.fullAnalysis}
                  isLoading={isAnalyzingConversation}
                  onReanalyze={() => selectedLead && handleAnalyzeConversation(selectedLead)}
                  onDraftSuggestedReply={handleDraftSuggestedReply}
                  leadName={selectedLead?.name || 'Lead'}
                  onSendCAPIEvent={handleDirectCAPI}
                  onGenerateReplyFromHint={handleGenerateReplyFromHint}
                  onAskAi={handleAskAi}
                  contactContext={visibleContactContext}
                  isContactContextLoading={isContactContextLoading}
                  onRefreshContactContext={() => void refreshContactContext()}
                  onSaveContactMemory={handleSaveContactMemory}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Ficha IA no mobile — painel deslizante por cima da conversa (a
          coluna 3 fica hidden abaixo do breakpoint lg).

          TASK-0251 (achado real, 03/09/2026, print do celular): o
          comentário antigo aqui dizia "mesmo componente e mesmas props do
          painel de desktop acima, só a apresentação muda" — não era
          verdade. No desktop a coluna 3 tem DUAS abas de verdade
          ("Ficha do Contato" → `ConversationContextSidebar`, perfil/etapa
          do funil/agendamentos; "Análise IA" → `ConversationAnalysisPanel`,
          que embute o "Contexto Supervisionado"/`ContactContextPanel` como
          sub-seção). A gaveta mobile só reproduzia o conteúdo da aba
          "Análise IA" — a aba "Ficha do Contato" (`ConversationContextSidebar`)
          nunca tinha sido incluída aqui, então não tinha como abrir no
          celular de jeito nenhum. Reaproveita a MESMA `rightPanelTab` do
          desktop (estado único, compartilhado) — trocar de aba aqui ou lá
          reflete no mesmo lugar quando a tela cresce. */}
      {mobileAnalysisOpen && mobileThreadOpen && selectedLead && (
        <div
          className="atendimento-analysis-drawer lg:hidden fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end animate-fade-in"
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
            {/* TASK-0251: mesmo seletor de abas do desktop ("Ficha do
                Contato" / "Análise IA"), reaproveitando `rightPanelTab`. */}
            <div className="flex border-b border-slate-800 bg-[#0f171d] px-3 pt-2 gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setRightPanelTab('profile')}
                className={`pb-2 px-2 text-xs font-bold transition-colors border-b-2 cursor-pointer ${
                  rightPanelTab === 'profile'
                    ? 'text-emerald-400 border-emerald-400'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                Ficha do Contato
              </button>
              <button
                type="button"
                onClick={() => setRightPanelTab('analysis')}
                className={`pb-2 px-2 text-xs font-bold transition-colors border-b-2 cursor-pointer ${
                  rightPanelTab === 'analysis'
                    ? 'text-emerald-400 border-emerald-400'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                Análise IA
              </button>
            </div>
            {rightPanelTab === 'profile' ? (
              <ConversationContextSidebar
                contact={{
                  name: selectedLead.name,
                  phone: selectedLead.phone,
                  interest: selectedLead.interest || visibleContactContext?.memory?.serviceInterest || undefined,
                  hasBooked: Boolean(paymentAppointment),
                  firstContactAt: selectedLead.messages?.[0]?.timestamp || selectedLead.timestamp,
                  notes: visibleContactContext?.memory?.conversationSummary || undefined,
                  funnelStage: {
                    name: paymentAppointment ? 'Horário já passou' : (selectedLead.fullAnalysis?.stage || 'Em Qualificação'),
                    currentStep: paymentAppointment ? 5 : 3,
                    totalSteps: 5,
                  },
                  upcomingAppointments: upcomingEvents
                    .filter((ev) => ev.phone === selectedLead.phone)
                    .map((ev) => ({
                      id: ev.id,
                      date: ev.date || 'Hoje',
                      time: ev.time || '12:00',
                      title: ev.title || 'Consulta',
                      status: 'scheduled',
                    })),
                }}
                agentStatus={(selectedLead as any)?.aiBlockedAt ? 'paused' : 'active'}
                onToggleAgentStatus={() => handleUpdateConversationState(selectedLead.id, { aiBlocked: !(selectedLead as any).aiBlockedAt })}
                onClose={() => setMobileAnalysisOpen(false)}
                isMobile
              />
            ) : (
            <div className="p-3 space-y-3 overflow-y-auto">
              {/* Auto IA — mesmo toggle da coluna de desktop (ver comentário
                  lá acima), reaproveitado aqui na gaveta mobile. */}
              <label
                className="inline-flex items-center gap-1.5 cursor-pointer text-slate-500 hover:text-slate-400 transition-colors"
                title='Analisar automaticamente a cada mensagem nova (consome tokens do Gemini a cada análise) — prefira o botão "Analisar Conversa Completa" pra analisar só quando precisar'
              >
                <input
                  type="checkbox"
                  checked={autoAnalyze}
                  onChange={(e) => setAutoAnalyze(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="relative w-6 h-3.5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:start-[1px] after:bg-slate-400 after:border after:border-slate-500 after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-emerald-600/70 peer-checked:after:bg-white" />
                <span className="text-[10px]">Analisar automaticamente a cada mensagem</span>
              </label>
              <ConversationAnalysisPanel
                analysis={selectedLead.fullAnalysis}
                isLoading={isAnalyzingConversation}
                onReanalyze={() => handleAnalyzeConversation(selectedLead)}
                onDraftSuggestedReply={handleDraftSuggestedReply}
                leadName={selectedLead.name || 'Lead'}
                onSendCAPIEvent={handleDirectCAPI}
                onGenerateReplyFromHint={handleGenerateReplyFromHint}
                onAskAi={handleAskAi}
                contactContext={visibleContactContext}
                isContactContextLoading={isContactContextLoading}
                onRefreshContactContext={() => void refreshContactContext()}
                onSaveContactMemory={handleSaveContactMemory}
              />
            </div>
            )}
          </div>
        </div>
      )}

      {/* Ferramentas no mobile — mesma gaveta deslizante da Ficha IA (ver
          acima), aberta pela aba inferior "Ferramentas" (ícone de
          engrenagem) em vez de empurrar a lista de conversas pra baixo
          (achado real, 29/08/2026, pedido do dono do produto). Conteúdo
          idêntico ao painel de desktop — reaproveita `toolbarSettingsBody`,
          definido antes do "return" deste componente, sem duplicar JSX. */}
      {isToolbarSettingsOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-end animate-fade-in"
          onClick={() => setIsToolbarSettingsOpen(false)}
        >
          <div
            className="bg-[#111b21] w-full max-h-[85vh] rounded-t-2xl border-t border-slate-800 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b border-slate-800 flex-shrink-0">
              <h3 className="text-sm font-bold text-white">Ferramentas</h3>
              <button
                onClick={() => setIsToolbarSettingsOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 flex flex-wrap items-center gap-2.5 overflow-y-auto">
              {toolbarSettingsBody}
            </div>
          </div>
        </div>
      )}

      {/* Forward Message Modal — escolher outro lead da lista pra encaminhar */}
      <ForwardMessageModal
        message={forwardingMessage}
        leads={leads}
        excludeLeadId={selectedLead?.id}
        onForward={handleForwardMessage}
        onClose={() => setForwardingMessage(null)}
      />

      <ImageLightboxModal imageUrl={viewImageUrl} onClose={() => setViewImageUrl(null)} />

      {/* Add New Lead Modal */}
      <AddLeadModal
        isOpen={showAddLead}
        name={newLeadName}
        onNameChange={setNewLeadName}
        phone={newLeadPhone}
        onPhoneChange={setNewLeadPhone}
        text={newLeadText}
        onTextChange={setNewLeadText}
        isGenerating={isGeneratingLead}
        onSubmit={handleAddNewLead}
        onClose={() => setShowAddLead(false)}
      />

      {/* Cadastro manual de agendamento fechado fora da IA (issue #182) */}
      <ManualAppointmentModal
        isOpen={isManualAppointmentModalOpen}
        leadName={selectedLead?.name}
        leadPhone={selectedLead?.phone}
        products={knowledgeBase.products}
        serviceName={manualServiceName}
        onServiceNameChange={setManualServiceName}
        isCustomService={isManualServiceCustom}
        onIsCustomServiceChange={setIsManualServiceCustom}
        customDurationMinutes={manualCustomDurationMinutes}
        onCustomDurationMinutesChange={setManualCustomDurationMinutes}
        date={manualDate}
        onDateChange={setManualDate}
        time={manualTime}
        onTimeChange={setManualTime}
        freeSlots={manualFreeSlots}
        isLoadingFreeSlots={isLoadingManualFreeSlots}
        freeSlotsError={manualFreeSlotsError}
        notes={manualNotes}
        onNotesChange={setManualNotes}
        paymentReceived={manualPaymentReceived}
        onPaymentReceivedChange={setManualPaymentReceived}
        paymentAmountReceived={manualPaymentAmountReceived}
        onPaymentAmountReceivedChange={setManualPaymentAmountReceived}
        error={manualAppointmentError}
        isCreating={isCreatingManualAppointment}
        onSubmit={handleCreateManualAppointment}
        onClose={() => { setIsManualAppointmentModalOpen(false); setManualAppointmentError(null); setManualNotes(''); setManualPaymentReceived(false); setManualPaymentAmountReceived(''); setIsManualServiceCustom(false); setManualCustomDurationMinutes(''); }}
      />

      <ManageLabelsModal
        isOpen={isLabelManagerOpen}
        labels={labelCatalog}
        isLoading={isLoadingLabelCatalog}
        onRename={handleRenameLabelCatalog}
        onDelete={handleDeleteLabelCatalog}
        onClose={() => setIsLabelManagerOpen(false)}
      />

      <ContractModal
        isOpen={isContractModalOpen}
        onClose={() => setIsContractModalOpen(false)}
        buyerName={selectedLead?.name || ''}
      />

      <StatusModal
        isOpen={isStatusModalOpen}
        error={statusError}
        isPosting={isPostingStatus}
        text={statusText}
        onTextChange={setStatusText}
        backgroundColor={statusBackgroundColor}
        onBackgroundColorChange={setStatusBackgroundColor}
        imageBase64={statusImageBase64}
        imageFileName={statusImageFileName}
        onClearImage={() => { setStatusImageBase64(null); setStatusImageFileName(''); }}
        onImageSelect={handleStatusImageSelect}
        videoBase64={statusVideoBase64}
        videoFileName={statusVideoFileName}
        onClearVideo={() => { setStatusVideoBase64(null); setStatusVideoFileName(''); }}
        onVideoSelect={handleStatusVideoSelect}
        caption={statusCaption}
        onCaptionChange={setStatusCaption}
        onSubmit={handlePostStatus}
        onClose={() => { setIsStatusModalOpen(false); setStatusError(null); setStatusImageBase64(null); setStatusImageFileName(''); setStatusVideoBase64(null); setStatusVideoFileName(''); setStatusText(''); setStatusCaption(''); }}
      />

      {/* Gatilhos de texto do modo "somente anúncios" — um por linha, texto
          exato do "ice breaker" que a Meta oferece no botão do anúncio. */}
      {isAdTriggersModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setIsAdTriggersModalOpen(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Filter className="w-5 h-5 text-sky-400" />
              Gatilhos de Anúncio
            </h3>
            <p className="text-xs text-slate-400">
              Um texto por linha — a mensagem-modelo ("ice breaker") que a Meta oferece no botão do anúncio. Quando a primeira mensagem de um lead bate com um desses textos, o agente responde mesmo sem o dado de clique no anúncio (ctwa_clid), que a Meta quase nunca preenche.
            </p>
            <AutoResizeTextarea
              placeholder={'Me gustaría reservar un horario para el combo de cejas y labios 💕\n¡Hola! Vi el anuncio y me gustaría agendar un horario. 😊'}
              value={adTriggersDraft}
              onChange={(e) => setAdTriggersDraft(e.target.value)}
              minRows={4}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-sky-500 focus:outline-none"
            />
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAdTriggersModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveAdTriggerMessages}
                disabled={isSavingAdTriggers}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 shadow-md shadow-sky-950 cursor-pointer"
              >
                {isSavingAdTriggers ? (isSpanish ? 'Guardando...' : 'Salvando...') : (isSpanish ? 'Guardar' : 'Salvar')}
              </button>
            </div>
          </div>
        </div>
      )}

      {operatorFeedbackKind && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setOperatorFeedbackKind(null)}>
          <form onSubmit={submitOperatorFeedback} onClick={(event) => event.stopPropagation()} className="bg-slate-900 border border-slate-700 rounded-2xl p-5 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`text-[10px] uppercase tracking-wider font-bold ${operatorFeedbackKind === 'bug' ? 'text-rose-300' : 'text-amber-300'}`}>Feedback supervisionado</p>
                <h3 className="text-lg font-bold text-white mt-1">{operatorFeedbackKind === 'bug' ? 'Reportar bug' : 'Sugerir melhoria'}</h3>
                <p className="text-xs text-slate-500 mt-1">{isSpanish ? 'Conversación:' : 'Conversa:'} {selectedLead?.name || selectedLead?.phone || (isSpanish ? 'no seleccionada' : 'não selecionada')}</p>
              </div>
              <button type="button" onClick={() => setOperatorFeedbackKind(null)} className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <label className="block">
              <span className="text-[11px] text-slate-400">Título</span>
              <input required value={operatorFeedbackTitle} onChange={(event) => setOperatorFeedbackTitle(event.target.value)} placeholder={operatorFeedbackKind === 'bug' ? 'Ex.: Comprovante aparece sem vínculo' : 'Ex.: Mostrar cobrança ao lado da conversa'} className="mt-1 w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500" />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-400">O que aconteceu e o que deveria acontecer?</span>
              <textarea required rows={5} value={operatorFeedbackDescription} onChange={(event) => setOperatorFeedbackDescription(event.target.value)} placeholder="Descreva o contexto para que o administrador consiga revisar depois." className="mt-1 w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-emerald-500" />
            </label>
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[10px] text-slate-500">A decisão de publicar qualquer ajuste continua com o administrador.</p>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button type="button" onClick={() => setOperatorFeedbackKind(null)} className="px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-white cursor-pointer">{isSpanish ? 'Cancelar' : 'Cancelar'}</button>
                <button type="submit" disabled={isSubmittingOperatorFeedback} className={`px-3.5 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-50 cursor-pointer ${operatorFeedbackKind === 'bug' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-amber-600 hover:bg-amber-500'}`}>{isSubmittingOperatorFeedback ? (isSpanish ? 'Enviando...' : 'Enviando...') : (isSpanish ? 'Enviar para revisión' : 'Enviar para revisão')}</button>
              </div>
            </div>
          </form>
        </div>
      )}

      <UpcomingEventsPanel
        isOpen={isUpcomingEventsPanelOpen}
        onClose={() => setIsUpcomingEventsPanelOpen(false)}
        events={upcomingEvents}
        isLoading={isLoadingUpcomingEvents}
        error={upcomingEventsError}
        onRefresh={() => fetchUpcomingEvents()}
        leads={leads}
        onCreateAdHocContactForAppointment={handleCreateAdHocContactForAppointment}
        onPickLeadForNewAppointment={handlePickLeadForNewAppointment}
        monthLabel={calendarMonthLabel}
        calendarYear={calendarMonth.year}
        calendarMonthNumber={calendarMonth.month}
        onPrevMonth={() => changeCalendarMonth(-1)}
        onNextMonth={() => changeCalendarMonth(1)}
        onToggleCompleted={handleToggleEventCompleted}
        onEditSummary={handleEditEventSummary}
        onReschedule={handleRescheduleEvent}
        onDelete={handleDeleteEvent}
        onRegisterPayment={handleRegisterEventPayment}
        onEditPayment={handleEditEventPayment}
        googleCalendarConnected={googleCalendarConnected}
        backupSheetUrl={backupSheetUrl}
      />

      {selectedLead && (
        <ReopenConversationModal
          isOpen={isReopenModalOpen}
          onClose={() => setIsReopenModalOpen(false)}
          phone={selectedLead.phone}
          contactName={selectedLead.name}
          businessName={activeTenant.name}
          suggestedService={visibleContactContext?.memory?.serviceInterest || undefined}
          onTemplateSent={() => {
            void refreshContactContext();
            if (selectedLead && (selectedLead as any).isReal) {
              void loadRealConversationHistory(selectedLead.phone, selectedLead.id);
            }
          }}
        />
      )}
    </div>
  );
};
