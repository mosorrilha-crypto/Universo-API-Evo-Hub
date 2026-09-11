-- TASK-0389 — fecha o ciclo atendimento → agendamento → pagamento.
--
-- Achado real (pedido direto, com print): "Marcar como comprovante" no chat
-- só oferecia vincular a transação a um agendamento quando ele estava
-- AINDA aguardando aprovação (payment_status 'awaiting_payment' ou
-- 'pending_verification' — o ciclo curto da IA: pré-reserva → comprovante →
-- aprovação). Um agendamento já REALIZADO (serviço concluído, comprovante
-- chega depois, ou o atendimento nem passou pela IA) nunca deixava rastro
-- nenhum pra vincular depois — confirmado consultando produção: contato
-- real com comprovante marcado tinha zero linhas em `appointments` e zero
-- eventos em `appointment_journey_events`.
--
-- Estas 3 colunas guardam um SNAPSHOT do agendamento vinculado (não uma FK)
-- de propósito: `appointments` guarda só 1 linha "atual" por telefone
-- (upsert), então uma referência só por id se perderia assim que o
-- contato tivesse um agendamento novo. O snapshot preserva o que era
-- verdade no momento em que o operador vinculou, pra sempre.
--
-- Deliberadamente SEPARADO de `source_ref` (que já tem índice único por
-- tenant, migration 0037, usado pra deduplicar "apt:<eventId>" criado
-- automaticamente pelo verify-payment) — um comprovante vinculado
-- manualmente aqui não deve nunca colidir com essa deduplicação nem
-- competir pelo mesmo valor de source_ref.
alter table public.financial_transactions
  add column if not exists linked_appointment_event_id text,
  add column if not exists linked_appointment_summary text,
  add column if not exists linked_appointment_start_iso text;
