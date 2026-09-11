/**
 * TASK-0336 (Ficha IA — "Sugerir mensagem de retomada") + TASK-0332 (era
 * chamada assim antes de virar hint fixo): texto usado tanto pelo card de
 * aviso "mais de 24h sem responder" (WhatsAppLeadsSim.tsx,
 * handleDraftReengagementMessage) quanto pelo atalho de mesmo nome na Ficha
 * IA (ConversationAnalysisPanel.tsx, HINT_SUGGESTIONS) — extraído aqui pra
 * um lugar só depois de ficar duplicado nos dois arquivos, e porque
 * `handleGenerateReplyFromHint` (WhatsAppLeadsSim.tsx) precisa comparar o
 * hint recebido contra este valor exato pra saber quando pode pedir o
 * caminho mais leve (sem Base de Conhecimento, histórico bem menor) — ver
 * TASK-0385: essa mensagem é só um "oi, ainda está aí" genérico, revisado
 * manualmente antes de qualquer envio, sem necessidade real de preço/
 * catálogo/histórico longo pra ser gerada corretamente.
 */
export const REENGAGEMENT_HINT =
  'O cliente ficou mais de 24h sem responder. Escreva uma mensagem curta e natural de retomada de contato, reconhecendo com leveza o tempo que passou, sem soar robótico nem desesperado, e sem repetir informação que já foi dada nesta conversa.';
