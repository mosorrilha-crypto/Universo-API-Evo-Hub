-- Aba "Roadmap Técnico & Backlog" (painel SaaS Master) era uma lista de 4
-- cards fixos no código (SaaSAdminDashboard.tsx), com um badge "5 Módulos
-- Planejados" já errado (só 4 cards renderizados) — impossível de editar
-- pelo painel, e vários itens já desatualizados (ex: "Automação Zero-Touch
-- de Instâncias WhatsApp" já em boa parte implementado via "Conectar
-- WhatsApp via QR Code", Epic 4.6). Pedido real do usuário: um backlog de
-- verdade, editável pelo saas_admin — adiciona pendências não-urgentes
-- (texto + imagem opcional) conforme aparecem, executa depois em lote.
--
-- Não é por tenant — é o backlog técnico do produto (SaaS inteiro), mesmo
-- padrão singleton-de-domínio de global_prompt_layer, só que multi-linha.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

create table if not exists public.roadmap_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  priority text not null default 'media' check (priority in ('alta', 'media', 'baixa')),
  status text not null default 'pendente' check (status in ('pendente', 'concluido')),
  -- Imagem opcional (screenshot/mockup de referência) guardada como data URI
  -- direto na linha — mesmo padrão já usado em AgentProduct.exampleImageBase64
  -- (knowledgeBaseStore.ts), não um bucket separado: volume baixo, uso
  -- interno do saas_admin, não passa pelo caminho de mensagem do agente.
  image_base64 text,
  created_by uuid references public.operators(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roadmap_items_status_idx on public.roadmap_items (status, created_at desc);

-- Sem policy nenhuma, RLS habilitado é deny-all pra anon/authenticated — a
-- service key do backend continua funcionando normal (bypassa RLS, mesmo
-- padrão de global_prompt_layer/processed_webhook_messages).
alter table public.roadmap_items enable row level security;
alter table public.roadmap_items force row level security;
