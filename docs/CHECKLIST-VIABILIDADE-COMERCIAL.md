# Checklist de viabilidade comercial — Universo além da Monique

> **Por que este documento existe.** O Universo deixou de ser "o sistema da Monique" — já existe
> um segundo tenant real e ativo (Dr. Daniel, fisioterapeuta) e um terceiro em prospecção (um
> salão de beleza, condicionado a "gerar valor"). Este checklist acompanha, ao longo do tempo, se
> o produto está de fato pronto pra vender pra negócios diferentes — não é tudo pra resolver de
> uma vez. Cada item tem `[x]` (confirmado com evidência real), `[~]` (parcial) ou `[ ]` (aberto).
> Sempre que um item mudar de estado, atualize aqui na mesma PR que resolveu — mesma disciplina
> do `docs/GUIA-DO-PROJETO.md`.
>
> **Origem:** TASK-0405, pedido direto do dono do produto depois da comparação
> Universo × DeskcommCRM (ver `docs/GUIA-DO-PROJETO.md` pra esse estudo). Existe também um estudo
> de UX complementar (reformulação da Base de Conhecimento + Qualidade do Agente), conduzido em
> outra sessão/ambiente — este documento referencia esse estudo onde for relevante, sem duplicá-lo.

## 1. Generalização multi-vertical

Testado com evidência real: o tenant `ddae56c3-961f-4765-bca0-b43cf5647ae6` (Dr. Daniel
Oliveira, fisioterapeuta, Bonito/MS) — vertical completamente diferente da Monique (estética) —
já está ativo e configurado 100% via painel, sem nenhuma edição de código.

- [x] **Schema de 8 documentos tipados da Base de Conhecimento generaliza pro conteúdo.**
      `brand_voice` e `business_profile` do Dr. Daniel têm persona própria ("Liz Flores") e
      triagem de sinais de urgência clínica específicos de fisioterapia (dor no peito, perda de
      força, trauma → orientar busca presencial; nunca diagnosticar/prescrever) — tudo texto
      livre no painel.
- [x] **Decisão arquitetural de zero-hardcode por segmento está documentada e majoritariamente
      cumprida.** `docs/AGENTE-VERTICAL-ARQUITETURA.md` (14/08/2026): nenhuma regra de negócio
      deve viver em código, só Camada 1 (Prompt Global, saas_admin) ou Camada 3 (KB do tenant).
- [x] **Os 2 prompts hardcoded pra "negócio de estética/micropigmentação" foram genericizados.**
      `server/services/autoReply.ts:1241` (classificação de consulta de agenda via Groq) e `:1686`
      (prompt da ferramenta de agendamento) violavam a decisão de 14/08 acima, rodando pra
      qualquer tenant. **Corrigido em TASK-0406 (PR #776, mesclada 12/09/2026)** — mudança
      puramente textual, sem alteração de lógica/schema/tools.
- [x] **Critério de aceite do próprio doc de arquitetura** ("um segundo tenant de outro segmento
      consegue ser configurado só cadastrando dado — zero edição de código/prompt",
      `docs/AGENTE-VERTICAL-ARQUITETURA.md` seção 8) — a única exceção concreta conhecida (item
      acima) foi corrigida; não há mais nenhum hardcode de vertical identificado no código.
      Falta apenas marcar formalmente o checkbox na seção 8 daquele documento (não feito aqui —
      esse arquivo tem seu próprio processo de atualização, fora do escopo deste checklist).

## 2. Onboarding self-service

- [~] **Criação de tenant é só por script**, não self-service: `npm run create:tenant`
      (`scripts/create-tenant.ts`), roda contra Supabase real com service role key — exige
      alguém tecnicamente habilitado, não é algo que um cliente novo faz sozinho.
- [ ] **Gate de publicação da KB não garante conteúdo completo, só existência estrutural.**
      `getRuntimeKnowledgeBase()` (`server/services/knowledgeBaseStore.ts`) só exige que os 8
      tipos tenham uma versão `published` — não checa se o conteúdo em si é útil. Achado real: o
      Dr. Daniel tem 3 dos 8 documentos publicados com dado **vazio** (`opening_hours: {}`,
      `human_handoff_rules: {}`, `faq.faqs: []`) — o agente roda "com KB completa" segundo o
      sistema, mas sem saber o horário de funcionamento nem ter perguntas frequentes cadastradas
      (`human_handoff_rules` é um caso à parte — ver item abaixo). É exatamente o tipo de risco
      que vira reclamação de cliente novo pros dois campos que o tenant de fato pode preencher.
      **Em correção pelo estudo de UX complementar** (Saúde da Base + findings acionáveis,
      reaproveitando `src/lib/knowledgeBaseAudit.ts`) — não é trabalho desta sessão.
- [ ] **`human_handoff_rules` vazio não é um gap de auditoria — é decisão de produto em aberto.**
      Correção de um achado anterior deste documento: a caracterização original ("falta um
      finding de completude, mesmo padrão dos demais, ~3 linhas") estava errada. Investigado em
      TASK-0406 antes de implementar: `human_handoff_rules` **não tem nenhum campo editável no
      frontend** (não está em `VISUAL_KNOWLEDGE_BASE_DOCUMENT_TYPES`,
      `src/lib/knowledgeBaseVisualDocuments.ts:9-16`) nem validação de conteúdo no backend
      (`server/services/knowledgeBaseStore.ts:572-574` trata esse tipo com um `case` vazio) —
      é sempre `data: {}`, **para todos os tenants**, não uma lacuna específica do Dr. Daniel.
      `src/components/KnowledgeBaseDocumentation.tsx:108-111` já documenta isso como reservado
      pra versão futura. Um finding de "vazio" nesse campo dispararia sempre, pra 100% dos
      tenants, sem nada que o operador possa preencher pra resolver — ruído, não sinal. Item
      real em aberto: decidir **se e quando** vale a pena desenhar campos estruturados de
      encaminhamento humano (o que também tornaria o card "Encaminhamento humano" da navegação
      da KB, hoje sem destino real, finalmente apontar pra algo) — não uma correção de bug.

## 3. Custo e escala por tenant

- [ ] **Sem número real de custo por tenant/mês.** O estudo Universo × DeskcommCRM (ver
      `docs/GUIA-DO-PROJETO.md`) avaliou eficiência de tokens/arquitetura, não custo em
      moeda — falta levantar Gemini + Groq + Cloudflare R2 + Supabase + Render por tenant ativo.
- [ ] **Infra hoje é 1 instância Node (`0.5c-512mb` no Render) + SSE em memória
      (`server/services/conversationEvents.ts`), sem replicação.** Não é um problema com 2-3
      tenants de baixo volume, mas não há dado sobre em que ponto (nº de tenants/mensagens
      simultâneas) isso deixa de escalar — nenhum teste de carga realizado até hoje.
- [ ] **Caminho Groq não se beneficia do cache do Gemini** (achado do estudo anterior,
      `docs/GUIA-DO-PROJETO.md`) — só vira problema real de custo quando o Groq estiver ativo em
      produção pra tenants de catálogo grande; hoje é fallback/economia, não o caminho principal.

## 4. Prontidão de produto (feature gaps)

- [x] **RAG real, checkpoint formal de conversa e skills sob demanda (disclosure progressivo)
      foram avaliados e conscientemente adiados** — confirmado pelo dono do produto: nenhum é
      urgente na escala atual (poucos tenants, catálogos pequenos). Ver estudo Universo ×
      DeskcommCRM em `docs/GUIA-DO-PROJETO.md` pra detalhe de cada um.
- [ ] **Reformulação de UX da Base de Conhecimento + Qualidade do Agente** — em andamento em
      outra sessão/ambiente (briefing próprio, não reproduzido aqui). Resolve a maior parte do
      item 2 acima (visibilidade de KB incompleta) quando terminar.
- [ ] **Sem inventário formal de "o que um cliente pagante novo esperaria e ainda não existe"**
      (billing próprio, relatórios por tenant, granularidade de permissões além de
      admin/saas_admin/operator) — não investigado nesta rodada; item aberto pra uma futura
      passada dedicada, se/quando um cliente novo de fato entrar.
