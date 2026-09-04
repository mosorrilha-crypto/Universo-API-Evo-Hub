/**
 * Nem todo "nome" que chega no perfil do WhatsApp é um nome de pessoa de
 * verdade — pode ser um status ("Ocupado", "Disponible", "No molestar"), o
 * nome do próprio negócio da cliente, ou só emoji/símbolos. Achado real
 * (04/09/2026, pedido direto do dono do produto): usar esse valor sem
 * checagem nenhuma pra chamar a cliente na saudação ("Hola, {nome}...") é
 * arriscado — o agente pode acabar chamando a cliente de "Ocupado" como se
 * fosse o nome dela.
 *
 * Filtro deliberadamente conservador: só rejeita quando o valor claramente
 * NÃO parece nome de pessoa (sem nenhuma letra, ou bate em status/frase de
 * negócio conhecida). Nomes de verdade — inclusive compostos, com acento,
 * ou em caixa alta como vêm de muitos perfis ("ANA BALBUENA") — passam
 * normalmente; a normalização de maiúsculas/like "só o primeiro nome" já é
 * feita pelo próprio modelo ao escrever a saudação, não aqui.
 */
export function isPlausiblePersonalName(name: string | undefined | null): boolean {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  // Nome de pessoa real raramente passa disso — acima disso é mais provável
  // ser uma frase/status/bio do que um nome.
  if (trimmed.length > 40) return false;
  if (!/[a-zA-ZÀ-ÿ]/.test(trimmed)) return false; // só emoji/números/símbolos
  const normalized = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const statusOrBusinessPattern = /(ocupad|disponible|ausente|no molest|not available|\bbusy\b|\baway\b|whatsapp business|atendimento ao cliente|suporte tecnico|contato comercial|\bdelivery\b|revendedora|consultora|\bstudio\b|estudio|salao|boutique)/;
  if (statusOrBusinessPattern.test(normalized)) return false;
  return true;
}
