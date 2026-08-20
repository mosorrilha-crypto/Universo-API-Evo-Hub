import React, { useState, useEffect, useMemo } from 'react';
import { AgentKnowledgeBase, AgentProduct, ProductVariant, AgentFAQ, AgentFileDoc, BusinessHours, DayHours, FirstContactBlock, FirstContactBlockType, Tenant } from '../types';
import { apiFetch } from '../lib/apiClient';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import {
  Brain,
  Sparkles,
  Save,
  Plus,
  Trash2,
  FileText,
  HelpCircle,
  ShieldAlert,
  Building2,
  Target,
  DollarSign,
  Upload,
  CheckCircle2,
  RotateCcw,
  Zap,
  BookOpen,
  ArrowRight,
  Sliders,
  Check,
  Layers,
  FileCheck,
  Clock,
  Download,
  Loader2,
  BrainCircuit,
  Video,
  Play,
  Send,
  X,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  ChevronUp,
  ChevronDown,
  GripVertical
} from 'lucide-react';

interface AgentKnowledgeBaseProps {
  knowledgeBase: AgentKnowledgeBase;
  onSaveKnowledgeBase: (kb: AgentKnowledgeBase) => Promise<boolean>;
  businessHours: BusinessHours;
  onSaveBusinessHours: (hours: BusinessHours) => Promise<boolean>;
  onGoToWhatsAppSim: () => void;
  /** Tenants cuja Base de Conhecimento pode ser copiada como ponto de partida — vazio pra quem não é saas_admin (a rota no backend também exige esse papel). */
  copyableTenants?: Tenant[];
  /** Busca a Base de Conhecimento REAL de outro tenant (GET /api/admin/tenants/:id/knowledge-base) — null em caso de falha, o próprio App.tsx já mostra o toast de erro. */
  onFetchTenantKnowledgeBase?: (tenantId: string) => Promise<AgentKnowledgeBase | null>;
}

/** "0" domingo .. "6" sábado, mesma convenção de server/services/tenantProfileStore.ts (Date.getUTCDay()). */
const WEEKDAY_LABELS: { key: string; label: string }[] = [
  { key: '1', label: 'Segunda' },
  { key: '2', label: 'Terça' },
  { key: '3', label: 'Quarta' },
  { key: '4', label: 'Quinta' },
  { key: '5', label: 'Sexta' },
  { key: '6', label: 'Sábado' },
  { key: '0', label: 'Domingo' },
];

const DEFAULT_DAY_HOURS: DayHours = { open: '09:00', close: '18:00' };

/** Ícone/rótulo/cor de cada tipo de bloco da Mensagem Inicial de Primeiro Contato — usado pra montar a sequência ordenada (ver SECTION 6 abaixo). */
const FIRST_CONTACT_BLOCK_META: Record<FirstContactBlockType, { label: string; icon: React.ReactNode; color: string }> = {
  text: { label: 'Texto', icon: <MessageSquare className="w-3.5 h-3.5" />, color: 'text-slate-300' },
  image: { label: 'Imagem', icon: <ImageIcon className="w-3.5 h-3.5" />, color: 'text-blue-400' },
  video: { label: 'Vídeo', icon: <Video className="w-3.5 h-3.5" />, color: 'text-emerald-400' },
  file: { label: 'Arquivo', icon: <Paperclip className="w-3.5 h-3.5" />, color: 'text-purple-400' },
};

/**
 * Achado real em produção: os catálogos semeados via scripts/seed-monique-
 * knowledge-base.ts nunca tiveram campo `id` (o tipo do backend,
 * server/services/knowledgeBaseStore.ts, nem declara essa propriedade — só
 * o tipo do frontend, src/types.ts, exige `id: string`). Isso significa que
 * itens vindos do servidor chegam aqui com `id === undefined` em TODOS eles.
 * handleProductFieldChange/handlePromoChange/handleDeleteProduct comparam
 * por `p.id === id` — com todo mundo compartilhando `undefined`, editar UM
 * produto atualizava TODOS ao mesmo tempo (ex real: editar o preço de
 * "Neutralización" mudou também "Combo Cejas + Labios", "Retoque" etc. pro
 * mesmo valor). Gera um id único pra qualquer item sem um (ou com um
 * duplicado) assim que os dados entram no editor, antes de qualquer edição
 * ser possível.
 */
export function ensureUniqueIds<T extends { id?: string }>(items: T[] | undefined, prefix: string): (T & { id: string })[] {
  const seen = new Set<string>();
  return (items || []).map((item, idx) => {
    let id = item.id;
    if (!id || seen.has(id)) {
      id = `${prefix}-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`;
    }
    seen.add(id);
    return { ...item, id };
  });
}

// Espelha o "PROMPT FINAL — MONIQUE SORRILHA BEAUTY STUDIO" (versão final
// fechada em 07/08/2026, ver scripts/seed-monique-knowledge-base.ts pra a
// cópia que roda de verdade no backend/Gemini). Essa cópia aqui alimenta só
// o editor local da aba "Base de Conhecimento" — mantida em paridade com o
// backend pra nunca voltar a divergir (achado numa auditoria: essa cópia
// tinha só 10 dos 21 serviços e ainda mostrava a promoção de julho/2026 já
// vencida, "[PROMO Gs 450.000]", hardcoded no preço).
export const moniqueStudioKnowledgeBase: AgentKnowledgeBase = {
  companyName: 'Monique Sorrilha Beauty Studio',
  agentGoal: 'Atender clientes pelo WhatsApp e Instagram com a voz e o posicionamento da marca (sem afirmar ser literalmente a Monique): entender desejo/medo/necessidade, recomendar o serviço mais adequado, informar valor/duração com clareza, conduzir ao próximo passo (disponibilidade real → seña → confirmação de turno), fazer follow-up sem pressionar, estimular retorno/indicação/avaliação. Se perguntarem quem atende: "Soy la asistente del estudio y te ayudo con la información y la coordinación de tu turno con Monique."',
  toneOfVoice: 'Espanhol paraguaio com voseo natural (vos, querés, buscás, podés) quando a cliente escreve em espanhol, português quando ela escreve em português. Tom caloroso, próximo, humano, profissional, premium, nunca robótico. Expressões carinhosas com moderação (reina, amiga, linda, mi vida) — nunca em toda frase. NUNCA use diminutivo (nada de "-ito"/"-ita"). Escreva como uma pessoa real digitando no celular: frases curtas, sem parênteses nem dois-pontos explicativos dentro da mensagem. Evite usted, linguagem corporativa, excesso de emojis, pressão ou falsa urgência.',
  businessModel: 'Estúdio premium de micropigmentação e beleza (pestañas, cejas, labios) em Luque, Paraguai — atendimento de uma cliente por vez, privacidade, experiência sensorial com som binaural, técnica brasileira, resultado natural e personalizado. Monique é brasileira, mais de 13 anos de experiência. Instagram: @pestanaspormonique. Endereço: Calle Paso Bogarín 3665, Loma Merlo, Luque. Horário: segunda a sexta 07:30–20:00, sábados 08:00–13:00, domingos 09:00–17:00.',
  locationMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Calle%20Paso%20Bogar%C3%ADn%203665%2C%20Loma%20Merlo%2C%20Luque%2C%20Paraguay',
  pricingAndPolicies: 'Seña de Gs 50.000, sempre a primeira forma de confirmação oferecida, por transferência (Alias/Cédula: 5286155, Titular: Sara Jazmin Escobar Ruiz) — abatida do valor total do serviço. Efetivo só quando a cliente pedir/demonstrar dificuldade com transferência; nesse caso paga o valor total depois do atendimento. Cancelamento: seña devolvida com 24h+ de antecedência, não devolvida com menos de 24h. Retoque NÃO incluso no valor inicial (Gs 150.000 quando Monique recomendar após avaliar). Nunca desconto ou parcelamento não autorizado.',
  products: [
    // PESTAÑAS
    { id: 'm1', name: 'Lash Lift', price: 'Gs 140.000', priceAmount: 140000, currency: 'PYG', durationMinutes: 90, description: 'Pestañas — curva e realça as próprias pestañas, sem extensões. Efeito natural que dura semanas.' },
    { id: 'm2', name: 'Efecto 30+', price: 'Gs 350.000', priceAmount: 350000, currency: 'PYG', durationMinutes: 120, description: 'Pestañas — extensões técnica brasileira, retenção de até 30 dias, máximo volume.' },
    { id: 'm3', name: 'Efecto Delineado', price: 'Gs 220.000', priceAmount: 220000, currency: 'PYG', durationMinutes: 120, description: 'Pestañas — extensões concentradas na linha das pestañas, efeito delineado sutil.' },
    { id: 'm4', name: 'Efecto Rímel', price: 'Gs 220.000', priceAmount: 220000, currency: 'PYG', durationMinutes: 120, description: 'Pestañas — volume leve e natural, como rímel todos os dias.' },
    { id: 'm5', name: 'Efecto Volumen Brasileño', price: 'Gs 200.000', priceAmount: 200000, currency: 'PYG', durationMinutes: 90, description: 'Pestañas — técnica clássica do estúdio, volume marcado sem perder naturalidade.' },
    { id: 'm6', name: 'Marrones', price: 'Gs 200.000', priceAmount: 200000, currency: 'PYG', durationMinutes: 90, description: 'Pestañas — extensões em tom marrom, look diário discreto.' },
    { id: 'm7', name: 'Efecto Foxy', price: 'Gs 200.000', priceAmount: 200000, currency: 'PYG', durationMinutes: 120, description: 'Pestañas — extensões personalizadas conforme o visagismo dos olhos e formato do rosto.' },
    // CEJAS
    { id: 'm8', name: 'Microshading', price: 'Gs 500.000', priceAmount: 500000, currency: 'PYG', durationMinutes: 120, description: 'Cejas — sombreado em pó, efeito de cejas maquiadas todos os dias.' },
    { id: 'm9', name: 'Pelo a Pelo', price: 'Gs 500.000', priceAmount: 500000, currency: 'PYG', durationMinutes: 120, description: 'Cejas — desenho traço a traço hiper-realista, imitando cada fio.' },
    { id: 'm10', name: 'Diseño con Henna', price: 'Gs 80.000', priceAmount: 80000, currency: 'PYG', durationMinutes: 30, description: 'Cejas — desenho temporal, ideal pra testar formato antes de algo permanente.' },
    { id: 'm11', name: 'Diseño Tradicional con Hilo', price: 'Gs 60.000', priceAmount: 60000, currency: 'PYG', durationMinutes: 30, description: 'Cejas — depilação de precisão com linha.' },
    { id: 'm12', name: 'Browlamination', price: 'Gs 100.000', priceAmount: 100000, currency: 'PYG', durationMinutes: 90, description: 'Cejas — penteia e fixa os fios pra cima, efeito full por ~1 semana.' },
    { id: 'm13', name: 'Coloración', price: 'Gs 80.000', priceAmount: 80000, currency: 'PYG', durationMinutes: 30, description: 'Cejas — tinta que empareja a cor dos fios.' },
    { id: 'm14', name: 'Browlamination + Coloración', price: 'Gs 150.000', priceAmount: 150000, currency: 'PYG', durationMinutes: 90, description: 'Cejas — combina penteado dos fios com cor mais pareja.' },
    // LABIOS
    { id: 'm15', name: 'Microlips', price: 'Gs 500.000', priceAmount: 500000, currency: 'PYG', durationMinutes: 120, description: 'Labios — cor natural e definida, sem depender tanto do batom.' },
    { id: 'm16', name: 'Neutralización', price: 'Gs 450.000', priceAmount: 450000, currency: 'PYG', durationMinutes: 120, description: 'Labios — corrige tons indesejados de uma micropigmentação labial anterior.' },
    // COMBOS
    { id: 'm17', name: 'Combo Cejas + Labios', price: 'Gs 800.000', priceAmount: 800000, currency: 'PYG', durationMinutes: 180, description: 'Combo — cejas e labios na mesma sessão.' },
    { id: 'm18', name: 'Combo Cejas + Pestañas', price: 'Gs 600.000', priceAmount: 600000, currency: 'PYG', durationMinutes: 180, description: 'Combo — cejas e pestañas na mesma sessão.' },
    { id: 'm19', name: 'Combo Triple: Cejas + Labios + Pestañas', price: 'Gs 1.000.000', priceAmount: 1000000, currency: 'PYG', durationMinutes: 180, description: 'Combo — cejas, labios e pestañas na mesma sessão.' },
    { id: 'm20', name: 'Combo Pestañas + Labios', price: 'Gs 650.000', priceAmount: 650000, currency: 'PYG', durationMinutes: 210, description: 'Combo — pestañas e labios na mesma sessão.' },
    // RETOQUE — não é agendável por si só (bookable:false), listado só pra o agente nunca inventar o preço
    { id: 'm21', name: 'Retoque', price: 'Gs 150.000', priceAmount: 150000, currency: 'PYG', bookable: false, description: 'NÃO incluso no valor inicial, não é necessário pra todas as clientes — só quando Monique recomenda após avaliar o resultado.' },
  ],
  businessRules: [
    'Fale com a voz da marca, nunca como se fosse literalmente Monique.',
    'Não faça diagnóstico definitivo só por foto ou mensagem.',
    'Se a cliente tiver medo de algo mais duradouro, ofereça alternativa de menor compromisso: Diseño Tradicional con Hilo, Diseño con Henna, Coloración, Browlamination ou Lash Lift.',
    'O resultado (cejas/labios) pode durar mais de um ano dependendo da pele/cuidados.',
    'Retoque NÃO incluso, não é pra todas — só quando Monique recomenda após avaliar, Gs 150.000. Nunca diga que é grátis, incluso, obrigatório ou automático.',
    'As 3 fotos de referência disponíveis são: combo cejas+labios, Microlips antes/depois, pestañas+delineado antes/depois.',
    'Encaminhe pra Monique/operador também quando a cliente perguntar sobre cursos (fora do escopo desta base).',
    'Cursos só acontecem no Brasil por enquanto — nunca invente data/valor de curso no Paraguai; direcione pra seguir @pestanaspormonique.',
  ],
  faqs: [
    { id: 'mf1', question: '¿Duele el procedimiento?', answer: 'Te entiendo, amiga. Es normal tener esa duda. La sensación depende mucho de la sensibilidad de cada persona. Usamos anestesia tópica cuando corresponde y suele describirse como una molestia leve, pero no puedo prometer que no vas a sentir nada.' },
    { id: 'mf2', question: '¿Cuánto dura el resultado?', answer: 'El resultado puede durar más de un año, dependiendo de tu piel, tus cuidados, la exposición al sol y otros factores.' },
    { id: 'mf3', question: '¿El retoque está incluido?', answer: 'El retoque no está incluido y no siempre es necesario. En algunos casos puntuales, Monique puede recomendarlo después de evaluar el resultado. Si fuera necesario, tiene un valor de Gs 150.000.' },
    { id: 'mf4', question: '¿Puedo pagar en efectivo?', answer: 'Sí, podés pagar en efectivo. En ese caso, coordinamos tu turno normalmente y abonás el valor total del servicio después de la atención.' },
    { id: 'mf5', question: '¿Qué pasa si cancelo mi turno?', answer: 'Te recuerdo que la seña se devuelve si la cancelación se informa con 24 horas o más de anticipación. Con menos de 24 horas, la seña no es reembolsable.' },
    { id: 'mf6', question: '¿Dan clases/cursos en Paraguay?', answer: 'Por ahora, los cursos de Monique se realizan solamente en Brasil, amiga. Como ella todavía está perfeccionando su español, aún no abrió clases en Paraguay. Pero podés seguir @pestanaspormonique para enterarte apenas se abran nuevas fechas por acá.' },
  ],
  documents: [
    {
      id: 'md1',
      fileName: 'Portfolio_Valores_Monique_2026.png',
      fileSize: '2.1 MB',
      uploadDate: 'Hoje às 14:00',
      status: 'Processado'
    },
    {
      id: 'md2',
      fileName: 'Guia_Cuidados_Pos_Micropigmentacao.pdf',
      fileSize: '1.8 MB',
      uploadDate: 'Hoje às 14:05',
      status: 'Processado'
    }
  ]
};

export const defaultKnowledgeBase: AgentKnowledgeBase = {
  companyName: 'TechCorp CRM Solutions',
  agentGoal: 'Qualificação de Leads B2B e Agendamento de Reuniões de Demonstração Comercial',
  toneOfVoice: 'Consultivo, cordial, objetivo e persuasivo com uso moderado de emojis',
  businessModel: 'Plataforma SaaS para Automação Comercial e WhatsApp CRM.',
  pricingAndPolicies: 'Plano Starter: R$ 290/mês (até 3 atendentes). Plano Pro: R$ 690/mês (até 10 atendentes). Plano Enterprise: $1,500/mês (ilimitado e gerente dedicado). Pagamento via Pix, Boleto ou Cartão de Crédito. Garantia de 7 dias.',
  products: [
    {
      id: 'p1',
      name: 'Plano Starter (SaaS)',
      price: 'R$ 290 / mês',
      description: 'Ideal para pequenas equipes de até 3 atendentes com transcrição de áudio e CRM básico.'
    },
    {
      id: 'p2',
      name: 'Plano Pro (SaaS)',
      price: 'R$ 690 / mês',
      description: 'Até 10 atendentes, inteligência multimodal Gemini e automações de funil.'
    },
    {
      id: 'p3',
      name: 'Plano Enterprise',
      price: '$1,500 / mês',
      description: 'Atendimento corporativo ilimitado, suporte internacional e integrações customizadas.'
    }
  ],
  businessRules: [
    'Sempre oferecer o agendamento de uma reunião de demonstração com os consultores.',
    'Nunca oferecer descontos acima de 15% sem autorização prévia da gerência comercial.',
    'Clientes do exterior podem pagar em Dólar (USD) ou Euro (EUR) com suporte a múltiplos idiomas.',
    'Sempre esclarecer os prazos de implementação (máximo de 48h úteis pós-contratação).'
  ],
  faqs: [
    {
      id: 'f1',
      question: 'A plataforma possui período de teste grátis (free trial)?',
      answer: 'Oferecemos 7 dias de garantia incondicional com reembolso total em caso de insatisfação.'
    },
    {
      id: 'f2',
      question: 'Vocês emitem nota fiscal e contrato de prestação de serviços?',
      answer: 'Sim! Emitimos NF-e automaticamente para todas as assinaturas brasileiras e invoice para pagamentos internacionais.'
    },
    {
      id: 'f3',
      question: 'Como funciona a transcrição de áudios e análise de sentimento?',
      answer: 'A plataforma utiliza o modelo Gemini 3.6 Flash da Google para transcrever áudios em tempo real e atualizar a ficha CRM do lead.'
    }
  ],
  documents: [
    {
      id: 'd1',
      fileName: 'Tabela_Precos_e_Planos_2026.pdf',
      fileSize: '1.2 MB',
      uploadDate: 'Hoje às 10:15',
      status: 'Processado'
    },
    {
      id: 'd2',
      fileName: 'Manual_Integracao_WhatsApp_Webhooks.pdf',
      fileSize: '3.4 MB',
      uploadDate: 'Hoje às 11:30',
      status: 'Processado'
    }
  ]
};

// Preset templates for fast 1-click loading
const PRESET_TEMPLATES: { name: string; icon: string; desc: string; data: Partial<AgentKnowledgeBase> }[] = [
  {
    name: '✨ Monique Sorrilha Studio (Micropigmentación)',
    icon: 'Sparkles',
    desc: 'Estúdio de Estética, Micropigmentação (Microshading/Microlips/Pelo a Pelo), Cílios e Seña de Gs 50.000.',
    data: moniqueStudioKnowledgeBase
  },
  {
    name: '🚀 SaaS & Tecnologia B2B',
    icon: 'Zap',
    desc: 'Focado em agendamento de reuniões, planos mensais e contratos SaaS.',
    data: {
      companyName: 'TechCorp CRM Solutions',
      agentGoal: 'Qualificar Leads B2B e Agendar Reuniões de Demonstração com Executivos de Vendas',
      toneOfVoice: 'Consultivo, cordial, dinâmico e focado em valor de negócio',
      businessModel: 'Plataforma SaaS por assinatura mensal/anual.',
      pricingAndPolicies: 'Plano Starter: R$ 290/mês. Plano Pro: R$ 690/mês. Enterprise: R$ 1.500/mês. Faturamento via Pix, Boleto ou Cartão.',
      businessRules: [
        'Sempre buscar agendar uma call de demonstração de 20 minutos.',
        'Não conceder descontos superiores a 10% sem aprovação do Diretor.',
        'Sempre perguntar o tamanho da equipe comercial do cliente.'
      ]
    }
  },
  {
    name: '🛒 E-commerce & Varejo',
    icon: 'Building2',
    desc: 'Focado em catálogo de produtos, frete, prazo de entrega e descontos de cupom.',
    data: {
      companyName: 'Loja Moda & Estilo Online',
      agentGoal: 'Esclarecer Dúvidas de Produtos, Ajudar na Escolha de Tamanhos e Finalizar Compras',
      toneOfVoice: 'Amigável, descontraído, entusiasta e solícito com emojis',
      businessModel: 'Venda de vestuário e acessórios com entrega em todo o Brasil.',
      pricingAndPolicies: 'Frete grátis para compras acima de R$ 199. Troca grátis em até 30 dias. Parcelamento em até 6x sem juros.',
      businessRules: [
        'Sempre informar o cupom de boas-vindas PRIMEIRA10 para 10% OFF.',
        'Em caso de dúvidas de tamanho, sugerir nosso provador virtual.',
        'Prazo médio de entrega: 3 a 7 dias úteis.'
      ]
    }
  },
  {
    name: '🏥 Clínica & Saúde',
    icon: 'Target',
    desc: 'Focado em agendamento de consultas, planos de saúde e instruções de preparo.',
    data: {
      companyName: 'Clínica Saúde & Bem-Estar',
      agentGoal: 'Agendamento de Consultas e Exames e Triage Inicial de Pacientes',
      toneOfVoice: 'Acolhedor, empático, altamente profissional e atencioso',
      businessModel: 'Prestação de serviços médicos e exames diagnósticos.',
      pricingAndPolicies: 'Consulta R$ 250 (particular). Aceitamos convênios Bradesco, SulAmérica e Unimed. Pagamento em até 3x no cartão.',
      businessRules: [
        'Solicitar o nome completo e data de nascimento antes do agendamento.',
        'Informar a necessidade de jejum de 8 horas para exames de sangue.',
        'Sempre confirmar o plano de saúde do paciente.'
      ]
    }
  }
];

export const AgentKnowledgeBaseView: React.FC<AgentKnowledgeBaseProps> = ({
  knowledgeBase,
  onSaveKnowledgeBase,
  businessHours,
  onSaveBusinessHours,
  onGoToWhatsAppSim,
  copyableTenants = [],
  onFetchTenantKnowledgeBase,
}) => {
  const [formData, setFormData] = useState<AgentKnowledgeBase>(() => ({
    ...knowledgeBase,
    products: ensureUniqueIds(knowledgeBase.products, 'prod'),
    faqs: ensureUniqueIds(knowledgeBase.faqs, 'faq'),
    documents: ensureUniqueIds(knowledgeBase.documents, 'doc'),
    firstContactBlocks: ensureUniqueIds(knowledgeBase.firstContactBlocks, 'fcblock'),
  }));
  const [isSavedToast, setIsSavedToast] = useState(false);

  // Gavetas (accordion) das 6 seções da aba — pedido real (20/08/2026): a
  // aba tinha ficado extensa demais com tudo sempre visível de uma vez
  // (ver comentário "Visão unificada" abaixo, que já tinha abolido as
  // antigas 6 abas separadas). Fechadas por padrão pra reduzir o scroll
  // inicial; o estado não persiste entre sessões, é só de UI.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) => setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // Recurso separado (tabela `tenants`, não a base de conhecimento) — save
  // próprio, não passa pelo handleSave/onSaveKnowledgeBase de cima.
  const [hoursForm, setHoursForm] = useState<BusinessHours>(() => businessHours);
  const [isSavingHours, setIsSavingHours] = useState(false);

  const handleToggleDay = (day: string, enabled: boolean) => {
    setHoursForm((prev) => {
      const next = { ...prev };
      if (enabled) {
        next[day] = prev[day] || { ...DEFAULT_DAY_HOURS };
      } else {
        delete next[day];
      }
      return next;
    });
  };

  const handleDayTimeChange = (day: string, field: keyof DayHours, value: string) => {
    setHoursForm((prev) => ({
      ...prev,
      [day]: { ...(prev[day] || DEFAULT_DAY_HOURS), [field]: value },
    }));
  };

  const handleSaveHours = async () => {
    setIsSavingHours(true);
    try {
      await onSaveBusinessHours(hoursForm);
    } finally {
      setIsSavingHours(false);
    }
  };

  // Input states for adding new items
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductDesc, setNewProductDesc] = useState('');
  // Achado real (18/08/2026, Clic Piscinas): durationMinutes já existe no
  // tipo do produto e já é usado pra calcular o fim real do evento no
  // Calendar (ver criar_agendamento/consultar_disponibilidade_semana em
  // autoReply.ts) — mas não existia campo nenhum no painel pra cadastrar
  // isso, só vinha preenchido pro seed hardcoded da Monique. Sem duração
  // configurada, todo produto caía no fallback conservador de 1h, errado
  // pra serviços mais longos (ex: instalação de piscina).
  const [newProductDuration, setNewProductDuration] = useState('');

  const [newRuleText, setNewRuleText] = useState('');

  const [newFaqQuestion, setNewFaqQuestion] = useState('');
  const [newFaqAnswer, setNewFaqAnswer] = useState('');

  // Achado numa auditoria: o toast "Salva com Sucesso!" aparecia sempre,
  // mesmo quando o POST /api/knowledge-base falhava no servidor (rede,
  // Supabase fora do ar, sessão expirada) — o App.tsx só logava o erro no
  // console e nunca propagava a falha pra cá. A operadora achava que o preço
  // ou a regra nova já estava valendo, mas o agente Gemini real continuava
  // respondendo com a base de conhecimento antiga. Agora só mostra sucesso
  // quando o salvamento no servidor de fato confirmou.
  const handleSave = async () => {
    const updated = {
      ...formData,
      lastSaved: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };
    const saved = await onSaveKnowledgeBase(updated);
    if (saved) {
      setIsSavedToast(true);
      setTimeout(() => setIsSavedToast(false), 4000);
    }
  };

  // Presets parciais (SaaS/E-commerce/Clínica) só definem alguns campos —
  // sem resetar o resto, produtos/FAQs/documentos/regras de um preset
  // anterior (ex: Monique Studio) continuavam misturados com o nome/tom da
  // empresa nova, criando uma base de conhecimento contraditória (ex: um
  // agente "Clínica de Saúde" ainda cotando preço de micropigmentação).
  const handleApplyPreset = (preset: typeof PRESET_TEMPLATES[0]) => {
    setFormData((prev) => ({
      ...prev,
      products: preset.data.products ?? [],
      businessRules: preset.data.businessRules ?? [],
      faqs: preset.data.faqs ?? [],
      documents: preset.data.documents ?? [],
      ...preset.data,
    }));
  };

  // Pedido real (18/08/2026): os "Modelos de Negócio Prontos" acima são
  // fixos em código, sem jeito de editar sem deploy — isso deixa carregar a
  // Base de Conhecimento REAL de outro tenant como ponto de partida (mesmo
  // raciocínio de handleApplyPreset acima, mas buscando do servidor em vez
  // de um preset hardcoded). Vídeos/arquivos anexados via Storage (bloco de
  // 1º contato tipo vídeo/arquivo) NÃO vêm nessa cópia — ver comentário da
  // rota GET /api/admin/tenants/:id/knowledge-base no backend — precisam
  // ser re-anexados manualmente se fizerem falta.
  const [copySourceTenantId, setCopySourceTenantId] = useState('');
  const [isCopyingKb, setIsCopyingKb] = useState(false);
  const handleCopyFromTenant = async () => {
    if (!copySourceTenantId || !onFetchTenantKnowledgeBase) return;
    setIsCopyingKb(true);
    try {
      const copied = await onFetchTenantKnowledgeBase(copySourceTenantId);
      if (!copied) return; // erro já mostrado via toast em App.tsx
      setFormData((prev) => ({
        ...prev,
        ...copied,
        products: ensureUniqueIds(copied.products, 'prod'),
        faqs: ensureUniqueIds(copied.faqs, 'faq'),
        documents: ensureUniqueIds(copied.documents, 'doc'),
        firstContactBlocks: ensureUniqueIds(copied.firstContactBlocks, 'fcblock'),
      }));
    } finally {
      setIsCopyingKb(false);
    }
  };

  // Camada 1 (regras universais) por tenant (18/08/2026, pedido real do
  // dono do produto) — até aqui era uma regra só, global, editável só por
  // saas_admin; o admin de um tenant não tinha como nem ler esse texto,
  // risco real de duplicar/entrar em conflito com uma regra que já está
  // coberta ali. GET /api/tenant-prompt-layer exige papel admin+ — se este
  // usuário não tiver (403), a seção simplesmente não aparece (nunca mostra
  // erro pra quem não pode ver mesmo).
  const [tenantPromptLayer, setTenantPromptLayer] = useState<{ content: string; isCustomized: boolean; updatedAt: string | null } | null>(null);
  const [tenantPromptLayerVisible, setTenantPromptLayerVisible] = useState(false);
  const [isEditingTenantPromptLayer, setIsEditingTenantPromptLayer] = useState(false);
  const [tenantPromptLayerDraft, setTenantPromptLayerDraft] = useState('');
  const [tenantPromptLayerPassword, setTenantPromptLayerPassword] = useState('');
  const [tenantPromptLayerError, setTenantPromptLayerError] = useState<string | null>(null);
  const [isSavingTenantPromptLayer, setIsSavingTenantPromptLayer] = useState(false);

  useEffect(() => {
    apiFetch('/api/tenant-prompt-layer')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return; // 403 (papel abaixo de admin) — seção fica oculta
        setTenantPromptLayer(data);
        setTenantPromptLayerVisible(true);
      })
      .catch(() => {});
  }, []);

  const handleStartEditTenantPromptLayer = () => {
    setTenantPromptLayerDraft(tenantPromptLayer?.content || '');
    setTenantPromptLayerPassword('');
    setTenantPromptLayerError(null);
    setIsEditingTenantPromptLayer(true);
  };

  const handleSaveTenantPromptLayer = async () => {
    if (!tenantPromptLayerDraft.trim() || !tenantPromptLayerPassword) {
      setTenantPromptLayerError('Preencha o texto e confirme sua senha.');
      return;
    }
    setIsSavingTenantPromptLayer(true);
    setTenantPromptLayerError(null);
    try {
      const res = await apiFetch('/api/tenant-prompt-layer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: tenantPromptLayerDraft, currentPassword: tenantPromptLayerPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setTenantPromptLayer(data);
      setIsEditingTenantPromptLayer(false);
      setTenantPromptLayerPassword('');
    } catch (err: any) {
      setTenantPromptLayerError(err.message || 'Não foi possível salvar. Tente de novo.');
    } finally {
      setIsSavingTenantPromptLayer(false);
    }
  };

  const handleResetTenantPromptLayer = async () => {
    setIsSavingTenantPromptLayer(true);
    try {
      const res = await apiFetch('/api/tenant-prompt-layer', { method: 'DELETE' });
      if (res.ok) setTenantPromptLayer(await res.json());
      setIsEditingTenantPromptLayer(false);
    } finally {
      setIsSavingTenantPromptLayer(false);
    }
  };

  const handleAddProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim()) return;
    const item: AgentProduct = {
      id: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: newProductName.trim(),
      price: newProductPrice.trim() || 'Sob Consulta',
      description: newProductDesc.trim() || 'Sem descrição cadastrada',
      durationMinutes: newProductDuration.trim() ? Number(newProductDuration) : undefined,
    };
    setFormData((prev) => ({
      ...prev,
      products: [...prev.products, item]
    }));
    setNewProductName('');
    setNewProductPrice('');
    setNewProductDesc('');
    setNewProductDuration('');
  };

  const handleDeleteProduct = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      products: prev.products.filter((p) => p.id !== id)
    }));
  };

  const handlePromoChange = (id: string, field: 'promoPrice' | 'promoUntil', value: string) => {
    setFormData((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === id ? { ...p, [field]: value || undefined } : p)),
    }));
  };

  // Edita nome/preço/descrição de um produto já cadastrado direto no card —
  // sem isso, a única forma de corrigir algo era apagar e recriar do zero
  // (perdendo foto de exemplo, promoção etc. já configurados).
  const handleProductFieldChange = (id: string, field: 'name' | 'price' | 'description' | 'category', value: string) => {
    setFormData((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    }));
  };

  // Agrupamento visual por categoria (pedido real, 20/08/2026: catálogo com
  // muitos serviços de perto, ex: 19 itens de um estúdio de beleza, ficava
  // difícil de escanear numa lista só). `category` já existia no modelo de
  // dados e já era usado pra agrupar o texto do prompt do agente
  // (formatKnowledgeBaseForPrompt), mas não tinha campo editável nem
  // agrupamento visual aqui — só dava pra setar direto no banco. Não muda a
  // ordem/array real de `formData.products` (todo handler de edição continua
  // operando por `prod.id`), só a forma de renderizar a lista.
  const productGroups = useMemo(() => {
    const byCategory = new Map<string, AgentProduct[]>();
    const uncategorized: AgentProduct[] = [];
    for (const p of formData.products) {
      const category = p.category?.trim();
      if (!category) {
        uncategorized.push(p);
        continue;
      }
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category)!.push(p);
    }
    return { categorized: Array.from(byCategory.entries()), uncategorized };
  }, [formData.products]);

  // Variantes de tamanho/modelo dentro de um produto unificado (ex: "Piscina Fapac
  // Maresias" cobrindo 4x2.20m/5x2.60m/6x2.80m/7x3m, cada tamanho com preço próprio) —
  // permite 1 foto/vídeo só pro produto em vez de 1 produto por tamanho, evitando que
  // o agente envie a mesma mídia repetida várias vezes na mesma conversa.
  const handleAddVariant = (productId: string) => {
    const variant: ProductVariant = { code: '', price: 'Sob consulta' };
    setFormData((prev) => ({
      ...prev,
      products: prev.products.map((p) =>
        p.id === productId ? { ...p, variants: [...(p.variants || []), variant] } : p
      ),
    }));
  };

  const handleVariantFieldChange = (
    productId: string,
    index: number,
    field: keyof ProductVariant,
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      products: prev.products.map((p) => {
        if (p.id !== productId || !p.variants) return p;
        const variants = p.variants.map((v, i) => {
          if (i !== index) return v;
          if (field === 'litros' || field === 'priceAmount' || field === 'durationMinutes') {
            const numeric = value.trim() === '' ? undefined : Number(value);
            return { ...v, [field]: numeric === undefined || Number.isNaN(numeric) ? undefined : numeric };
          }
          return { ...v, [field]: value };
        });
        return { ...p, variants };
      }),
    }));
  };

  const handleDeleteVariant = (productId: string, index: number) => {
    setFormData((prev) => ({
      ...prev,
      products: prev.products.map((p) =>
        p.id === productId ? { ...p, variants: (p.variants || []).filter((_, i) => i !== index) } : p
      ),
    }));
  };

  const handleProductDurationChange = (id: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === id ? { ...p, durationMinutes: value.trim() ? Number(value) : undefined } : p)),
    }));
  };

  const handleProductImageChange = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result);
      setFormData((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === id ? { ...p, exampleImageBase64: base64, exampleImageMimeType: file.type } : p)),
      }));
    };
    reader.readAsDataURL(file);
  };

  const MAX_VIDEO_INPUT_SIZE_MB = 35; // teto do arquivo ORIGINAL antes de converter (ex: .MOV do iPhone) — mesmo valor de MAX_VIDEO_INPUT_BYTES no servidor; o servidor converte pro limite final de 16MB da Meta se precisar
  const [uploadingVideoForId, setUploadingVideoForId] = useState<string | null>(null);
  const [previewingVideoId, setPreviewingVideoId] = useState<string | null>(null);

  const fileToBase64Local = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // Diferente da foto (inline no formData): o vídeo sobe pro Storage do
  // backend na hora (não espera "Salvar Regras no Agente") e só a
  // referência (videoId) fica no formData local — mesmo motivo documentado
  // em knowledgeBaseVideoStore.ts: guardar um vídeo inteiro em base64 no
  // formData repetiria o incidente real de estouro de cota do localStorage
  // que já aconteceu com foto (ver App.tsx/safeSetLocalStorage).
  //
  // Aceita qualquer formato de vídeo aqui (inclusive .MOV do iPhone,
  // "video/quicktime") — quem decide se precisa converter pro formato que
  // a Meta aceita (MP4/3GPP) é o servidor, via ffmpeg (videoTranscode.ts).
  const handleProductVideoUpload = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      alert(`Arquivo não é um vídeo (${file.type || 'formato desconhecido'}).`);
      return;
    }
    if (file.size > MAX_VIDEO_INPUT_SIZE_MB * 1024 * 1024) {
      alert(`Vídeo maior que ${MAX_VIDEO_INPUT_SIZE_MB}MB. Comprima ou corte antes de enviar.`);
      return;
    }

    const oldVideoId = formData.products.find((p) => p.id === id)?.exampleVideoId;
    setUploadingVideoForId(id);
    try {
      const base64 = await fileToBase64Local(file);
      const res = await apiFetch('/api/knowledge-base/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64, oldVideoId }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}) as any);
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const { videoId, mimeType, fileName, sizeBytes } = await res.json();
      setFormData((prev) => ({
        ...prev,
        products: prev.products.map((p) =>
          p.id === id ? { ...p, exampleVideoId: videoId, exampleVideoMimeType: mimeType, exampleVideoFileName: fileName, exampleVideoSizeBytes: sizeBytes } : p
        ),
      }));
    } catch (err: any) {
      console.error('Falha ao enviar vídeo:', err);
      alert(`Não foi possível enviar o vídeo: ${err.message || 'tente novamente'}.`);
    } finally {
      setUploadingVideoForId(null);
    }
  };

  const handlePreviewProductVideo = async (videoId: string) => {
    setPreviewingVideoId(videoId);
    try {
      const res = await apiFetch(`/api/knowledge-base/videos/${videoId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('Falha ao abrir vídeo:', err);
      alert('Não foi possível abrir o vídeo.');
    } finally {
      setPreviewingVideoId(null);
    }
  };

  // Mensagem Inicial de Primeiro Contato (pedido real, 14-15/08/2026, Clic
  // Piscinas): sequência ORDENADA de blocos (texto/imagem/vídeo/arquivo)
  // mandada automaticamente na 1ª mensagem de uma conversa NOVA, em vez da
  // pergunta de triagem padrão da IA — ver server/services/firstContactMessage.ts.
  // Pedido explícito de poder intercalar tipos (ex: texto > vídeo > texto),
  // não só um texto + uma imagem + um vídeo soltos numa ordem fixa — por
  // isso é um array (firstContactBlocks), reordenável, em vez de um objeto
  // único. Mesmos padrões de upload já usados nos produtos (imagem inline
  // em base64, vídeo/arquivo sobem pro Storage na hora e só a referência
  // fica no formData).
  const MAX_FIRST_CONTACT_FILE_SIZE_MB = 15; // mesmo teto de MAX_DOCUMENT_BYTES no servidor
  const [uploadingBlockId, setUploadingBlockId] = useState<string | null>(null);
  const [previewingBlockMediaId, setPreviewingBlockMediaId] = useState<string | null>(null);

  const handleAddFirstContactBlock = (type: FirstContactBlockType) => {
    const block: FirstContactBlock = { id: `fcblock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type };
    setFormData((prev) => ({ ...prev, firstContactBlocks: [...(prev.firstContactBlocks || []), block] }));
  };

  const handleRemoveFirstContactBlock = (id: string) => {
    setFormData((prev) => ({ ...prev, firstContactBlocks: (prev.firstContactBlocks || []).filter((b) => b.id !== id) }));
  };

  // Sem biblioteca de drag-and-drop no projeto — reordena com botões
  // ↑/↓, trocando de posição com o vizinho, suficiente pra uma sequência
  // curta de blocos (o caso real de uso).
  const handleMoveFirstContactBlock = (id: string, direction: 'up' | 'down') => {
    setFormData((prev) => {
      const blocks = [...(prev.firstContactBlocks || [])];
      const idx = blocks.findIndex((b) => b.id === id);
      const swapWith = direction === 'up' ? idx - 1 : idx + 1;
      if (idx === -1 || swapWith < 0 || swapWith >= blocks.length) return prev;
      [blocks[idx], blocks[swapWith]] = [blocks[swapWith], blocks[idx]];
      return { ...prev, firstContactBlocks: blocks };
    });
  };

  const updateFirstContactBlock = (id: string, patch: Partial<FirstContactBlock>) => {
    setFormData((prev) => ({
      ...prev,
      firstContactBlocks: (prev.firstContactBlocks || []).map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  };

  const handleFirstContactBlockTextChange = (id: string, value: string) => updateFirstContactBlock(id, { text: value });

  const handleFirstContactBlockImageChange = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateFirstContactBlock(id, { imageBase64: String(reader.result), imageMimeType: file.type });
    reader.readAsDataURL(file);
  };

  const handleFirstContactBlockImageRemove = (id: string) => updateFirstContactBlock(id, { imageBase64: undefined, imageMimeType: undefined });

  const handleFirstContactBlockVideoUpload = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      alert(`Arquivo não é um vídeo (${file.type || 'formato desconhecido'}).`);
      return;
    }
    if (file.size > MAX_VIDEO_INPUT_SIZE_MB * 1024 * 1024) {
      alert(`Vídeo maior que ${MAX_VIDEO_INPUT_SIZE_MB}MB. Comprima ou corte antes de enviar.`);
      return;
    }

    const oldVideoId = formData.firstContactBlocks?.find((b) => b.id === id)?.videoId;
    setUploadingBlockId(id);
    try {
      const base64 = await fileToBase64Local(file);
      const res = await apiFetch('/api/knowledge-base/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64, oldVideoId }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}) as any);
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const { videoId, mimeType, fileName, sizeBytes } = await res.json();
      updateFirstContactBlock(id, { videoId, videoMimeType: mimeType, videoFileName: fileName, videoSizeBytes: sizeBytes });
    } catch (err: any) {
      console.error('Falha ao enviar vídeo:', err);
      alert(`Não foi possível enviar o vídeo: ${err.message || 'tente novamente'}.`);
    } finally {
      setUploadingBlockId(null);
    }
  };

  const handleFirstContactBlockVideoRemove = (id: string) =>
    updateFirstContactBlock(id, { videoId: undefined, videoMimeType: undefined, videoFileName: undefined, videoSizeBytes: undefined });

  const handleFirstContactBlockVideoCaptionChange = (id: string, value: string) => updateFirstContactBlock(id, { videoCaption: value });

  const handlePreviewFirstContactBlockVideo = async (videoId: string) => {
    setPreviewingBlockMediaId(videoId);
    try {
      const res = await apiFetch(`/api/knowledge-base/videos/${videoId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('Falha ao abrir vídeo:', err);
      alert('Não foi possível abrir o vídeo.');
    } finally {
      setPreviewingBlockMediaId(null);
    }
  };

  const handleFirstContactBlockFileUpload = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FIRST_CONTACT_FILE_SIZE_MB * 1024 * 1024) {
      alert(`Arquivo maior que ${MAX_FIRST_CONTACT_FILE_SIZE_MB}MB.`);
      return;
    }

    const oldFileId = formData.firstContactBlocks?.find((b) => b.id === id)?.fileId;
    setUploadingBlockId(id);
    try {
      const base64 = await fileToBase64Local(file);
      const res = await apiFetch('/api/knowledge-base/first-contact-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64, oldFileId }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}) as any);
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      const { fileId, mimeType, fileName, sizeBytes } = await res.json();
      updateFirstContactBlock(id, { fileId, fileMimeType: mimeType, fileName, fileSizeBytes: sizeBytes });
    } catch (err: any) {
      console.error('Falha ao enviar arquivo:', err);
      alert(`Não foi possível enviar o arquivo: ${err.message || 'tente novamente'}.`);
    } finally {
      setUploadingBlockId(null);
    }
  };

  const handleFirstContactBlockFileRemove = (id: string) =>
    updateFirstContactBlock(id, { fileId: undefined, fileMimeType: undefined, fileName: undefined, fileSizeBytes: undefined });

  const handlePreviewFirstContactBlockFile = async (fileId: string) => {
    setPreviewingBlockMediaId(fileId);
    try {
      const res = await apiFetch(`/api/knowledge-base/first-contact-file/${fileId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('Falha ao abrir arquivo:', err);
      alert('Não foi possível abrir o arquivo.');
    } finally {
      setPreviewingBlockMediaId(null);
    }
  };

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleText.trim()) return;
    setFormData((prev) => ({
      ...prev,
      businessRules: [...prev.businessRules, newRuleText.trim()]
    }));
    setNewRuleText('');
  };

  const handleDeleteRule = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      businessRules: prev.businessRules.filter((_, idx) => idx !== index)
    }));
  };

  const handleAddFaq = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFaqQuestion.trim() || !newFaqAnswer.trim()) return;
    const faqItem: AgentFAQ = {
      id: `faq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      question: newFaqQuestion.trim(),
      answer: newFaqAnswer.trim()
    };
    setFormData((prev) => ({
      ...prev,
      faqs: [...prev.faqs, faqItem]
    }));
    setNewFaqQuestion('');
    setNewFaqAnswer('');
  };

  const handleDeleteFaq = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      faqs: prev.faqs.filter((f) => f.id !== id)
    }));
  };

  const MAX_DOC_SIZE_MB = 15;
  // Espelha MAX_DOCUMENTS_PER_TENANT/MAX_TOTAL_BYTES_PER_TENANT em
  // server/routes/conversations.ts — só pra mostrar o uso na UI antes do
  // upload falhar; o teto real é sempre validado no backend.
  const MAX_DOCUMENTS_PER_TENANT = 30;
  const MAX_TOTAL_MB_PER_TENANT = 200;
  const [uploadingDocNames, setUploadingDocNames] = useState<string[]>([]);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  // Upload real (Storage do backend) — até aqui era só um registro visual
  // fictício, sem arquivo nenhum de verdade guardado em lugar algum (achado
  // real: os 2 "documentos" do preset da Monique nunca existiram, ninguém
  // conseguia abrir). Cada arquivo sobe e grava direto (não fica esperando
  // o botão "Salvar Regras no Agente" — mesmo motivo de horário de
  // funcionamento ter save próprio: é outro recurso, não o formData local).
  const handleRealFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = '';
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files) as File[];
    const oversized = fileArray.filter((f) => f.size > MAX_DOC_SIZE_MB * 1024 * 1024);
    if (oversized.length > 0) {
      alert(`Arquivo(s) maior(es) que ${MAX_DOC_SIZE_MB}MB não foram enviados: ${oversized.map((f) => f.name).join(', ')}`);
    }
    const accepted = fileArray.filter((f) => f.size <= MAX_DOC_SIZE_MB * 1024 * 1024);
    if (!accepted.length) return;

    setUploadingDocNames(accepted.map((f) => f.name));
    for (const file of accepted) {
      try {
        const base64 = await fileToBase64(file);
        const res = await apiFetch('/api/knowledge-base/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64 }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const { document } = await res.json();
        setFormData((prev) => ({ ...prev, documents: [...prev.documents, document] }));
      } catch (err: any) {
        console.error('Falha ao enviar documento:', err);
        alert(`Não foi possível enviar "${file.name}": ${err?.message || 'tente novamente.'}`);
      }
    }
    setUploadingDocNames([]);
  };

  const handleDeleteDoc = async (id: string) => {
    const previous = formData.documents;
    setFormData((prev) => ({ ...prev, documents: prev.documents.filter((d) => d.id !== id) }));
    try {
      const res = await apiFetch(`/api/knowledge-base/documents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('Falha ao apagar documento no servidor:', err);
      setFormData((prev) => ({ ...prev, documents: previous }));
      alert('Não foi possível apagar o documento no servidor. Tente novamente.');
    }
  };

  const handleDownloadDoc = async (doc: AgentFileDoc) => {
    setDownloadingDocId(doc.id);
    try {
      const res = await apiFetch(`/api/knowledge-base/documents/${doc.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.download = doc.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('Falha ao baixar documento:', err);
      alert('Não foi possível abrir o documento.');
    } finally {
      setDownloadingDocId(null);
    }
  };

  /**
   * Baixa tudo que o operador vê nesta tela (Camada 1, se visível pro seu
   * papel, + as 6 seções da Base de Conhecimento) num único .md — pra
   * auditoria/edição fora do painel, sem precisar copiar campo por campo.
   * Client-side só (Blob + link temporário), sem chamada ao backend.
   */
  const handleDownloadMarkdown = () => {
    const lines: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    lines.push(`# Base de Conhecimento — ${formData.companyName || 'Sem nome'}`);
    lines.push('');
    lines.push(`_Exportado em ${today}_`);
    lines.push('');

    if (tenantPromptLayerVisible && tenantPromptLayer) {
      lines.push('## Camada 1 — Regras Universais da Plataforma');
      lines.push('');
      lines.push(tenantPromptLayer.isCustomized ? '_Personalizada por esta empresa._' : '_Herdada da regra padrão da plataforma._');
      lines.push('');
      lines.push(tenantPromptLayer.content || '_(vazio)_');
      lines.push('');
    }

    lines.push('## 1. Perfil & Objetivo');
    lines.push('');
    lines.push(`- **Nome da empresa:** ${formData.companyName || '_(vazio)_'}`);
    lines.push(`- **Objetivo do agente:** ${formData.agentGoal || '_(vazio)_'}`);
    lines.push(`- **Tom de voz:** ${formData.toneOfVoice || '_(vazio)_'}`);
    lines.push(`- **Modelo de negócio:** ${formData.businessModel || '_(vazio)_'}`);
    lines.push(`- **Preços & políticas (texto livre):** ${formData.pricingAndPolicies || '_(vazio)_'}`);
    if (formData.locationMapsUrl) lines.push(`- **Link do Google Maps:** ${formData.locationMapsUrl}`);
    lines.push('');

    lines.push(`## 2. Regras de Negócio (${formData.businessRules.length})`);
    lines.push('');
    if (formData.businessRules.length) {
      formData.businessRules.forEach((rule, i) => lines.push(`${i + 1}. ${rule}`));
    } else {
      lines.push('_Nenhuma regra cadastrada._');
    }
    lines.push('');

    lines.push(`## 3. Preços & Produtos (${formData.products.length})`);
    lines.push('');
    if (formData.products.length) {
      formData.products.forEach((p) => {
        lines.push(`### ${p.name}`);
        lines.push(`- **Preço:** ${p.price}${p.promoPrice ? ` (promo: ${p.promoPrice}${p.promoUntil ? ` até ${p.promoUntil}` : ''})` : ''}`);
        if (p.durationMinutes) lines.push(`- **Duração:** ${p.durationMinutes} min`);
        if (p.bookable === false) lines.push(`- **Agendável direto pela IA:** não`);
        if (p.description) lines.push(`- **Descrição:** ${p.description}`);
        if (p.variants?.length) {
          lines.push(`- **Variações:**`);
          p.variants.forEach((v) => lines.push(`  - ${v.code}${v.dimensions ? ` (${v.dimensions})` : ''}: ${v.price}${v.durationMinutes ? ` — ${v.durationMinutes} min` : ''}${v.bookable === false ? ' (não agendável direto pela IA)' : ''}`));
        }
        lines.push('');
      });
    } else {
      lines.push('_Nenhum produto cadastrado._');
      lines.push('');
    }

    lines.push(`## 4. FAQ e Dúvidas (${formData.faqs.length})`);
    lines.push('');
    if (formData.faqs.length) {
      formData.faqs.forEach((f) => {
        lines.push(`**P: ${f.question}**`);
        lines.push(`R: ${f.answer}`);
        lines.push('');
      });
    } else {
      lines.push('_Nenhuma FAQ cadastrada._');
      lines.push('');
    }

    lines.push(`## 5. Documentos Anexados (${formData.documents.length})`);
    lines.push('');
    if (formData.documents.length) {
      formData.documents.forEach((d) => lines.push(`- ${d.fileName} (${d.fileSize}, ${d.status})`));
    } else {
      lines.push('_Nenhum documento anexado._');
    }
    lines.push('');

    lines.push('## 6. Mensagem Inicial de Primeiro Contato');
    lines.push('');
    const blocks = formData.firstContactBlocks || [];
    if (blocks.length) {
      blocks.forEach((b, i) => {
        if (b.type === 'text') lines.push(`${i + 1}. **Texto:** ${b.text || '_(vazio)_'}`);
        else if (b.type === 'image') lines.push(`${i + 1}. **Imagem** (anexada no painel, não incluída neste export)`);
        else if (b.type === 'video') lines.push(`${i + 1}. **Vídeo:** ${b.videoFileName || '(sem nome)'}${b.videoCaption ? ` — legenda: ${b.videoCaption}` : ''}`);
        else if (b.type === 'file') lines.push(`${i + 1}. **Arquivo:** ${b.fileName || '(sem nome)'}`);
      });
    } else {
      lines.push('_Nenhum bloco cadastrado — a IA responde a 1ª mensagem normalmente._');
    }
    lines.push('');

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (formData.companyName || 'base-de-conhecimento').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    a.download = `base-conhecimento-${safeName}-${today}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleResetToDefault = () => {
    if (window.confirm('Tem certeza que deseja restaurar as configurações padrão da base de conhecimento?')) {
      setFormData(defaultKnowledgeBase);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      
      {/* Top Header Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-900 border border-emerald-500/30 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 flex-shrink-0 shadow-lg shadow-emerald-950">
            <Brain className="w-6 h-6 text-emerald-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-white tracking-tight">
                Base de Conhecimento & Regras do Agente
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/40 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-emerald-400" />
                Agente Gemini Treinado
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Defina o objetivo do cliente, insira as regras de negócio, tabelas de preços, FAQs e anexos de treinamento. O Agente Gemini usará estas diretrizes para analisar conversas e sugerir respostas personalizadas no WhatsApp.
            </p>
          </div>
        </div>

        {/* Primary Header Actions */}
        <div className="flex items-center space-x-2.5 self-end md:self-auto flex-shrink-0">
          <button
            onClick={handleResetToDefault}
            className="px-3 py-2 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
            title="Restaurar padrão"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Restaurar</span>
          </button>

          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2 shadow-lg shadow-emerald-950/60 transition-all cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Salvar Regras no Agente</span>
          </button>
        </div>
      </div>

      {/* Preset Fast Template Buttons */}
      <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 shadow-md space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-400" />
            Modelos de Negócio Prontos (Carregamento em 1-Clique)
          </span>
          <span className="text-[11px] text-slate-500">Selecione para preencher automaticamente</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {PRESET_TEMPLATES.map((tmpl, idx) => (
            <div
              key={idx}
              onClick={() => handleApplyPreset(tmpl)}
              className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/80 hover:bg-slate-800/70 hover:border-emerald-500/40 transition-all cursor-pointer group flex flex-col justify-between"
            >
              <div>
                <h4 className="text-xs font-bold text-white group-hover:text-emerald-400 transition-colors flex items-center justify-between">
                  <span>{tmpl.name}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
                </h4>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  {tmpl.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Copiar Base de Conhecimento real de outro tenant (só saas_admin) */}
      {copyableTenants.length > 0 && (
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 shadow-md space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <Download className="w-4 h-4 text-sky-400" />
              Copiar Base de Conhecimento de outra empresa
            </span>
            <span className="text-[11px] text-slate-500">Só saas_admin • útil pra configurar um tenant novo a partir de um já pronto</span>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={copySourceTenantId}
              onChange={(e) => setCopySourceTenantId(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/60"
            >
              <option value="">Selecione a empresa de origem...</option>
              {copyableTenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              onClick={handleCopyFromTenant}
              disabled={!copySourceTenantId || isCopyingKb}
              className="px-4 py-2 rounded-xl font-bold text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              {isCopyingKb ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>Carregar nesta base</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Preenche o formulário abaixo com produtos, regras, FAQs e mensagem inicial (texto/imagem) dessa empresa — vídeos e arquivos anexados não são copiados, precisam ser re-anexados aqui se fizerem falta. Nada é salvo até você clicar em "Salvar Regras no Agente".
          </p>
        </div>
      )}

      {/* Camada 1 (regras universais) por tenant — só aparece pra quem tem papel admin+ (403 do backend = seção oculta) */}
      {tenantPromptLayerVisible && tenantPromptLayer && (
        <div className="bg-slate-900/90 border border-amber-800/40 rounded-2xl p-4 shadow-md space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              Regras Universais da Plataforma (Camada 1)
            </span>
            <span className="text-[11px] text-slate-500">
              {tenantPromptLayer.isCustomized ? 'Personalizada por esta empresa' : 'Herdada da regra padrão da plataforma'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Regras de segurança/comportamento que valem antes de qualquer coisa cadastrada abaixo (ex: nunca inventar preço, nunca confirmar pagamento sozinho). Só pra você saber o que já está garantido — evita cadastrar uma regra duplicada ou conflitante aqui embaixo sem saber que isso já existe. Editar aqui muda só esta empresa, nunca as outras.
          </p>
          {!isEditingTenantPromptLayer ? (
            <>
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
                {tenantPromptLayer.content}
              </div>
              <button
                type="button"
                onClick={handleStartEditTenantPromptLayer}
                className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Editar pra esta empresa
              </button>
            </>
          ) : (
            <div className="space-y-2">
              <AutoResizeTextarea
                minRows={6}
                value={tenantPromptLayerDraft}
                onChange={(e) => setTenantPromptLayerDraft(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-[11px] text-slate-200 focus:outline-none focus:border-amber-500/60"
              />
              <input
                type="password"
                value={tenantPromptLayerPassword}
                onChange={(e) => setTenantPromptLayerPassword(e.target.value)}
                placeholder="Confirme sua senha pra salvar"
                className="w-full sm:w-72 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500/60"
              />
              {tenantPromptLayerError && <p className="text-[11px] text-red-400">{tenantPromptLayerError}</p>}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSaveTenantPromptLayer}
                  disabled={isSavingTenantPromptLayer}
                  className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  {isSavingTenantPromptLayer ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Salvar (só esta empresa)</span>
                </button>
                {tenantPromptLayer.isCustomized && (
                  <button
                    type="button"
                    onClick={handleResetTenantPromptLayer}
                    disabled={isSavingTenantPromptLayer}
                    className="px-3 py-2 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-400 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restaurar padrão da plataforma</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsEditingTenantPromptLayer(false)}
                  className="px-3 py-2 text-slate-500 hover:text-slate-300 text-xs cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Visão unificada — antes era 6 abas separadas (uma só de cada vez);
          agora tudo fica empilhado numa página só, pra facilitar auditoria e
          edição sem ficar clicando entre abas. Cada campo continua editável
          exatamente onde já estava, nada foi fundido. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs font-bold text-slate-400">
          Todos os campos da Base de Conhecimento, numa página só
        </span>
        <button
          type="button"
          onClick={handleDownloadMarkdown}
          className="px-3.5 py-2 rounded-xl font-bold text-xs bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white flex items-center gap-1.5 transition-all cursor-pointer"
          title="Baixa tudo (Camada 1, se visível, + as 6 seções abaixo) como um arquivo .md pra ler/editar/auditar fora do painel"
        >
          <Download className="w-3.5 h-3.5 text-emerald-400" />
          <span>Baixar .md (auditoria)</span>
        </button>
      </div>

      {/* Main Content Area — todas as seções sempre visíveis */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-10">

        {/* SECTION 1: General Profile & Goal */}
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => toggleSection('s1')}
            className="w-full flex items-center justify-between gap-1.5 text-[11px] font-bold text-emerald-400 uppercase tracking-wide cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5" />
              <span>1. Perfil & Objetivo</span>
            </span>
            {openSections.s1 ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {openSections.s1 && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-400" />
                  Perfil do Cliente & Objetivo do Agente IA
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Estas diretrizes definem quem o agente representa e qual é a sua missão comercial.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Nome da Empresa / Projeto:
                </label>
                <input
                  type="text"
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  placeholder="Ex: TechCorp CRM Solutions"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Tom de Voz do Agente:
                </label>
                <AutoResizeTextarea
                  minRows={1}
                  value={formData.toneOfVoice}
                  onChange={(e) => setFormData({ ...formData, toneOfVoice: e.target.value })}
                  placeholder="Ex: Consultivo, cordial, objetivo e persuasivo com uso moderado de emojis"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none leading-relaxed"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Objetivo Principal do Agente no WhatsApp:
              </label>
              <AutoResizeTextarea
                minRows={2}
                value={formData.agentGoal}
                onChange={(e) => setFormData({ ...formData, agentGoal: e.target.value })}
                placeholder="Ex: Qualificar leads B2B, identificar orçamento e agendar reuniões de demonstração comercial."
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Descrição Geral do Modelo de Negócio:
              </label>
              <AutoResizeTextarea
                minRows={3}
                value={formData.businessModel}
                onChange={(e) => setFormData({ ...formData, businessModel: e.target.value })}
                placeholder="Descreva o que sua empresa vende, para quem vende e quais são os principais diferenciais competitivos..."
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Link de Localização (Google Maps) — opcional:
              </label>
              <input
                type="text"
                value={formData.locationMapsUrl || ''}
                onChange={(e) => setFormData({ ...formData, locationMapsUrl: e.target.value })}
                placeholder="Ex: https://www.google.com/maps/search/?api=1&query=Seu+Endereço+Completo"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
              <p className="text-[11px] text-slate-500 mt-1">Quando preenchido, o agente manda esse link sempre que o cliente pedir o endereço/localização.</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Políticas Comerciais e Formas de Pagamento:
              </label>
              <AutoResizeTextarea
                minRows={2}
                value={formData.pricingAndPolicies}
                onChange={(e) => setFormData({ ...formData, pricingAndPolicies: e.target.value })}
                placeholder="Ex: Aceitamos Pix, Cartão em até 12x e Boleto bancário. Prazos de entrega de 48h úteis."
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none leading-relaxed"
              />
            </div>

            {/* Horário de Funcionamento — recurso separado (tabela `tenants`),
                usado de verdade pelo agendamento automático real (autoReply.ts/
                googleCalendar.ts) pra nunca oferecer horário fora do
                expediente. Save próprio, independente do botão "Salvar Regras
                no Agente" no topo. */}
            <div className="border-t border-slate-800 pt-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-400" />
                  Horário de Funcionamento
                </h3>
                <button
                  onClick={handleSaveHours}
                  disabled={isSavingHours}
                  className="px-3 py-1.5 rounded-lg font-bold text-[11px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingHours ? 'Salvando...' : 'Salvar Horário'}</span>
                </button>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                O agendamento automático nunca oferece nem confirma um horário fora do expediente cadastrado aqui. Dias sem marcação = sem atendimento.
              </p>
              <div className="space-y-1.5">
                {WEEKDAY_LABELS.map(({ key, label }) => {
                  const dayHours = hoursForm[key];
                  const enabled = !!dayHours;
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 text-xs"
                    >
                      <label className="flex items-center gap-2 w-28 flex-shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => handleToggleDay(key, e.target.checked)}
                          className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                        />
                        <span className={enabled ? 'text-white font-semibold' : 'text-slate-500'}>{label}</span>
                      </label>
                      {enabled ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="time"
                            value={dayHours!.open}
                            onChange={(e) => handleDayTimeChange(key, 'open', e.target.value)}
                            className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:border-emerald-500 focus:outline-none"
                          />
                          <span className="text-slate-500">até</span>
                          <input
                            type="time"
                            value={dayHours!.close}
                            onChange={(e) => handleDayTimeChange(key, 'close', e.target.value)}
                            className="px-2 py-1 bg-slate-900 border border-slate-700 rounded-lg text-white text-xs focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                      ) : (
                        <span className="text-slate-600 italic">sem atendimento</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          )}
        </div>

        {/* SECTION 2: Business Rules & Constraints */}
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => toggleSection('s2')}
            className="w-full flex items-center justify-between gap-1.5 text-[11px] font-bold text-amber-400 uppercase tracking-wide cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>2. Regras de Negócio ({formData.businessRules.length})</span>
            </span>
            {openSections.s2 ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {openSections.s2 && (
          <div className="space-y-5">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  Regras de Negócio & Diretrizes do Agente
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Cadastre regras estritas (Do's and Don'ts) que o agente NUNCA pode descumprir ao conversar com os clientes.
                </p>
              </div>
            </div>

            {/* Add New Rule Form */}
            <form onSubmit={handleAddRule} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-2">
              <input
                type="text"
                value={newRuleText}
                onChange={(e) => setNewRuleText(e.target.value)}
                placeholder="Ex: Nunca oferecer descontos acima de 15% sem autorização da gerência..."
                className="flex-1 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="submit"
                className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Adicionar Regra</span>
              </button>
            </form>

            {/* List of active rules */}
            <div className="space-y-2">
              {formData.businessRules.length > 0 ? (
                formData.businessRules.map((rule, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="flex items-start space-x-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5">
                        {idx + 1}
                      </span>
                      <p className="text-slate-200 font-medium leading-relaxed">{rule}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteRule(idx)}
                      className="text-slate-500 hover:text-red-400 p-1 transition-colors cursor-pointer"
                      title="Excluir regra"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-xs text-slate-500 bg-slate-950/60 rounded-xl border border-slate-800/60">
                  Nenhuma regra de negócio cadastrada. Adicione regras acima.
                </div>
              )}
            </div>
          </div>
          )}
        </div>

        {/* SECTION 3: Products & Pricing */}
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => toggleSection('s3')}
            className="w-full flex items-center justify-between gap-1.5 text-[11px] font-bold text-emerald-400 uppercase tracking-wide cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5" />
              <span>3. Preços & Produtos ({formData.products.length})</span>
            </span>
            {openSections.s3 ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {openSections.s3 && (
          <div className="space-y-5">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  Catálogo de Produtos, Serviços & Tabela de Preços
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Permite ao Gemini consultar preços e especificações exatas durante o atendimento comercial. Foto e vídeo de exemplo (qualquer formato, inclusive .MOV do iPhone — convertido automaticamente; até {MAX_VIDEO_INPUT_SIZE_MB}MB, geralmente até ~1 minuto) o agente manda de verdade pro cliente quando perguntarem sobre o serviço.
                </p>
              </div>
            </div>

            {/* Add New Product Form */}
            <form onSubmit={handleAddProduct} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <span className="text-xs font-bold text-emerald-400 block">Cadastrar Novo Produto ou Serviço:</span>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                  type="text"
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  placeholder="Nome do Produto / Plano"
                  className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={newProductPrice}
                  onChange={(e) => setNewProductPrice(e.target.value)}
                  placeholder="Preço (Ex: R$ 290/mês)"
                  className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={newProductDesc}
                  onChange={(e) => setNewProductDesc(e.target.value)}
                  placeholder="Descrição resumida do item"
                  className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
                <input
                  type="number"
                  min="0"
                  value={newProductDuration}
                  onChange={(e) => setNewProductDuration(e.target.value)}
                  placeholder="Duração (min)"
                  title="Duração real do serviço em minutos — usada pra calcular o fim do agendamento no Calendar (sem isso, o agente assume 1h por padrão)."
                  className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer ml-auto"
              >
                <Plus className="w-4 h-4" />
                <span>Salvar Produto</span>
              </button>
            </form>

            {/* Product List — agrupada por categoria quando os produtos têm
                (ver productGroups acima); "row" achata cabeçalho + produtos
                num `.map()` só, pra não duplicar o corpo do card em dois
                loops separados. */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(() => {
                const orderedRows: Array<{ type: 'header'; label: string } | { type: 'product'; product: AgentProduct }> = [];
                for (const [category, items] of productGroups.categorized) {
                  orderedRows.push({ type: 'header', label: category });
                  for (const p of items) orderedRows.push({ type: 'product', product: p });
                }
                if (productGroups.uncategorized.length) {
                  if (productGroups.categorized.length) orderedRows.push({ type: 'header', label: 'Sem categoria' });
                  for (const p of productGroups.uncategorized) orderedRows.push({ type: 'product', product: p });
                }
                return orderedRows.map((row, rowIdx) => {
                  if (row.type === 'header') {
                    return (
                      <div key={`cat-${row.label}-${rowIdx}`} className="col-span-full pt-2 first:pt-0">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-400">{row.label}</span>
                      </div>
                    );
                  }
                  const prod = row.product;
                  return (
                <div key={prod.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between space-y-2 relative group">
                  <button
                    type="button"
                    onClick={() => handleDeleteProduct(prod.id)}
                    className="absolute top-3 right-3 z-10 text-slate-500 hover:text-red-400 transition-colors cursor-pointer p-1"
                    title="Excluir produto"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={prod.name}
                      onChange={(e) => handleProductFieldChange(prod.id, 'name', e.target.value)}
                      className="w-full pr-6 bg-transparent text-xs font-bold text-white focus:outline-none focus:bg-slate-900 rounded py-0.5"
                      title="Editar nome"
                    />
                    <input
                      type="text"
                      value={prod.price}
                      onChange={(e) => handleProductFieldChange(prod.id, 'price', e.target.value)}
                      className="w-full bg-transparent text-xs font-extrabold text-emerald-400 focus:outline-none focus:bg-slate-900 rounded py-0.5"
                      title="Editar preço"
                    />
                    <input
                      type="text"
                      value={prod.category || ''}
                      onChange={(e) => handleProductFieldChange(prod.id, 'category', e.target.value)}
                      placeholder="Categoria (ex: Pestañas, Cejas)"
                      title="Agrupa este item no prompt do agente e na lista abaixo — opcional, deixe vazio pra ficar fora de qualquer categoria."
                      className="w-full bg-transparent text-[11px] text-cyan-300 placeholder-slate-600 focus:outline-none focus:bg-slate-900 rounded py-0.5"
                    />
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-slate-500 shrink-0" />
                      <input
                        type="number"
                        min="0"
                        value={prod.durationMinutes ?? ''}
                        onChange={(e) => handleProductDurationChange(prod.id, e.target.value)}
                        placeholder="Duração (min)"
                        title="Duração real do serviço em minutos — usada pra calcular o fim do agendamento no Calendar (sem isso, o agente assume 1h por padrão)."
                        className="w-full bg-transparent text-xs text-slate-300 focus:outline-none focus:bg-slate-900 rounded py-0.5"
                      />
                    </div>
                    <AutoResizeTextarea
                      minRows={2}
                      value={prod.description}
                      onChange={(e) => handleProductFieldChange(prod.id, 'description', e.target.value)}
                      className="w-full bg-transparent text-[11px] text-slate-400 leading-relaxed focus:outline-none focus:bg-slate-900 rounded py-0.5"
                      title="Editar descrição"
                    />
                  </div>
                  <div className="border-t border-slate-800 pt-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-cyan-400 font-semibold block">Variantes/serviços desta família (opcional):</span>
                      <button
                        type="button"
                        onClick={() => handleAddVariant(prod.id)}
                        className="text-[10px] text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer flex items-center gap-0.5"
                      >
                        <Plus className="w-3 h-3" />
                        Adicionar
                      </button>
                    </div>
                    {(prod.variants || []).map((variant, vIndex) => (
                      <div key={vIndex} className="flex gap-1 items-center flex-wrap">
                        <input
                          type="text"
                          placeholder="Nome/modelo (ex: Lash Lift, MS F600)"
                          value={variant.code}
                          onChange={(e) => handleVariantFieldChange(prod.id, vIndex, 'code', e.target.value)}
                          className="w-32 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[10px] text-white"
                        />
                        <input
                          type="text"
                          placeholder="Medidas"
                          value={variant.dimensions || ''}
                          onChange={(e) => handleVariantFieldChange(prod.id, vIndex, 'dimensions', e.target.value)}
                          className="w-16 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[10px] text-white"
                        />
                        <input
                          type="text"
                          placeholder="Preço"
                          value={variant.price}
                          onChange={(e) => handleVariantFieldChange(prod.id, vIndex, 'price', e.target.value)}
                          className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[10px] text-emerald-400 font-semibold"
                        />
                        <input
                          type="number"
                          min="1"
                          placeholder="Duração (min)"
                          value={variant.durationMinutes ?? ''}
                          onChange={(e) => handleVariantFieldChange(prod.id, vIndex, 'durationMinutes', e.target.value)}
                          title="Duração real desta variante em minutos — quando vazio, o agente usa a duração cadastrada no produto (acima). Necessário quando as variantes desta família têm durações diferentes, senão o agendamento no Calendar sai com o horário de fim errado."
                          className="w-24 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[10px] text-white"
                        />
                        <button
                          type="button"
                          onClick={() => handleDeleteVariant(prod.id, vIndex)}
                          className="text-slate-500 hover:text-red-400 cursor-pointer p-0.5"
                          title="Excluir variante"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-slate-800 pt-2 space-y-1.5">
                    <span className="text-[10px] text-amber-400 font-semibold block">Promoção (opcional, expira sozinha):</span>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder="Preço promo"
                        value={prod.promoPrice || ''}
                        onChange={(e) => handlePromoChange(prod.id, 'promoPrice', e.target.value)}
                        className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[10px] text-white"
                      />
                      <input
                        type="date"
                        value={prod.promoUntil || ''}
                        onChange={(e) => handlePromoChange(prod.id, 'promoUntil', e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[10px] text-white"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    {prod.exampleImageBase64 ? (
                      <img src={prod.exampleImageBase64} alt={prod.name} className="w-10 h-10 rounded-lg object-cover border border-slate-700" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg border border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-[9px]">sem foto</div>
                    )}
                    <label className="text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer font-semibold">
                      {prod.exampleImageBase64 ? 'Trocar foto' : 'Adicionar foto de exemplo'}
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handleProductImageChange(prod.id, e)} />
                    </label>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    {prod.exampleVideoId ? (
                      <button
                        type="button"
                        onClick={() => handlePreviewProductVideo(prod.exampleVideoId!)}
                        disabled={previewingVideoId === prod.exampleVideoId}
                        title={prod.exampleVideoFileName || 'Ver vídeo'}
                        className="w-10 h-10 rounded-lg border border-slate-700 bg-slate-900 flex items-center justify-center text-emerald-400 hover:text-emerald-300 disabled:opacity-50 cursor-pointer"
                      >
                        {previewingVideoId === prod.exampleVideoId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                    ) : (
                      <div className="w-10 h-10 rounded-lg border border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-[9px]">sem vídeo</div>
                    )}
                    <label className="text-[10px] text-blue-400 hover:text-blue-300 cursor-pointer font-semibold flex items-center gap-1">
                      {uploadingVideoForId === prod.id ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        <>
                          <Video className="w-3 h-3" />
                          {prod.exampleVideoId ? 'Trocar vídeo' : 'Adicionar vídeo de exemplo'}
                        </>
                      )}
                      <input
                        type="file"
                        accept="video/*"
                        className="hidden"
                        disabled={uploadingVideoForId === prod.id}
                        onChange={(e) => handleProductVideoUpload(prod.id, e)}
                      />
                    </label>
                    {prod.exampleVideoId && (
                      <span className="text-[9px] text-slate-500">
                        {prod.exampleVideoSizeBytes ? `${(prod.exampleVideoSizeBytes / (1024 * 1024)).toFixed(1)} MB` : ''}
                      </span>
                    )}
                  </div>
                </div>
                  );
                });
              })()}
            </div>
          </div>
          )}
        </div>

        {/* SECTION 4: FAQs & Common Questions */}
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => toggleSection('s4')}
            className="w-full flex items-center justify-between gap-1.5 text-[11px] font-bold text-blue-400 uppercase tracking-wide cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>4. FAQ e Dúvidas ({formData.faqs.length})</span>
            </span>
            {openSections.s4 ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {openSections.s4 && (
          <div className="space-y-5">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-blue-400" />
                  Base de Perguntas Frequentes (FAQs)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Forneça respostas oficiais para as dúvidas mais comuns dos seus clientes.
                </p>
              </div>
            </div>

            {/* Add FAQ Form */}
            <form onSubmit={handleAddFaq} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <span className="text-xs font-bold text-blue-400 block">Adicionar Pergunta & Resposta Padrão:</span>
              <input
                type="text"
                value={newFaqQuestion}
                onChange={(e) => setNewFaqQuestion(e.target.value)}
                placeholder="Pergunta comum do cliente (Ex: Vocês emitem nota fiscal?)"
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
              <AutoResizeTextarea
                minRows={2}
                value={newFaqAnswer}
                onChange={(e) => setNewFaqAnswer(e.target.value)}
                placeholder="Resposta oficial da empresa..."
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:border-emerald-500 focus:outline-none leading-relaxed"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer ml-auto"
              >
                <Plus className="w-4 h-4" />
                <span>Salvar FAQ</span>
              </button>
            </form>

            {/* List of FAQs */}
            <div className="space-y-3">
              {formData.faqs.map((faq) => (
                <div key={faq.id} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 relative">
                  <button
                    onClick={() => handleDeleteFaq(faq.id)}
                    className="absolute top-4 right-4 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                    title="Excluir FAQ"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <h4 className="text-xs font-bold text-blue-300 pr-8">P: {faq.question}</h4>
                  <p className="text-xs text-slate-200 leading-relaxed bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                    R: {faq.answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>

        {/* SECTION 5: Document Uploads */}
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => toggleSection('s5')}
            className="w-full flex items-center justify-between gap-1.5 text-[11px] font-bold text-purple-400 uppercase tracking-wide cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" />
              <span>5. Documentos Anexados ({formData.documents.length})</span>
            </span>
            {openSections.s5 ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {openSections.s5 && (
          <div className="space-y-5">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-purple-400" />
                  Documentos & Manuais de Treinamento
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Anexe arquivos PDF, manuais, termos de uso ou catálogos como referência do que a IA deve saber. Documentos PDF, TXT, CSV, JSON e MD têm o conteúdo lido pelo agente automaticamente (com um limite de tamanho); outros formatos (ex: DOCX) ficam salvos e disponíveis pra baixar, mas o texto não entra no prompt da IA.
                </p>
              </div>
            </div>

            {/* Usage indicator — teto por tenant (MAX_DOCUMENTS_PER_TENANT / MAX_TOTAL_BYTES_PER_TENANT em conversations.ts), pra ninguém ser pego de surpresa pelo limite só quando o upload já falhar */}
            <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2">
              <span>
                {formData.documents.length}/{MAX_DOCUMENTS_PER_TENANT} documentos
              </span>
              <span>
                {(formData.documents.reduce((sum, d) => sum + (d.sizeBytes || 0), 0) / (1024 * 1024)).toFixed(1)}MB / {MAX_TOTAL_MB_PER_TENANT}MB usados
              </span>
            </div>

            {/* Drag and Drop File Upload Area */}
            <div className="border-2 border-dashed border-slate-800 hover:border-purple-500/50 bg-slate-950/80 rounded-2xl p-6 text-center space-y-3 transition-colors relative">
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.csv,.json"
                onChange={handleRealFileUpload}
                disabled={uploadingDocNames.length > 0}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full disabled:cursor-not-allowed"
              />
              <div className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto">
                {uploadingDocNames.length > 0 ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <Upload className="w-6 h-6" />
                )}
              </div>
              <div>
                <span className="text-xs font-bold text-white block">
                  {uploadingDocNames.length > 0
                    ? `Enviando ${uploadingDocNames.join(', ')}...`
                    : 'Arraste e solte arquivos aqui ou clique para selecionar'}
                </span>
                <span className="text-[11px] text-slate-400 block mt-1">
                  Formatos aceitos: PDF, DOCX, TXT, CSV, JSON (Até 15MB cada)
                </span>
              </div>
            </div>

            {/* File List */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-300 block">
                Arquivos Processados na Base de Conhecimento ({formData.documents.length}):
              </span>

              {formData.documents.map((doc) => (
                <div key={doc.id} className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/30 text-purple-400">
                      <FileCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="font-bold text-white">{doc.fileName}</h5>
                      <div className="flex items-center space-x-2 text-[10px] text-slate-400 mt-0.5">
                        <span>{doc.fileSize}</span>
                        <span>•</span>
                        <span>{doc.uploadDate}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3">
                    {doc.extractedText ? (
                      <span
                        className="px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 text-[10px] font-bold border border-purple-800/60 flex items-center gap-1"
                        title="O agente lê o conteúdo deste arquivo"
                      >
                        <BrainCircuit className="w-3 h-3 text-purple-400" />
                        Lido pela IA
                      </span>
                    ) : (
                      <span
                        className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-bold border border-slate-700"
                        title="Formato sem leitura automática — só arquivo/registro"
                      >
                        Somente arquivo
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 text-[10px] font-bold border border-emerald-800/60 flex items-center gap-1">
                      <Check className="w-3 h-3 text-emerald-400" />
                      {doc.status}
                    </span>
                    <button
                      onClick={() => handleDownloadDoc(doc)}
                      disabled={downloadingDocId === doc.id}
                      className="text-slate-500 hover:text-purple-400 p-1 transition-colors cursor-pointer disabled:opacity-50"
                      title="Baixar documento"
                    >
                      {downloadingDocId === doc.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDeleteDoc(doc.id)}
                      className="text-slate-500 hover:text-red-400 p-1 transition-colors cursor-pointer"
                      title="Excluir documento"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>

        {/* SECTION 6: Mensagem Inicial de Primeiro Contato — pedido real
            (14-15/08/2026, Clic Piscinas): em vez da pergunta de triagem
            padrão da IA logo na 1ª mensagem, mandar primeiro uma SEQUÊNCIA
            ORDENADA de blocos (texto/imagem/vídeo/arquivo, não gerados pela
            IA) — a negociação com a IA só começa a partir da PRÓXIMA
            mensagem do cliente. Ver server/services/firstContactMessage.ts.
            Nenhum bloco = comportamento de sempre (a IA responde a 1ª
            mensagem normalmente), sem precisar de um toggle separado. */}
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => toggleSection('s6')}
            className="w-full flex items-center justify-between gap-1.5 text-[11px] font-bold text-pink-400 uppercase tracking-wide cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" />
              <span>6. Mensagem Inicial</span>
            </span>
            {openSections.s6 ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {openSections.s6 && (
          <div className="space-y-5">
          <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Send className="w-4 h-4 text-pink-400" />
                  Mensagem Inicial Programada de Primeiro Contato
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Monte a sequência que a PRIMEIRA mensagem de uma conversa nova recebe, na ordem exata dos blocos abaixo (ex: texto → vídeo → texto), em vez da pergunta de triagem padrão da IA — a negociação com a IA só começa a partir da próxima mensagem do cliente. Sem nenhum bloco, mantém o comportamento normal (a IA responde a 1ª mensagem sozinha).
                </p>
              </div>
            </div>

            {(!formData.firstContactBlocks || formData.firstContactBlocks.length === 0) && (
              <div className="p-6 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
                Nenhum bloco adicionado ainda. Use os botões abaixo pra começar a sequência.
              </div>
            )}

            {/* Sequência ordenada, "em fila" — cada bloco ligado ao próximo
                por uma setinha, pra ficar visualmente óbvio que é uma ordem
                de envio, não campos soltos. */}
            <div>
              {(formData.firstContactBlocks || []).map((block, idx) => {
                const meta = FIRST_CONTACT_BLOCK_META[block.type];
                const isFirst = idx === 0;
                const isLast = idx === (formData.firstContactBlocks?.length || 0) - 1;
                return (
                  <div key={block.id}>
                    {idx > 0 && (
                      <div className="flex justify-center py-0.5">
                        <ChevronDown className="w-4 h-4 text-slate-700" />
                      </div>
                    )}
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold flex items-center gap-1.5 ${meta.color}`}>
                          <GripVertical className="w-3.5 h-3.5 text-slate-700" />
                          {meta.icon}
                          {meta.label}
                          <span className="text-slate-500 font-normal">· passo {idx + 1}</span>
                        </span>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleMoveFirstContactBlock(block.id, 'up')}
                            disabled={isFirst}
                            title="Mover pra cima"
                            className="p-1 text-slate-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveFirstContactBlock(block.id, 'down')}
                            disabled={isLast}
                            title="Mover pra baixo"
                            className="p-1 text-slate-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveFirstContactBlock(block.id)}
                            title="Remover bloco"
                            className="p-1 text-slate-500 hover:text-red-400 cursor-pointer transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {block.type === 'text' && (
                        <AutoResizeTextarea
                          minRows={3}
                          value={block.text || ''}
                          onChange={(e) => handleFirstContactBlockTextChange(block.id, e.target.value)}
                          placeholder="Ex: Oi! Que bom que você chegou até nós 🙌 Somos a Clic Piscinas — confira no vídeo abaixo..."
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white focus:border-pink-500 focus:outline-none leading-relaxed"
                        />
                      )}

                      {block.type === 'image' && (
                        <div className="flex items-center gap-3">
                          {block.imageBase64 ? (
                            <img src={block.imageBase64} alt="Bloco de imagem" className="w-14 h-14 rounded-lg object-cover border border-slate-700" />
                          ) : (
                            <div className="w-14 h-14 rounded-lg border border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-[9px] text-center">sem imagem</div>
                          )}
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer font-semibold">
                              {block.imageBase64 ? 'Trocar imagem' : 'Adicionar imagem'}
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFirstContactBlockImageChange(block.id, e)} />
                            </label>
                            {block.imageBase64 && (
                              <button
                                type="button"
                                onClick={() => handleFirstContactBlockImageRemove(block.id)}
                                className="text-[11px] text-slate-500 hover:text-red-400 cursor-pointer font-semibold flex items-center gap-1 w-fit"
                              >
                                <X className="w-3 h-3" />
                                Remover
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {block.type === 'video' && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            {block.videoId ? (
                              <button
                                type="button"
                                onClick={() => handlePreviewFirstContactBlockVideo(block.videoId!)}
                                disabled={previewingBlockMediaId === block.videoId}
                                title={block.videoFileName || 'Ver vídeo'}
                                className="w-14 h-14 rounded-lg border border-slate-700 bg-slate-900 flex items-center justify-center text-emerald-400 hover:text-emerald-300 disabled:opacity-50 cursor-pointer"
                              >
                                {previewingBlockMediaId === block.videoId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                              </button>
                            ) : (
                              <div className="w-14 h-14 rounded-lg border border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-[9px] text-center">sem vídeo</div>
                            )}
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer font-semibold flex items-center gap-1 w-fit">
                                {uploadingBlockId === block.id ? (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Enviando...
                                  </>
                                ) : (
                                  <>
                                    <Video className="w-3 h-3" />
                                    {block.videoId ? 'Trocar vídeo' : 'Adicionar vídeo'}
                                  </>
                                )}
                                <input
                                  type="file"
                                  accept="video/*"
                                  className="hidden"
                                  disabled={uploadingBlockId === block.id}
                                  onChange={(e) => handleFirstContactBlockVideoUpload(block.id, e)}
                                />
                              </label>
                              {block.videoId && (
                                <button
                                  type="button"
                                  onClick={() => handleFirstContactBlockVideoRemove(block.id)}
                                  className="text-[11px] text-slate-500 hover:text-red-400 cursor-pointer font-semibold flex items-center gap-1 w-fit"
                                >
                                  <X className="w-3 h-3" />
                                  Remover
                                </button>
                              )}
                            </div>
                          </div>
                          <span className="text-[9px] text-slate-500 block">
                            Até {MAX_VIDEO_INPUT_SIZE_MB}MB, qualquer formato — convertido automaticamente.
                            {block.videoSizeBytes ? ` (${(block.videoSizeBytes / (1024 * 1024)).toFixed(1)} MB)` : ''}
                          </span>
                          <input
                            type="text"
                            value={block.videoCaption || ''}
                            onChange={(e) => handleFirstContactBlockVideoCaptionChange(block.id, e.target.value)}
                            placeholder="Legenda do vídeo (opcional) — vai junto na mesma mensagem"
                            className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-[11px] text-white focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                      )}

                      {block.type === 'file' && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            {block.fileId ? (
                              <button
                                type="button"
                                onClick={() => handlePreviewFirstContactBlockFile(block.fileId!)}
                                disabled={previewingBlockMediaId === block.fileId}
                                title={block.fileName || 'Ver arquivo'}
                                className="w-14 h-14 rounded-lg border border-slate-700 bg-slate-900 flex items-center justify-center text-purple-400 hover:text-purple-300 disabled:opacity-50 cursor-pointer"
                              >
                                {previewingBlockMediaId === block.fileId ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                              </button>
                            ) : (
                              <div className="w-14 h-14 rounded-lg border border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-[9px] text-center">sem arquivo</div>
                            )}
                            <div className="flex flex-col gap-1.5">
                              <label className="text-[11px] text-blue-400 hover:text-blue-300 cursor-pointer font-semibold flex items-center gap-1 w-fit">
                                {uploadingBlockId === block.id ? (
                                  <>
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Enviando...
                                  </>
                                ) : (
                                  <>
                                    <Paperclip className="w-3 h-3" />
                                    {block.fileId ? 'Trocar arquivo' : 'Adicionar arquivo'}
                                  </>
                                )}
                                <input
                                  type="file"
                                  className="hidden"
                                  disabled={uploadingBlockId === block.id}
                                  onChange={(e) => handleFirstContactBlockFileUpload(block.id, e)}
                                />
                              </label>
                              {block.fileId && (
                                <button
                                  type="button"
                                  onClick={() => handleFirstContactBlockFileRemove(block.id)}
                                  className="text-[11px] text-slate-500 hover:text-red-400 cursor-pointer font-semibold flex items-center gap-1 w-fit"
                                >
                                  <X className="w-3 h-3" />
                                  Remover
                                </button>
                              )}
                            </div>
                          </div>
                          <span className="text-[9px] text-slate-500 block">
                            Até {MAX_FIRST_CONTACT_FILE_SIZE_MB}MB (ex: catálogo em PDF).
                            {block.fileName ? ` ${block.fileName}` : ''}
                            {block.fileSizeBytes ? ` (${(block.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB)` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800">
              <span className="text-xs font-bold text-slate-400 pt-3">Adicionar bloco:</span>
              <div className="flex flex-wrap gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => handleAddFirstContactBlock('text')}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-600 text-[11px] font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Texto
                </button>
                <button
                  type="button"
                  onClick={() => handleAddFirstContactBlock('image')}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-blue-600 text-[11px] font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  Imagem
                </button>
                <button
                  type="button"
                  onClick={() => handleAddFirstContactBlock('video')}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-600 text-[11px] font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <Video className="w-3.5 h-3.5" />
                  Vídeo
                </button>
                <button
                  type="button"
                  onClick={() => handleAddFirstContactBlock('file')}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-purple-600 text-[11px] font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer transition-all"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  Arquivo
                </button>
              </div>
            </div>
          </div>
          )}
        </div>

      </div>

      {/* Bottom Save Notification Toast / Banner */}
      {isSavedToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-900 border border-emerald-500 text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center space-x-3 text-xs font-bold animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-emerald-300" />
          <div>
            <span>Base de Conhecimento Salva com Sucesso!</span>
            <p className="text-[10px] text-emerald-200 font-normal">
              O Agente Gemini utilizará estas regras atualizadas em todos os atendimentos.
            </p>
          </div>
        </div>
      )}

      {/* Footer Shortcut to WhatsApp Sim */}
      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Sparkles className="w-5 h-5 text-emerald-400" />
          <span className="text-xs text-slate-300 font-medium">
            Tudo configurado? Teste o comportamento do seu agente na simulação do WhatsApp.
          </span>
        </div>
        <button
          onClick={onGoToWhatsAppSim}
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-md shadow-emerald-950"
        >
          <span>Testar Agente no WhatsApp</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

    </div>
  );
};
