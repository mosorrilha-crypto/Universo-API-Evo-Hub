-- Agente Vertical — horário de funcionamento por dia da semana, por tenant.
-- Achado numa auditoria comparativa contra o projeto standalone antigo da
-- Monique: o Universo nunca teve essa checagem — o agente só respeita o que
-- o Google Calendar mostra como ocupado, sem nenhum limite de horário de
-- atendimento. Nada impedia (em código) criar um agendamento às 22h ou num
-- domingo fechado, contanto que o horário aparecesse "livre" no Calendar.
--
-- Formato de `business_hours`: objeto jsonb chaveado por dia da semana
-- ("0" domingo .. "6" sábado, mesma convenção de Date.getUTCDay()), cada
-- valor { "open": "HH:mm", "close": "HH:mm" }. Um dia AUSENTE do objeto
-- significa que o tenant não atende nesse dia — nunca representar "fechado"
-- com um horário zerado. tenant sem `business_hours` configurado (null) não
-- tem restrição nenhuma (comportamento anterior preservado, não quebra
-- tenants que ainda não configuraram isso).
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.tenants
  add column if not exists business_hours jsonb;

-- Semeia o horário real da Monique (mesmo dado já descrito em texto na
-- knowledge_base dela, ver scripts/seed-monique-knowledge-base.ts) —
-- segunda a sexta 07:30–20:00, sábado 08:00–13:00, domingo 09:00–17:00.
update public.tenants
set business_hours = '{
  "1": {"open": "07:30", "close": "20:00"},
  "2": {"open": "07:30", "close": "20:00"},
  "3": {"open": "07:30", "close": "20:00"},
  "4": {"open": "07:30", "close": "20:00"},
  "5": {"open": "07:30", "close": "20:00"},
  "6": {"open": "08:00", "close": "13:00"},
  "0": {"open": "09:00", "close": "17:00"}
}'::jsonb
where id = '11111111-1111-1111-1111-111111111111' and business_hours is null;
