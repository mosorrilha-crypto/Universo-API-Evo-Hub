/**
 * Normalização de texto pra comparação tolerante a acento/caixa/espaçamento —
 * usada onde o nome de um serviço vem de fala livre do cliente ou de texto
 * gerado pelo modelo (nunca exatamente igual ao cadastro no catálogo). TASK-0339.
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
