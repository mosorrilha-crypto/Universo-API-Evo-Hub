/**
 * TASK-0431 — achado real (tenant Monique, contato "😍", telefone
 * 595985868809): a cliente mandou "¡Hola! Quiero más información" e, 12s
 * depois, "Precio por favor" — mais que a janela de 10s de silêncio do
 * buffer de texto (messageBuffer.ts), então cada mensagem abriu seu PRÓPRIO
 * buffer, independente. A proteção de absorção de mensagem tardia
 * (TASK-0418, takePendingBufferTexts) só funciona se a mensagem nova ainda
 * estiver ESPERANDO no buffer no momento em que a resposta anterior termina
 * de ser GERADA — mas gerar uma resposta (roteador + especialista + revisor)
 * leva bem mais que 10s na prática (~30-40s observado). O buffer da 2ª
 * mensagem já tinha disparado sozinho (seus próprios 10s já tinham vencido)
 * bem antes da 1ª geração terminar — quando a 1ª checou
 * `takePendingBufferTexts`, não achou mais nada lá (já tinha sido retirado
 * pelo próprio flush da 2ª, que ficou na fila de `runExclusive` aguardando a
 * vez). Resultado: 2 ciclos completos e independentes, cada um respondendo
 * corretamente à SUA mensagem, mas sem saber da existência do outro —
 * repetindo informação (preço, nesse caso) em sequência.
 *
 * Este módulo faz o buffer (texto ou áudio, ver messageBuffer.ts/
 * audioMessageBuffer.ts) ADIAR seu próprio flush enquanto uma resposta pro
 * MESMO tenant/telefone já está sendo gerada — em vez de disparar
 * imediatamente e entrar na fila do runExclusive por conta própria. Isso
 * garante que a mensagem tardia AINDA esteja no buffer, esperando, no
 * momento em que a geração em andamento chegar em
 * `takePendingBufferTexts`/`takePendingAudioBufferTexts` — a mesma proteção
 * de absorção já existente passa a funcionar de verdade, independente de
 * quanto tempo a geração levar. Compartilhado entre texto e áudio (mesma
 * chave `tenantId:phone`) — também amortece o caso de uma mensagem de texto
 * chegar enquanto um áudio está sendo respondido, ou vice-versa, embora
 * unificar os dois caminhos de verdade continue fora do escopo aqui.
 */
const generatingKeys = new Set<string>();

function key(tenantId: string, phone: string): string {
  return `${tenantId}:${phone}`;
}

/** Chamado bem no início da geração de uma resposta (antes de qualquer chamada ao Gemini) — sempre em par com unmarkGenerating num finally, nunca sozinho. */
export function markGenerating(tenantId: string, phone: string): void {
  generatingKeys.add(key(tenantId, phone));
}

/** Chamado num `finally` ao redor de toda a geração+envio, cobrindo sucesso, escalonamento e erro — nunca deixa a marca presa. */
export function unmarkGenerating(tenantId: string, phone: string): void {
  generatingKeys.delete(key(tenantId, phone));
}

export function isGenerating(tenantId: string, phone: string): boolean {
  return generatingKeys.has(key(tenantId, phone));
}
