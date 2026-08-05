/**
 * Histórico de conversas reais de WhatsApp, em memória — alimenta a caixa de
 * mensagens do frontend (WhatsAppLeadsSim) com dados de verdade em vez do
 * mock local. Sem persistência: reinício do processo apaga o histórico
 * (migrar pra Supabase é o próximo passo natural, fora do escopo desta versão).
 */

export interface StoredMessage {
  id: string;
  sender: 'lead' | 'agent';
  type: 'text' | 'audio' | 'image' | 'file';
  text?: string;
  timestamp: string;
}

export interface StoredConversation {
  phone: string;
  name?: string;
  messages: StoredMessage[];
  updatedAt: string;
}

const conversations = new Map<string, StoredConversation>();

function getOrCreate(phone: string, name?: string): StoredConversation {
  let conv = conversations.get(phone);
  if (!conv) {
    conv = { phone, name, messages: [], updatedAt: new Date().toISOString() };
    conversations.set(phone, conv);
  } else if (name && !conv.name) {
    conv.name = name;
  }
  return conv;
}

export function recordIncomingMessage(phone: string, name: string | undefined, message: Omit<StoredMessage, 'id' | 'sender'>, customId?: string) {
  const conv = getOrCreate(phone, name);
  const id = customId || `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  conv.messages.push({ id, sender: 'lead', ...message });
  conv.updatedAt = new Date().toISOString();
  return conv;
}

/** Atualiza o texto de uma mensagem já registrada (ex: placeholder de áudio → transcrição real). */
export function updateMessageText(phone: string, id: string, newText: string) {
  const conv = conversations.get(phone);
  const msg = conv?.messages.find((m) => m.id === id);
  if (msg) {
    msg.text = newText;
    conv!.updatedAt = new Date().toISOString();
  }
}

export function recordOutgoingMessage(phone: string, message: Omit<StoredMessage, 'id' | 'sender'>) {
  const conv = getOrCreate(phone);
  conv.messages.push({ id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, sender: 'agent', ...message });
  conv.updatedAt = new Date().toISOString();
  return conv;
}

export function listConversations(): StoredConversation[] {
  return Array.from(conversations.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getConversation(phone: string): StoredConversation | undefined {
  return conversations.get(phone);
}
