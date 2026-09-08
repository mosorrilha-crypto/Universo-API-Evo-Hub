# Análise técnica para planejamento de migração para Cloudflare

> TASK-0334. Relatório de arquitetura gerado por análise estática do código real do
> repositório (não é um plano de execução, nem uma recomendação de ir ou não pra
> Cloudflare — é o levantamento factual pra alguém tomar essa decisão). Ver
> `docs/GUIA-DO-PROJETO.md` para o estado funcional do produto e `CLAUDE.md` para
> convenções/incidentes reais já vividos em produção.

## 1. Visão Geral

- **Tipo de aplicação**: SaaS multi-tenant B2B, monólito full-stack — API HTTP/webhook
  (Express) + painel administrativo SPA (React) servidos pelo mesmo processo Node.
  Não é um app mobile nem e-commerce.
- **Descrição**: plataforma que dá a cada tenant (um negócio real) um agente de IA
  (Gemini) que responde leads via WhatsApp, agenda compromissos reais no Google
  Calendar, e acompanha o funil de pagamento/CRM daquele lead — com um painel web para
  o operador do negócio acompanhar conversas, agenda, financeiro e catálogo.
  **Está em produção com um tenant pagante real** recebendo mensagens de clientes.

## 2. Stack Tecnológica

- **Linguagem**: TypeScript ~5.8.2 (`tsconfig.json`: `target: ES2022`, `module: ESNext`,
  `moduleResolution: bundler`, `noEmit: true` — o typecheck (`tsc --noEmit`) é o único
  lint do projeto, não há ESLint configurado).
- **Runtime**: Node.js (CI usa `node-version: 22`; nenhum `engines` declarado no
  `package.json`).
- **Framework de servidor**: Express **5.2.1** (não 4 — importante porque o próprio
  `CLAUDE.md`/comentários do código ainda falam de "Express 4 não captura rejeição de
  promise" como motivação histórica do `asyncHandler`, mas a dependência instalada hoje
  já é a v5).
- **Framework de UI**: React 19.0.1 + Tailwind CSS 4.1.14 (`@tailwindcss/vite`),
  ícones `lucide-react`, gráficos `recharts`, animação `motion` (Framer Motion).
- **Build tool**: Vite 8.2.2 para o frontend (`vite build`) + **esbuild** 0.28.2 para
  empacotar o servidor (`esbuild server.ts --bundle --platform=node --format=cjs
  --packages=external --outfile=dist/server.cjs`) — ou seja, o build final do backend é
  um único arquivo CommonJS que roda com `node dist/server.cjs`, com `packages=external`
  (dependências não são inlinadas, precisam de `node_modules` real no host de produção).
- **Servidor de dev**: em desenvolvimento o próprio `server.ts` sobe o Vite em
  `middlewareMode` dentro do processo Express (`createViteServer({ server: {
  middlewareMode: true }, appType: 'spa' })`) — API e SPA sempre same-origin, sem CORS.
- **Gerenciador de pacotes**: **ambíguo** — o repo tem `package-lock.json` (npm) *e*
  `pnpm-lock.yaml` (pnpm) commitados simultaneamente. `npm ci`/`npm run <script>` são o
  que o `CLAUDE.md` e o CI (`ci.yml`) usam de fato; o lockfile pnpm parece órfão/legado.
  Vale confirmar antes de configurar qualquer build no Cloudflare Pages/Workers, que
  detecta o gerenciador pelo lockfile presente.

## 3. Estrutura de Pastas

| Pasta | Lado | Propósito |
|---|---|---|
| `server.ts` (raiz) | servidor | entrypoint único: monta config, Supabase, Gemini, todos os routers, todos os background jobs, e o fallback estático/SPA |
| `server/routes/` | servidor | 17 routers Express, um por domínio (`auth`, `ai`, `webhooks`, `conversations`, `googleCalendar`, `admin`, `crm`, `financial`, `metaAds`, `metaCapi`, `broadcast`, `commercialOffer`, `entitlements`, `publicCatalog`, `pushSubscriptions`, `qualityAudit`, `roadmap`, `telemetry`) — camada HTTP fina |
| `server/services/` | servidor | ~100 arquivos — toda a lógica real (agente de IA, stores de dados por domínio, jobs de fundo, integrações externas) |
| `server/middleware/` | servidor | `auth.ts` (JWT), `asyncHandler.ts`, `rateLimit.ts` (`express-rate-limit`, em memória) |
| `server/config.ts` / `server/gemini.ts` / `server/supabaseClient.ts` | servidor | leitura/validação de env vars e criação dos clients Supabase/Gemini |
| `src/` | cliente | SPA React: `App.tsx` (estado top-level + toda a orquestração de fetch), `components/`, `hooks/`, `contexts/`, `lib/` (inclui `firebase.ts`), `i18n/`, `data/`, `utils/` |
| `public/` | cliente (estático) | PWA: `manifest.json`, `sw.js` (service worker próprio, não gerado por ferramenta), ícones, imagens de catálogo de exemplo |
| `scripts/` | servidor/CLI | scripts `tsx` rodados manualmente contra o Supabase real (`create-tenant.ts`, `create-operator.ts`, `migrate-legacy-data.ts`, `eval-agent.ts`, `start-task.ts`, criptografia de credenciais) |
| `supabase/migrations/` | servidor (dados) | 93 arquivos SQL idempotentes, sem runner — aplicados manualmente via Supabase MCP/SQL Editor |
| `docs/` | — | documentação extensa (arquitetura, auditorias, planos, registro de tasks) |
| `.github/workflows/` | CI | `ci.yml` (lint/test/build + dependency-review), `codeql.yml` |

**Rotas/endpoints existentes** (prefixo comum `/api/...`, todas montadas em `server.ts`):
autenticação (`auth.ts`, cookie de sessão JWT `universo_session`), IA (`ai.ts`:
transcrição, análise de conversa, relatórios), telemetria, webhooks do WhatsApp (Meta
Cloud API e Evolution API), Meta Conversions API, Meta Ads (gestão + insights),
conversas (CRUD + SSE `/api/conversations/stream`), Google Calendar (OAuth + agenda),
administração (saas_admin: tenants, operadores), roadmap interno, disparo em massa
(broadcast), CRM, financeiro/agenda, catálogo público (sem auth, por slug de tenant),
oferta comercial, entitlements (planos/features), push subscriptions (Web Push),
auditoria de qualidade.

## 4. Banco de Dados

- **Motor**: PostgreSQL.
- **Hospedagem**: **Supabase** (gerenciado) — `SUPABASE_URL`/`SUPABASE_KEY` apontam pro
  projeto Supabase; não há Postgres local nem outro provedor.
- **Tabelas** (73 tabelas reais em `public.*`, via `create table` nas migrations —
  lista completa, agrupada por domínio):
  - **Tenancy/plataforma**: `tenants`, `operators`, `plans`, `plan_feature_rules`,
    `features`, `tenant_feature_overrides`, `tenant_feature_usage`,
    `tenant_entitlement_audit`, `tenant_billing_records`, `tenant_subscriptions`,
    `business_models`.
  - **Credenciais por tenant** (criptografadas): `tenant_calendar_tokens`,
    `tenant_meta_credentials`, `tenant_evolution_credentials`,
    `tenant_instagram_credentials`.
  - **Conversas/agente**: `conversations`, `messages`, `agent_status`,
    `agent_turn_traces`, `agent_eval_runs`, `agent_eval_run_cases`,
    `contact_agent_memory`, `memory_pattern_reviews`, `conversation_analyses`,
    `conversation_labels`, `pending_message_buffers`, `pending_outbound_echoes`,
    `processed_webhook_messages` (idempotência), `quick_replies`,
    `tenant_approved_reply_examples`, `controlled_quality_experiments`.
  - **Base de conhecimento**: `knowledge_base` (legado — descontinuado na TASK-0327),
    `knowledge_base_documents`, `knowledge_base_document_events`.
  - **Agenda/agendamento**: `appointments`, `pre_reservations`,
    `calendar_event_completions`, `sent_reminders`, `pending_followups`.
  - **CRM/qualidade/escalonamento**: `crm_lead_state`, `escalations`,
    `escalation_audit_events`, `quality_reviews`, `quality_audit_events`,
    `system_incidents`, `system_incident_audit_events`, `operation_events`.
  - **Financeiro/estoque**: `financial_accounts`, `financial_categories`,
    `financial_titles`, `financial_title_settlements`, `financial_transactions`,
    `recurring_expenses`, `inventory_items`, `purchase_orders`,
    `purchase_order_items`, `stock_movements`.
  - **Marketing/broadcast**: `broadcast_campaigns`, `broadcast_campaign_numbers`,
    `broadcast_campaign_recipients`, `broadcast_campaign_templates`,
    `broadcast_contact_lists`, `broadcast_contacts`, `broadcast_numbers`,
    `broadcast_templates`, `meta_ads_operation_requests`,
    `commercial_interest_requests`, `public_catalog_whatsapp_clicks`.
  - **Prompt/telemetria**: `global_prompt_layer`, `tenant_prompt_layer`,
    `gemini_token_usage`.
  - **Outros**: `push_subscriptions`, `roadmap_items`.
- **Views/functions/triggers/stored procedures**: sim — as migrations descrevem RPCs
  atômicos (ex.: publicação/rascunho da base de conhecimento tipada, migrations
  `0058`/`0059`) e funções ligadas à política RLS (contexto de tenant via JWT). Não foi
  levantado o corpo completo de cada function nesta análise; recomenda-se rodar
  `list_tables`/consulta ao catálogo do Postgres (via MCP Supabase) para extrair o SQL
  exato de cada function/trigger antes de portar.
- **Migrations**: 93 arquivos SQL hand-written em `supabase/migrations/`, todos
  idempotentes (`IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`). **Não há runner de
  migration na aplicação** — são aplicadas manualmente, hoje via ferramenta MCP
  `Supabase.apply_migration` (que registra no histórico de migrations do próprio
  Supabase). Um incidente real (issue #93) documentado no `CLAUDE.md`: uma migration
  colada direto no SQL Editor nunca ficou registrada como aplicada e quebrou uma
  feature já mergeada silenciosamente por dias.
- **Relacionamentos complexos**: sim — isolamento multi-tenant via `tenant_id` em
  praticamente toda tabela de domínio, RLS (Row-Level Security) reforçado por JWT
  curto assinado por requisição (não apenas pela FK), várias tabelas N:N de
  broadcast/campanha (`broadcast_campaign_recipients`, `broadcast_campaign_numbers`),
  e cadeias de auditoria (`*_audit_events`) paralelas às tabelas principais.
- **Volume de registros**: não determinável por análise estática do repositório (não
  há dump/estatística no código); um tenant pagante real está em produção, então o
  volume de `messages`/`conversations`/`gemini_token_usage` cresce continuamente desde
  o go-live.

## 5. ORM / Query Builder

- **Não há ORM nem query builder** (nem Prisma, nem Drizzle, nem Knex). O acesso ao
  banco é feito diretamente via **`@supabase/supabase-js`** (`^2.114.0`), chamando a
  API PostgREST do Supabase (`.from('tabela').select/insert/update/delete/rpc(...)`)
  a partir de cada `*Store.ts` em `server/services/`.
- Não existe `schema.prisma` nem `drizzle.config.ts` — o "schema" vive espalhado nos 93
  arquivos SQL de `supabase/migrations/`, que são a única fonte de verdade estrutural.
- Dois clientes Supabase distintos coexistem por desenho (ver seção 6): um com a
  service-role key (`SUPABASE_KEY`, ignora RLS, uso restrito a operações de
  manutenção/plataforma) e um "runtime" com `SUPABASE_PUBLISHABLE_KEY` + JWT curto por
  tenant (`tenantDbContext.ts`) que efetivamente respeita RLS.

## 6. Autenticação

- **Auth de operador (painel)**: própria — `bcrypt` (senha) + JWT (`jsonwebtoken`)
  contra a tabela `operators`, cookie de sessão HTTP-only assinado
  (`universo_session`, `sameSite: 'strict'`, sem CSRF token dedicado porque o app é
  100% same-origin — decisão documentada em `docs/task-registry/TASK-0311.md`).
- **Login social**: sim, Google — via **Firebase Auth** no frontend
  (`src/lib/firebase.ts`, `LoginModal.tsx`) que gera um ID token do Google, verificado
  no backend por `server/services/firebaseAdmin.ts` (Firebase Admin SDK,
  `FIREBASE_ADMIN_CREDENTIALS`) antes de emitir o JWT de sessão próprio (TASK-0218).
  Sem essa credencial configurada, o botão de login Google fica indisponível (503),
  mas login por senha continua funcionando — não é uma dependência dura.
- **Roles/permissões**: sim, RBAC hierárquico — `operator < manager < admin <
  saas_admin` (`server/middleware/rbac.ts` / `requireRole`, ativo em 7 arquivos de
  rota). `saas_admin` é o único papel com o seletor de tenant no painel
  (`Header.tsx`) e acesso às rotas administrativas cross-tenant (`admin.ts`).
- **Row-Level Security (RLS)**: sim, e é o mecanismo real de isolamento
  multi-tenant no banco (não só uma checagem de aplicação) — reforçado em produção
  desde 26/08/2026. O runtime autenticado usa a chave publicável do Supabase
  combinada com um JWT curto (`SUPABASE_JWT_SECRET`) carregando apenas o
  `tenant_id` já validado; a chave secreta (`SUPABASE_KEY`, bypass de RLS) fica
  restrita a operações de manutenção. Ver `docs/RLS_RUNTIME_ROLLOUT.md` — o rollout
  já teve 2 incidentes reais documentados (env vars faltando no deploy; jobs de
  fundo sem contexto de tenant HTTP quebrando porque rodam fora de request).

## 7. Armazenamento de Arquivos

- **Onde**: bucket privado do **Supabase Storage** chamado `app-data`
  (`server/services/mediaImageStore.ts`, `knowledgeBaseImageStore.ts`,
  `knowledgeBaseVideoStore.ts`), acessado via chamadas HTTP diretas
  (`fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/...`)`) — não usa o SDK
  `supabase-js` para storage, é REST cru.
- **Tipos de arquivo**: imagens (fotos de mídia recebida no WhatsApp, imagens do
  catálogo/base de conhecimento — com geração de thumbnail via `sharp`,
  `catalogImageThumbnail.ts`), áudio (mensagens de voz recebidas e enviadas — via
  transcodificação `ffmpeg` para Ogg/Opus, `audioTranscode.ts`), vídeo
  (`videoTranscode.ts`), e alguns PDFs (comprovantes de pagamento, `pdf-parse`).
- **Tamanho total**: não determinável por análise estática — depende do volume real
  acumulado de mídia recebida/enviada desde o go-live do tenant pagante; não há
  telemetria de tamanho de bucket no código.

## 8. Realtime / WebSockets

- **Usa**, mas não WebSockets — **Server-Sent Events (SSE)** puro:
  `GET /api/conversations/stream` (`server/services/conversationEvents.ts`), para
  o painel do operador (`WhatsAppLeadsSim.tsx`) receber mensagens novas em tempo
  real sem polling.
- **Implementação**: `EventEmitter` do Node **em memória**, pub/sub local ao
  processo — explicitamente **não distribuído** (não sobrevive a restart, não
  funciona entre múltiplas instâncias/réplicas). Há um poll de segurança de 90s
  como fallback no frontend. Isso é um ponto crítico para qualquer migração para
  uma plataforma que rode múltiplas instâncias sem afinidade de sessão (ver seção
  15).

## 9. Background Jobs / Filas / Cron

- **Não há cron externo nem fila de mensagens** (nem BullMQ, nem Redis, nem
  Supabase Edge Functions agendadas). Todos os jobs de fundo são **`setInterval` in-process**
  dentro do próprio `server.ts`/`server/services/periodicJob.ts`
  (`startPeriodicJob`), iniciados uma vez por processo e sem trava distribuída
  entre réplicas (documentado como limitação conhecida).
- **Jobs ativos hoje** (todos iniciados em `server.ts` no boot):
  1. `startTranscriptionWorker` — fila de transcrição de áudio (webhook → download
     de mídia → Gemini), também **em memória** (comentário no próprio código: "Substituir
     por Redis/BullMQ é a Fase 5 (Epic 5.1)" — ainda não implementado).
  2. `startReminderJob` — lembretes de compromisso na véspera/dia via WhatsApp.
  3. `startPreReservationFollowUpJob` — alerta quando pré-reserva vence sem
     confirmação.
  4. `startPendingFollowUpJob` — escalona lead esfriando no meio do funil.
  5. `startAgentPausedAlertJob` (15 min) — alerta operador se o agente ficou pausado
     com mensagens acumulando.
  6. `startBroadcastSenderJob` — envia campanhas de disparo em massa respeitando
     cota por número.
  7. `startEvolutionConnectionAlertJob` — detecta sessão WhatsApp (Evolution/Baileys)
     caída silenciosamente.
  8. `startPaymentPendingAlertJob` — alerta pagamento pendente de verificação há
     mais de 2h.
  9. `startHeldAppointmentExpiryJob` — libera horário retido sem comprovante
     aprovado a tempo.
  10. `startRecurringExpenseJob` — gera lançamento financeiro de despesas
      recorrentes no vencimento.
  11. `reconcileOrphanedAgentEvalRuns` — roda uma vez no boot (não é periódico),
      marca como `failed` rodadas de avaliação de agente órfãs de um restart
      anterior.
- Todos usam `getPlatformDb()`/`runWithTenantDbContext({ source: 'job' })` para ter
  acesso ao Postgres via RLS fora de uma requisição HTTP real — um dos dois
  incidentes documentados do rollout de RLS.

## 10. Variáveis de Ambiente

Listadas por nome (sem valores), conforme `server/config.ts` e `.env.example`:

**Servidor (obrigatórias em produção, travam o boot se ausentes):**
`JWT_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`.

**Servidor (banco/RLS — obrigatórias juntas para runtime real):**
`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_JWT_SECRET`.

**Servidor (opcionais, degradam feature específica se ausentes):**
`GEMINI_API_KEY`, `GROQ_API_KEY`, `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`,
`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `FIREBASE_ADMIN_CREDENTIALS`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`,
`PUBLIC_BASE_URL`, `PORT`, `NODE_ENV`.

**Frontend (bundladas no build, prefixo `VITE_` — expostas ao cliente por design):**
`VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_STORAGE_BUCKET`,
`VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_FIRESTORE_DATABASE_ID`,
`APP_URL` (injetada pelo AI Studio no ambiente atual).

**Secrets críticos** (nunca devem aparecer em log/frontend): `SUPABASE_KEY`
(service-role, bypassa RLS), `SUPABASE_JWT_SECRET`, `JWT_SECRET`, `META_APP_SECRET`,
`META_ACCESS_TOKEN`, `EVOLUTION_API_KEY`, `VAPID_PRIVATE_KEY`,
`FIREBASE_ADMIN_CREDENTIALS`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`,
`GROQ_API_KEY`. As variáveis `VITE_FIREBASE_*` são públicas por design (a
segurança real do Firebase vem de `firestore.rules`, não do sigilo da API key —
documentado explicitamente no `.env.example`).

## 11. Cache / Redis

- **Não há Redis nem cache externo em uso hoje.** Todo estado "de cache/fila" é
  em memória do processo Node: rate limiting (`express-rate-limit`, store padrão
  em memória — sem `RedisStore`/store customizado configurado em
  `server/middleware/rateLimit.ts`), fila de transcrição, pub/sub de SSE, e o
  cache de `systemInstruction` do Gemini por tenant
  (`geminiSystemInstructionCache.ts`). Isso significa que **nenhum desses
  mecanismos sobrevive a restart nem funciona corretamente com múltiplas
  instâncias simultâneas** — ponto de atenção direto para qualquer plataforma
  serverless/edge com múltiplas instâncias efêmeras (Cloudflare Workers incluído).

## 12. Integrações Externas

- **Meta (WhatsApp Cloud API)** — envio/recebimento de mensagens, mídia, webhook
  HMAC-SHA256 (`x-hub-signature-256`), Conversions API (CAPI) e gestão/insights de
  Meta Ads.
- **Evolution API** (self-hosted/terceiro, wrapper sobre Baileys) — canal
  alternativo de WhatsApp para tenants sem número Cloud API oficial; também usado
  para descriptografar áudio recebido.
- **Instagram** — envio de mensagens (`instagramSend.ts`) e credenciais próprias
  por tenant.
- **Google Calendar** (OAuth 2.0, `googleapis`) — agendamento real por tenant,
  tokens armazenados criptografados em `tenant_calendar_tokens`.
- **Google Sheets** (`googleapis`) — sincronização/backup de dados por tenant
  (`googleSheetsSync.ts`).
- **Google Gemini** (`@google/genai`) — o agente de IA em si (roteamento,
  respostas, transcrição de áudio, análise de conversa, function-calling para
  agenda).
- **Groq** — classificador de roteamento mais barato/rápido, com fallback
  automático para Gemini em qualquer falha (opcional).
- **Firebase** (`firebase` + `firebase-admin`) — login social Google no
  frontend + verificação de ID token no backend; Firestore Rules próprias
  (`firestore.rules`) para o que quer que o app grave no Firestore.
- **Web Push** (`web-push`, protocolo VAPID) — notificações push do PWA do
  operador.
- **Supabase** — banco de dados (Postgres + PostgREST) e Storage (bucket
  `app-data`).

## 13. Deploy Atual

- **Hospedagem**: **Render** (confirmado por múltiplas referências no código —
  comentário em `server.ts` sobre o proxy reverso do Render setando
  `X-Forwarded-For`, URL padrão `https://universo-api-evo-hub.onrender.com` em
  `server/config.ts`, e há inclusive um MCP `Render` disponível nesta sessão
  listando serviços/deploys reais do workspace).
- **Como é feito o deploy**: não há Dockerfile, `render.yaml`, `Procfile`, nem
  qualquer outro arquivo de infraestrutura-como-código no repositório — o deploy
  no Render é configurado fora do repo (provavelmente via painel do Render,
  build command `npm run build` + start command `npm start`, apontando pro
  branch `main`). Não há Docker em uso.
- **CI** (`(.github/workflows/ci.yml)`): em todo PR/push para `main`, roda
  `npm ci` → `npm run lint` (tsc) → `npx vitest run` → `npm run build`, mais um
  job `dependency-review` (só em PR). Há também `codeql.yml` para análise
  estática de segurança. Nenhum dos dois faz deploy — é só validação.
- **Static site paralelo**: `docs/mapa-do-projeto/site/index.html` é publicado
  como *Render Static Site* separado (`universo-mapa-arquitetura.onrender.com`),
  auto-deploy a partir de uma branch de feature — irrelevante para a app
  principal, mas mostra que já existe outro serviço Render no mesmo workspace.

## 14. package.json (conteúdo completo)

```json
{
  "name": "universo-api-evo-hub",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx server.ts",
    "build": "vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "start": "NODE_ENV=production node dist/server.cjs",
    "preview": "vite preview",
    "clean": "rm -rf dist server.js",
    "lint": "tsc --noEmit",
    "test": "vitest run",
    "migrate:legacy-data": "tsx scripts/migrate-legacy-data.ts",
    "create:operator": "tsx scripts/create-operator.ts",
    "create:tenant": "tsx scripts/create-tenant.ts",
    "eval:agent": "tsx scripts/eval-agent.ts",
    "encrypt:calendar-tokens": "tsx scripts/encrypt-calendar-tokens.ts",
    "encrypt:phase2-credentials": "tsx scripts/encrypt-phase2-credentials.ts",
    "task:start": "tsx scripts/start-task.ts"
  },
  "dependencies": {
    "@google/genai": "^2.21.0",
    "@supabase/supabase-js": "^2.114.0",
    "@tailwindcss/vite": "^4.1.14",
    "@vitejs/plugin-react": "^6.1.1",
    "bcrypt": "^6.0.0",
    "cookie-parser": "^1.4.7",
    "dotenv": "^17.2.3",
    "express": "^5.2.1",
    "express-rate-limit": "^8.7.0",
    "ffmpeg-static": "^5.3.0",
    "firebase": "^12.18.0",
    "firebase-admin": "^14.3.0",
    "googleapis": "^178.0.0",
    "html2canvas": "^1.4.1",
    "jsonwebtoken": "^9.0.3",
    "jspdf": "^4.2.1",
    "lucide-react": "^1.39.0",
    "motion": "^13.2.0",
    "pdf-parse": "^2.4.5",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "recharts": "^3.10.1",
    "sharp": "^0.35.4",
    "vite": "^8.2.2",
    "web-push": "^3.6.7"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.7",
    "@types/bcrypt": "^6.0.0",
    "@types/cookie-parser": "^1.4.10",
    "@types/express": "^5.0.6",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/node": "^26.4.1",
    "@types/pdf-parse": "^1.1.5",
    "autoprefixer": "^10.4.21",
    "esbuild": "^0.28.2",
    "jsdom": "^30.0.1",
    "tailwindcss": "^4.1.14",
    "tsx": "^4.23.13",
    "typescript": "~5.8.2",
    "vitest": "^4.1.11"
  }
}
```

## 15. Pontos de Atenção

Ordenados aproximadamente por impacto na dificuldade de migrar para a plataforma
Cloudflare (Workers/Pages + adjacentes), considerando que o destino típico ali é
um runtime **V8 isolates** (não Node.js completo) para o backend:

1. **Dependências nativas (binários compilados)** — `sharp` (libvips) e
   `ffmpeg-static` (binário `ffmpeg` completo) são usados para thumbnail de
   imagem e transcodificação de áudio/vídeo. Nenhum dos dois roda em Cloudflare
   Workers (sem filesystem persistente, sem processos externos, sem addons
   nativos). Exigiria mover esse processamento para um serviço externo (ex.:
   Cloudflare Images para thumbnail, algum serviço de transcodificação
   dedicado) ou manter essa parte específica fora do Workers (ex.: um serviço
   Node separado, o que já deixa de ser "migração completa").
2. **SSE em memória, single-instance** — `conversationEvents.ts` usa um
   `EventEmitter` local ao processo para push em tempo real ao painel. Workers
   não mantêm estado de processo entre invocações (cada request pode cair em
   um isolate diferente) — precisaria virar Durable Objects (stateful) ou
   trocar a estratégia de realtime inteira (ex.: Supabase Realtime, que já
   existe como serviço mas não está em uso hoje).
3. **Todos os jobs de fundo são `setInterval` in-process** — 10+ jobs
   (lembretes, alertas, disparo de campanha, expiração de reserva) dependem de
   um processo Node de vida longa. Não existe equivalente direto num Worker
   stateless; precisariam virar Cloudflare Cron Triggers + reescrita para rodar
   sob demanda (sem trava entre invocações concorrentes, que hoje é feita por
   `Set` em memória único por processo).
4. **Fila de transcrição de áudio também em memória** — mesmo problema do item
   2/3, e o próprio código já sinaliza a necessidade de migrar isso para
   Redis/BullMQ como trabalho pendente (não relacionado a Cloudflare, mas
   agrava a dificuldade: hoje não seria nem "portar uma fila real", seria
   "criar a fila real pela primeira vez").
5. **Bundle único `esbuild --packages=external`** — o build de produção do
   servidor assume Node completo com `node_modules` disponível em disco no
   host (`--packages=external` não inclui as dependências no bundle). Um
   Worker precisa de tudo empacotado (ou usar `nodejs_compat` + bindings), e
   várias dependências (`bcrypt` com binding nativo, `sharp`, `ffmpeg-static`,
   `pdf-parse`, `googleapis` pesado) não são garantidamente compatíveis com o
   runtime `workerd`.
6. **`express` 5 completo como framework** — portar para Workers normalmente
   significa reescrever as rotas num framework compatível com `workerd` (Hono é
   o mais comum), não simplesmente reempacotar o Express existente — mesmo que
   parcialmente compatível via `nodejs_compat`, o comportamento de streaming,
   timeouts e limites de CPU por invocação (diferente de um processo Node de
   vida longa) muda o desenho de rotas longas (ex.: SSE, análise de IA que
   pode demorar).
7. **Rate limiting e cache de `systemInstruction` do Gemini em memória** — os
   dois assumem processo único; multiplicariam de forma incorreta (ou
   simplesmente não persistiriam) num ambiente de isolates efêmeros e
   paralelos — precisariam de um KV/Durable Object para continuar corretos.
8. **Webhook HMAC + corpo bruto (`req.rawBody`)** — a verificação de assinatura
   do webhook Meta depende de capturar o body bruto exato via
   `express.json({ verify })`. Reescrever em outro framework precisa preservar
   esse mesmo cuidado (erro aqui reabriria o "fail-closed" que o `CLAUDE.md`
   trata como requisito de segurança).
9. **Cookie de sessão same-origin, sem CORS** — hoje API e SPA são servidas
   pelo mesmo processo/domínio. Se a migração usar Cloudflare Pages
   (frontend) + Workers (API) em domínios/subdomínios diferentes, a decisão
   de CSRF documentada em `docs/task-registry/TASK-0311.md` ("sem token CSRF
   porque é 100% same-origin") deixa de valer e precisa ser revisitada.
10. **RLS runtime já depende de infraestrutura de longa duração** —
    `tenantDbContext.ts`/`runWithTenantDbContext` assume contexto por
    requisição dentro de um processo Node; jobs de fundo já precisaram de
    tratamento especial (`getPlatformDb()`) por rodarem fora de request HTTP —
    replicar esse padrão certinho num modelo serverless (sem processo
    persistente) é o tipo de detalhe que já causou incidente real uma vez
    (rollout de RLS, ver `docs/RLS_RUNTIME_ROLLOUT.md`) e provavelmente causaria de novo.
11. **`pnpm-lock.yaml` e `package-lock.json` coexistindo** — precisa resolver
    qual é o real antes de configurar qualquer build automatizado no Cloudflare
    Pages (detecção de gerenciador por lockfile).
12. **Sem Dockerfile/IaC** — não há nenhuma definição de container/infra hoje;
    qualquer plano de migração parte do zero nesse quesito (nem serve de
    referência, nem de obstáculo).
13. **Superfície ampla de integrações third-party síncronas** — Meta Graph
    API, Evolution API, Google Calendar/Sheets, Gemini, Groq, Firebase Admin —
    todas chamadas via HTTP `fetch`/SDKs a partir do backend; isso é
    tipicamente **compatível** com Workers (sem I/O de disco), mas os SDKs
    (`googleapis` em particular, pesado e com muitas dependências transitivas)
    precisam ser validados individualmente quanto a compatibilidade/tamanho de
    bundle no runtime `workerd`.
14. **Sistema em produção com tenant pagante real** — qualquer corte de
    tráfego para uma nova plataforma precisa de plano de rollback e janela de
    baixo risco; o próprio `CLAUDE.md` pede cuidado extra explícito com
    qualquer mudança no caminho mensagem/agendamento/pagamento, o que se
    aplica com força total a uma migração de plataforma de hosting inteira.

## Resumo executivo

O banco (Supabase/Postgres com RLS) e as integrações externas via HTTP são, em
princípio, portáveis para qualquer plataforma, Cloudflare incluída. O ponto
realmente difícil não é o banco — é que **o backend de hoje é desenhado como um
processo Node de vida longa e stateful** (SSE em memória, ~11 jobs `setInterval`,
fila de transcrição em memória, rate limit em memória, cache em memória) mais
duas dependências nativas de processamento de mídia (`sharp`, `ffmpeg`) que não
existem no modelo de execução de Cloudflare Workers. Uma migração completa e
"pura" para Workers exigiria redesenhar essas cinco áreas (realtime, jobs,
fila, cache, mídia) antes de portar o código de rotas em si — não é um
`esbuild --platform=cloudflare` e pronto.
