-- TASK-0366 (pedido direto — campanha de reaquecimento de leads de
-- micropigmentação que demonstraram interesse mas não agendaram): 3º
-- segmento de lista de contatos, junto aos 2 já existentes (0071):
-- `interested_no_appointment` filtra `conversations.interest` por um
-- termo livre (ex.: "micro" pra qualquer serviço de micropigmentação) e
-- exclui quem já tem qualquer linha em `appointments` (mesmo reserva
-- provisória sem evento — já está em processo de agendar).
alter table public.broadcast_contact_lists
  drop constraint if exists broadcast_contact_lists_source_check;
alter table public.broadcast_contact_lists
  add constraint broadcast_contact_lists_source_check
    check (source in ('csv', 'segment_known_leads', 'segment_has_appointment', 'segment_interested_no_appointment'));
