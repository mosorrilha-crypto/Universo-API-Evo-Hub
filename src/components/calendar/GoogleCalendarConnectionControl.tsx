import { useEffect, useState } from 'react';
import { AlertCircle, CalendarCheck2, ExternalLink, Link2, Loader2, Unlink } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

/**
 * TASK-0263 (pedido direto, print real): "Desconectar Google Calendar" já
 * morou dentro de Ferramentas, depois dentro do popup "Agenda"
 * (`UpcomingEventsPanel`) — mas é uma ação rara de configuração (trocar de
 * conta), não de uso diário, e inflava o cabeçalho desse popup sem
 * necessidade. Mora agora aqui, na aba Agenda de verdade (menu principal),
 * como um controle discreto e autocontido — busca o próprio status, não
 * depende de nenhum state do Atendimento.
 */
interface GoogleCalendarConnectionControlProps {
  /** TASK-0292 (pedido direto, print real: "tem três balões encima do
      calendário que podem ser otimizados") — versão mais enxuta pra caber
      na mesma linha da alternância Hoje/Calendário no mobile, em vez de uma
      barra própria empilhada acima. Mesmas ações (conectar/desconectar),
      só com texto/paddings menores. */
  compact?: boolean;
}

export function GoogleCalendarConnectionControl({ compact = false }: GoogleCalendarConnectionControlProps = {}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [backupSheetUrl, setBackupSheetUrl] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = () => {
    apiFetch('/api/google-calendar/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { setConnected(!!data?.connected); setBackupSheetUrl(data?.backupSheetUrl); })
      .catch(() => setConnected(false));
  };

  useEffect(() => { fetchStatus(); }, []);

  const handleConnect = async () => {
    setError(null);
    setIsBusy(true);
    try {
      const res = await apiFetch('/api/google-calendar/connect');
      const data = await res.json();
      if (data.url) window.open(data.url, '_blank', 'width=520,height=650');
    } catch (err) {
      console.error('Falha ao iniciar conexão com Google Calendar:', err);
      setError('Não foi possível iniciar a conexão agora — tente de novo.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Desconectar o Google Calendar? O agente de agendamento para de conseguir consultar/criar horários reais até você reconectar (pode ser com outra conta).')) return;
    setError(null);
    setIsBusy(true);
    try {
      const res = await apiFetch('/api/google-calendar/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConnected(false);
    } catch (err) {
      console.error('Falha ao desconectar Google Calendar:', err);
      setError('Não foi possível desconectar agora — tente de novo.');
    } finally {
      setIsBusy(false);
    }
  };

  if (compact) {
    const statusTitle = connected === null ? 'Verificando conexão com o Google Calendar...' : connected ? 'Google Calendar conectado' : 'Google Calendar não conectado';
    return (
      <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1.5" title={statusTitle}>
        {connected ? <CalendarCheck2 className="w-3.5 h-3.5 flex-shrink-0 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5 flex-shrink-0 text-slate-500" />}
        {connected && backupSheetUrl && (
          <a href={backupSheetUrl} target="_blank" rel="noopener noreferrer" title="Abrir planilha de backup dos leads no Google Sheets" className="text-slate-500 hover:text-emerald-300">
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {connected === true && (
          <button type="button" onClick={handleDisconnect} disabled={isBusy} title="Desconectar Google Calendar (pra trocar de conta)" className="text-slate-400 hover:text-rose-300 disabled:opacity-50">
            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
          </button>
        )}
        {connected === false && (
          <button type="button" onClick={handleConnect} disabled={isBusy} title="Conectar Google Calendar" className="text-emerald-300 hover:text-emerald-200 disabled:opacity-50">
            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          </button>
        )}
        {error && <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-rose-400" title={error} />}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        {connected ? (
          <CalendarCheck2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        ) : (
          <Link2 className="w-4 h-4 text-slate-500 flex-shrink-0" />
        )}
        <span className="text-slate-300 truncate">
          {connected === null ? 'Verificando conexão com o Google Calendar...' : connected ? 'Google Calendar conectado' : 'Google Calendar não conectado'}
        </span>
        {connected && backupSheetUrl && (
          <a
            href={backupSheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir planilha de backup dos leads no Google Sheets"
            className="p-1 text-slate-500 hover:text-emerald-300 rounded cursor-pointer flex-shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {error && <span className="text-[10px] text-rose-400">{error}</span>}
        {connected === true && (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={isBusy}
            title="Desconectar Google Calendar (pra trocar de conta)"
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-400 hover:text-rose-300 border border-slate-700 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
            Desconectar
          </button>
        )}
        {connected === false && (
          <button
            type="button"
            onClick={handleConnect}
            disabled={isBusy}
            title="Conectar Google Calendar"
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:text-emerald-200 border border-emerald-700/50 rounded-lg cursor-pointer disabled:opacity-50"
          >
            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            Conectar
          </button>
        )}
      </div>
    </div>
  );
}
