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
- [ ] **Dois prompts ainda hardcoded pra "negócio de estética/micropigmentação", rodando pra
      qualquer tenant.** `server/services/autoReply.ts:1241` (classificação de consulta de
      agenda via Groq) e `:1686` (prompt da ferramenta de agendamento) — violam a decisão de
      14/08 acima. Não quebra a mecânica (duração ainda vem do catálogo certo), mas é
      inconsistência de conteúdo que pode confundir o modelo pra qualquer tenant que não seja de
      estética. **Fix pequeno e independente, oferecido e ainda não confirmado pelo dono do
      produto** (genericizar as duas strings, sem mudar lógica/schema/tools).
- [ ] **Critério de aceite do próprio doc de arquitetura** ("um segundo tenant de outro segmento
      consegue ser configurado só cadastrando dado — zero edição de código/prompt",
      `docs/AGENTE-VERTICAL-ARQUITETURA.md` seção 8) segue formalmente desmarcado — a evidência
      real (Dr. Daniel funcionando) mostra que está ~95% cumprido; o item acima é a exceção
      concreta que falta corrigir pra poder marcar como feito.

## 2. Onboarding self-service

- [~] **Criação de tenant é só por script**, não self-service: `npm run create:tenant`
      (`scripts/create-tenant.ts`), roda contra Supabase real com service role key — exige
      alguém tecnicamente habilitado, não é algo que um cliente novo faz sozinho.
- [ ] **Gate de publicação da KB não garante conteúdo completo, só existência estrutural.**
      `getRuntimeKnowledgeBase()` (`server/services/knowledgeBaseStore.ts`) só exige que os 8
      tipos tenham uma versão `published` — não checa se o conteúdo em si é útil. Achado real: o
      Dr. Daniel tem 3 dos 8 documentos publicados com dado **vazio** (`opening_hours: {}`,
      `human_handoff_rules: {}`, `faq.faqs: []`) — o agente roda "com KB completa" segundo o
      sistema, mas sem saber o horário de funcionamento nem ter nenhuma regra de handoff
      configurada. É exatamente o tipo de risco que vira reclamação de cliente novo.
      **Em correção pelo estudo de UX complementar** (Saúde da Base + findings acionáveis,
      reaproveitando `src/lib/knowledgeBaseAudit.ts`) — não é trabalho desta sessão.
- [ ] **Gap remanescente que a reformulação de UX sozinha não resolve:** `auditKnowledgeBase()`
      já detecta 2 dos 3 campos vazios acima (`operation-hours` quando `businessHours` está
      vazio, `context-faq-empty` quando `faqs.length === 0`), mas **não tem nenhum finding pra
      `human_handoff_rules` vazio** — mesmo depois da UX terminar, esse campo continuaria
      passando despercebido, porque a UX só pode mostrar o que o motor de auditoria calcula.
      Fix pequeno e independente, ainda não confirmado (adicionar 1 finding, mesmo padrão dos
      demais, + teste).

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
