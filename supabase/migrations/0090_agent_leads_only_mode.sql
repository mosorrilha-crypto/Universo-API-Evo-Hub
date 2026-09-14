-- Pedido real do usuário (14/09/2026, TASK-0411/TASK-0412): tenants que
-- atendem pelo próprio número pessoal de WhatsApp (ex: Dr. Daniel Oliveira,
-- fisioterapeuta) recebem tanto mensagens de pacientes/leads quanto
-- assuntos totalmente pessoais (carona, organização de evento, papo com
-- conhecido) no mesmo número. Sem um filtro, a IA respondia automaticamente
-- qualquer mensagem, inclusive as pessoais — "nosso foco é atender leads e
-- não contatos pessoais dos tenants".
--
-- Generaliza o mecanismo pra um toggle oficial por tenant (mesmo padrão do
-- "somente anúncios", ads_only, migration 0029): quando ativado, o
-- especialista (server/services/autoReply.ts) passa a avaliar se cada
-- mensagem é comercial/profissional antes de responder — mensagens
-- claramente pessoais ficam sem resposta automática (outOfScope=true), sem
-- gerar escalonamento de falha. A primeira mensagem de uma conversa nova
-- (sem histórico) NUNCA é tratada como fora de escopo, mesmo com este modo
-- ativo — não há contexto suficiente ainda pra decidir, e um lead real de
-- verdade não pode ficar sem resposta só por mandar "Oi" primeiro.
--
-- Mesma tabela de status do agente (active/paused/restricted) + ads_only —
-- mais um flag ortogonal, não um novo valor do enum nem substituto de
-- ads_only (os dois podem estar ativos ao mesmo tempo).
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.agent_status
  add column if not exists leads_only boolean not null default false;
