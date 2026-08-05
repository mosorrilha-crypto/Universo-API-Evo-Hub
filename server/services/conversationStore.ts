/**
 * Histórico de conversas reais de WhatsApp, em memória — alimenta a caixa de
 * mensagens do frontend (WhatsAppLeadsSim) com dados de verdade em vez do
 * mock local. Persiste opcionalmente num arquivo JSON no Supabase Storage
 * (bucket "app-data"), pra sobreviver a reinícios/redeploys do servidor —
 * sem precisar de migração de schema (ver initConversationPersistence).
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

let persistence: { supabaseUrl: string; supabaseKey: string } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const BUCKET = 'app-data';
const OBJECT_PATH = 'conversations.json';

/**
 * Liga a persistência em Supabase Storage: carrega o snapshot mais recente
 * (se existir) pra dentro do Map em memória, e cria o bucket se ainda não
 * existir. Chamar uma vez na subida do servidor (server.ts). Sem isso, o
 * store continua funcionando normalmente, só que 100% em memória.
 */
export async function initConversationPersistence(supabaseUrl?: string, supabaseKey?: string) {
  if (!supabaseUrl || !supabaseKey) return;
  persistence = { supabaseUrl, supabaseKey };

  try {
    await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
    });
  } catch {
    // bucket provavelmente já existe — ignora
  }

  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (res.ok) {
      const data = (await res.json()) as StoredConversation[];
      for (const conv of data) conversations.set(conv.phone, conv);
      console.log(`💾 [Conversas] ${data.length} conversa(s) restaurada(s) do Supabase Storage.`);
    }
  } catch (err) {
    console.warn('⚠️  [Conversas] Falha ao carregar snapshot do Supabase Storage (seguindo só em memória):', (err as Error).message);
  }
}

function scheduleSave() {
  if (!persistence) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch(`${persistence!.supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
        method: 'POST',
        headers: {
          apikey: persistence!.supabaseKey,
          Authorization: `Bearer ${persistence!.supabaseKey}`,
          'Content-Type': 'application/json',
          'x-upsert': 'true',
        },
        body: JSON.stringify(Array.from(conversations.values())),
      });
    } catch (err) {
      console.warn('⚠️  [Conversas] Falha ao salvar snapshot no Supabase Storage:', (err as Error).message);
    }
  }, 2000);
}

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
  scheduleSave();
  return conv;
}

/** Atualiza o texto de uma mensagem já registrada (ex: placeholder de áudio → transcrição real). */
export function updateMessageText(phone: string, id: string, newText: string) {
  const conv = conversations.get(phone);
  const msg = conv?.messages.find((m) => m.id === id);
  if (msg) {
    msg.text = newText;
    conv!.updatedAt = new Date().toISOString();
    scheduleSave();
  }
}

export function recordOutgoingMessage(phone: string, message: Omit<StoredMessage, 'id' | 'sender'>) {
  const conv = getOrCreate(phone);
  conv.messages.push({ id: `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, sender: 'agent', ...message });
  conv.updatedAt = new Date().toISOString();
  scheduleSave();
  return conv;
}

export function listConversations(): StoredConversation[] {
  return Array.from(conversations.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getConversation(phone: string): StoredConversation | undefined {
  return conversations.get(phone);
}

/**
 * Limpa o histórico de mensagens de um número específico (ex: número de
 * teste), mas mantém o contato/lead (nome, telefone) — pra testes não
 * ficarem contaminados pela memória de conversas anteriores, sem perder o
 * cadastro do contato. Equivalente ao deleteHistory() do
 * whatsapp-agent-monique, mas sem apagar o registro do lead.
 */
export function clearConversationHistory(phone: string): StoredConversation | undefined {
  const conv = conversations.get(phone);
  if (!conv) return undefined;
  conv.messages = [];
  conv.updatedAt = new Date().toISOString();
  scheduleSave();
  return conv;
}
