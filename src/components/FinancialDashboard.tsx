import React, { useMemo, useState } from 'react';
import {
  FinancialTransaction,
  LeadInfo,
  PaymentMethod,
  PaymentStatus,
  UserProfile
} from '../types';
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  QrCode,
  Landmark,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  Search,
  Send,
  Building2,
  X,
  ArrowUpRight,
  PieChart as PieChartIcon,
  Trash2,
  Sparkles
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell
} from 'recharts';

interface FinancialDashboardProps {
  transactions?: FinancialTransaction[];
  /** Devolve true quando persistiu de verdade no servidor — o modal só mostra a tela de sucesso nesse caso (nunca assume sucesso sem confirmação real). */
  onAddTransaction?: (newTx: FinancialTransaction) => Promise<boolean>;
  onUpdateTransactionStatus?: (id: string, newStatus: PaymentStatus) => void;
  onDeleteTransaction?: (txId: string) => void;
  onClearAllTransactions?: () => void;
  leads?: LeadInfo[];
  currentUser?: UserProfile | any;
  initialSelectedLead?: LeadInfo | null;
  /** Moeda real do tenant (Tenant.currency, ex: "PYG") — default PYG (moeda principal do negócio, ver CLAUDE.md) quando ainda não carregou de GET /api/tenant. */
  currency?: string;
  locale?: string;
}

const DONUT_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#0EA5E9', '#ec4899'];

const PAYMENT_METHOD_ICON: Record<PaymentMethod, React.ReactNode> = {
  'PIX': <QrCode className="w-3.5 h-3.5 mr-1 text-emerald-400" />,
  'Transferência Bancária': <Landmark className="w-3.5 h-3.5 mr-1 text-blue-400" />,
  'Cartão de Crédito': <CreditCard className="w-3.5 h-3.5 mr-1 text-blue-400" />,
  'Boleto Bancário': <DollarSign className="w-3.5 h-3.5 mr-1 text-amber-400" />,
  'Link WhatsApp': <Send className="w-3.5 h-3.5 mr-1 text-emerald-400" />,
};

export const FinancialDashboard: React.FC<FinancialDashboardProps> = ({
  transactions = [],
  onAddTransaction,
  onUpdateTransactionStatus,
  onDeleteTransaction,
  onClearAllTransactions,
  leads: propLeads,
  currentUser: propCurrentUser,
  initialSelectedLead,
  currency = 'PYG',
  locale = 'es-PY',
}) => {
  const leads = propLeads || [];
  const currentUser = propCurrentUser || { name: 'Operador Admin', id: 'op_1' };
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(!!initialSelectedLead);

  // New Transaction Form State
  const [selectedLeadId, setSelectedLeadId] = useState<string>(initialSelectedLead?.id || (leads[0]?.id || ''));
  const [productName, setProductName] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Transferência Bancária');
  const [status, setStatus] = useState<PaymentStatus>('pago');
  const [justCreated, setJustCreated] = useState<FinancialTransaction | null>(null);

  /** Formata na moeda real do tenant — nunca R$/pt-BR fixo (achado real: negócio roda em PYG, não BRL). Intl já cuida de casas decimais certas por moeda (PYG não usa centavos, por exemplo). */
  const formatMoney = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);

  const filteredTransactions = transactions.filter((t) => {
    const matchesSearch =
      t.leadName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.leadPhone.includes(searchTerm);

    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // KPI Calculations — todos derivados de dado real (`transactions`), nunca
  // um número fixo/inventado. Achado real (19/08/2026): a versão anterior
  // deste painel mostrava "ROI do Meta Ads 4.8x" e "+18,4% vs mês anterior"
  // como strings fixas no JSX, sem nenhuma fonte de dado real por trás —
  // removidos, não substituídos por outra invenção.
  const totalPaidRevenue = transactions.filter((t) => t.status === 'pago').reduce((acc, t) => acc + t.amount, 0);
  const totalPendingRevenue = transactions.filter((t) => t.status === 'pendente' || t.status === 'atrasado').reduce((acc, t) => acc + t.amount, 0);
  const paidCount = transactions.filter((t) => t.status === 'pago').length;
  const ticketMedio = paidCount > 0 ? totalPaidRevenue / paidCount : 0;

  const now = new Date();
  const paidThisMonthCount = transactions.filter((t) => {
    if (t.status !== 'pago') return false;
    const d = new Date(t.date);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  // Gráfico de faturamento diário — receita real dos últimos 14 dias, só
  // transações pagas. Sem nenhum "custo de ads" (não existe fonte real
  // dessa informação hoje, ver plano do Financeiro).
  const revenueByDay = useMemo(() => {
    const days: { key: string; day: string; receita: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ key, day: d.toLocaleDateString(locale, { day: '2-digit', month: 'short' }), receita: 0 });
    }
    const byKey = new Map(days.map((d) => [d.key, d]));
    for (const t of transactions) {
      if (t.status !== 'pago') continue;
      const key = new Date(t.date).toISOString().slice(0, 10);
      const bucket = byKey.get(key);
      if (bucket) bucket.receita += t.amount;
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions]);

  // Breakdown real por forma de pagamento — o dado que mais importa pro
  // pedido de "controle de transferências bancárias manuais": quanto entrou
  // via transferência vs PIX vs outros métodos.
  const paymentMethodBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of transactions) {
      if (t.status !== 'pago') continue;
      totals.set(t.paymentMethod, (totals.get(t.paymentMethod) || 0) + t.amount);
    }
    return Array.from(totals.entries())
      .map(([name, value], i) => ({ name, value, color: DONUT_COLORS[i % DONUT_COLORS.length] }))
      .sort((a, b) => b.value - a.value);
  }, [transactions]);

  const resetForm = () => {
    setProductName('');
    setAmount('');
    setPaymentMethod('Transferência Bancária');
    setStatus('pago');
    setSelectedLeadId(initialSelectedLead?.id || (leads[0]?.id || ''));
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleRegisterTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddTransaction || !amount || amount <= 0 || !productName.trim()) return;
    const lead = leads.find((l) => l.id === selectedLeadId);

    const newTx: FinancialTransaction = {
      id: crypto.randomUUID(),
      leadId: lead?.id || 'manual',
      leadName: lead?.name || 'Cliente sem cadastro',
      leadPhone: lead?.phone || '',
      productName: productName.trim(),
      amount,
      paymentMethod,
      status,
      date: new Date().toISOString(),
      operatorName: currentUser.name,
      channel: 'Registro manual',
    };

    setSubmitError(null);
    setIsSubmitting(true);
    const saved = await onAddTransaction(newTx);
    setIsSubmitting(false);
    if (!saved) {
      setSubmitError('Não foi possível registrar no servidor. Tente de novo.');
      return;
    }
    setJustCreated(newTx);
    resetForm();
  };

  const getStatusBadge = (s: PaymentStatus) => {
    switch (s) {
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
              Gestão Financeira do Negócio
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
              CFO / Operador
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Controle de faturamento e registro de transferências bancárias/comprovantes conferidos — dado real, salvo por empresa.
          </p>
        </div>

        <div className="flex items-center space-x-2 flex-wrap gap-2">
          {onClearAllTransactions && transactions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Tem certeza que deseja apagar TODOS os ${transactions.length} registros? Isso não pode ser desfeito.`)) {
                  onClearAllTransactions();
                }
              }}
              className="py-2.5 px-3 bg-slate-950 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-800/60 font-semibold text-xs rounded-xl flex items-center space-x-1 transition-all"
              title="Apagar todos os registros"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Limpar Tudo</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setJustCreated(null);
              resetForm();
              setIsModalOpen(true);
            }}
            className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/40 flex items-center space-x-2 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Registrar Transferência / Venda</span>
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
          <div className="text-2xl font-black text-emerald-400">{formatMoney(totalPaidRevenue)}</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Pendentes & Atrasados</span>
            <div className="p-2 bg-amber-500/10 rounded-lg text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-amber-400">{formatMoney(totalPendingRevenue)}</div>
          <p className="text-[10px] text-slate-500 mt-2">{transactions.filter((t) => t.status === 'pendente').length} a receber</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Ticket Médio por Venda</span>
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-white">{formatMoney(ticketMedio)}</div>
          <p className="text-[10px] text-slate-500 mt-2">Média por venda confirmada</p>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 p-5 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Vendas Confirmadas no Mês</span>
            <div className="p-2 bg-sky-500/10 rounded-lg text-sky-400">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-sky-300">{paidThisMonthCount}</div>
          <p className="text-[10px] text-slate-500 mt-2">Transações pagas neste mês</p>
        </div>
      </div>

      {/* RECHARTS GRAPHS SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Area Chart: Real Daily Revenue */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div>
            <h2 className="text-sm font-bold text-white">Evolução de Faturamento Diário</h2>
            <p className="text-xs text-slate-400 mt-0.5">Receita confirmada nos últimos 14 dias</p>
          </div>

          {totalPaidRevenue === 0 ? (
            <div className="h-64 w-full flex flex-col items-center justify-center text-center text-slate-500 gap-2">
              <TrendingUp className="w-8 h-8 text-slate-700" />
              <p className="text-xs">Nenhuma venda confirmada ainda — o gráfico aparece assim que a primeira entrar.</p>
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueByDay}>
                  <defs>
                    <linearGradient id="colorReceita" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                  <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => formatMoney(v)} width={80} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                    formatter={(val: any) => [formatMoney(Number(val)), 'Receita']}
                  />
                  <Area type="monotone" dataKey="receita" name="Receita" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorReceita)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Donut Chart: Real breakdown by payment method */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <PieChartIcon className="w-4 h-4 text-emerald-400" />
              Receita por Forma de Pagamento
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Vendas confirmadas, por método</p>
          </div>

          {paymentMethodBreakdown.length === 0 ? (
            <div className="h-56 w-full flex flex-col items-center justify-center text-center text-slate-500 gap-2">
              <Sparkles className="w-8 h-8 text-slate-700" />
              <p className="text-xs">Sem vendas pagas ainda.</p>
            </div>
          ) : (
            <>
              <div className="h-56 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={paymentMethodBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                      {paymentMethodBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                      formatter={(val: any) => [formatMoney(Number(val)), '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-1.5 text-xs">
                {paymentMethodBreakdown.map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-slate-300">
                    <div className="flex items-center space-x-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="truncate max-w-[150px]">{item.name}</span>
                    </div>
                    <span className="font-bold text-white">{formatMoney(item.value)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Transactions Table & Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">Histórico de Transações</h2>
            <p className="text-xs text-slate-400">Vendas confirmadas pelo WhatsApp (automático) + registros manuais</p>
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
                <th className="p-3.5">Data</th>
                <th className="p-3.5">Cliente / Lead</th>
                <th className="p-3.5">Produto / Serviço</th>
                <th className="p-3.5">Valor</th>
                <th className="p-3.5">Método</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Origem</th>
                <th className="p-3.5 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    {transactions.length === 0
                      ? 'Nenhum registro ainda — vendas confirmadas por comprovante no WhatsApp entram aqui automaticamente, ou registre uma manualmente.'
                      : 'Nenhum registro bate com o filtro/busca.'}
                  </td>
                </tr>
              )}
              {filteredTransactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-800/50 transition-colors">
                  <td className="p-3.5 text-slate-400">
                    {new Date(tx.date).toLocaleDateString(locale)}
                  </td>

                  <td className="p-3.5">
                    <div className="font-bold text-white">{tx.leadName}</div>
                    <div className="text-[10px] text-slate-400">{tx.leadPhone}</div>
                  </td>

                  <td className="p-3.5 text-slate-300 font-medium max-w-xs truncate">
                    {tx.productName}
                  </td>

                  <td className="p-3.5 font-bold text-white text-sm">
                    {formatMoney(tx.amount)}
                  </td>

                  <td className="p-3.5">
                    <span className="inline-flex items-center text-slate-300">
                      {PAYMENT_METHOD_ICON[tx.paymentMethod]}
                      {tx.paymentMethod}
                    </span>
                  </td>

                  <td className="p-3.5">{getStatusBadge(tx.status)}</td>

                  <td className="p-3.5">
                    {tx.sourceRef ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-950 text-blue-300 border border-blue-800" title="Criado automaticamente quando o comprovante foi aprovado no WhatsApp">
                        Automático
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                        Manual{tx.operatorName ? ` · ${tx.operatorName}` : ''}
                      </span>
                    )}
                  </td>

                  <td className="p-3.5 text-right space-x-1">
                    {tx.status === 'pendente' && (
                      <button
                        type="button"
                        onClick={() => onUpdateTransactionStatus?.(tx.id, 'pago')}
                        className="px-2.5 py-1 bg-emerald-950 hover:bg-emerald-800 text-emerald-300 border border-emerald-700 rounded-lg text-[10px] font-bold"
                      >
                        Confirmar Pgto
                      </button>
                    )}
                    {onDeleteTransaction && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Excluir este registro (${tx.productName})?`)) {
                            onDeleteTransaction(tx.id);
                          }
                        }}
                        className="p-1 bg-slate-900 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 border border-slate-800 rounded-lg"
                        title="Excluir registro"
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

      {/* REGISTER TRANSACTION MODAL — achado real (19/08/2026): a versão
          anterior deste modal gerava um "QR Code PIX" e um link de pagamento
          totalmente fictícios (nenhum gateway real integrado ainda). Vira só
          o que é de verdade: um registro manual de venda/transferência já
          recebida (ou a receber), conferida por comprovante fora do sistema. */}
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
                <Landmark className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Registrar Transferência / Venda</h2>
                <p className="text-xs text-slate-400">Lance uma venda já confirmada (ex: comprovante de transferência conferido fora do WhatsApp)</p>
              </div>
            </div>

            {!justCreated ? (
              <form onSubmit={handleRegisterTransaction} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Lead / Cliente</label>
                  <select
                    value={selectedLeadId}
                    onChange={(e) => setSelectedLeadId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Cliente sem cadastro no CRM</option>
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
                    placeholder="Ex: Corte + Escova"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Valor ({currency})</label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
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
                      <option value="Transferência Bancária">Transferência Bancária</option>
                      <option value="PIX">PIX</option>
                      <option value="Cartão de Crédito">Cartão de Crédito</option>
                      <option value="Boleto Bancário">Boleto Bancário</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as PaymentStatus)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="pago">Pago (comprovante já conferido)</option>
                    <option value="pendente">Pendente (ainda a receber)</option>
                  </select>
                </div>

                {submitError && (
                  <p className="text-[11px] text-rose-400 bg-rose-950/40 border border-rose-800/60 rounded-lg px-3 py-2">{submitError}</p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-xl shadow-lg flex items-center justify-center space-x-2 transition-all"
                >
                  <Building2 className="w-4 h-4" />
                  <span>{isSubmitting ? 'Registrando...' : 'Registrar'}</span>
                </button>
              </form>
            ) : (
              <div className="space-y-4 animate-fade-in">
                <div className="p-4 bg-slate-950 border border-emerald-500/40 rounded-xl space-y-2 text-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                  <h3 className="text-sm font-bold text-white">{justCreated.productName}</h3>
                  <p className="text-lg font-black text-emerald-400">{formatMoney(justCreated.amount)}</p>
                  <p className="text-xs text-slate-400">Cliente: {justCreated.leadName}</p>
                  <p className="text-[11px] text-slate-500">Registrado com sucesso.</p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setJustCreated(null)}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-xl"
                  >
                    Registrar Outra
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setJustCreated(null);
                      setIsModalOpen(false);
                    }}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
