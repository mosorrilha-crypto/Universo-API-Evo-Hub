-- Achado real em produção (20/08/2026): o lembrete automático de agendamento
-- (server/services/reminderJob.ts) tinha o texto fixo em português, mesmo
-- pra leads paraguaias que conversam em espanhol o tempo todo com a IA —
-- "Bom dia! Só confirmando: seu horário é hoje..." chegando pra uma cliente
-- que nunca escreveu uma palavra em português. Como reminderJob.ts é
-- determinístico (não passa pelo Gemini, só monta a string direto), não tem
-- como "detectar" o idioma da conversa ali — precisa de uma configuração
-- explícita por tenant.
--
-- Default 'es': o único tenant real em produção hoje (Monique, Paraguai) é
-- de língua espanhola — todo o resto do sistema (prompt do agente,
-- mensagens geradas pelo modelo) já fala espanhol com essa tenant.
-- Português continua disponível pra um tenant futuro que precise (setar
-- 'pt' explicitamente).
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.tenants
  add column if not exists reminder_language text not null default 'es';
