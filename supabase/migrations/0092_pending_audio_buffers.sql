-- TASK-0430 — achado real de audit (tenant Monique, cliente "Carmen
-- Bareiro"): diferente do texto (server/services/messageBuffer.ts, agrupa
-- mensagens picotadas com ~10s de silêncio antes de responder), o áudio não
-- tinha NENHUM agrupamento — cada nota de voz, assim que terminava de
-- transcrever (fila global única de transcrição, server/services/
-- transcriptionQueue.ts), disparava sozinha um ciclo completo e independente
-- de resposta automática. Uma cliente que mandou 7 áudios em ~3 minutos e
-- meio gerou efetivamente 5-6 respostas separadas, sem nenhuma saber que a
-- cliente já tinha seguido em frente enquanto esperava na fila — terminando
-- em 3 despedidas quase idênticas em sequência (o revisor de repetição é
-- baseado em sobreposição literal de palavras e não pegou, já que cada
-- despedida saiu reformulada, seguindo a própria instrução do agente de
-- variar a redação).
--
-- Esta tabela espelha pending_message_buffers (0033/0070), mas é
-- INDEPENDENTE dela — buffer próprio pro caminho de áudio (server/services/
-- audioMessageBuffer.ts), nunca mistura com o buffer de texto. Mesmo motivo
-- de existir da original: o timer em memória é o caminho rápido pro caso
-- comum: isto só existe pra um sweeper periódico recuperar qualquer marca
-- cujo horário de disparo já passou e ninguém tratou nesta instância (ex:
-- restart de deploy no meio da janela de silêncio).

create table if not exists public.pending_audio_buffers (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text not null,
  texts jsonb not null,
  contact_name text,
  last_message_id text not null,
  first_message_id text not null,
  resolved_tenant jsonb not null,
  flush_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, phone)
);

create index if not exists pending_audio_buffers_flush_at_idx
  on public.pending_audio_buffers (flush_at);

alter table public.pending_audio_buffers enable row level security;
alter table public.pending_audio_buffers force row level security;
drop policy if exists tenant_isolation on public.pending_audio_buffers;
create policy tenant_isolation on public.pending_audio_buffers
  using (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid)
  with check (tenant_id = (select current_setting('app.current_tenant_id', true))::uuid);
