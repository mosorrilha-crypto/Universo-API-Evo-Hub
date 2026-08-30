import React, { useEffect, useState } from 'react';
import { QrCode, X, CheckCircle2, RefreshCw } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

/**
 * Extraído de `WhatsAppLeadsSim.tsx` (TASK-0167, 29/08/2026, pedido do dono
 * do produto: "reconectar WhatsApp pode ficar nas configurações do tenant
 * quando admin") — antes vivia dentro do painel de Ferramentas do
 * Atendimento; agora mora na Base de Conhecimento (`AgentKnowledgeBase.tsx`),
 * que já é a tela de configuração operacional do tenant vista por admins.
 *
 * Mesma lógica de sempre, inalterada: gera/renova o QR Code de conexão via
 * Evolution API (server/routes/admin.ts). Ícone só, sem seletor de tenant
 * nem opção de criar tenant novo — sempre o tenant logado. O backend
 * (resolveEvolutionTenantId) ignora qualquer id que não venha de saas_admin
 * e resolve pelo tenantId do JWT, então isso nunca abre a conexão de outro
 * tenant mesmo que o `tenantId` passado aqui esteja errado/desatualizado.
 */
export const ReconectarWhatsAppQrCode: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'idle' | 'waiting' | 'connected'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isRecreating, setIsRecreating] = useState(false);

  useEffect(() => {
    if (connectionState !== 'waiting') return;
    const interval = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/admin/tenants/${tenantId}/evolution-instance/status`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.connected) setConnectionState('connected');
      } catch {
        // Falha transitória de rede durante o polling — tenta de novo no próximo tick.
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [connectionState, tenantId]);

  const handleRefreshQr = async () => {
    setIsGeneratingQr(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch(`/api/admin/tenants/${tenantId}/evolution-instance/qrcode`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.warning) setErrorMsg(data.warning);
      setQrCodeBase64(data.qrCodeBase64 || null);
      setConnectionState('waiting');
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao buscar o QR Code.');
    } finally {
      setIsGeneratingQr(false);
    }
  };

  const handleGenerateQr = async () => {
    setIsGeneratingQr(true);
    setErrorMsg(null);
    setQrCodeBase64(null);
    try {
      const res = await apiFetch(`/api/admin/tenants/${tenantId}/evolution-instance`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.warning) setErrorMsg(data.warning);
      if (data.qrCodeBase64) {
        setQrCodeBase64(data.qrCodeBase64);
        setConnectionState('waiting');
      } else {
        await handleRefreshQr();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao gerar o QR Code.');
    } finally {
      setIsGeneratingQr(false);
    }
  };

  const openModal = () => {
    setIsModalOpen(true);
    setErrorMsg(null);
    setQrCodeBase64(null);
    setConnectionState('idle');
  };

  // Recria a instância do zero na Evolution API (delete + create) — achado
  // real (15/08/2026, Clic Piscinas): diferente de "Gerar novo QR Code" (só
  // renova o pareamento de uma instância já saudável), isso limpa estado
  // interno do Baileys que reconectar sozinho não resolve (ex: mapeamento
  // @lid degradado pra um contato específico — issue #262). Sempre exige
  // escanear o QR de novo depois — por isso pede confirmação explícita.
  const handleRecreateInstance = async () => {
    if (!window.confirm('Isso vai apagar e recriar a instância do WhatsApp desse tenant do zero. A conexão atual cai e vai ser preciso escanear o QR Code de novo. Continuar?')) return;
    setIsRecreating(true);
    setErrorMsg(null);
    setQrCodeBase64(null);
    try {
      const res = await apiFetch(`/api/admin/tenants/${tenantId}/evolution-instance/recreate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.warning) setErrorMsg(data.warning);
      if (data.qrCodeBase64) {
        setQrCodeBase64(data.qrCodeBase64);
        setConnectionState('waiting');
      } else {
        await handleRefreshQr();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Falha ao recriar a instância.');
    } finally {
      setIsRecreating(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Gerar/renovar o QR Code de conexão do WhatsApp deste tenant (Evolution API)"
        className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-sky-800/60 bg-sky-950/60 px-3 py-2 text-xs font-semibold text-sky-300 transition-all hover:bg-sky-900/80"
      >
        <QrCode className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Reconectar WhatsApp (QR Code)</span>
        <span className="sm:hidden">Reconectar WhatsApp</span>
      </button>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setIsModalOpen(false)}>
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-sm flex items-center gap-2">
                <QrCode className="w-4 h-4 text-sky-400" /> Reconectar WhatsApp (Evolution API)
              </h3>
              <button type="button" onClick={() => setIsModalOpen(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="bg-red-950/60 border border-red-800 rounded-lg p-2.5 text-xs text-red-300">{errorMsg}</div>
            )}

            {connectionState === 'connected' ? (
              <div className="text-center py-6 space-y-3">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                <p className="text-sm text-white font-semibold">WhatsApp conectado!</p>
                <p className="text-xs text-slate-400">O número já pode receber e enviar mensagens de novo.</p>
                <button
                  type="button"
                  onClick={handleRecreateInstance}
                  disabled={isRecreating}
                  className="text-xs text-red-300 hover:text-red-200 flex items-center gap-1.5 mx-auto disabled:opacity-50 pt-2"
                >
                  <RefreshCw className={`w-3 h-3 ${isRecreating ? 'animate-spin' : ''}`} /> {isRecreating ? 'Recriando...' : 'Mensagens não chegam mesmo conectado? Recriar instância do zero'}
                </button>
              </div>
            ) : qrCodeBase64 ? (
              <div className="text-center space-y-3">
                <img src={qrCodeBase64} alt="QR Code de conexão" className="mx-auto rounded-lg border border-slate-700 w-56 h-56 object-contain bg-white" />
                <p className="text-xs text-slate-400">Abra o WhatsApp no celular deste número → Aparelhos conectados → Conectar um aparelho → escaneie este código.</p>
                <button
                  type="button"
                  onClick={handleRefreshQr}
                  disabled={isGeneratingQr}
                  className="text-xs text-sky-300 hover:text-sky-200 flex items-center gap-1.5 mx-auto disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isGeneratingQr ? 'animate-spin' : ''}`} /> QR expirou? Gerar novo
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGenerateQr}
                disabled={isGeneratingQr}
                className="w-full bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {isGeneratingQr ? <span className="animate-spin">⏳</span> : <QrCode className="w-3.5 h-3.5" />}
                {isGeneratingQr ? 'Gerando...' : 'Gerar QR Code'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
};
