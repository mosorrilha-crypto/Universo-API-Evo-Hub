import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Criptografia em repouso pra credenciais de terceiros (item 2 de uma
 * auditoria de segurança, 02/09/2026, comparando a arquitetura do Universo
 * com um projeto open source do mesmo domínio — MIT license). Achado real:
 * refresh token do Google Calendar, chave da Evolution API e tokens do Meta
 * ficam em colunas `text` comuns, protegidas só pelo RLS — se uma policy
 * tiver um bug (já aconteceu num projeto comparável: uma policy com
 * `... or true` vazando a organização inteira) ou o banco vazar por
 * qualquer outro caminho, o segredo sai em texto puro, pronto pra uso.
 *
 * AES-256-GCM, mesmo padrão já validado (autenticado, não só confidencial —
 * GCM detecta adulteração do ciphertext). Formato de armazenamento
 * autodescritivo, cabe nas colunas `text` já existentes sem migration de
 * schema: `v1:<iv base64>:<tag base64>:<ciphertext base64>`.
 *
 * Rollout sem quebra: `TOKEN_ENCRYPTION_KEY` é OPCIONAL de propósito.
 * Quando ausente, `encryptSecret` devolve o valor original sem cifrar (log
 * de aviso uma vez) — nenhum ambiente sem a chave configurada (dev, teste,
 * ou um deploy antes da chave ser gerada) quebra ao gravar. `decryptSecret`
 * reconhece o prefixo "v1:" pra decidir se decifra ou devolve o valor como
 * está (texto puro legado, já gravado antes desta mudança, ou gravado num
 * ambiente sem a chave) — nenhum backfill é obrigatório pro código
 * continuar funcionando; um valor plaintext antigo simplesmente nunca é
 * "promovido" a cifrado até ser reescrito de novo (reconexão, rotação).
 */

const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const VERSION_PREFIX = 'v1';

let cachedKey: Buffer | null | undefined;
let warnedMissingKey = false;

function loadKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    cachedKey = null;
    return null;
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    throw new Error('TOKEN_ENCRYPTION_KEY inválida: base64 malformado.');
  }
  if (buf.length !== KEY_LENGTH_BYTES) {
    throw new Error(`TOKEN_ENCRYPTION_KEY deve ter exatamente 32 bytes (lido: ${buf.length}). Gere com: openssl rand -base64 32`);
  }
  cachedKey = buf;
  return buf;
}

/** Exportado exclusivamente para testes, pra simular chave ausente/presente entre casos. */
export function resetTokenCryptoKeyCacheForTests(): void {
  cachedKey = undefined;
  warnedMissingKey = false;
}

/**
 * Cifra `plaintext`. Sem `TOKEN_ENCRYPTION_KEY` configurada, devolve o valor
 * original sem cifrar (nunca lança) — ver nota de rollout acima.
 */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  if (!key) {
    if (!warnedMissingKey) {
      console.warn('⚠️  [tokenCrypto] TOKEN_ENCRYPTION_KEY não configurada — credenciais de terceiros sendo gravadas SEM criptografia em repouso.');
      warnedMissingKey = true;
    }
    return plaintext;
  }
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION_PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Decifra um valor produzido por `encryptSecret`. Um valor sem o prefixo
 * "v1:" é tratado como texto puro legado e devolvido como está — nunca
 * lança por causa disso, é o caminho normal durante a transição.
 */
export function decryptSecret(value: string): string {
  if (!value.startsWith(`${VERSION_PREFIX}:`)) return value;
  const key = loadKey();
  if (!key) {
    throw new Error('Valor cifrado encontrado, mas TOKEN_ENCRYPTION_KEY não está configurada — não é possível decifrar.');
  }
  const parts = value.split(':');
  if (parts.length !== 4) {
    throw new Error('Valor cifrado com formato inválido (esperado "v1:iv:tag:ciphertext").');
  }
  const [, ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
