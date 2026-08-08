-- Etiquetas livres por conversa (tipo WhatsApp Business) — características/
-- sinais que se acumulam numa conversa (ex: "Interesada en pestañas", "Seña
-- pendiente"), diferente do estágio único do CRM (crmStage, ainda só
-- localStorage — fora de escopo deste card). Texto livre, sem tabela de
-- catálogo separada — suficiente pro volume atual, evita over-engineering.
--
-- NOTA: as PRs #54 e #57 (ainda abertas quando esta migration foi criada)
-- também mexem em `conversations`/conversationStore.ts/conversations.ts —
-- esta migration só cria uma tabela nova (conversation_labels), sem tocar em
-- `conversations`, então não colide no schema. Mas os arquivos de serviço
-- (conversationStore.ts) provavelmente vão precisar de merge manual entre as
-- três PRs.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

create table if not exists public.conversation_labels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);
create index if not exists conversation_labels_tenant_conv_idx
  on public.conversation_labels (tenant_id, conversation_id);

-- Row Level Security — mesmo padrão das outras tabelas do schema (ver
-- 0002_pre_reservations_and_payment_state.sql). A service key do backend
-- ainda bypassa RLS hoje; políticas ficam prontas e corretas mesmo assim
-- (defesa em profundidade, não bloqueante).
alter table public.conversation_labels enable row level security;
alter table public.conversation_labels force row level security;
drop policy if exists tenant_isolation on public.conversation_labels;
create policy tenant_isolation on public.conversation_labels
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
