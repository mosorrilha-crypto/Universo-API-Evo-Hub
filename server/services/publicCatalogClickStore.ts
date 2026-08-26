import { randomUUID } from 'crypto';
import { getDb, getPlatformDb } from './db';
import { normalizeSlug } from './publicCatalogStore';

/**
 * Contador interno de clique nos botões de WhatsApp do catálogo público —
 * pedido direto do dono do produto (25/08/2026), independente do Meta Pixel
 * (o evento só chega pro Facebook, nunca pro nosso backend, então não serve
 * pra o AGENTE identificar de onde veio uma conversa) e do reconhecimento
 * por texto de "Gatilhos de Anúncio" (frágil — só funciona se o cliente
 * mandar a mensagem pré-preenchida exatamente como veio, sem editar nada).
 *
 * Fluxo: `recordCatalogWhatsappClick` grava o clique ANTES do redirect pro
 * WhatsApp (contagem real, não depende da mensagem chegar) e devolve um
 * `code` único — sequência curta de emojis "fofos" (tom da marca, não
 * parece um código de rastreamento) embutida no fim da mensagem
 * pré-preenchida. Se essa mensagem chegar de verdade no WhatsApp,
 * `matchCatalogClickCode` reconhece o `code` dentro do texto recebido
 * (substring, não só prefixo — sobrevive a edição antes/depois do código) e
 * liga a conversa a este clique específico com certeza.
 */

const CUTE_EMOJIS = ['💕', '💖', '💗', '🌸', '🌷', '✨', '🦋', '🎀', '⭐', '🌙', '💐', '😊'];
const CODE_EMOJI_COUNT = 3;
/** Janela de correlação: cliente pode clicar e só mandar a mensagem horas depois. */
const MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function generateCuteCode(): string {
  let code = '';
  for (let i = 0; i < CODE_EMOJI_COUNT; i++) {
    code += CUTE_EMOJIS[Math.floor(Math.random() * CUTE_EMOJIS.length)];
  }
  return code;
}

export interface CatalogWhatsappTarget {
  tenantId: string;
  whatsappNumber: string;
}

/**
 * Resolve só o necessário pra registrar o clique e montar o link de
 * WhatsApp (tenant_id + telefone) — não reaproveita `getPublicCatalogBySlug`
 * porque essa devolve o catálogo inteiro (produtos, Base de Conhecimento
 * localizada etc.), custo desnecessário só pra um redirect. Mesma regra de
 * acesso: só tenant com `public_catalog_enabled` e telefone configurado.
 */
export async function resolveCatalogWhatsappTarget(slug: string): Promise<CatalogWhatsappTarget | null> {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) return null;
  const { data, error } = await getPlatformDb()
    .from('tenants')
    .select('id, public_catalog_enabled, public_whatsapp_phone')
    .eq('slug', normalizedSlug)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id || data.public_catalog_enabled !== true || !data.public_whatsapp_phone) return null;
  return { tenantId: data.id, whatsappNumber: data.public_whatsapp_phone };
}

export interface CatalogWhatsappClick {
  id: string;
  tenantId: string;
  code: string;
  product?: string;
  message: string;
}

/**
 * Grava o clique e devolve a mensagem final (original + code) pra montar a
 * URL de redirect — gera um code novo até não colidir com outro code ainda
 * não consumido do mesmo tenant (evita duas mensagens diferentes baterem no
 * mesmo code por coincidência; com 12^3 combinações e volume real baixo,
 * normalmente acerta de primeira).
 */
export async function recordCatalogWhatsappClick(tenantId: string, baseMessage: string, product?: string): Promise<CatalogWhatsappClick> {
  const db = getPlatformDb();
  let code = generateCuteCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data } = await db.from('public_catalog_whatsapp_clicks').select('id').eq('tenant_id', tenantId).eq('code', code);
    if (!data || data.length === 0) break;
    code = generateCuteCode();
  }

  const message = `${baseMessage} ${code}`;
  const { data, error } = await db.from('public_catalog_whatsapp_clicks').insert({
    id: randomUUID(),
    tenant_id: tenantId,
    code,
    product: product || null,
    message,
    created_at: new Date().toISOString(),
    matched_at: null,
    matched_phone: null,
  }).select('*').single();
  if (error) throw error;

  return { id: data.id, tenantId, code, product, message };
}

/**
 * Procura, entre os cliques ainda não consumidos do tenant na janela de
 * correlação, algum cujo `code` apareça em QUALQUER parte do texto recebido
 * (não só no início — o cliente pode ter completado a mensagem antes ou
 * depois do emoji). Sem match: undefined, sem lançar erro (chamador decide
 * o próximo passo, ex: cair pro reconhecimento por Gatilho de Anúncio).
 */
export async function matchCatalogClickCode(tenantId: string, text: string): Promise<{ id: string; product?: string } | undefined> {
  if (!text) return undefined;
  const db = getDb();
  const since = new Date(Date.now() - MATCH_WINDOW_MS).toISOString();
  const { data } = await db.from('public_catalog_whatsapp_clicks').select('*').eq('tenant_id', tenantId).gte('created_at', since);
  const candidates = (data || []).filter((row: any) => !row.matched_at);
  const match = candidates.find((row: any) => text.includes(row.code));
  if (!match) return undefined;
  return { id: match.id, product: match.product || undefined };
}

/** Marca o clique como consumido (liga à conversa) assim que reconhecido — não volta a ser candidato pra outra mensagem. */
export async function consumeCatalogClick(clickId: string, phone: string): Promise<void> {
  const db = getDb();
  await db.from('public_catalog_whatsapp_clicks').update({
    matched_at: new Date().toISOString(),
    matched_phone: phone,
  }).eq('id', clickId);
}

const ANALYTICS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export interface CatalogClickWindowStats {
  clicks: number;
  matched: number;
}

export interface CatalogClickProductStats extends CatalogClickWindowStats {
  product: string;
}

export interface CatalogClickRecentEntry {
  id: string;
  product?: string;
  createdAt: string;
  matchedAt?: string;
  matchedPhone?: string;
}

export interface CatalogClickAnalytics {
  totalClicks: number;
  totalMatched: number;
  last7d: CatalogClickWindowStats;
  last30d: CatalogClickWindowStats;
  byProduct: CatalogClickProductStats[];
  /** Últimos 20 cliques, mais recente primeiro — visão rápida de "o que está acontecendo agora" na aba de Desempenho. */
  recent: CatalogClickRecentEntry[];
}

/**
 * Relatório de "leads do catálogo" (pedido real, 25/08/2026) — dá pra aba
 * de Desempenho responder "quantas pessoas clicaram" e "quantos desses
 * cliques viraram conversa de verdade", sem precisar de Meta Pixel/Windsor.
 * Janela de 90 dias é só limite de custo da consulta (tabela cresce sem
 * fim); os totais "all-time" de fato ficam de fora por enquanto — se algum
 * dia importar, dá pra trocar por um `count` agregado no banco.
 */
export async function getCatalogClickAnalytics(tenantId: string): Promise<CatalogClickAnalytics> {
  const db = getDb();
  const since = new Date(Date.now() - ANALYTICS_WINDOW_MS).toISOString();
  const { data } = await db.from('public_catalog_whatsapp_clicks').select('*').eq('tenant_id', tenantId).gte('created_at', since);
  const rows: any[] = data || [];

  const now = Date.now();
  const since7 = now - 7 * 24 * 60 * 60 * 1000;
  const since30 = now - 30 * 24 * 60 * 60 * 1000;

  const last7d: CatalogClickWindowStats = { clicks: 0, matched: 0 };
  const last30d: CatalogClickWindowStats = { clicks: 0, matched: 0 };
  const productMap = new Map<string, CatalogClickWindowStats>();
  let totalMatched = 0;

  for (const row of rows) {
    const createdMs = new Date(row.created_at).getTime();
    const isMatched = !!row.matched_at;
    if (isMatched) totalMatched++;
    if (createdMs >= since7) {
      last7d.clicks++;
      if (isMatched) last7d.matched++;
    }
    if (createdMs >= since30) {
      last30d.clicks++;
      if (isMatched) last30d.matched++;
    }
    const productKey = row.product || 'Geral (botão sem produto específico)';
    const entry = productMap.get(productKey) || { clicks: 0, matched: 0 };
    entry.clicks++;
    if (isMatched) entry.matched++;
    productMap.set(productKey, entry);
  }

  const byProduct = Array.from(productMap.entries())
    .map(([product, stats]) => ({ product, ...stats }))
    .sort((a, b) => b.clicks - a.clicks);

  const recent: CatalogClickRecentEntry[] = [...rows]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      product: row.product || undefined,
      createdAt: row.created_at,
      matchedAt: row.matched_at || undefined,
      matchedPhone: row.matched_phone || undefined,
    }));

  return { totalClicks: rows.length, totalMatched, last7d, last30d, byProduct, recent };
}
