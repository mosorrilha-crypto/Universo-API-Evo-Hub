import { useEffect, useState } from 'react';
import { getExistingPushSubscription, enablePushNotifications, disablePushNotifications } from '../lib/pushNotifications';

/**
 * Notificação push do PWA do atendente (issue #159) — segundo canal de
 * alerta (escalação nova, agente pausado com lead sem resposta), além do
 * WhatsApp template já existente. Extraído de WhatsAppLeadsSim.tsx
 * (TASK-0284, pedido direto): o toggle vivia só dentro do menu ⋮ da
 * conversa aberta, sem nenhum sentido de "ação desta conversa" — virou
 * hook compartilhado pra também aparecer no Header global (configuração de
 * conta, não de uma conversa específica), sem duplicar a lógica de
 * ativar/desativar em dois lugares.
 *
 * `null` = ainda verificando se já existe assinatura salva no navegador;
 * `false` cobre tanto "nunca ativou" quanto "navegador não suporta" (a
 * mensagem de erro específica só aparece se o operador tentar ativar).
 */
export function usePushNotifications() {
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    getExistingPushSubscription()
      .then((sub) => setPushEnabled(!!sub))
      .catch(() => setPushEnabled(false));
  }, []);

  const toggle = async () => {
    setPushError(null);
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
          setPushError(result.error || 'Não foi possível ativar notificações agora.');
        }
      }
    } finally {
      setPushBusy(false);
    }
  };

  return { pushEnabled, pushBusy, pushError, togglePush: toggle };
}
