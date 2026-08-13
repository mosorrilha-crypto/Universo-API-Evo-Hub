import React, { useState } from 'react';
import { AgentKnowledgeBase, AgentProduct, AgentFAQ, AgentFileDoc, BusinessHours, DayHours } from '../types';
import { apiFetch } from '../lib/apiClient';
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
  Play
} from 'lucide-react';

interface AgentKnowledgeBaseProps {
  knowledgeBase: AgentKnowledgeBase;
  onSaveKnowledgeBase: (kb: AgentKnowledgeBase) => Promise<boolean>;
  businessHours: BusinessHours;
  onSaveBusinessHours: (hours: BusinessHours) => Promise<boolean>;
  onGoToWhatsAppSim: () => void;
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
  onGoToWhatsAppSim
}) => {
  const [formData, setFormData] = useState<AgentKnowledgeBase>(() => ({
    ...knowledgeBase,
    products: ensureUniqueIds(knowledgeBase.products, 'prod'),
    faqs: ensureUniqueIds(knowledgeBase.faqs, 'faq'),
    documents: ensureUniqueIds(knowledgeBase.documents, 'doc'),
  }));
  const [isSavedToast, setIsSavedToast] = useState(false);

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
  const [activeSubSection, setActiveSubSection] = useState<'general' | 'products' | 'rules' | 'faqs' | 'docs'>('general');

  // Input states for adding new items
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductDesc, setNewProductDesc] = useState('');

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

  const handleAddProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim()) return;
    const item: AgentProduct = {
      id: `prod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: newProductName.trim(),
      price: newProductPrice.trim() || 'Sob Consulta',
      description: newProductDesc.trim() || 'Sem descrição cadastrada'
    };
    setFormData((prev) => ({
      ...prev,
      products: [...prev.products, item]
    }));
    setNewProductName('');
    setNewProductPrice('');
    setNewProductDesc('');
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
  const handleProductFieldChange = (id: string, field: 'name' | 'price' | 'description', value: string) => {
    setFormData((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
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

  const MAX_VIDEO_SIZE_MB = 16; // mesmo limite real da Meta Cloud API pra mensagem de vídeo, validado de novo no servidor
  const ALLOWED_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/3gpp']);
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
  const handleProductVideoUpload = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_VIDEO_MIME_TYPES.has(file.type)) {
      alert(`Formato de vídeo não suportado pelo WhatsApp (${file.type || 'desconhecido'}). Envie um MP4.`);
      return;
    }
    if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
      alert(`Vídeo maior que ${MAX_VIDEO_SIZE_MB}MB (limite da Meta pra mensagem de vídeo). Comprima antes de enviar.`);
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

      {/* Sub-navigation Tabs inside Knowledge Base */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-2 overflow-x-auto scrollbar-none text-xs">
        <button
          onClick={() => setActiveSubSection('general')}
          className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
            activeSubSection === 'general'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Target className="w-4 h-4" />
          <span>1. Perfil & Objetivo</span>
        </button>

        <button
          onClick={() => setActiveSubSection('rules')}
          className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
            activeSubSection === 'rules'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <span>2. Regras de Negócio ({formData.businessRules.length})</span>
        </button>

        <button
          onClick={() => setActiveSubSection('products')}
          className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
            activeSubSection === 'products'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <DollarSign className="w-4 h-4 text-emerald-400" />
          <span>3. Preços & Produtos ({formData.products.length})</span>
        </button>

        <button
          onClick={() => setActiveSubSection('faqs')}
          className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
            activeSubSection === 'faqs'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <HelpCircle className="w-4 h-4 text-blue-400" />
          <span>4. FAQ e Dúvidas ({formData.faqs.length})</span>
        </button>

        <button
          onClick={() => setActiveSubSection('docs')}
          className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
            activeSubSection === 'docs'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <FileText className="w-4 h-4 text-purple-400" />
          <span>5. Documentos Anexados ({formData.documents.length})</span>
        </button>
      </div>

      {/* Main Content Area depending on activeSubSection */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">

        {/* SECTION 1: General Profile & Goal */}
        {activeSubSection === 'general' && (
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
                <input
                  type="text"
                  value={formData.toneOfVoice}
                  onChange={(e) => setFormData({ ...formData, toneOfVoice: e.target.value })}
                  placeholder="Ex: Consultivo, cordial, objetivo e persuasivo com uso moderado de emojis"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Objetivo Principal do Agente no WhatsApp:
              </label>
              <textarea
                rows={2}
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
              <textarea
                rows={3}
                value={formData.businessModel}
                onChange={(e) => setFormData({ ...formData, businessModel: e.target.value })}
                placeholder="Descreva o que sua empresa vende, para quem vende e quais são os principais diferenciais competitivos..."
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:border-emerald-500 focus:outline-none leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Políticas Comerciais e Formas de Pagamento:
              </label>
              <textarea
                rows={2}
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

        {/* SECTION 2: Business Rules & Constraints */}
        {activeSubSection === 'rules' && (
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

        {/* SECTION 3: Products & Pricing */}
        {activeSubSection === 'products' && (
          <div className="space-y-5">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  Catálogo de Produtos, Serviços & Tabela de Preços
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Permite ao Gemini consultar preços e especificações exatas durante o atendimento comercial. Foto e vídeo de exemplo (MP4, até {MAX_VIDEO_SIZE_MB}MB, geralmente até ~1 minuto) o agente manda de verdade pro cliente quando perguntarem sobre o serviço.
                </p>
              </div>
            </div>

            {/* Add New Product Form */}
            <form onSubmit={handleAddProduct} className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <span className="text-xs font-bold text-emerald-400 block">Cadastrar Novo Produto ou Serviço:</span>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer ml-auto"
              >
                <Plus className="w-4 h-4" />
                <span>Salvar Produto</span>
              </button>
            </form>

            {/* Product List */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {formData.products.map((prod) => (
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
                    <textarea
                      rows={2}
                      value={prod.description}
                      onChange={(e) => handleProductFieldChange(prod.id, 'description', e.target.value)}
                      className="w-full bg-transparent text-[11px] text-slate-400 leading-relaxed focus:outline-none focus:bg-slate-900 rounded py-0.5 resize-none"
                      title="Editar descrição"
                    />
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
                        accept="video/mp4,video/3gpp"
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
              ))}
            </div>
          </div>
        )}

        {/* SECTION 4: FAQs & Common Questions */}
        {activeSubSection === 'faqs' && (
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
              <textarea
                rows={2}
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

        {/* SECTION 5: Document Uploads */}
        {activeSubSection === 'docs' && (
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
