/**
 * Respostas rápidas configuráveis — lista única de mensagens prontas
 * compartilhada pela equipe, pro operador inserir com um clique no painel.
 * Mesmo conceito do getRespostasRapidas/saveRespostasRapidas do
 * whatsapp-agent-monique. Persiste no mesmo Supabase Storage.
 */
const BUCKET = 'app-data';
const OBJECT_PATH = 'quick-replies.json';

let quickReplies: string[] = [];
let persistence: { supabaseUrl: string; supabaseKey: string } | null = null;

export async function initQuickRepliesPersistence(supabaseUrl?: string, supabaseKey?: string) {
  if (!supabaseUrl || !supabaseKey) return;
  persistence = { supabaseUrl, supabaseKey };
  try {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (res.ok) quickReplies = (await res.json()) as string[];
  } catch (err) {
    console.warn('⚠️  [Respostas Rápidas] Falha ao carregar:', (err as Error).message);
  }
}

export function getQuickReplies(): string[] {
  return quickReplies;
}

export async function setQuickReplies(list: string[]) {
  quickReplies = list;
  if (!persistence) return;
  try {
    await fetch(`${persistence.supabaseUrl}/storage/v1/object/${BUCKET}/${OBJECT_PATH}`, {
      method: 'POST',
      headers: {
        apikey: persistence.supabaseKey,
        Authorization: `Bearer ${persistence.supabaseKey}`,
        'Content-Type': 'application/json',
        'x-upsert': 'true',
      },
      body: JSON.stringify(list),
    });
  } catch (err) {
    console.warn('⚠️  [Respostas Rápidas] Falha ao salvar:', (err as Error).message);
  }
}
