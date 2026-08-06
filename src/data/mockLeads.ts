import { LeadInfo, ChatMessage } from '../types';

// Lista de leads de exemplo/demonstração removida para produção — o CRM
// agora começa vazio e é alimentado só por leads reais (WhatsApp/CAPI).
export const INITIAL_MOCK_LEADS: (LeadInfo & { textContent: string; messages: ChatMessage[] })[] = [];
