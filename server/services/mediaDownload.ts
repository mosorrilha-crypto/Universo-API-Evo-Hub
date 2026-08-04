/**
 * Download de mídia real a partir dos IDs/referências que vêm no webhook.
 * Depende de credenciais que ainda não temos configuradas em nenhum ambiente
 * (não há WhatsApp Business/Evolution reais conectados nesta revisão) — o
 * código segue a documentação oficial de cada provedor, mas só foi validado
 * localmente com payloads sintéticos, não ponta-a-ponta com mídia real.
 */

export interface DownloadedAudio {
  base64: string;
  mimeType: string;
}

/**
 * Meta Cloud API: primeiro resolve a URL temporária e assinada da mídia
 * (GET /{media-id}), depois baixa o binário dessa URL com o mesmo token.
 * Referência: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 */
export async function downloadMetaMedia(mediaId: string, accessToken: string | undefined): Promise<DownloadedAudio> {
  if (!accessToken) {
    throw new Error('META_ACCESS_TOKEN não configurado — não é possível baixar mídia da Meta Cloud API.');
  }

  const metaRes = await fetch(`https://graph.facebook.com/v23.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaRes.ok) {
    throw new Error(`Falha ao resolver URL da mídia Meta (media_id=${mediaId}): HTTP ${metaRes.status}`);
  }
  const metaInfo = await metaRes.json() as { url?: string; mime_type?: string };
  if (!metaInfo.url) {
    throw new Error(`Resposta da Meta não trouxe URL de download para media_id=${mediaId}.`);
  }

  const mediaRes = await fetch(metaInfo.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!mediaRes.ok) {
    throw new Error(`Falha ao baixar bytes da mídia Meta (media_id=${mediaId}): HTTP ${mediaRes.status}`);
  }

  const buffer = Buffer.from(await mediaRes.arrayBuffer());
  return { base64: buffer.toString('base64'), mimeType: metaInfo.mime_type || 'audio/ogg' };
}

/**
 * Evolution API: o áudio do WhatsApp é criptografado ponta-a-ponta, então a
 * própria instância Evolution precisa descriptografar e devolver o base64 —
 * não dá pra baixar direto da `url`/`mediaKey` que vêm no webhook. Convenção
 * mais comum (Evolution API v2): POST /chat/getBase64FromMediaMessage/{instance}.
 */
export async function downloadEvolutionMedia(
  messageKey: unknown,
  instanceName: string | undefined,
  apiUrl: string | undefined,
  apiKey: string | undefined
): Promise<DownloadedAudio> {
  if (!apiUrl || !apiKey || !instanceName) {
    throw new Error('EVOLUTION_API_URL, EVOLUTION_API_KEY ou EVOLUTION_INSTANCE_NAME ausentes — não é possível baixar mídia da Evolution API.');
  }

  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/chat/getBase64FromMediaMessage/${instanceName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
    },
    body: JSON.stringify({ message: { key: messageKey }, convertToMp4: false }),
  });

  if (!res.ok) {
    throw new Error(`Falha ao baixar mídia da Evolution API: HTTP ${res.status}`);
  }

  const data = await res.json() as { base64?: string; mimetype?: string };
  if (!data.base64) {
    throw new Error('Resposta da Evolution API não trouxe base64 da mídia.');
  }

  return { base64: data.base64, mimeType: data.mimetype || 'audio/ogg' };
}
