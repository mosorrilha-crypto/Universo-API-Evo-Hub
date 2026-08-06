-- Agente Vertical, Etapa 3 — mecanismo de camadas do prompt (global / segmento
-- / tenant / dinâmico). Ver docs/AGENTE-VERTICAL-ARQUITETURA.md, seções 1 e 7.
--
-- `segment` identifica qual conjunto de regras fixas do segmento (camada 2)
-- se aplica a este tenant — hoje só existe `beauty_studio` (a Monique), mas o
-- campo já nasce pronto pra um segundo segmento sem precisar de outra
-- migration. Conteúdo real da camada 2 é a Etapa 4, ainda pendente.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto (Project > SQL Editor > New query) e rode uma vez. Idempotente,
-- seguro rodar de novo.

-- ADD COLUMN ... DEFAULT preenche linhas existentes (inclusive a Monique,
-- semeada em 0001) com o default — nenhum UPDATE manual é necessário.
alter table public.tenants
  add column if not exists segment text not null default 'beauty_studio';
