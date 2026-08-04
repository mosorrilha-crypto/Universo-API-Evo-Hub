# Plano de Evolução — Transcritor WhatsApp Leads / Universo.ai

> Documento vivo. Última revisão: 2026-08-04.
> Objetivo: sair de canvas/demo (~25% produção) para SaaS operacional em fases incrementais.
>
> Complementar à revisão em `docs/REVISAO_E_REESTRUTURACAO.md` — as duas análises convergem
> nos mesmos problemas centrais (auth fragmentada, segredos hardcoded, localStorage como
> banco, monólito `server.ts`, telemetria fake), o que reforça o diagnóstico.

## Direção estratégica

### Visão (6 meses)

Plataforma multi-tenant onde leads chegam via WhatsApp (Meta Cloud API / Evolution), áudios
são transcritos e analisados por Gemini, operadores gerenciam CRM/financeiro/calendário com
dados persistidos no servidor e isolados por tenant.

### Princípios de evolução

- **Produção primeiro no core** — webhook → transcrição → CRM antes de expandir features secundárias.
- **Uma fonte de verdade** — eliminar localStorage como banco; backend como persistência.
- **Segurança antes de escala** — auth + rate limit nas APIs de IA desde a Fase 1.
- **Entregas verticais** — cada fase entrega valor testável de ponta a ponta.
- **Demo mode explícito** — mocks só com flag `DEMO_MODE=true`, nunca silencioso.

### Stack-alvo (decisões recomendadas)

| Camada | Escolha | Motivo |
|---|---|---|
| Persistência | Supabase (Postgres + RLS) | Já parcialmente integrado; RLS nativo para multi-tenant |
| Auth | Supabase Auth + JWT | Unificar operadores; remover login demo em produção |
| Backend | Express modular → extrair services | Menor refactor que reescrever |
| Estado frontend | TanStack Query + Context mínimo | Cache server-side; eliminar duplicação |
| Fila async | Supabase Edge Functions ou BullMQ + Redis | Processar webhooks/áudio fora do request |
| Observabilidade | Pino + métricas tokens/tenant | Substituir telemetria fake |

## Roadmap por fases

```
Fase 0 ──► Fase 1 ──► Fase 2 ──► Fase 3 ──► Fase 4 ──► Fase 5
Fundação   Core        Dados       UX/CRM      Integrações  Escala
(1-2 sem)  WhatsApp    Persistência Refactor    Meta/CAPI    Prod
           (2-3 sem)   (2-3 sem)    (2 sem)     (2 sem)      (contínuo)
```

---

## Fase 0 — Fundação e segurança

**Duração estimada:** 1–2 semanas
**Objetivo:** tornar o repositório deployável com segurança mínima e base técnica limpa.

### Epic 0.1 — Hardening imediato do backend

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 0.1.1 | Middleware de auth JWT em rotas sensíveis (`/api/transcribe`, `/api/analyze-conversation`, `/api/test-gemini`, `/api/telemetry/*`) | P0 | S | Pendente |
| 0.1.2 | Remover/forçar `JWT_SECRET` em produção (fail fast se ausente) | P0 | XS | ✅ Feito (mesmo padrão aplicado a `META_WEBHOOK_VERIFY_TOKEN` e `EVOHUB_API_KEY`) |
| 0.1.3 | Rate limiting por IP/tenant nas rotas de IA (`express-rate-limit`) | P0 | S | Pendente |
| 0.1.4 | `helmet` + CORS restrito por `APP_URL` | P1 | XS | Pendente |
| 0.1.5 | Reduzir body limit de 50MB para rota específica de transcribe | P1 | XS | Pendente |
| 0.1.6 | Proteger `/api/test-gemini` — só `NODE_ENV=development` ou admin | P1 | XS | Pendente |

**Critério de aceite:** chamada anônima a `/api/transcribe` retorna 401; rate limit dispara após N req/min.

### Epic 0.2 — Modo demo explícito

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 0.2.1 | Criar env `DEMO_MODE=true\|false` | P0 | XS | Pendente |
| 0.2.2 | Fallbacks mock retornam `{ source: 'fallback', success: true }` — nunca fingir Gemini | P0 | S | Pendente |
| 0.2.3 | UI exibe badge "Modo Demo" quando `source !== 'gemini'` | P1 | S | Pendente |
| 0.2.4 | Login demo (LoginModal senhas hardcoded) só funciona se `DEMO_MODE=true` | P0 | S | Pendente |

### Epic 0.3 — Higiene do repositório

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 0.3.1 | Atualizar README (setup, env vars, arquitetura, scripts Windows) | P1 | S | Pendente |
| 0.3.2 | Remover ou arquivar código morto: `Login.tsx`, `auth.ts`, `whatsapp-integration.ts` (ou integrar) | P2 | S | ✅ Parcial (`auth.ts`/`whatsapp-integration.ts` removidos; `Login.tsx` mantido mas ainda não usado em `App.tsx`) |
| 0.3.3 | Remover `firebase-admin` se não usado; resolver `vite` duplicado no `package.json` | P2 | XS | ✅ Parcial (`vite` duplicado já corrigido; `firebase-admin` ainda presente, avaliar se usado) |
| 0.3.4 | Renomear package `"react-example"` → nome do produto | P3 | XS | Pendente |
| 0.3.5 | Script `clean` cross-platform (`rimraf`) | P3 | XS | Pendente |

**Entregável Fase 0:** app deployável com APIs protegidas e demo mode claro.

---

## Fase 1 — Core WhatsApp (pipeline real)

**Duração estimada:** 2–3 semanas
**Objetivo:** webhook recebe mensagem de áudio → transcreve → cria/atualiza lead no CRM.

### Epic 1.1 — Pipeline de webhook

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 1.1.1 | Extrair `services/webhook/` de `server.ts` | P0 | M |
| 1.1.2 | Parser Meta Cloud API: extrair `from`, `type`, `audio.id` | P0 | M |
| 1.1.3 | Parser Evolution API: `MESSAGES_UPSERT` com mídia de áudio | P0 | M |
| 1.1.4 | Download de mídia Meta (Graph API) e Evolution | P0 | L |
| 1.1.5 | Enfileirar job de transcrição (in-memory queue → Fase 2 Redis) | P0 | M |
| 1.1.6 | Corrigir rota `/api/webhooks/evolution_hub` → alinhar com frontend ou redirect | P2 | XS |
| 1.1.7 | Idempotência por `message_id` (evitar reprocessar) | P1 | S |

**Critério de aceite:** POST simulado de áudio WhatsApp cria lead com transcrição real (não TTS).

### Epic 1.2 — Serviço de transcrição robusto

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 1.2.1 | Extrair `services/gemini/transcribe.ts` | P0 | S |
| 1.2.2 | Validar modelos Gemini (`/api/test-gemini`) e fixar modelo estável (ex.: `gemini-2.0-flash`) | P0 | S |
| 1.2.3 | Validar resposta JSON com schema Zod | P1 | S |
| 1.2.4 | Suportar OGG/Opus nativo do WhatsApp (não só TTS) | P0 | M |
| 1.2.5 | Log de tokens por request (input/output) | P1 | S |

### Epic 1.3 — Resposta automática opcional

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 1.3.1 | Após transcrição, gerar `suggestedReply` e enviar via Evo Hub/Meta se tenant configurado | P2 | L |
| 1.3.2 | Respeitar `autoReplyEnabled` e `minUrgencyForAlert` do tenant | P2 | S |

**Entregável Fase 1:** lead entra pelo WhatsApp real e aparece transcrito (via API, ainda sem persistência server).

---

## Fase 2 — Persistência e multi-tenant

**Duração estimada:** 2–3 semanas
**Objetivo:** substituir localStorage por banco; isolamento por tenant.

### Epic 2.1 — Schema Supabase

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 2.1.1 | Definir migrations: `tenants`, `operators`, `leads`, `messages`, `transactions`, `transcripts`, `knowledge_bases` | P0 | M |
| 2.1.2 | Row Level Security por `tenant_id` | P0 | M |
| 2.1.3 | Padronizar IDs tenant (`tenant_001` → UUID ou slug único) | P1 | S |
| 2.1.4 | Seed script para dados demo (substituir mocks TS) | P2 | S |

Schema mínimo sugerido:

- `tenants (id, name, slug, plan, settings jsonb, ...)`
- `operators (id, tenant_id, email, password_hash, role, ...)`
- `leads (id, tenant_id, name, phone, crm_stage, attribution jsonb, ...)`
- `messages (id, lead_id, sender, type, content, media_url, ...)`
- `transcripts (id, lead_id, source, result jsonb, tokens_used, ...)`
- `transactions (id, tenant_id, lead_id, amount, status, ...)`

### Epic 2.2 — API REST de domínio

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 2.2.1 | `GET/POST/PATCH/DELETE /api/leads` com filtro tenant | P0 | M |
| 2.2.2 | `GET/POST /api/leads/:id/messages` | P0 | M |
| 2.2.3 | `GET/POST /api/transcripts` | P0 | S |
| 2.2.4 | `GET/POST/PATCH /api/transactions` | P1 | M |
| 2.2.5 | `GET/PUT /api/tenants/:id/knowledge-base` | P1 | S |
| 2.2.6 | Webhook resolve `tenant_id` via query param ou channel token | P0 | M |

### Epic 2.3 — Migração frontend

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 2.3.1 | Introduzir TanStack Query para leads/transactions | P0 | M |
| 2.3.2 | Remover duplicação de estado em `WhatsAppLeadsSim` — consumir leads do App/API | P0 | M |
| 2.3.3 | Migrar localStorage → API com fallback read-only em demo | P0 | M |
| 2.3.4 | Persistir `savedTranscripts` no backend | P1 | S |

**Critério de aceite:** refresh da página mantém leads; tenant A não vê dados do tenant B.

**Entregável Fase 2:** SaaS com dados reais e isolamento multi-tenant.

---

## Fase 3 — Auth unificada e refactor frontend

**Duração estimada:** 2 semanas
**Objetivo:** um único fluxo de login; componentes menores.

### Epic 3.1 — Autenticação

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 3.1.1 | Unificar em Supabase Auth (email/senha) + JWT para API | P0 | M |
| 3.1.2 | Substituir `LoginModal` demo por login real; demo só em `DEMO_MODE` | P0 | M |
| 3.1.3 | Propagar `Authorization: Bearer` em todos os `fetch` | P0 | S |
| 3.1.4 | RBAC middleware: `operator < manager < admin < saas_admin` | P1 | M |
| 3.1.5 | Consolidar `firebase.ts` + `googleAuth.ts` (Calendar OAuth separado) | P2 | M |

### Epic 3.2 — Decomposição de componentes

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 3.2.1 | Quebrar `WhatsAppLeadsSim.tsx` → `ChatList`, `ChatWindow`, `LeadSidebar`, `QrModal` | P1 | L |
| 3.2.2 | Quebrar `AdAttributionCAPI.tsx` → subcomponentes + hooks | P2 | L |
| 3.2.3 | Quebrar `SaaSAdminDashboard.tsx` | P2 | L |
| 3.2.4 | Integrar ou remover `AudioRecorder`, `FileUpload`, `TranscriptHistory` | P2 | M |

### Epic 3.3 — TypeScript rigoroso

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 3.3.1 | Habilitar `strict: true` incrementalmente | P2 | M |
| 3.3.2 | Eliminar `any` em `server.ts` e props críticas | P2 | M |
| 3.3.3 | Adicionar ESLint + Prettier | P3 | S |

**Entregável Fase 3:** codebase mantível; auth production-grade.

---

## Fase 4 — Integrações reais (Meta, CAPI, Calendar)

**Duração estimada:** 2 semanas
**Objetivo:** substituir simulações por integrações funcionais onde aplicável.

### Epic 4.1 — Meta Conversions API

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 4.1.1 | Implementar envio real para Graph API (`/api/meta-capi/send-event`) | P1 | M |
| 4.1.2 | Hash SHA-256 de phone/email conforme spec Meta | P1 | S |
| 4.1.3 | Persistir eventos CAPI no Supabase (substituir localStorage) | P1 | S |
| 4.1.4 | Auto-disparo em mudança de estágio CRM (`QualifiedLead`, `Purchase`) | P2 | M |

### Epic 4.2 — Evo Hub / WhatsApp outbound

| ID | Issue | Prioridade | Esforço | Status |
|---|---|---|---|---|
| 4.2.1 | Persistir channels/webhooks/templates no Supabase (não in-memory) | P1 | M | Pendente |
| 4.2.2 | `/api/v1/messages/send` chamar Meta Graph API real | P1 | L | Pendente |
| 4.2.3 | Auth Evo Hub: validar tokens contra DB, remover fallback permissivo | P0 | S | ✅ Feito nesta revisão (validação contra `EVOHUB_API_KEY`; ainda falta persistir tokens por canal em vez de uma chave global) |

### Epic 4.3 — Google Calendar

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 4.3.1 | Revisar fluxo OAuth e refresh token | P2 | M |
| 4.3.2 | Vincular eventos a `lead_id` no banco | P2 | S |

**Entregável Fase 4:** integrações críticas operando com APIs reais.

---

## Fase 5 — Escala, observabilidade e produção

**Duração estimada:** contínuo
**Objetivo:** operação confiável em produção.

### Epic 5.1 — Fila e workers

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 5.1.1 | Redis + BullMQ para jobs de transcrição/análise batch | P1 | L |
| 5.1.2 | Retry com backoff; dead letter queue | P1 | M |
| 5.1.3 | Substituir telemetria fake por agregação real de tokens | P1 | M |

### Epic 5.2 — Testes e CI

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 5.2.1 | Vitest: unit tests `services/gemini`, parsers webhook | P1 | M |
| 5.2.2 | Integration tests: `/api/transcribe`, `/api/leads` | P1 | M |
| 5.2.3 | GitHub Actions: lint + test + build em PR | P1 | S |
| 5.2.4 | Smoke test pós-deploy | P2 | S |

### Epic 5.3 — Observabilidade

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 5.3.1 | Logger estruturado (Pino) com `tenant_id`, `request_id` | P1 | S |
| 5.3.2 | Dashboard tokens/custo por tenant (substituir SaaSAdmin fake) | P2 | M |
| 5.3.3 | Alertas: falha webhook, quota Gemini, fila > N | P2 | M |

### Epic 5.4 — Deploy

| ID | Issue | Prioridade | Esforço |
|---|---|---|---|
| 5.4.1 | Dockerfile multi-stage (Vite build + Node server) | P1 | M |
| 5.4.2 | Variáveis de ambiente documentadas + validação no boot (Zod) | P1 | S |
| 5.4.3 | Health check `/health` (DB + Gemini reachable) | P1 | S |

**Entregável Fase 5:** sistema monitorável, testado e escalável.

---

## Backlog consolidado — Top 20 (ordem de implementação)

| # | ID | Issue | Fase | P | Esforço | Status |
|---|---|---|---|---|---|---|
| 1 | 0.1.1 | Auth JWT nas APIs de IA | 0 | P0 | S | Pendente |
| 2 | 0.1.2 | JWT_SECRET obrigatório em prod | 0 | P0 | XS | ✅ Feito |
| 3 | 0.2.2 | Flag `source: fallback` nos mocks | 0 | P0 | S | Pendente |
| 4 | 0.2.4 | Demo login só em DEMO_MODE | 0 | P0 | S | Pendente |
| 5 | 0.1.3 | Rate limiting APIs IA | 0 | P0 | S | Pendente |
| 6 | 1.1.1 | Extrair services de server.ts | 1 | P0 | M | Pendente |
| 7 | 1.1.2–3 | Parsers webhook Meta + Evolution | 1 | P0 | M | Pendente |
| 8 | 1.1.4 | Download mídia áudio WhatsApp | 1 | P0 | L | Pendente |
| 9 | 1.2.2 | Fixar modelo Gemini válido | 1 | P0 | S | Pendente |
| 10 | 1.2.4 | Suporte OGG/Opus real | 1 | P0 | M | Pendente |
| 11 | 2.1.1–2 | Schema Supabase + RLS | 2 | P0 | M | Pendente |
| 12 | 2.2.1–3 | API REST leads/messages/transcripts | 2 | P0 | M | Pendente |
| 13 | 2.2.6 | Tenant resolution no webhook | 2 | P0 | M | Pendente |
| 14 | 2.3.2 | Eliminar estado duplicado leads | 2 | P0 | M | Pendente |
| 15 | 3.1.1–3 | Auth unificada + Bearer token | 3 | P0 | M | Pendente |
| 16 | 4.2.3 | Evo Hub auth real | 4 | P0 | S | ✅ Feito |
| 17 | 4.1.1 | Meta CAPI real | 4 | P1 | M | Pendente |
| 18 | 5.2.1–3 | Testes + CI | 5 | P1 | M | Pendente |
| 19 | 5.1.1 | Fila Redis/BullMQ | 5 | P1 | L | Pendente |
| 20 | 5.3.1 | Logging estruturado | 5 | P1 | S | Pendente |

**Legenda esforço:** XS = ≤2h · S = ≤1d · M = 2–5d · L = 1–2 sem

## Dependências entre fases

```
Fase 0 (segurança)
    │
    ▼
Fase 1 (webhook → transcrição) ──► pode iniciar com leads em memória/JSON
    │
    ▼
Fase 2 (persistência) ──► depende de auth básica (0.1.1)
    │
    ├──► Fase 3 (auth + refactor UI)
    │
    └──► Fase 4 (integrações reais) ──► depende de tenants no DB
              │
              ▼
         Fase 5 (escala + CI)
```

**Paralelizável:** Fase 0.3 (higiene repo) e 3.2 (refactor componentes) podem rodar em
paralelo à Fase 1/2.

## Métricas de sucesso por fase

| Fase | Métrica |
|---|---|
| 0 | 0 endpoints IA públicos; 100% respostas mock identificadas |
| 1 | ≥1 áudio WhatsApp real transcrito end-to-end |
| 2 | 0 dados críticos em localStorage; RLS bloqueia cross-tenant |
| 3 | 1 fluxo login; componentes WhatsApp < 400 linhas cada |
| 4 | CAPI evento real aparece no Events Manager Meta |
| 5 | CI verde; p95 transcribe < 15s; uptime monitorado |

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Custo Gemini descontrolado | Alto | Rate limit + quota/tenant (Fase 0 + 5) |
| Meta API muda formato | Médio | Parsers isolados + testes fixture |
| Scope creep (10 módulos UI) | Alto | Congelar features novas até Fase 2 done |
| Migração localStorage perde dados | Médio | Script export/import JSON (já existe backup) |
| Supabase vs Firebase indecisão | Médio | Decisão: Supabase (documentada acima) |
| ~~Chave service_role do Supabase vazada no Git~~ | ~~Alto~~ | ✅ Resolvido 04/08/2026 — chaves legadas desativadas, migrado para `sb_secret_...` |

## Próximo passo imediato (Sprint 0 — semana 1)

1. **0.1.1** — middleware auth nas rotas IA
2. **0.1.2** — JWT_SECRET required ✅ feito nesta revisão
3. **0.2.2 + 0.2.4** — demo mode explícito
4. **0.1.3** — rate limit
5. **1.1.1** — iniciar extração `server.ts` → `src/server/` ou `services/`

**Definition of Done Sprint 0:** PR merged; README atualizado; deploy staging com env vars;
teste manual 401 em `/api/transcribe` sem token.

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

## Apêndice — Mapeamento deficiência → issue

| Deficiência (análise anterior) | Issues |
|---|---|
| APIs IA sem auth | 0.1.1, 0.1.3 |
| localStorage como DB | 2.1.*, 2.3.* |
| Webhook não processa áudio | 1.1.* |
| Auth fragmentada | 3.1.*, 0.2.4 |
| Fallback mock silencioso | 0.2.2, 0.2.3 |
| Estado duplicado leads | 2.3.2 |
| Monólito server.ts | 1.1.1, 1.2.1 |
| Zero testes | 5.2.* |
| Código morto | 0.3.2, 3.2.4 |
| Multi-tenant só UI | 2.1.2, 2.2.6 |
| Telemetria fake | 5.1.3, 5.3.2 |
| TypeScript permissivo | 3.3.* |
