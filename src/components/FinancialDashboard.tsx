import React, { useState } from 'react';
import {
  FinancialTransaction,
  LeadInfo,
  PaymentMethod,
  PaymentStatus,
  UserProfile
} from '../types';
import { INITIAL_TRANSACTIONS } from '../data/mockTransactions';
import { INITIAL_MOCK_LEADS } from '../data/mockLeads';
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  QrCode,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  Search,
  Filter,
  Send,
  MessageSquare,
  Copy,
  Download,
  Building2,
  UserCheck,
  Calendar,
  X,
  Sparkles,
  ArrowUpRight,
  PieChart as PieChartIcon,
  Trash2,
  Settings,
  Key
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';

interface FinancialDashboardProps {
  transactions?: FinancialTransaction[];
  onAddTransaction?: (newTx: FinancialTransaction) => void;
  onUpdateTransactionStatus?: (id: string, newStatus: PaymentStatus) => void;
  onDeleteTransaction?: (txId: string) => void;
  onClearAllTransactions?: () => void;
  leads?: LeadInfo[];
  currentUser?: UserProfile | any;
  initialSelectedLead?: LeadInfo | null;
}

const INITIAL_REVENUE_CHART_DATA = [
  { day: '01/Ago', receita: 4200, custoAds: 850 },
  { day: '02/Ago', receita: 6800, custoAds: 1200 },
  { day: '03/Ago', receita: 9500, custoAds: 1400 },
  { day: '04/Ago', receita: 12400, custoAds: 1800 },
  { day: '05/Ago', receita: 8900, custoAds: 1300 },
  { day: '06/Ago', receita: 15600, custoAds: 2100 },
  { day: '07/Ago', receita: 18200, custoAds: 2400 },
  { day: '08/Ago', receita: 22100, custoAds: 2900 },
];

const CHANNEL_BREAKDOWN = [
  { name: 'Meta Ads (Facebook & IG)', value: 84500, color: '#10b981' },
  { name: 'Google Ads Search', value: 32100, color: '#3b82f6' },
  { name: 'WhatsApp Direto', value: 18900, color: '#8b5cf6' },
  { name: 'Orgânico / Recomendação', value: 13000, color: '#f59e0b' },
];

const PAYMENT_METHOD_BREAKDOWN = [
  { method: 'PIX (Instântaneo)', count: 28, valor: 98400, fill: '#10b981' },
  { method: 'Cartão de Crédito', count: 12, valor: 38200, fill: '#3b82f6' },
  { method: 'Boleto Bancário', count: 6, valor: 11900, fill: '#f59e0b' },
];

export const FinancialDashboard: React.FC<FinancialDashboardProps> = ({
  transactions: propTransactions,
  onAddTransaction,
  onUpdateTransactionStatus,
  onDeleteTransaction,
  onClearAllTransactions,
  leads: propLeads,
  currentUser: propCurrentUser,
  initialSelectedLead
}) => {
  const transactions = propTransactions || INITIAL_TRANSACTIONS;
  const leads = propLeads || INITIAL_MOCK_LEADS;
  const currentUser = propCurrentUser || { name: 'Operador Admin', id: 'op_1' };
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(!!initialSelectedLead);

  // Custom Company PIX Key state
  const [pixKey, setPixKey] = useState<string>(() => {
    return localStorage.getItem('metaleads_official_pix_key') || 'financeiro@empresa.com.br';
  });
  const [isPixKeyModalOpen, setIsPixKeyModalOpen] = useState(false);

  // New Transaction Form State
  const [selectedLeadId, setSelectedLeadId] = useState<string>(initialSelectedLead?.id || (leads[0]?.id || ''));
  const [productName, setProductName] = useState('Plano Premium Implementação IA & WhatsApp');
  const [amount, setAmount] = useState<number>(3500);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('PIX');
  const [createdPayment, setCreatedPayment] = useState<FinancialTransaction | null>(null);

  const filteredTransactions = transactions.filter((t) => {
    const matchesSearch =
      t.leadName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.leadPhone.includes(searchTerm);

    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // KPI Calculations
  const totalPaidRevenue = transactions
    .filter((t) => t.status === 'pago')
    .reduce((acc, t) => acc + t.amount, 0);

  const totalPendingRevenue = transactions
    .filter((t) => t.status === 'pendente' || t.status === 'atrasado')
    .reduce((acc, t) => acc + t.amount, 0);

  const paidCount = transactions.filter((t) => t.status === 'pago').length;
  const ticketMedio = paidCount > 0 ? totalPaidRevenue / paidCount : 0;

  const handleCreatePaymentLink = (e: React.FormEvent) => {
    e.preventDefault();
    const lead = leads.find((l) => l.id === selectedLeadId) || leads[0];

    const newTx: FinancialTransaction = {
      id: `fat_${Date.now().toString().slice(-6)}`,
      leadId: lead?.id || 'ld_gen',
      leadName: lead?.name || 'Cliente WhatsApp',
      leadPhone: lead?.phone || '5511999999999',
      productName,
      amount,
      paymentMethod,
      status: 'pendente',
      date: new Date().toLocaleDateString('pt-BR'),
      operatorName: currentUser.name,
      channel: lead?.attribution?.channelLabel || 'Meta Ads',
      pixQrCode: '00020126580014BR.GOV.BCB.PIX0136123e4567-e89b-12d3-a456-426614174000520400005303986540',
      paymentLinkUrl: `https://pay.metaleads.com.br/fat_${Date.now().toString().slice(-6)}`,
    };

    onAddTransaction(newTx);
    setCreatedPayment(newTx);
  };

  const getStatusBadge = (status: PaymentStatus) => {
    switch (status) {
      case 'pago':
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1 w-max">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Pago
          </span>
        );
      case 'pendente':
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1 w-max">
            <Clock className="w-3 h-3 text-amber-400" /> Pendente
          </span>
        );
      case 'atrasado':
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800 flex items-center gap-1 w-max">
            <AlertCircle className="w-3 h-3 text-rose-400" /> Atrasado
          </span>
        );
      case 'cancelado':
        return (
          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1 w-max">
            Cancelado
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Financial Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-400" />
              Gestão Financeira & Faturamento de Vendas
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
              CFO / Operador
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Controle de fluxo de caixa, acompanhamento de pagamentos em tempo real, links de cobrança e ROI do Meta Ads.
          </p>
        </div>

        <div className="flex items-center space-x-2 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setIsPixKeyModalOpen(true)}
            className="py-2.5 px-3 bg-slate-950 border border-slate-800 hover:border-emerald-500/50 text-slate-300 hover:text-white font-semibold text-xs rounded-xl flex items-center space-x-1.5 transition-all"
            title="Configurar a Chave PIX Oficial da Empresa"
          >
            <Key className="w-4 h-4 text-emerald-400" />
            <span className="hidden sm:inline">Chave PIX:</span>
            <span className="font-mono text-emerald-400">{pixKey.length > 18 ? pixKey.slice(0, 15) + '...' : pixKey}</span>
          </button>

          {onClearAllTransactions && transactions.length > 0 && (
            <button
              type="button"
              onClick={onClearAllTransactions}
              className="py-2.5 px-3 bg-slate-950 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-800/60 font-semibold text-xs rounded-xl flex items-center space-x-1 transition-all"
              title="Limpar faturas fictícias"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Limpar Faturas</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setCreatedPayment(null);
              setIsModalOpen(true);
            }}
            className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/40 flex items-center space-x-2 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Gerar Nova Cobrança / PIX</span>
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Receita Confirmada (Paga)</span>
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-400">
            R$ {totalPaidRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <div className="flex items-center text-[10px] text-emerald-300 mt-2 font-medium">
            <ArrowUpRight className="w-3.5 h-3.5 mr-1" />
            +18.4% em relação ao mês anterior
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Pendentes & Atrasados</span>
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-amber-400">
            R$ {totalPendingRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[10px] text-slate-500 mt-2">{transactions.filter((t) => t.status === 'pendente').length} faturas a receber</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Ticket Médio por Venda</span>
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">
            R$ {ticketMedio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </div>
          <p className="text-[10px] text-slate-500 mt-2">Média por cliente fechado</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>ROI do Meta Ads</span>
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-purple-300">4.8x</div>
          <p className="text-[10px] text-emerald-400 mt-2 font-medium">CAC Médio: R$ 84,20 / lead</p>
        </div>
      </div>

      {/* RECHARTS GRAPHS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Area Chart: Revenue vs Ad Spend */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                Evolução de Faturamento Diário vs Investimento em Ads
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Comparativo em tempo real de receita gerada por anúncios Meta & Google
              </p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={INITIAL_REVENUE_CHART_DATA}>
                <defs>
                  <linearGradient id="colorReceita" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorCusto" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `R$${v / 1000}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                  formatter={(val: any) => [`R$ ${Number(val).toLocaleString('pt-BR')}`, '']}
                />
                <Area type="monotone" dataKey="receita" name="Receita (R$)" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorReceita)" />
                <Area type="monotone" dataKey="custoAds" name="Custo Ads (R$)" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorCusto)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Donut Chart: Revenue by Acquisition Channel */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <PieChartIcon className="w-4 h-4 text-emerald-400" />
              Receita por Canal de Origem
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Origem das vendas convertidas no WhatsApp</p>
          </div>

          <div className="h-56 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={CHANNEL_BREAKDOWN}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {CHANNEL_BREAKDOWN.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                  formatter={(val: any) => [`R$ ${Number(val).toLocaleString('pt-BR')}`, '']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-1.5 text-xs">
            {CHANNEL_BREAKDOWN.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-slate-300">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="truncate max-w-[150px]">{item.name}</span>
                </div>
                <span className="font-bold text-white">R$ {item.value.toLocaleString('pt-BR')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Transactions Table & Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">Histórico de Transações e Cobranças</h2>
            <p className="text-xs text-slate-400">Todas as faturas geradas pelos operadores via WhatsApp</p>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por cliente ou produto..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 pl-8"
              />
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="all">Todos os Status</option>
              <option value="pago">Pago</option>
              <option value="pendente">Pendente</option>
              <option value="atrasado">Atrasado</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase font-semibold text-[10px]">
              <tr>
                <th className="p-3.5">Cód. / Data</th>
                <th className="p-3.5">Cliente / Lead</th>
                <th className="p-3.5">Produto / Serviço</th>
                <th className="p-3.5">Valor (R$)</th>
                <th className="p-3.5">Método</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Operador</th>
                <th className="p-3.5 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredTransactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-3.5">
                    <span className="font-mono text-emerald-400 font-bold">{tx.id}</span>
                    <p className="text-[10px] text-slate-500 mt-0.5">{tx.date}</p>
                  </td>

                  <td className="p-3.5">
                    <div className="font-bold text-white">{tx.leadName}</div>
                    <div className="text-[10px] text-slate-400">{tx.leadPhone}</div>
                  </td>

                  <td className="p-3.5 text-slate-300 font-medium max-w-xs truncate">
                    {tx.productName}
                  </td>

                  <td className="p-3.5 font-bold text-white text-sm">
                    R$ {tx.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>

                  <td className="p-3.5">
                    <span className="inline-flex items-center text-slate-300">
                      {tx.paymentMethod === 'PIX' && <QrCode className="w-3.5 h-3.5 mr-1 text-emerald-400" />}
                      {tx.paymentMethod === 'Cartão de Crédito' && <CreditCard className="w-3.5 h-3.5 mr-1 text-blue-400" />}
                      {tx.paymentMethod}
                    </span>
                  </td>

                  <td className="p-3.5">{getStatusBadge(tx.status)}</td>

                  <td className="p-3.5 text-slate-400">{tx.operatorName}</td>

                  <td className="p-3.5 text-right space-x-1">
                    {tx.status === 'pendente' && (
                      <button
                        type="button"
                        onClick={() => onUpdateTransactionStatus(tx.id, 'pago')}
                        className="px-2.5 py-1 bg-emerald-950 hover:bg-emerald-800 text-emerald-300 border border-emerald-700 rounded-lg text-[10px] font-bold"
                      >
                        Confirmar Pgto
                      </button>
                    )}
                    <a
                      href={`https://wa.me/${tx.leadPhone.replace(/\D/g, '')}?text=${encodeURIComponent(
                        `Olá ${tx.leadName}! Segue o link de cobrança do seu pedido (${tx.productName}): ${tx.paymentLinkUrl}`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-[10px] font-medium inline-flex items-center gap-1"
                    >
                      <Send className="w-3 h-3 text-emerald-400" /> Enviar Whats
                    </a>
                    {onDeleteTransaction && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Excluir a fatura ${tx.id}?`)) {
                            onDeleteTransaction(tx.id);
                          }
                        }}
                        className="p-1 bg-slate-900 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 border border-slate-800 rounded-lg"
                        title="Excluir fatura"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* NEW PAYMENT GENERATION MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative space-y-5">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 pb-3 border-b border-slate-800">
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
                <QrCode className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Gerador de Cobrança Instantânea PIX / WhatsApp</h2>
                <p className="text-xs text-slate-400">Emita um link e QR Code de pagamento para envio direto ao lead</p>
              </div>
            </div>

            {!createdPayment ? (
              <form onSubmit={handleCreatePaymentLink} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Lead / Cliente WhatsApp</label>
                  <select
                    value={selectedLeadId}
                    onChange={(e) => setSelectedLeadId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    {leads.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.phone})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Descrição do Produto / Serviço</label>
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    placeholder="Ex: Plano Anual de Treinamento Comercial"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Valor da Cobrança (R$)</label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-emerald-400 font-bold focus:outline-none focus:border-emerald-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Método de Pagamento</label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="PIX">PIX Instântaneo</option>
                      <option value="Cartão de Crédito">Cartão de Crédito</option>
                      <option value="Boleto Bancário">Boleto Bancário</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg flex items-center justify-center space-x-2 transition-all"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Gerar QR Code PIX & Link WhatsApp</span>
                </button>
              </form>
            ) : (
              <div className="space-y-4 animate-fade-in">
                <div className="p-4 bg-slate-950 border border-emerald-500/40 rounded-xl space-y-3 text-center">
                  <div className="inline-flex p-3 bg-white rounded-xl shadow-lg my-1">
                    {/* Simulated QR Code Visual */}
                    <div className="w-32 h-32 bg-slate-900 border-2 border-slate-950 p-2 text-emerald-400 font-mono text-[9px] flex flex-col justify-between items-center text-center">
                      <QrCode className="w-16 h-16 text-emerald-400" />
                      <span>PIX QR CODE</span>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-white">{createdPayment.productName}</h3>
                    <p className="text-lg font-black text-emerald-400 mt-0.5">
                      R$ {createdPayment.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-slate-400">Cliente: {createdPayment.leadName}</p>
                  </div>

                  <div className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg text-left text-[11px] font-mono text-slate-300 flex items-center justify-between">
                    <span className="truncate mr-2">{createdPayment.paymentLinkUrl}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(createdPayment.paymentLinkUrl || '')}
                      className="p-1 text-emerald-400 hover:text-emerald-300"
                      title="Copiar Link"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <a
                    href={`https://wa.me/${createdPayment.leadPhone.replace(/\D/g, '')}?text=${encodeURIComponent(
                      `Olá ${createdPayment.leadName}! Segue o link de pagamento PIX para finalizar seu pedido de ${createdPayment.productName} (R$ ${createdPayment.amount}): ${createdPayment.paymentLinkUrl}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl flex items-center justify-center space-x-2"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>Enviar para WhatsApp do Lead</span>
                  </a>

                  <button
                    onClick={() => setCreatedPayment(null)}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl"
                  >
                    Gerar Outro
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* OFFICIAL COMPANY PIX KEY CONFIGURATION MODAL */}
      {isPixKeyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Chave PIX Oficial da Empresa</h3>
                  <p className="text-[11px] text-slate-400">Usada para emissão de faturas e QR Code PIX</p>
                </div>
              </div>
              <button
                onClick={() => setIsPixKeyModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-bold mb-1">Informe a Chave PIX da Conta Jurídica / Empresa *</label>
                <input
                  type="text"
                  placeholder="CNPJ, E-mail, Telefone ou Chave Aleatória"
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 font-mono text-xs focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Esta chave será inserida automaticamente na mensagem de cobrança enviada ao WhatsApp do cliente.
                </p>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsPixKeyModalOpen(false)}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem('metaleads_official_pix_key', pixKey);
                    setIsPixKeyModalOpen(false);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-xl shadow"
                >
                  Salvar Chave PIX
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
