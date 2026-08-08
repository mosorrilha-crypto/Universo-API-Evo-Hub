# Plano de Evolução — Transcritor WhatsApp Leads / Universo.ai

> Documento vivo. Última revisão: 2026-08-06.
> Objetivo: sair de canvas/demo (~25% produção) para SaaS operacional em fases incrementais.
>
> Complementar à revisão em `docs/REVISAO_E_REESTRUTURACAO.md` — as duas análises convergem
> nos mesmos problemas centrais (auth fragmentada, segredos hardcoded, localStorage como
> banco, monólito `server.ts`, telemetria fake), o que reforça o diagnóstico.
>
> Complementar também a `docs/AGENTE-VERTICAL-ARQUITETURA.md` — o mapa da reestruturação do
> prompt do agente em camadas (global/segmento/tenant/dinâmico) e das integrações que faltam
> pro script de vendas da Monique operar em 10/10 (pré-reserva, verificação de pagamento,
> disponibilidade semanal). Consenso fechado em 06/08/2026; ainda não implementado.

## 🟢 Decisões do dono do produto — 06/08/2026 (tarde)

1. **Segurança:** autorizado desligar `DEMO_MODE` assim que existir login real — ver ação sua
   no Bloco 2.A acima (criar operador real primeiro, senão tranca o próprio acesso).
2. **Comercial — moeda/idioma esclarecidos (ainda falta o valor exato dos planos):**
   Paraguay é o mercado prioritário (es-PY / Guaraní, com Dólar junto — o Paraguay é
   dolarizado na prática). Brasil vem logo atrás: tenants com vínculo brasileiro (Monique e o
   outro cliente) recebem um par secundário pt-BR/BRL, exibido junto do principal, não no
   lugar dele. Inglês/USD também é prioridade, não "futuro". Schema atualizado pra isso —
   `tenants.currency`/`locale` (principal) + `secondary_currency`/`secondary_locale`,
   restritos a PYG/BRL/USD e es-PY/pt-BR/en. Cotação automática via API de câmbio (ex:
   open.er-api.com ou frankfurter.app, ambas gratuitas) fica anotada como diferencial de
   baixo custo pro Bloco 2.E, quando a tela de exibição for construída — ainda não bloqueia
   nada. **Ainda falta:** confirmar se os valores "Starter R$590 / Pro R$1.200 / Enterprise
   R$2.900" são PYG com prefixo errado ou BRL — decisão de negócio pro Bloco 2.F/Epic 4.4,
   não bloqueia o Bloco 2.A.
3. **Prioridade confirmada:** Bloco 2.A executado nesta sessão — ver detalhamento abaixo.
4. **Ação do proprietário:** Google Calendar autorizado (test user cadastrado na tela OAuth do
   Google Cloud Console) — Epic 4.3.3 resolvido. Validação do Evo Hub real (Epic 1.1.9) segue
   como próxima ação seu.

## 🔴 Atualização estratégica — 06/08/2026

**Contexto:** demanda real validada — reunião com um cliente novo esperando o produto pronto.
Decisão tomada: **não** seguir pelo caminho de implantação isolada por cliente (clonar a stack
a cada venda). Vamos direto para **multi-tenant real** (Fase 2 abaixo), porque o projeto já
cresceu o suficiente pra justificar o investimento e a decisão já foi validada pelo dono do
produto — evoluímos por esse caminho independente dos desafios técnicos que aparecerem.

**O que isso muda no roadmap:**
- **Fase 2 (Persistência e multi-tenant) vira a fase ativa agora**, reescrita abaixo com
  detalhe concreto (não mais genérico) a partir de uma varredura real de todos os 8 serviços
  do backend.
- **Fase 3.1 (Autenticação) foi incorporada dentro da Fase 2** — login real por operador é
  pré-requisito de multi-tenant, não algo que pode esperar uma fase depois (não dá pra isolar
  dado por cliente sem saber com segurança quem está logado como quem).
- Os **10 itens pendentes da auditoria pré-lançamento** (`docs/` não tinha esse relatório —
  foi gerado nesta sessão) estão todos mapeados abaixo, cada um dentro do epic onde faz mais
  sentido resolver, pra nada se perder solto.

**Diagnóstico técnico confirmado (varredura de código, não estimativa):** hoje o backend é
**inteiramente single-tenant**. Os 8 serviços reais (conversas, base de conhecimento,
escalonamentos, respostas rápidas, status do agente, agendamentos, lembretes, conexão do
Google Calendar) guardam estado numa única variável/Map global por serviço, sem `tenantId` em
lugar nenhum. Existe **um único** número de WhatsApp, **uma única** conexão de Calendar,
**uma única** base de conhecimento pro sistema inteiro. O painel "SaaS Admin" que parece
gerenciar clientes é decorativo — não provisiona nada de verdade.

### Princípios de evolução

- **Produção primeiro no core** — webhook → transcrição → CRM antes de expandir features secundárias.
- **Uma fonte de verdade** — eliminar localStorage como banco; backend como persistência.
- **Segurança antes de escala** — auth + rate limit nas APIs de IA desde a Fase 1.
- **Entregas verticais** — cada fase entrega valor testável de ponta a ponta.
- **Demo mode explícito** — mocks só com flag `DEMO_MODE=true`, nunca silencioso.
- **Isolamento por tenant é inegociável a partir daqui** — nenhuma feature nova entra sem
  já nascer particionada por cliente (novo princípio, pós-decisão de 06/08).

### Stack-alvo (decisões recomendadas)

| Camada | Escolha | Motivo |
|---|---|---|
| Persistência | Supabase (Postgres + RLS) | Já parcialmente integrado; RLS nativo para multi-tenant |
| Auth | Supabase Auth + JWT | Unificar operadores; remover login demo em produção |
| Backend | Express modular → extrair services | Menor refactor que reescrever |
| Estado frontend | TanStack Query + Context mínimo | Cache server-side; eliminar duplicação |
| Fila async | Supabase Edge Functions ou BullMQ + Redis | Processar webhooks/áudio fora do request |
| Observabilidade | Pino + métricas tokens/tenant | Substituir telemetria fake |
| Pagamentos (novo) | A decidir (Stripe global ou PIX/local por país) | Cobrar clientes de verdade — hoje não existe nada |

## Roadmap por fases

```
Fase 0 ──► Fase 1 ──► Fase 2 ──► Fase 4 ──► Fase 3 ──► Fase 5
Fundação   Core        Multi-      Integrações  UX/CRM      Escala
(feita)    WhatsApp    tenant      reais       Refactor    Prod
           (quase      real        (parcial,   (componentes) (contínuo)
           feita)      ★ ATIVA     resto após  restante
                       AGORA       Fase 2)
```

**Fase 2 e Fase 4 trocaram de ordem em relação à revisão anterior** — integrações reais
(CAPI, pagamentos) só fazem sentido depois que existir mais de um tenant de verdade pra
integrar.

---

## Fase 0 — Fundação e segurança

**Duração estimada:** 1–2 semanas
**Status:** ✅ concluída (itens P1/P2 residuais listados, não bloqueiam a Fase 2)

### Epic 0.1 — Hardening imediato do backend

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 0.1.1 | Middleware de auth JWT em rotas sensíveis | P0 | S | ✅ Feito |
| 0.1.2 | `JWT_SECRET` obrigatório em produção (fail fast) | P0 | XS | ✅ Feito |
| 0.1.3 | Rate limiting por IP nas rotas de IA | P0 | S | ✅ Feito (20 req/min) |
| 0.1.4 | `helmet` + CORS restrito por `APP_URL` | P1 | XS | Pendente |
| 0.1.5 | Reduzir body limit de 50MB para rota específica de transcribe | P1 | XS | Pendente |
| 0.1.6 | Proteger `/api/test-gemini` — só dev ou admin | P1 | XS | Pendente |
| 0.1.7 | **(novo, da auditoria)** `DEMO_MODE=true` em produção expõe senhas demo em texto claro na tela de login | **P0 🔴** | S | **Pendente — decisão do usuário: precisa confirmar que já existem contas reais no Supabase antes de desligar, senão tranca o próprio acesso** |

### Epic 0.2 — Modo demo explícito

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 0.2.1–0.2.4 | Env `DEMO_MODE`, fallback marcado, badge UI, login demo restrito | P0/P1 | — | ✅ Feito (badge de UI 0.2.3 ainda pendente, cosmético) |

### Epic 0.3 — Higiene do repositório

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 0.3.1 | Atualizar README | P1 | S | Pendente |
| 0.3.2 | Remover código morto | P2 | S | ✅ Feito (`Login.tsx`, `GoogleCalendarIntegration.tsx`+libs Firebase removidos nesta sessão) |
| 0.3.3 | Resolver dependências duplicadas/não usadas | P2 | XS | ✅ Parcial |
| 0.3.4 | Renomear package `"react-example"` | P3 | XS | Pendente |

---

## Fase 1 — Core WhatsApp (pipeline real)

**Status:** ✅ quase concluída — pipeline real rodando em produção (webhook → transcrição →
resposta automática via agente router/especialista → envio real via Meta Cloud API).

### Epic 1.1 — Pipeline de webhook

| ID | Issue | Status |
|---|---|---|
| 1.1.1–1.1.7 | Extração de services, parsers Meta/Evolution, download de mídia, fila, idempotência | ✅ Feito, validado em produção com conversas reais |
| 1.1.8 | Integração real com Evo Hub (BYO Meta App) — código | ✅ Feito, testado só com payloads sintéticos |
| 1.1.9 | Criar canal real no Evo Hub, validar ponta-a-ponta | **Pendente — ação do usuário: confirmar se o Business Manager já foi verificado no painel do Evo Hub** |

### Epic 1.2 — Transcrição

| ID | Issue | Status |
|---|---|---|
| 1.2.1, 1.2.4 | Serviço extraído, OGG/Opus nativo do WhatsApp | ✅ Feito, validado |
| 1.2.2 | Fixar modelo Gemini estável | ✅ Feito (`gemini-3.6-flash` em produção; só `/api/test-gemini` testa modelos antigos) |
| 1.2.3, 1.2.5 | Schema Zod, log de tokens | Pendente, baixa prioridade |

### Epic 1.3 — Resposta automática

| ID | Issue | Status |
|---|---|---|
| 1.3.1–1.3.2 | Router + especialista Gemini, envio real de bolhas via Meta | ✅ Feito, com agente de agendamento usando function-calling real no Google Calendar (ver Fase 4.3) |

**Entregável Fase 1:** ✅ atingido e além do escopo original — inclui agendamento real, não só CRM.

---

## Fase 2 — Multi-tenant real ★ FASE ATIVA

**Duração estimada:** 3–5 semanas (revisado a partir do escopo real, não é um refactor pequeno)
**Objetivo:** um único backend atendendo N clientes de verdade, cada um com seu próprio
número de WhatsApp, agenda, base de conhecimento e login — com isolamento total de dados.

Esta fase reescreve o coração do sistema. Detalhamento por bloco, na ordem em que faz sentido
implementar (cada bloco depende do anterior):

### Bloco 2.A — Schema de tenant e persistência real (fundação de tudo)

**Status: ✅ código pronto e no branch — falta só a ação sua descrita abaixo.**

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 2.A.1 | Migrations Supabase Postgres: `tenants`, `operators`, `tenant_meta_credentials` (WABA/phone_number_id/access_token por tenant), `tenant_calendar_tokens` (refresh token por tenant) | P0 | M | ✅ Feito — `supabase/migrations/0001_multi_tenant_schema.sql` |
| 2.A.2 | Row Level Security por `tenant_id` em todas as tabelas | P0 | M | ✅ Feito, com ressalva — ver "Nota sobre RLS" abaixo |
| 2.A.3 | Migrar os 8 serviços de `server/services/*Store.ts` de Map/variável global em memória (+ 1 arquivo JSON por serviço no Supabase Storage) para tabelas Postgres reais chaveadas por `tenant_id`: `conversationStore`, `knowledgeBaseStore`, `escalationStore`, `quickRepliesStore`, `agentStatus`, `appointmentStore`, `reminderStore`, `googleCalendar` | P0 | L | ✅ Feito — todos os 8 exigem `tenantId` como parâmetro obrigatório agora |
| 2.A.4 | Script de migração dos dados atuais da Monique pro `tenant_id` dela (não pode perder histórico de conversa real) | P0 | S | ✅ Código pronto (`scripts/migrate-legacy-data.ts`) — **precisa rodar contra o Supabase real (ação sua, ver abaixo)** |

**Critério de aceite:** os 8 serviços aceitam `tenantId` como parâmetro obrigatório; dado de
um tenant nunca aparece pra outro mesmo com Postgres compartilhado (RLS testado). ✅ Atendido
no código — falta aplicar em produção.

**tenantId ainda é um valor fixo (`LEGACY_DEFAULT_TENANT_ID`, o UUID da Monique), não
resolvido por requisição** — isso é literalmente o trabalho do Bloco 2.B (routing por
`phone_number_id`) e do Bloco 2.C (Google Calendar por tenant real via OAuth `state`), que
vêm em seguida. Rotas autenticadas (`/api/conversations`, `/api/knowledge-base` etc.) já usam
`req.user.tenantId` do JWT quando disponível; só o caminho do webhook (que ainda não sabe de
qual cliente é a mensagem) usa o valor fixo.

**Nota sobre RLS:** as políticas estão criadas e habilitadas em todas as tabelas
(`current_setting('app.current_tenant_id')`), mas o backend fala com o Postgres pela service
key do Supabase, que ignora RLS por padrão (`BYPASSRLS`). A isolação que protege os dados
*hoje* é o `tenantId` obrigatório em toda função de serviço — testado, funciona. RLS reforçada
de verdade no banco (proteção mesmo contra bug de código) exige trocar pra uma role Postgres
restrita com conexão direta — fica como item futuro, não bloqueia esta fase.

**Ação sua pra "isolamento por tenant_id funcional em produção" ficar 100% completo:**
1. Colar `supabase/migrations/0001_multi_tenant_schema.sql` no SQL Editor do painel Supabase
   e rodar (idempotente, seguro repetir).
2. Rodar `SUPABASE_URL=... SUPABASE_KEY=... npm run migrate:legacy-data` uma vez, com as
   credenciais reais de produção — migra as conversas/agenda/base de conhecimento atuais da
   Monique (hoje em JSON no Storage) pras tabelas novas, sob o tenant dela.
3. Rodar `SUPABASE_URL=... SUPABASE_KEY=... npm run create:operator -- --email <seu-email> --password <senha-forte> --name "<nome>" --role saas_admin` pra ter um login real de admin — é isso que destrava `DEMO_MODE=false` sem te trancar pra fora. Repita com `--role admin` pro e-mail da Monique.
4. Aí sim: `DEMO_MODE=false` no Render.

### Bloco 2.B — Roteamento multi-canal (webhook sabe de quem é a mensagem)

**Status: ✅ código pronto e no branch.**

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 2.B.1 | `webhookParsers.ts` passa a extrair `value.metadata.phone_number_id` do payload da Meta (hoje não lê esse campo) | P0 | S | ✅ Feito |
| 2.B.2 | Nova tabela/lookup `phone_number_id → tenant_id` — resolve qual cliente é dono de cada número assim que a mensagem chega | P0 | M | ✅ Feito — reaproveita `tenant_meta_credentials` (já existia do Bloco 2.A) via `server/services/tenantResolver.ts`, sem precisar de tabela nova |
| 2.B.3 | `metaSend.ts`, `autoReply.ts`, `sendBubbles.ts`, `transcriptionQueue.ts` deixam de receber credenciais globais injetadas na subida do servidor (`config.metaAccessToken` fixo) e passam a resolver a credencial do tenant certo por requisição | P0 | L | ✅ Feito — `metaSend.ts`/`sendBubbles.ts` já recebiam credencial por parâmetro (nenhuma mudança neles); `webhooks.ts` e `transcriptionQueue.ts` agora resolvem por `phone_number_id` antes de chamar |
| 2.B.4 | Idempotência e fila de transcrição passam a ser por `tenant_id + message_id` | P1 | S | Adiado — `message_id` da Meta já é praticamente único globalmente, risco baixo de colisão entre tenants; revisitar se algum dia virar problema real |

**Critério de aceite:** duas mensagens simultâneas de dois números de WhatsApp diferentes
(dois tenants) são respondidas cada uma com a base de conhecimento e a agenda certas, sem
misturar. ✅ Atendido no código.

**Como funciona na prática:** se o `phone_number_id` da mensagem recebida não estiver
cadastrado em `tenant_meta_credentials`, cai no tenant legado (Monique) + credencial
compartilhada — exatamente o comportamento de hoje, preservado como fallback. Isso significa
que **nada muda em produção até você cadastrar um segundo cliente de verdade**. Pra isso,
script novo: `npm run create:tenant -- --name "Nome" --phone-number-id <id> --access-token
<token>` (cria o tenant + credenciais do WhatsApp dele), seguido de `npm run create:operator
-- --tenant <uuid-impresso> --email ... --password ... --role admin` (cria o primeiro login
dele). É a implementação do Bloco 2.D.4 (onboarding manual já decidido).

### Bloco 2.C — Google Calendar por tenant

**Status: ✅ código pronto e no branch.**

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 2.C.1 | `googleCalendar.ts`: trocar `storedRefreshToken` (variável única global) por token por `tenant_id` | P0 | M | ✅ Feito no Bloco 2.A (`tenant_calendar_tokens`) |
| 2.C.2 | Callback OAuth (`/api/google-calendar/oauth-callback`) precisa saber pra qual tenant está conectando — codificar `tenantId` no parâmetro `state` do fluxo OAuth | P0 | S | ✅ Feito — `state` é um JWT curto (10min) assinado com `tenantId`, gerado em `/connect` e verificado no callback público; cai no tenant legado se ausente/inválido |
| 2.C.3 | `appointmentStore`/`reminderJob.ts` já migrados no Bloco 2.A passam a rodar o job de lembretes iterando por tenant, não uma vez só globalmente | P0 | S | ✅ Feito — `listConnectedCalendarTenants()` lista quem tem calendário conectado, o job roda uma vez por tenant, resolvendo a credencial Meta de cada um (`resolveMetaCredentialsForTenant`) |

**Critério de aceite:** dois tenants diferentes conectam a própria conta do Google Calendar
de forma independente, sem um sobrescrever o token do outro, e cada um recebe lembretes só
dos próprios agendamentos. ✅ Atendido no código — falta só um segundo tenant real ter
calendário conectado pra validar ponta a ponta (o primeiro é a Monique, já conectada).

### Bloco 2.D — Autenticação real e provisionamento de cliente

*(Fase 3.1 da revisão anterior incorporada aqui — não faz sentido separar.)*

**Status: backend pronto e no branch; frontend do painel SaaS Admin ainda não reconectado (ver nota abaixo).**

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 2.D.1 | Login real via tabela `operators` (email/senha, bcrypt), com `tenant_id` vinculado — substitui os 4 usuários demo fixos | P0 | M | ✅ Já existia antes desta sessão (`server/routes/auth.ts`); `DEMO_MODE=false` confirmado em produção |
| 2.D.2 | RBAC: `operator < manager < admin < saas_admin`, `saas_admin` é o único que enxerga todos os tenants | P0 | M | ✅ Feito — `server/middleware/rbac.ts` (`requireRole`), testado (admin bloqueado de listar todos os tenants e de criar `saas_admin`, saas_admin passa) |
| 2.D.3 | "Cadastrar Novo Usuário" do painel SaaS Admin passa a criar de verdade | P0 | S | ⚠️ Backend pronto (`POST /api/admin/operators`), **frontend (`SaaSAdminDashboard.tsx`) ainda chama só estado local/localStorage — não foi reconectado nesta sessão** |
| 2.D.4 | Fluxo real de onboarding de cliente novo: admin cadastra tenant + credenciais Meta manualmente | P0 | M | ✅ Feito — CLI (`scripts/create-tenant.ts`) desde o Bloco 2.B, agora também via API (`POST /api/admin/tenants`) |
| 2.D.5 | "Cadastrar Novo Cliente SaaS" do SaaS Admin passa a provisionar de verdade | P0 | M | ⚠️ Backend pronto (`POST /api/admin/tenants`), **frontend ainda não reconectado** — ver nota |

**Nota sobre o frontend do SaaS Admin:** o componente (`src/components/SaaSAdminDashboard.tsx`, 1600+ linhas) guarda `Tenant`/`UserProfile` num formato (`monthlyMRR`, `whatsappEngine`, `zapiInstanceId/Token`, `evolutionInstanceName` fabricados) que diverge do schema real do Postgres (`tenants.currency/locale`, `tenant_meta_credentials.phone_number_id/access_token`). Reconectar o formulário aos endpoints novos exige primeiro decidir o que fazer com esses campos fabricados (a maioria descreve integrações que não existem de verdade — Z-API não está implementado). Ficou de fora desta sessão por ser um redesenho de tela, não só troca de chamada de API — meu próximo passo recomendado quando retomarmos isso.

### Bloco 2.E — Frontend: eliminar localStorage como banco

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 2.E.1 | TanStack Query pra leads/transactions/knowledge-base, substituindo os `useState` + `localStorage.setItem` espalhados em `App.tsx` e `WhatsAppLeadsSim.tsx` | P0 | M |
| 2.E.2 | Remover o state duplicado de `leads` entre `App.tsx` e `WhatsAppLeadsSim.tsx` (hoje são dois arrays desconectados — já mitigado parcialmente nesta sessão, falta unificar de vez) | P0 | M |
| 2.E.3 | CRM (`OperatorCRM.tsx`), Financeiro (`FinancialDashboard.tsx`) e Atribuição (`AdAttributionCAPI.tsx`) passam a ler/escrever via API real com filtro de tenant, não mais mock local | P0 | L |
| 2.E.4 | Seletor de moeda/locale por tenant — hoje R$/pt-BR está fixo no código. Schema já pronto (`tenants.currency`/`locale` + `secondary_currency`/`secondary_locale`, PYG/BRL/USD × es-PY/pt-BR/en). Paraguay (Gs/USD) é o principal, Brasil (BRL/pt-BR) o secundário pra tenants com vínculo brasileiro. Diferencial opcional: cotação automática via API de câmbio gratuita (open.er-api.com, frankfurter.app) | P1 | S |

### Bloco 2.F — Itens da auditoria que só fazem sentido resolver aqui dentro

| ID | Item da auditoria | Onde entra |
|---|---|---|
| P-1 | Preços de planos contraditórios entre "Guia Conexão API" e "Painel SaaS Master" | Corrigir junto do Bloco 2.D (tela de planos/cadastro de tenant é reescrita de qualquer forma) — **preciso dos valores reais de venda antes de mexer** |
| P-2 | Chave PIX configurada nunca é usada nas cobranças geradas | Fora do escopo desta fase — vira **Fase 4 (Pagamentos)**, só faz sentido com tenants reais cobrando de verdade |
| P-3 | Upload de "Documentos" na Base de Conhecimento não alimenta a IA | Fora do escopo desta fase — é RAG real, projeto à parte; texto da UI já avisa que não funciona ainda |

**Entregável Fase 2:** dois (ou mais) tenants reais rodando no mesmo backend, cada um com seu
WhatsApp, agenda e login, sem nenhum dado vazando entre eles. Isso é o que transforma o painel
"SaaS Admin" de decorativo em real.

---

## Fase 3 — Refactor de UX/frontend

**Duração estimada:** 2 semanas (depois da Fase 2 — autenticação já foi incorporada lá)
**Objetivo:** codebase mantível, componentes menores.

### Epic 3.2 — Decomposição de componentes

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 3.2.1 | Quebrar `WhatsAppLeadsSim.tsx` (hoje ~2000 linhas) → `ChatList`, `ChatWindow`, `LeadSidebar`, `QrModal` | P1 | L |
| 3.2.2 | Quebrar `AdAttributionCAPI.tsx` | P2 | L |
| 3.2.3 | Quebrar `SaaSAdminDashboard.tsx` | P2 | L |
| 3.2.4 | Integrar ou remover `AudioRecorder`, `FileUpload`, `TranscriptHistory` (ferramenta de transcrição avulsa, sem persistência de histórico) | P2 | M |

### Epic 3.3 — TypeScript rigoroso

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 3.3.1–3.3.3 | `strict: true`, eliminar `any`, ESLint + Prettier | P2/P3 | M |

---

## Fase 4 — Integrações reais e pagamentos

**Duração estimada:** 2–3 semanas (parcialmente paralelizável com o fim da Fase 2)
**Objetivo:** substituir simulações por integrações funcionais, e cobrar clientes de verdade.

### Epic 4.1 — Meta Conversions API

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 4.1.1–4.1.4 | Envio real, hash SHA-256, persistência, auto-disparo por estágio CRM | P1 | M/L |

### Epic 4.2 — Evo Hub / WhatsApp outbound (facade)

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 4.2.1–4.2.2 | Persistir channels reais, `/api/v1/messages/send` chamando Meta de verdade | P1 | M/L | Pendente — reavaliar necessidade após Fase 2 (o roteamento multi-tenant do Bloco 2.B pode tornar esse facade desnecessário) |
| 4.2.3 | Auth Evo Hub validando contra DB | P0 | S | ✅ Feito |

### Epic 4.3 — Google Calendar

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 4.3.1 | Fluxo OAuth + refresh token | P2 | M | ✅ Feito (single-tenant); vira multi-tenant no Bloco 2.C |
| 4.3.2 | Function-calling do agente de agendamento (verificar disponibilidade, criar/remarcar/cancelar) + lembretes automáticos | P0 | L | ✅ Feito nesta sessão |
| 4.3.3 | **(novo)** Conectar de fato a conta real da Monique — o botão existe e funciona, ninguém clicou ainda | P0 | XS | **Pendente — ação do usuário** |

### Epic 4.4 — Pagamentos (novo epic, nasceu da auditoria)

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 4.4.1 | Decidir provedor de cobrança (Stripe pra cartão internacional? PIX/transferência local via algo como um gateway paraguaio?) — **decisão de negócio, não técnica** | P0 | — |
| 4.4.2 | Ligar a chave PIX configurável de verdade na geração de cobrança do Financeiro (hoje decorativa) | P1 | M |
| 4.4.3 | Cobrança recorrente dos tenants do SaaS (assinatura mensal) | P1 | L |

### Epic 4.5 — Paridade com o projeto antigo da Monique (bloqueia descontinuar o projeto antigo)

**Origem:** auditoria comparativa código-a-código feita em outra sessão contra o repositório
antigo standalone da Monique (fora do Universo, nunca portado pro GitHub). Confirmado
lendo os dois lados, não por inferência. O projeto antigo está em produção faturando; estes
itens são o que falta no Universo pra ele poder ser descontinuado com segurança — todos tocam
o caminho de conversão/receita, não são cosméticos.

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 4.5.1 | Meta Conversions API é 100% mock em `server/routes/metaCapi.ts` — `status: 'simulated_ok'`, hash de telefone fixo hardcoded, nenhum `fetch` real. O projeto antigo chama `https://graph.facebook.com/v21.0/{DATASET_ID}/events` de verdade. Sem isso, atribuição de anúncio (CAPI) não existe no Universo. | P0 | M | ✅ Feito — chamada real a `graph.facebook.com/{pixelId}/events`, hash SHA-256 real do telefone (`server/routes/__tests__/metaCapi.test.ts`), sem fabricar match quality score (Meta não devolve isso síncrono). `pixelId`/`accessToken` ainda vêm do painel (localStorage) por requisição, não de credencial por tenant no banco — isso é dívida do Bloco 2.E, não resolvida aqui. Defaults fake do formulário (pixel/token/testCode de demo) removidos. |
| 4.5.2 | Agente não tem ferramenta pra enviar foto de portfólio/exemplo do serviço — `AgentProduct.exampleImageBase64` já existe no schema da KB (`knowledgeBaseStore.ts`), mas nada em `autoReply.ts`/function-calling usa esse campo pra mandar a imagem de verdade pro cliente. O projeto antigo tem essa ferramenta ligada no loop de tool-calling. | P1 | M | ✅ Feito — tool `enviar_foto_exemplo` (function-calling do Gemini) pros agentes faq/triagem, reaproveitando o mesmo upload/envio real (`uploadWhatsAppMedia`/`sendWhatsAppMediaMessage`) já usado no envio manual do painel. No máximo 1 foto por mensagem recebida (não há limite de "1 por conversa inteira" ainda — isso é regra de segmento, Etapa 4). Testado em `server/services/__tests__/autoReply.test.ts`. |
| 4.5.3 | Confirmação de pagamento (comprovante → libera confirmação de agendamento) — schema já existe (`pre_reservations`, Etapa 1), mas o agente ainda não chama nada disso; comentário no próprio código (`autoReply.ts`) admite que hoje isso vira só escalonamento manual. | P0 | L | ✅ Feito — Etapa 8 do roadmap do agente vertical, ver `docs/AGENTE-VERTICAL-ARQUITETURA.md` seção 7 item 8 pro detalhe completo. |
| 4.5.4 | Nota de preço promocional obsoleta hardcoded como texto solto no seed (`scripts/seed-monique-knowledge-base.ts:40`, "promoções de julho terminaram em 31/07") | P2 | XS | **Achado corrigido** — a claim original ("preço promocional virou texto estático") está errada: o mecanismo dinâmico já existe e funciona (`resolveProductPrice` em `knowledgeBaseStore.ts`, compara `promoUntil` com a data real). O problema real é só essa nota redundante/desatualizada misturada em `businessRules`; risco é confundir o agente com informação obsoleta, não falta de mecanismo. Remover a nota, deixar o campo `promoPrice`/`promoUntil` por produto ser a única fonte. |
| 4.5.5 | **(novo, auditoria de código completo em 07/08/2026)** Nenhum horário de funcionamento codificado — o agendamento só respeita o que o Google Calendar mostra como ocupado, sem limite de expediente. Nada impedia (em código) criar um agendamento às 22h ou num domingo fechado. O projeto antigo tem isso explícito (`HORARIO_POR_DIA` + `dentroDoExpediente`, rejeita com `HORARIO_FUERA_DE_EXPEDIENTE`). Risco real de produção, não só falta de recurso. | P0 🔴 | S | ✅ Feito — `tenants.business_hours` (jsonb por dia da semana, migration `0004_tenant_business_hours.sql`, já semeado com o horário real da Monique), checagem `isWithinBusinessHours`/`assertWithinBusinessHours` em `googleCalendar.ts`: `checkFreeBusy` devolve indisponível sem nem consultar o Google, `criar_agendamento`/`remarcar_agendamento` lançam `HORARIO_FORA_DO_EXPEDIENTE` como defesa em profundidade. Testado (`server/services/__tests__/businessHours.test.ts`). Tenant sem horário configurado não é restringido (não quebra tenants futuros que ainda não configuraram isso). |
| 4.5.6 | **(novo)** `webhookParsers.ts` nunca lê `message.referral` (headline, `source_id`, `ctwa_clid`) que a Meta manda quando o lead vem de anúncio Clique-para-WhatsApp. Sem isso, o CAPI (4.5.1) não amarra o evento ao anúncio real — o projeto antigo **recusa** disparar o evento sem `ctwa_clid` (nunca manda atribuição incompleta) e dispara automaticamente `dispararAgendamentoConcluido` quando o evento é criado de verdade no Calendar, com `ctwa_clid` da conversa. | P0 | M | ✅ Feito — `webhookParsers.ts` captura `message.referral`; `conversations.ctwa_clid`/`ad_source_id`/`ad_headline` gravados uma única vez por conversa (`attachAdReferralIfMissing`, migration `0005_ctwa_referral_and_capi_credentials.sql`, mesma tabela ganhou `tenant_meta_credentials.capi_dataset_id/capi_access_token/capi_page_id`). Novo `server/services/metaCapiService.ts` (`fireMetaCapiEventForTenant`) dispara `Schedule` automaticamente quando `criar_agendamento` cria o evento de verdade (`autoReply.ts`) — nunca sem `ctwa_clid` real e nunca sem credencial de CAPI configurada pro tenant, sempre fire-and-forget. Testado (`server/services/__tests__/metaCapiService.test.ts`). O envio manual do painel (4.5.1) continua existindo em paralelo, sem mudança. |
| 4.5.7 | **(novo)** Sem validação anti-alucinação de horário — o projeto antigo (`validarHorariosDotexto`) confere, depois que o modelo responde, se qualquer horário citado no texto final bate com o resultado real de `consultar_horarios_livres`; se não bater, reescreve o texto à força antes de mandar pro cliente. O Universo confia só no modelo não alucinar. | P1 | S | ✅ Feito — `generateAutoReplyForText` coleta os horários realmente confirmados pelas ferramentas nesta mensagem (`verificar_disponibilidade` com `disponivel:true`, `criar_agendamento`/`remarcar_agendamento` bem-sucedidos, e o horário do agendamento ativo se houver) e compara contra todo `HH:mm` citado na resposta final; se o modelo citar um horário não confirmado, a resposta é substituída por uma correção segura antes de sair pro cliente. Adaptado ao que o Universo já tem hoje (checagem pontual por horário, não uma lista do dia inteiro — isso é a Etapa 6, ainda não construída). Testado (`server/services/__tests__/autoReplyAntiHallucination.test.ts`). |
| 4.5.8 | **(novo)** Sem etapa dedicada de reclamação — o projeto antigo tem um 5º modo (`reclamacao`) que nunca oferece solução/reembolso sozinho, sempre escala com contenção empática. No Universo isso cai misturado em triagem/faq. | P2 | S | ✅ Feito — 4º `AgentType` (`reclamacao`) no router e em `AGENT_INSTRUCTIONS`: acolhe com empatia, nunca oferece solução/reembolso/retoque por conta própria, `needsHumanConfirmation` sempre `true` (a IA nunca resolve reclamação sozinha) independente do que o especialista marcou. `webhooks.ts`/`transcriptionQueue.ts` escalam automaticamente. Testado. |
| 4.5.9 | **(novo)** Sem fluxo roteirizado de cancelamento em 2 fases (sem seña vs. com seña paga, com texto de resposta definido pra cada caso e regra de "1 tentativa de reagendar, nunca insistir 2x"). A política já existe em texto na KB, mas o agente não segue um script estruturado. | P2 | S | ✅ Feito (adaptado) — como o Universo não rastreia se o sinal foi pago (isso seria a Etapa 8), a distinção virou: cancelamento com **24h+ de antecedência** nunca é executado automaticamente (a decisão de devolução do sinal precisa de humano — `cancelar_agendamento` retorna `escalonar:true`, `needsHumanConfirmation` vira `true`); com **menos de 24h**, sem devolução em jogo pela política, a IA cancela direto. Instrução de "1 tentativa empática de reagendar, nunca insistir 2x" adicionada ao prompt do agendamento. Testado (`server/services/__tests__/autoReplyCancellation.test.ts`). |
| 4.5.10 | **(novo)** Sem alerta automático ao operador quando um pagamento fica pendente de verificação por muito tempo — o projeto antigo roda de hora em hora e manda WhatsApp pro admin se um escalonamento de pagamento passa de 2h sem resolução. | P1 | S | Pendente — a Etapa 8 (4.5.3) já está conectada (webhook marca `pending_verification`, `/api/conversations/:phone/verify-payment` pro operador resolver, agente lê o estado); falta só o job periódico de lembrete. Bloqueado por não existir ainda um "WhatsApp do admin por tenant" pra notificar — precisa desse campo antes. |

**O que NÃO é gap** (já confirmado igual ou melhor no Universo, sem ação necessária): agendamento
via Google Calendar com function-calling real, transcrição de áudio via Gemini, persistência
real em Postgres (vs. Google Sheets/localStorage do projeto antigo), multi-tenant, financeiro,
CRM, lembretes automáticos, idempotência por `wa_message_id`.

**Sobre descontinuar o projeto antigo:** decisão de negócio, não técnica — fica pra quando
4.5.1–4.5.3 estiverem prontos. Este documento não tem visibilidade sobre o repositório antigo
(não está no GitHub, vive só no ambiente da outra sessão) — qualquer ação de apagar/arquivar
esse projeto precisa ser feita a partir de lá, não daqui.

### Epic 4.6 — Evolution API multi-instância (QR Code Gateway, baixa barreira de entrada)

**Origem:** proposta trazida pelo dono do produto (documento externo, 08/08/2026) sobre como
reduzir a barreira de entrada comercial do SaaS — hoje, exigir Business Manager verificado pela
Meta antes do cliente conseguir usar o produto derruba boa parte do mercado inicial (pequenos
negócios sem CNPJ/BM verificado). Análise técnica confirmada contra o código real do Universo.

**Diagnóstico técnico (confirmado, não suposição):**
- `server/services/webhookParsers.ts` já tem `parseEvolutionWebhookPayload` — o Universo já
  entende o formato de mensagem da Evolution API.
- Mas `server/config.ts` só carrega Evolution como **uma única instância global**
  (`EVOLUTION_API_URL`/`EVOLUTION_API_KEY`/`EVOLUTION_INSTANCE_NAME` — três variáveis de
  ambiente fixas, iguais ao padrão single-tenant antigo do Meta antes do Bloco 2.B). Não existe
  criação de instância nova, geração de QR Code, nem resolução de qual tenant é dona de qual
  instância Evolution — a mesma lacuna que existia pro WhatsApp oficial antes do Bloco 2.B.
- Não existe, e nunca deveria existir: um `<iframe>`/widget carregando o WhatsApp Web direto no
  navegador do cliente — a Meta bloqueia isso via `X-Frame-Options: DENY`. Confirmado, não é uma
  limitação de implementação, é bloqueio do lado da Meta.

**Arquitetura recomendada — duas portas de entrada, unificadas no mesmo pipeline de IA:**

| | Porta A — QR Code (Evolution API) | Porta B — Oficial (Evo Hub / Meta Cloud API) |
|---|---|---|
| Pra quem | Cliente novo, sem CNPJ/BM verificado — onboarding em segundos | Cliente que cresceu, precisa de volume/estabilidade sem risco de banimento |
| Como conecta | Escaneia QR Code gerado pelo backend (instância "headless" do WhatsApp) | Facebook Login embutido (fluxo que o Evo Hub já cobre) |
| Risco de banimento | Médio (não-oficial) | Zero |
| Barreira de entrada | Nenhuma | Alta (exige BM verificado) |
| Pro agente de IA (`autoReply.ts`) | Mesmo pipeline — o processamento não sabe nem precisa saber de qual porta a mensagem veio | Mesmo pipeline |

**Estratégia comercial ("cavalo de troia"):** cliente entra de graça/barato pela Porta A
(Evolution), começa a usar a IA imediatamente. Quando o volume de mensagens cresce a ponto do
risco de banimento importar de verdade, oferece upgrade guiado pra Porta B (Evo Hub/Meta oficial).
Não descontinuar o Evo Hub — ele continua sendo o produto pra cliente enterprise; a Evolution API
é a "segunda antena" que amplia quem consegue entrar no funil no primeiro dia.

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 4.6.1 | Provisionar Evolution API multi-instância: uma instância por tenant (não mais 1 global fixa), análogo ao `tenant_meta_credentials` do Bloco 2.A — tabela `tenant_evolution_credentials` (instance_name/api_key/api_url por tenant) | P1 | M | ✅ Feito — migration `0011_tenant_evolution_credentials.sql`, `resolveTenantByEvolutionInstance`/`resolveMetaCredentialsForTenant`-equivalente em `tenantResolver.ts` |
| 4.6.2 | Endpoint/fluxo de criação de instância + geração de QR Code real (chama a Evolution API pra criar a instância do tenant novo e devolve o QR Code pro painel exibir) | P1 | M | ✅ Feito — `POST /api/admin/tenants/:id/evolution-instance` (cria + persiste credencial) e `GET /api/admin/tenants/:id/evolution-instance/qrcode` (renova QR expirado), ambos `saas_admin`-only. Usa `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` existentes como credencial "admin" de provisionamento — nenhuma env var nova. |
| 4.6.3 | Roteamento multi-canal (Bloco 2.B) estender pra resolver tenant também por `instance_name` da Evolution, não só por `phone_number_id` da Meta | P1 | S | ✅ Feito — `webhookParsers.ts` captura `body.instance`, `webhooks.ts` roteia mensagem Evolution por `resolveTenantByEvolutionInstance` (mesma regra de segurança do Bloco 2.B: instância desconhecida nunca cai no tenant legado). Download de áudio (`transcriptionQueue.ts`) também passou a usar a instância resolvida por tenant, não mais a global fixa. |
| 4.6.4 | Envio de mensagem via Evolution API (hoje `metaSend.ts` só fala com a Meta Cloud API) — precisa de um `evolutionSend.ts` equivalente, ou abstrair os dois atrás de uma interface comum | P1 | M | ✅ Feito — `evolutionSend.ts` novo (`sendEvolutionTextMessage`/`showEvolutionTyping`); `sendBubbles.ts` agora recebe um `OutboundChannel` (`provider: 'meta' \| 'evolution'`) em vez de phoneNumberId/accessToken crus, e escolhe o provedor certo. Cobre o pipeline automático da IA (texto e áudio). **Fora deste PR:** envio manual do painel (`conversations.ts`) e o job de lembretes (`reminderJob.ts`) continuam só-Meta — ferramenta de foto de exemplo (Epic 4.5.2) também, que já se desativa sozinha sem `mediaConfig`. Follow-up separado. |
| 4.6.5 | Onboarding self-service no painel: cliente escolhe "Conectar agora com QR Code" (Evolution, instantâneo) ou "Conectar com Facebook/Business Manager" (Evo Hub, oficial) — hoje o onboarding é só manual via `scripts/create-tenant.ts`/API admin (Bloco 2.D.4) | P2 | L | Pendente — os endpoints de 4.6.2 já dão a base (criar instância + buscar QR); falta só a tela. Mesma situação do SaaS Admin no Bloco 2.D (frontend não reconectado). |

**Fora de escopo aqui, mantido como está:** widget/iframe carregando WhatsApp Web direto no
navegador — tecnicamente bloqueado pela Meta, não é uma direção viável.

---

## Fase 5 — Escala, observabilidade e produção

**Duração estimada:** contínuo
**Objetivo:** operação confiável com múltiplos tenants reais.

### Epic 5.1 — Fila e workers

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 5.1.1 | Redis + BullMQ pra jobs de transcrição/análise, agora com volume real de vários tenants | P1 | L | Pendente |
| 5.1.2 | Retry com backoff; dead letter queue | P1 | M | Pendente |
| 5.1.3 | Telemetria real de tokens por tenant (painel já existe, ligado a dado fake ainda) | P1 | M | Pendente — só faz sentido depois do Bloco 2.A |

### Epic 5.2 — Testes e CI

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 5.2.1–5.2.4 | Vitest, testes de integração, GitHub Actions, smoke test pós-deploy | P1 | M |

### Epic 5.3 — Observabilidade

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 5.3.1–5.3.3 | Logger estruturado com `tenant_id`, dashboard custo por tenant, alertas | P1/P2 | S/M |

### Epic 5.4 — Deploy

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 5.4.1–5.4.3 | Dockerfile, env vars validadas no boot (Zod), health check | P1 | M/S |

---

## Pendências consolidadas da auditoria pré-lançamento (06/08/2026)

Lista completa dos 10 itens do relatório de auditoria, todos já mapeados nas fases acima —
esta tabela é só o índice rápido pra não se perder:

| # | Pendência | Severidade | Onde resolver |
|---|---|---|---|
| 1 | `DEMO_MODE=true` em produção expõe senhas na tela de login | 🔴 Crítico | Epic 0.1.7 — autorizado; falta você criar o operador real (`npm run create:operator`) e então desligar no Render |
| 2 | Preços de planos contraditórios entre telas | Decisão | Bloco 2.F (P-1) — preciso dos valores reais |
| 3 | Moeda R$ fixa, negócio real é em Guaraníes | Decisão | Bloco 2.E.4 |
| 4 | Chave PIX configurada nunca usada nas cobranças | Decisão | Epic 4.4.2 |
| 5 | Isolamento multi-tenant não existe (`tenantId` sem uso) | Arquitetura | **É a Fase 2 inteira** |
| 6 | "Cadastrar Novo Usuário" não cria login real | Decisão | Bloco 2.D.3 |
| 7 | Upload de documentos não alimenta a IA de verdade | Decisão | Bloco 2.F (P-3) — fora de escopo por ora |
| 8 | Evo Hub real nunca validado ponta-a-ponta | Ação sua | Epic 1.1.9 |
| 9 | Conexão do Google Calendar ainda não autorizada | Ação sua | Epic 4.3.3 — ✅ Resolvido 06/08/2026 |
| 10 | CRM/Financeiro/SaaS Admin/CAPI continuam mock | Arquitetura | Bloco 2.E |

---

## Backlog consolidado — próximos 15 passos (ordem de implementação)

| # | ID | Issue | Fase | P | Esforço | Status |
|---|---|---|---|---|---|---|
| 1 | 0.1.7 | Decisão + ação: `DEMO_MODE` em produção | 0 | P0 🔴 | S | Decidido — falta ação sua (criar operador) |
| 2 | 2.A.1 | Migrations Supabase: tenants, operators, credenciais | 2 | P0 | M | ✅ Código pronto |
| 3 | 2.A.2 | RLS por `tenant_id` | 2 | P0 | M | ✅ Código pronto |
| 4 | 2.A.3 | Migrar os 8 serviços pra Postgres com `tenant_id` | 2 | P0 | L | ✅ Código pronto |
| 5 | 2.A.4 | Migrar dados reais da Monique sem perder histórico | 2 | P0 | S | ✅ Script pronto — falta você rodar |
| 6 | 2.B.1–2.B.3 | Webhook resolve tenant pelo `phone_number_id`, credenciais por request | 2 | P0 | L | Próximo bloco de código |
| 7 | 2.C.1–2.C.2 | Google Calendar por tenant | 2 | P0 | M |
| 8 | 2.D.1–2.D.2 | Login real Supabase Auth + RBAC | 2 | P0 | M |
| 9 | 2.D.4–2.D.5 | Onboarding manual de cliente novo (admin cadastra credenciais) | 2 | P0 | M |
| 10 | 2.E.1–2.E.3 | TanStack Query + CRM/Financeiro/Atribuição via API real | 2 | P0 | L |
| 11 | 4.3.3 | Ação: conectar o Google Calendar real da Monique | 4 | P0 | XS |
| 12 | 1.1.9 | Ação: validar Evo Hub real ponta-a-ponta | 1 | P0 | M |
| 13 | 4.4.1 | Decisão: provedor de pagamento | 4 | P0 | — |
| 14 | 5.2.1–5.2.3 | Testes + CI (crítico assim que houver 2+ tenants reais) | 5 | P1 | M |
| 15 | 5.3.1 | Logging estruturado por tenant | 5 | P1 | S |

**Legenda esforço:** XS = ≤2h · S = ≤1d · M = 2–5d · L = 1–2 sem

## Dependências entre fases (atualizado)

```
Fase 0 (segurança) ✅
    │
    ▼
Fase 1 (webhook → transcrição → resposta automática) ✅ quase completa
    │
    ▼
Fase 2 (multi-tenant real) ★ ATIVA — Blocos 2.A → 2.B → 2.C → 2.D → 2.E, nessa ordem
    │
    ├──► Fase 3 (refactor de componentes) — pode rodar em paralelo no fim da Fase 2
    │
    └──► Fase 4 (integrações reais + pagamentos) ──► depende de tenants reais no DB
              │
              ▼
         Fase 5 (escala + CI + observabilidade por tenant)
```

## Riscos e mitigações (atualizado)

| Risco | Impacto | Mitigação |
|---|---|---|
| Migração de dados reais da Monique perde histórico de conversas | Alto | Script de export/import testado antes de migrar (2.A.4); manter o JSON atual como backup até confirmar |
| Escopo da Fase 2 é grande — pode atrasar o cliente novo esperando | Alto | Onboarding manual (2.D.4) primeiro, sem esperar self-service completo — cliente novo pode entrar assim que Blocos 2.A–2.D estiverem prontos, mesmo sem 2.E terminado |
| Custo Gemini descontrolado com mais tenants | Alto | Rate limit por tenant (não só por IP) — adicionar ao Epic 0.1.3 |
| Meta API muda formato | Médio | Parsers isolados + testes fixture |
| `DEMO_MODE` ligado por engano após virar multi-tenant real | Alto | Resolver item 0.1.7 antes de onboarding do segundo cliente |
| Decisão de moeda/pagamento adiada indefinidamente | Médio | Travar decisão (4.4.1, P-2) antes de fechar o segundo cliente pagante |

## Próximo passo imediato

1. **Ação sua (destrava tudo o resto do Bloco 2.A em produção):** aplicar a migration SQL no
   Supabase, rodar `npm run migrate:legacy-data` e `npm run create:operator` — passo a passo
   no Bloco 2.A acima.
2. **2.B** — roteamento multi-canal (webhook resolve o tenant pelo `phone_number_id`) é o
   próximo bloco de código, assim que 2.A estiver aplicado em produção.
3. **1.1.9** — ação sua: validar o Evo Hub real ponta-a-ponta (Google Calendar já resolvido).
4. **P-1** e **4.4.1** — preciso confirmar se os valores de plano são PYG ou BRL, e da decisão
   de provedor de pagamento, antes de tocar na tela de planos.

**Definition of Done Fase 2:** um segundo tenant real (o cliente da reunião de hoje) operando
no mesmo backend da Monique, com WhatsApp, agenda e login próprios, sem nenhum dado visível
entre os dois.

## Template de issue (GitHub)

```markdown
## Contexto
[Epic X.Y — link]
## Problema
...
## Solução proposta
...
## Critérios de aceite
- [ ] ...
- [ ] ...
## Fora de escopo
...
## Estimativa
S | M | L
## Dependências
- bloqueado por: #
- desbloqueia: #
```
