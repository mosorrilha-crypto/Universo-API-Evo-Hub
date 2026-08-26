/**
 * Chave canônica de telefone para conversas.
 *
 * A Evolution/Baileys pode receber o mesmo celular brasileiro em dois
 * formatos: com o nono dígito móvel (55 + DDD + 9 + 8 dígitos) ou no formato
 * legado sem ele (55 + DDD + 8 dígitos). Sem unificação, cada formato cria
 * uma conversa diferente, apesar de identificar a mesma linha móvel.
 *
 * A conversão é deliberadamente restrita: só adiciona o nono dígito a números
 * brasileiros com 12 dígitos cujo assinante de oito dígitos começa entre 6 e
 * 9. Linhas fixas (começam entre 2 e 5) e qualquer outro país permanecem
 * inalterados.
 */
export function normalizeConversationPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const isBrazilianLegacyMobile = digits.startsWith('55')
    && digits.length === 12
    && /^[6-9]$/.test(digits.charAt(4));

  return isBrazilianLegacyMobile
    ? `${digits.slice(0, 4)}9${digits.slice(4)}`
    : digits;
}
