import { describe, expect, it } from 'vitest';
import {
  extractMessagingConversations,
  isTrafficDatePreset,
  trafficDeliveryLabel,
} from '../metaAdsInsightsService';

describe('metaAdsInsightsService', () => {
  it('prioriza uma única métrica de conversa iniciada e evita somar ações similares em duplicidade', () => {
    const result = extractMessagingConversations([
      { action_type: 'onsite_conversion.messaging_first_reply', value: '9' },
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '7' },
      { action_type: 'link_click', value: '42' },
    ]);

    expect(result).toEqual({
      actionType: 'onsite_conversion.messaging_conversation_started_7d',
      value: 7,
    });
  });

  it('aceita variações reais de ação de conversa quando a principal não está disponível', () => {
    const result = extractMessagingConversations([
      { action_type: 'link_click', value: '42' },
      { action_type: 'custom.messaging_conversation_started', value: '4' },
    ]);

    expect(result).toEqual({
      actionType: 'custom.messaging_conversation_started',
      value: 4,
    });
  });

  it('não inventa conversas quando a Meta não retornou uma ação de mensagens', () => {
    expect(extractMessagingConversations([{ action_type: 'link_click', value: '23' }]))
      .toEqual({ actionType: null, value: 0 });
  });

  it('aceita somente os períodos expostos pela Central de Tráfego', () => {
    expect(isTrafficDatePreset('today')).toBe(true);
    expect(isTrafficDatePreset('last_30d')).toBe(true);
    expect(isTrafficDatePreset('maximum')).toBe(false);
    expect(isTrafficDatePreset(undefined)).toBe(false);
  });

  it('traduz os estados operacionais da Meta para o painel', () => {
    expect(trafficDeliveryLabel('active')).toBe('Ativo');
    expect(trafficDeliveryLabel('pending_review')).toBe('Em análise');
    expect(trafficDeliveryLabel('disapproved')).toBe('Reprovado');
  });
});
