import { getPlatformDb } from './db';
import { decryptSecret } from './tokenCrypto';

interface ProbeRequest { tenantId: string; from: string; to: string; expiresAt: string; action?: 'probe' | 'restart' | 'ignore_groups'; requestId?: string }

/** Operação opt-in, sem rota pública, sem importar/enviar mensagens. Restart explícito e idempotente. */
export function parseHistoryProbeRequest(raw: string | undefined, now = Date.now()): ProbeRequest | undefined {
  if (!raw) return undefined;
  const request = JSON.parse(raw) as ProbeRequest;
  const from = Date.parse(request.from), to = Date.parse(request.to), expiry = Date.parse(request.expiresAt);
  if ((request.action !== undefined && request.action !== 'probe' && request.action !== 'restart' && request.action !== 'ignore_groups')
      || ((request.action === 'restart' || request.action === 'ignore_groups') && !/^[0-9a-f-]{36}$/i.test(request.requestId || ''))
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.tenantId || '')
      || !Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(expiry)
      || to <= from || to - from > 86400000 || expiry <= now || expiry > now + 3600000) {
    throw new Error('Solicitação de diagnóstico inválida ou expirada');
  }
  return request;
}

export async function runEvolutionHistoryProbe(raw = process.env.EVOLUTION_HISTORY_PROBE): Promise<void> {
  if (!raw) return;
  try {
    const request = parseHistoryProbeRequest(raw)!;
    // Job administrativo explicitamente limitado a um tenant; nenhum segredo sai deste processo.
    const db = getPlatformDb();
    const { data: cred, error } = await db.from('tenant_evolution_credentials')
      .select('instance_name, api_url, api_key').eq('tenant_id', request.tenantId).maybeSingle();
    if (error || !cred) throw new Error('Credencial indisponível');
    const base = new URL(cred.api_url);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
      throw new Error('URL Evolution inválida');
    }
    if (request.action === 'ignore_groups') {
      const { error: claimError } = await db.from('processed_webhook_messages').insert({
        message_id: `ops:evolution-ignore-groups:${request.tenantId}:${request.requestId}`,
      });
      if (claimError && claimError.code !== '23505') throw new Error('Solicitação de ajuste não pôde ser reivindicada');
      if (!claimError) {
        const settingsUrl = `${base.href.replace(/\/$/, '')}/settings/find/${encodeURIComponent(cred.instance_name)}`;
        const options = { headers: { apikey: decryptSecret(cred.api_key), 'Content-Type': 'application/json' }, redirect: 'error' as const };
        const read = await fetch(settingsUrl, { ...options, signal: AbortSignal.timeout(15000) });
        if (!read.ok) throw new Error(`Evolution HTTP ${read.status} ao consultar ajustes`);
        const current = await read.json();
        if (!current || typeof current !== 'object' || Array.isArray(current) || typeof current.groupsIgnore !== 'boolean') {
          throw new Error('Resposta Evolution inválida nos ajustes');
        }
        if (!current.groupsIgnore) {
          // Strings opcionais podem vir null do banco; omitidas, o upsert preserva
          // esses valores. A API rejeita null no schema desses dois campos.
          const updateBody = { ...current, groupsIgnore: true };
          for (const key of ['msgCall', 'wavoipToken']) if (updateBody[key] == null) delete updateBody[key];
          const update = await fetch(`${base.href.replace(/\/$/, '')}/settings/set/${encodeURIComponent(cred.instance_name)}`, {
            ...options, method: 'POST', body: JSON.stringify(updateBody), signal: AbortSignal.timeout(15000),
          });
          if (!update.ok) throw new Error(`Evolution HTTP ${update.status} ao ajustar grupos`);
        }
        const verify = await fetch(settingsUrl, { ...options, signal: AbortSignal.timeout(15000) });
        if (!verify.ok || (await verify.json())?.groupsIgnore !== true) throw new Error('Resposta Evolution não confirmou ajuste de grupos');
        let linkedPhoneLast4: string | null = null;
        try {
          const identity = await fetch(`${base.href.replace(/\/$/, '')}/instance/fetchInstances?instanceName=${encodeURIComponent(cred.instance_name)}`, {
            ...options, signal: AbortSignal.timeout(3000),
          });
          if (identity.ok) {
            const rows = await identity.json();
            const instance = (Array.isArray(rows) ? rows : [rows]).map(row => row?.instance || row)
              .find(row => (row?.name || row?.instanceName) === cred.instance_name);
            const number = String(instance?.ownerJid || '').split('@')[0].replace(/\D/g, '');
            if (number.length >= 4) linkedPhoneLast4 = number.slice(-4);
          }
        } catch { /* Identidade é diagnóstico opcional; nunca expor payload/chave. */ }
        console.log('[Evolution History Probe]', JSON.stringify({ tenantId: request.tenantId, groupsIgnored: true, linkedPhoneLast4 }));
      }
    }
    if (request.action === 'restart') {
      // Reivindicação atômica, fail-closed: nunca repetir restart após deploy/crash.
      const { error: claimError } = await db.from('processed_webhook_messages').insert({
        message_id: `ops:evolution-restart:${request.tenantId}:${request.requestId}`,
      });
      if (claimError && claimError.code !== '23505') throw new Error('Solicitação de restart não pôde ser reivindicada');
      if (!claimError) {
        const restart = await fetch(`${base.href.replace(/\/$/, '')}/instance/restart/${encodeURIComponent(cred.instance_name)}`, {
          method: 'POST', headers: { apikey: decryptSecret(cred.api_key) },
          signal: AbortSignal.timeout(20000), redirect: 'error',
        });
        if (!restart.ok) throw new Error(`Evolution HTTP ${restart.status} no restart`);
        console.log('[Evolution History Probe]', JSON.stringify({ tenantId: request.tenantId, restartRequested: true }));
      } else {
        console.log('[Evolution History Probe]', JSON.stringify({ tenantId: request.tenantId, restartAlreadyClaimed: true }));
      }
    }
    const response = await fetch(`${base.href.replace(/\/$/, '')}/chat/findMessages/${encodeURIComponent(cred.instance_name)}`, {
      method: 'POST', headers: { apikey: decryptSecret(cred.api_key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { messageTimestamp: { gte: request.from, lte: new Date(Date.parse(request.to) - 1).toISOString() } }, offset: 100, page: 1 }),
      signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`Evolution HTTP ${response.status}`);
    const result = await response.json();
    const records = result?.messages?.records;
    const total = result?.messages?.total;
    if (!Array.isArray(records) || !Number.isInteger(total) || total < 0) throw new Error('Resposta Evolution inválida');
    const ids = records.map((row: any) => row?.key?.id).filter((id: unknown): id is string => typeof id === 'string');
    let storedCount = 0;
    if (ids.length) {
      const { data: existing, error: queryError } = await db.from('messages').select('id')
        .eq('tenant_id', request.tenantId).in('id', ids);
      if (queryError) throw new Error('Consulta do histórico Universo falhou');
      storedCount = existing?.length || 0;
    }
    const timestamps = records.map((row: any) => Number(row.messageTimestamp) * 1000)
      .filter((value: number) => Number.isFinite(value) && value >= Date.parse(request.from) && value < Date.parse(request.to));
    console.log('[Evolution History Probe]', JSON.stringify({
      tenantId: request.tenantId, from: request.from, to: request.to, total,
      sampled: records.length, sampledAlreadyStored: storedCount,
      sampledMissing: ids.length - storedCount,
      earliestSample: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
      latestSample: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    }));
  } catch (error) {
    // Sem payloads/URLs/chaves nem mensagem arbitrária retornada pelo provedor.
    const reason = error instanceof Error && /^(Solicitação|Credencial|URL Evolution|Evolution HTTP|Resposta Evolution|Consulta do histórico)/.test(error.message)
      ? error.message : 'Falha de rede ou configuração';
    console.error('[Evolution History Probe]', JSON.stringify({ error: reason }));
  }
}
