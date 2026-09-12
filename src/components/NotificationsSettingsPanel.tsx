import { useState } from 'react';
import { BellRing, MessageCircle } from 'lucide-react';
import { AlertSettingsPanel } from './AlertSettingsPanel';
import { CustomerNotificationSettingsPanel } from './CustomerNotificationSettingsPanel';

/**
 * Painel de comando de notificações (TASK-0399, 12/09/2026) — ponto de
 * entrada único da aba "Notificações", com duas sub-abas: alertas internos
 * (dono do tenant, `AlertSettingsPanel.tsx`) e mensagens automáticas pro
 * cliente final (`CustomerNotificationSettingsPanel.tsx`). Duas telas
 * separadas em vez de empilhar tudo numa só — a página já tinha crescido
 * uma vez na auditoria de UX da Base de Conhecimento (TASK-0396); 6 grupos
 * de configuração numa rolagem só seria denso demais.
 */
type NotificationsSubTab = 'internal' | 'customer';

export function NotificationsSettingsPanel() {
  const [subTab, setSubTab] = useState<NotificationsSubTab>('internal');

  return (
    <div>
      <div className="mb-4 flex gap-2 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setSubTab('internal')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition-colors ${subTab === 'internal' ? 'border-amber-500 text-amber-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
        >
          <BellRing className="h-3.5 w-3.5" /> Alertas internos
        </button>
        <button
          type="button"
          onClick={() => setSubTab('customer')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition-colors ${subTab === 'customer' ? 'border-emerald-500 text-emerald-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
        >
          <MessageCircle className="h-3.5 w-3.5" /> Mensagens automáticas pro cliente
        </button>
      </div>
      {subTab === 'internal' ? <AlertSettingsPanel /> : <CustomerNotificationSettingsPanel />}
    </div>
  );
}
