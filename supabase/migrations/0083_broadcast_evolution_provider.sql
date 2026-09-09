-- TASK-0367 (pedido direto — Monique usa Evolution API, não Meta Cloud API,
-- então o Disparo em Massa como estava não conseguia mandar nada pra ela: a
-- funcionalidade toda era só Meta Cloud API/template aprovado). `provider`
-- deixa um `broadcast_numbers` ser Evolution (texto livre, sem template) em
-- vez de Meta — `phone_number_id` continua a coluna única/obrigatória de
-- sempre, mas pra linhas Evolution ela guarda só um identificador único
-- (não usado pro envio de verdade: a rota real é sempre o número
-- operacional Evolution do próprio tenant, resolvido em tempo de envio via
-- `resolveCredentialsForConversation`/`tenant_evolution_credentials` — a
-- Evolution/Baileys não tem conceito de "pool de números dedicados" como a
-- Meta, só existe UM número conectado por instância).
alter table public.broadcast_numbers
  add column if not exists provider text not null default 'meta'
    check (provider in ('meta', 'evolution'));
