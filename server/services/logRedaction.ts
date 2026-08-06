/**
 * Evita vazar conteúdo sensível (comprovante de pagamento, dados pessoais do
 * cliente, texto completo de mensagens) nos logs do processo. Mantém debug
 * útil (tamanho + prévia curta) sem gravar o conteúdo inteiro em nenhum
 * lugar persistido em disco/agregador de log.
 */
const PREVIEW_LENGTH = 40;

export function redactMessageForLog(text: string | null | undefined): string {
  if (!text) return '(vazio)';
  const preview = text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
  return `"${preview}" (${text.length} caracteres)`;
}
