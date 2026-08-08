-- Bloquear IA de conversa individual — pedido real do operador: um lead
-- claramente não qualificado (sem interesse real, mandando fotos/mensagens
-- aleatórias) fica "assediando" e a IA continua respondendo automaticamente.
-- Diferente de agent_status (pausa o agente pra TODOS os leads do tenant de
-- uma vez), isso pausa só esse número específico — o resto do atendimento
-- automático continua normal. Metadado só do painel, igual ao resto de
-- 0008_conversation_organization.sql (archived_at/pinned_at/muted).
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.conversations
  add column if not exists ai_blocked_at timestamptz;
