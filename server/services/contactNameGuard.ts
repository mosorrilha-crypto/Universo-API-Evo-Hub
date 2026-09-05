/**
 * Nem todo "nome" que chega no perfil do WhatsApp é um nome de pessoa de
 * verdade — pode ser um status ("Ocupado", "Disponible", "No molestar"), o
 * nome do próprio negócio da cliente, ou só emoji/símbolos.
 *
 * Histórico: TASK-0278 (04/09/2026) tentou filtrar isso com uma lista de
 * status/negócios conhecidos ("Ocupado" virando nome era o achado real que
 * motivou). TASK-0305 (05/09/2026) achou um caso que a lista não cobria
 * ("Pao Fretes" — presumido, sem verificar, como nome de empresa de frete) e
 * desligou a função por completo (sempre `false`). Só depois ficou claro,
 * pela própria cliente confirmando "Paola Fretes me llamo" numa conversa
 * real, que "Pao Fretes" ERA o nome dela de verdade ("Pao" é apelido comum
 * de "Paola", "Fretes" é sobrenome paraguaio real) — a suposição de
 * "empresa" nunca foi verificada e estava errada. Desligar tudo evitava o
 * erro, mas também jogava fora nomes reais como este toda vez.
 *
 * TASK-0310 troca a estratégia: em vez de uma lista de exclusão (nunca
 * cobre todo caso real) ou desligar tudo (perde nome real com frequência),
 * usa uma heurística ESTRUTURAL — como o valor está formatado — como
 * filtro principal, com uma lista de exclusão residual só pra casos
 * ambíguos de uma palavra só que a forma sozinha não resolve (ex:
 * "Ocupado" tem a MESMA forma de um nome próprio comum). Isso aceita "Pao
 * Fretes" (duas palavras capitalizadas, sem pontuação de frase) e continua
 * rejeitando frases/descrições ("Estudio de Belleza Karen", "No molestar"
 * — têm conectivo/palavra em minúscula no meio) e "Ocupado" (via lista).
 *
 * Isso continua sendo uma heurística, não uma garantia — vai ter falso
 * positivo/negativo ocasional. O objetivo é reduzir os dois tipos de erro
 * (nome errado usado / nome certo descartado), não eliminá-los.
 */
const SENTENCE_PUNCTUATION = /[,.!?¡¿:;()[\]{}"@#]/;
const NAME_TOKEN = /^[A-Za-zÀ-ÿ'’-]+$/;
const STATUS_OR_BUSINESS_PATTERN = /(ocupad|disponible|ausente|no molest|not available|\bbusy\b|\baway\b|whatsapp business|atendimento ao cliente|suporte tecnico|contato comercial|\bdelivery\b|revendedora|consultora|\bstudio\b|estudio|salao|boutique)/;

export function isPlausiblePersonalName(name: string | undefined | null): boolean {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  // Nome de pessoa real raramente passa disso — acima disso é mais provável
  // ser uma frase/status/bio do que um nome.
  if (trimmed.length > 40) return false;
  if (!/[a-zA-ZÀ-ÿ]/.test(trimmed)) return false; // só emoji/números/símbolos

  // Pontuação de frase (vírgula, ponto, interrogação...) não aparece em
  // nome de pessoa real — já corta frases/descrições sozinho.
  if (SENTENCE_PUNCTUATION.test(trimmed)) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false; // nome raramente passa de 4 tokens
  if (!words.every((word) => NAME_TOKEN.test(word))) return false; // sem dígito, só letra/acento/hífen/apóstrofo

  // Núcleo do filtro: ou a frase inteira está em CAIXA ALTA (comum em
  // vários perfis reais, ex: "ANA BALBUENA"), ou toda palavra começa com
  // maiúscula (ex: "Pao Fretes", "María José"). Uma frase com conectivo em
  // minúsculo no meio ("Estudio de Belleza Karen", "No molestar") cai fora
  // das duas — sem precisar da lista de exclusão pra esses casos.
  const allCaps = trimmed === trimmed.toUpperCase();
  const eachWordCapitalized = words.every((word) => /^[A-ZÀ-Þ]/.test(word));
  if (!allCaps && !eachWordCapitalized) return false;

  // Lista de exclusão residual — só pra casos de uma ou poucas palavras que
  // têm a MESMA forma de um nome próprio comum (ex: "Ocupado", "WhatsApp
  // Business"), onde a estrutura sozinha não diferencia.
  const normalized = trimmed
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (STATUS_OR_BUSINESS_PATTERN.test(normalized)) return false;

  return true;
}
