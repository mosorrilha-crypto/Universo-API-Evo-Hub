import React, { useState } from 'react';
import { AgentKnowledgeBase, AgentProduct, AgentFAQ, AgentFileDoc } from '../types';
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
  FileCheck
} from 'lucide-react';

interface AgentKnowledgeBaseProps {
  knowledgeBase: AgentKnowledgeBase;
  onSaveKnowledgeBase: (kb: AgentKnowledgeBase) => void;
  onGoToWhatsAppSim: () => void;
}

export const moniqueStudioKnowledgeBase: AgentKnowledgeBase = {
  companyName: 'Monique Sorrilha Beauty Studio (Micropigmentación & Cílios)',
  agentGoal: 'Atendimento autônomo e consultoria de beleza para agendamento de Micropigmentação (Sobrancelhas e Lábios), Extensões de Cílios e Combos com confirmação de reserva via seña de Gs 50.000.',
  toneOfVoice: 'Acolhedor, elegante, altamente profissional, refinado e atencioso (técnica brasileira com experiência sensorial e atendimento individualizado)',
  businessModel: 'Estúdio de estética avançada e micropigmentação de alto padrão em Loma Merlo, Luque. Profissional Monique (brasileira, 13+ anos de experiência, técnica brasileira com som binaural e privacidade total). Instagram: @pestanaspormonique.',
  pricingAndPolicies: 'Reserva de Horário: Seña fixa de Gs 50.000. Cancelamentos com 24h ou mais de antecedência devolvem 100% da seña; menos de 24h a seña não é reembolsada. Pagamento via Transferência (Alias Cédula: 5286155 - Sara Jazmin Escobar Ruiz) ou Dinheiro em espécie. Não aceitamos cartão de crédito/débito.',
  products: [
    {
      id: 'm1',
      name: 'Microshading (Sobrancelhas)',
      price: 'Gs 500.000 [PROMO Gs 450.000]',
      description: 'Sombreado em pó com efeito sobrancelha maquiada e natural todos os dias. Sessão de 120 min.'
    },
    {
      id: 'm2',
      name: 'Pelo a Pelo (Sobrancelhas)',
      price: 'Gs 500.000 [PROMO Gs 450.000]',
      description: 'Design traço a traço hiperrealista que imita cada fio natural. Sessão de 120 min.'
    },
    {
      id: 'm3',
      name: 'Microlips (Micropigmentação Labial)',
      price: 'Gs 500.000 [PROMO Gs 450.000]',
      description: 'Cor natural e contorno definido nos lábios sem depender de batom diário. Sessão de 120 min.'
    },
    {
      id: 'm4',
      name: 'Neutralización Labial',
      price: 'Gs 450.000',
      description: 'Correção de tons escuros/arroxeados para alcançar tom rosado saudável e uniforme. Sessão de 120 min.'
    },
    {
      id: 'm5',
      name: 'Lash Lift',
      price: 'Gs 140.000',
      description: 'Curva e realça as próprias pestanas sem extensões, efeito natural de longa duração. Sessão de 90 min.'
    },
    {
      id: 'm6',
      name: 'Efecto 30+ (Cílios Máxima Retenção)',
      price: 'Gs 350.000',
      description: 'Extensões com técnica brasileira de alta retenção, até 30 dias sem manutenção. Sessão de 120 min.'
    },
    {
      id: 'm7',
      name: 'Efecto Volumen Brasileño',
      price: 'Gs 200.000',
      description: 'Técnica clássica do estúdio com volume marcado e leveza sem perder naturalidade. Sessão de 90 min.'
    },
    {
      id: 'm8',
      name: 'Browlamination + Coloración',
      price: 'Gs 150.000',
      description: 'Penteia, alinha e colore os fios das sobrancelhas para um visual encorpado e moderno. Sessão de 90 min.'
    },
    {
      id: 'm9',
      name: 'Combo Cejas + Labios',
      price: 'Gs 800.000',
      description: 'Sobrancelhas e lábios trabalhados na mesma sessão com valor promocional exclusivo. Sessão de 180 min.'
    },
    {
      id: 'm10',
      name: 'Combo Triple (Cejas + Labios + Pestañas)',
      price: 'Gs 1.000.000',
      description: 'A experiência sensorial e transformação completa do estúdio em uma única visita. Sessão de 180 min.'
    }
  ],
  businessRules: [
    'Para reservar qualquer horário, é obrigatória a seña/sinal de Gs 50.000.',
    'Fornecer os dados de transferência: Alias Cédula 5286155 (Sara Jazmin Escobar Ruiz).',
    'Cancelamento com 24h ou mais devolve a seña; menos de 24h não há reembolso.',
    'Horários: Segunda a Sexta 07:30 às 20:00, Sábados 08:00 às 13:00, Domingos 09:00 às 17:00.',
    'Respeitar a tolerância de 15 minutos para pontualidade e oferecer a experiência sensorial única.'
  ],
  faqs: [
    {
      id: 'mf1',
      question: 'Como faço para confirmar meu agendamento no estúdio?',
      answer: 'Basta escolher o procedimento e horário desejado e realizar a transferência da seña de Gs 50.000 para a conta de Sara Jazmin Escobar Ruiz (Alias Cédula: 5286155). Assim que nos enviar o comprovante no WhatsApp, seu horário fica 100% garantido!'
    },
    {
      id: 'mf2',
      question: 'Quanto tempo dura a Micropigmentação de Sobrancelhas ou Lábios?',
      answer: 'Os procedimentos permanentes como Microshading, Pelo a Pelo e Microlips duram entre 12 a 18 meses com visual impecável, variando de acordo com seu tipo de pele e cuidados pós-procedimento.'
    },
    {
      id: 'mf3',
      question: 'Quais são as formas de pagamento aceitas no estúdio?',
      answer: 'Aceitamos transferência bancária antecipada (para seña e valor total) ou dinheiro em espécie no local. Não aceitamos cartões de crédito ou débito.'
    }
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
  onGoToWhatsAppSim
}) => {
  const [formData, setFormData] = useState<AgentKnowledgeBase>(knowledgeBase);
  const [isSavedToast, setIsSavedToast] = useState(false);
  const [activeSubSection, setActiveSubSection] = useState<'general' | 'products' | 'rules' | 'faqs' | 'docs'>('general');

  // Input states for adding new items
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductDesc, setNewProductDesc] = useState('');

  const [newRuleText, setNewRuleText] = useState('');

  const [newFaqQuestion, setNewFaqQuestion] = useState('');
  const [newFaqAnswer, setNewFaqAnswer] = useState('');

  const handleSave = () => {
    const updated = {
      ...formData,
      lastSaved: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };
    onSaveKnowledgeBase(updated);
    setIsSavedToast(true);
    setTimeout(() => setIsSavedToast(false), 4000);
  };

  const handleApplyPreset = (preset: typeof PRESET_TEMPLATES[0]) => {
    setFormData((prev) => ({
      ...prev,
      ...preset.data
    }));
  };

  const handleAddProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProductName.trim()) return;
    const item: AgentProduct = {
      id: Date.now().toString(),
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
      id: Date.now().toString(),
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

  const handleSimulateFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newDocs: AgentFileDoc[] = Array.from(files).map((f: File, i: number) => ({
      id: (Date.now() + i).toString(),
      fileName: f.name,
      fileSize: `${(f.size / (1024 * 1024)).toFixed(1)} MB`,
      uploadDate: 'Agora mesmo',
      status: 'Processado'
    }));

    setFormData((prev) => ({
      ...prev,
      documents: [...prev.documents, ...newDocs]
    }));
    e.target.value = '';
  };

  const handleDeleteDoc = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      documents: prev.documents.filter((d) => d.id !== id)
    }));
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
                  Permite ao Gemini consultar preços e especificações exatas durante o atendimento comercial.
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
                  Anexe arquivos PDF, manuais, termos de uso ou catálogos para alimentar o contexto do Gemini.
                </p>
              </div>
            </div>

            {/* Drag and Drop File Upload Area */}
            <div className="border-2 border-dashed border-slate-800 hover:border-purple-500/50 bg-slate-950/80 rounded-2xl p-6 text-center space-y-3 transition-colors relative">
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.csv,.json"
                onChange={handleSimulateFileUpload}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <div className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 mx-auto">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs font-bold text-white block">
                  Arraste e solte arquivos aqui ou clique para selecionar
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
                    <span className="px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 text-[10px] font-bold border border-emerald-800/60 flex items-center gap-1">
                      <Check className="w-3 h-3 text-emerald-400" />
                      {doc.status}
                    </span>
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
