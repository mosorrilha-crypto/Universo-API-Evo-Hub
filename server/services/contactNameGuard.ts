/**
 * Nem todo "nome" que chega no perfil do WhatsApp é um nome de pessoa de
 * verdade — pode ser um status ("Ocupado", "Disponible", "No molestar"), o
 * nome do próprio negócio da cliente, ou só emoji/símbolos. TASK-0278
 * (04/09/2026) tentou filtrar isso com uma lista de status/negócios
 * conhecidos, mas uma lista de exclusão nunca cobre todo caso real — achado
 * real de produção (05/09/2026, TASK-0305): o perfil "Pao Fretes" (nome de
 * uma empresa de frete/entrega, não de uma pessoa) passou pelo filtro porque
 * "fretes" não estava na lista, e o agente chamou a cliente de "Pao" como se
 * fosse o primeiro nome dela.
 *
 * Decisão do dono do produto diante desse segundo caso real: em vez de
 * ficar caçando mais uma palavra pra lista (mesmo padrão frágil que já
 * falhou duas vezes), parar de usar esse campo como referência de nome de
 * verdade. Sempre retorna `false` — o nome de perfil do WhatsApp nunca mais
 * é usado pra chamar a cliente; o único nome que o agente usa é o que a
 * própria cliente disser durante a conversa (`nomeCapturado`, ver
 * autoReply.ts). O valor de perfil continua disponível pra fins
 * administrativos que não dependem de ser um nome real (título da conversa
 * no painel, rótulo de lead, logs de escalonamento) — só não passa mais por
 * este guard, que hoje só é chamado nos pontos que decidem se o valor entra
 * no prompt da IA como "Nome do cliente".
 */
export function isPlausiblePersonalName(_name: string | undefined | null): boolean {
  return false;
}
