# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Universo is a multi-tenant WhatsApp AI-agent SaaS: Express + TypeScript backend (Postgres/Supabase), React + Vite frontend, Gemini-powered conversational agent. Tenants get an AI agent that answers WhatsApp leads, books real Google Calendar appointments, and tracks payment/CRM state. **The platform is live in production** with a real paying tenant (a beauty studio) receiving real customer messages — treat anything touching the message/booking/payment path with the care that implies.

Three living docs carry architecture decisions and roadmap state; read them before large changes:
- `docs/AGENTE-VERTICAL-ARQUITETURA.md` — the layered-prompt agent architecture and its rollout plan.
- `docs/PLANO-EVOLUCAO.md` — evolution roadmap and known pending items.
- `docs/REVISAO_E_REESTRUTURACAO.md` — structural review/restructuring notes.

**Before picking up any task from the backlog, read `.github/WORKFLOW.md`** — how to find work, branch/PR/merge rules (including which areas never self-merge), and status-reporting conventions. GitHub (issues + PRs) is the official work-tracking channel; a prior Trello board was migrated out of use on 2026-08-09.

## Commands

```bash
npm run dev              # tsx server.ts — run the backend directly (no build step)
npm run build             # vite build (frontend) + esbuild bundle of server.ts -> dist/server.cjs
npm start                 # NODE_ENV=production node dist/server.cjs — run the built server
npm run lint               # tsc --noEmit — this is the only lint step, no eslint configured
npm test                  # vitest run — all tests
npx vitest run path/to/file.test.ts        # run a single test file
npx vitest run -t "test name substring"    # run tests matching a name
```

Always run `npm run lint`, `npx vitest run`, and `npm run build` before committing — all three must pass clean.

Data/setup scripts (all `tsx`, run against real Supabase — need `SUPABASE_URL`/`SUPABASE_KEY` in env, service role key not anon):
```bash
npm run seed:monique-kb        # (re)seeds the beauty-studio tenant's knowledge_base row — scripts/seed-monique-knowledge-base.ts
npm run create:tenant          # scripts/create-tenant.ts
npm run create:operator        # scripts/create-operator.ts
npm run migrate:legacy-data    # scripts/migrate-legacy-data.ts
```
Database migrations are hand-written idempotent SQL files under `supabase/migrations/` (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` throughout) — there is no migration runner. They're applied manually via the Supabase SQL Editor.

## Backend architecture

`server.ts` is the entrypoint: builds config, initializes the Supabase client, and mounts one router per domain from `server/routes/` (`auth`, `ai`, `telemetry`, `webhooks`, `metaCapi`, `evoHub`, `conversations`, `googleCalendar`, `admin`). Routes are a thin HTTP layer; real logic lives in `server/services/`.

**Async error handling is load-bearing.** Express 4 does not catch rejected promises from async route handlers — an unhandled rejection crashes the entire Node process (this caused a real production outage). Every async route handler must be wrapped in `asyncHandler` (`server/middleware/asyncHandler.ts`), and `server.ts` mounts a global 4-arg error middleware after all routers as a last-resort catch. `server.ts` also installs process-level `unhandledRejection`/`uncaughtException` handlers that log and never `process.exit`.

**Multi-tenant isolation.** Every tenant-scoped route resolves `tenantId` from the authenticated JWT (`req.user.tenantId`) — never from a client-supplied body/query param, and never with a silent fallback to a default tenant. If `tenantId` is missing from an authenticated session, the correct behavior is to throw/reject, not to fall back (a `LEGACY_DEFAULT_TENANT_ID` constant still exists in `server/services/tenantContext.ts` for a couple of narrow, intentional legacy-fallback cases — e.g. an unsigned Google OAuth callback state — but it should not spread to new code). Inbound webhook messages resolve their tenant by `phone_number_id` (`server/services/tenantResolver.ts`); if a `phone_number_id` doesn't match any registered tenant, the message is discarded rather than written to any tenant — never guess.

**Webhook signature verification is fail-closed.** When an app secret is configured, a missing/invalid `x-hub-signature-256` header must reject the request (403) — never silently skip verification because the header wasn't present.

**The AI agent** (`server/services/autoReply.ts`) is the core: a lightweight Gemini router call classifies each incoming message into an agent type (`triagem` | `faq` | `agendamento` | `reclamacao`) before the more expensive specialist reply is generated. Global/segment prompt layers (fixed, same for every tenant) go in Gemini's `systemInstruction`; tenant knowledge-base content + dynamic context + conversation history go in `contents` — these are never concatenated into one string. The `agendamento` agent uses real Gemini function-calling against Google Calendar (`AGENDAMENTO_TOOLS`: check availability, create/reschedule/cancel, plus `criar_pre_reserva` for a non-binding pre-reservation) — tool results, not model assertions, are the source of truth for what actually happened. After the specialist reply is generated, any time the model cites is validated against what the tools actually confirmed and corrected if it doesn't match (anti-hallucination gate) — this only runs when the calendar tools actually ran during that turn.

**AI fallbacks never fabricate business data.** When a Gemini call fails, the correct fallback is to say the analysis/report is unavailable — never invent plausible-sounding numbers (price, availability, ROAS, CRM analysis). This has been a recurring class of bug; check any new AI-backed endpoint for a fabricating fallback before shipping it.

**Knowledge base** (`server/services/knowledgeBaseStore.ts`) is one jsonb row per tenant (`knowledge_base` table). `AgentProduct` supports both a free-text `price` (always present, used for display/legacy tenants) and optional structured `priceAmount`/`promoPriceAmount`/`currency`/`durationMinutes`/`bookable` fields — `resolveProductPriceAmount()` prefers the structured value and only falls back to parsing `price` as text. `bookable: false` marks a catalog item (e.g. a touch-up service) that the agent must never book directly via `criar_agendamento`.

**Idempotency**: inbound webhook messages are deduped by `message_id` via an in-memory `Set` (`server/services/idempotency.ts`) — not persistent across restarts, not shared across instances (known limitation). If processing a message fails after it's been marked seen, it must be unmarked (`unmarkProcessed`) so the provider's webhook retry can succeed instead of the message being silently lost.

## Frontend architecture

`src/App.tsx` owns most top-level state (tenants, current user, leads, transactions, knowledge base) and persists to `localStorage` as a cache; on load it re-fetches real data from the backend (`/api/conversations`, `/api/knowledge-base`, etc.) and overwrites the cached state. **Not everything is backend-connected yet**: `OperatorCRM.tsx` and `FinancialDashboard.tsx` are currently pure `localStorage`-backed mocks with zero API calls — don't assume a UI surface is wired to real data without checking for an `apiFetch` call. `WhatsAppLeadsSim.tsx` is the real conversation view (polls `/api/conversations`); tabs must stay mounted (CSS `display` toggle, not conditional JSX) or in-memory polled state is lost on remount.

The tenant switcher in `Header.tsx` is restricted to the `saas_admin` role — regular tenant operators only ever see their own tenant's name, no switcher. Note this has always been cosmetic: every real backend route resolves its tenant from the JWT, never from whatever tenant is selected in this UI control.

## Testing conventions

Vitest, colocated in `**/__tests__/*.test.ts`. Backend service tests commonly use `server/services/__tests__/fakeSupabase.ts` (an in-memory fake Supabase client) with `initDb()` from `server/services/db.ts`. For `autoReply.ts` tests specifically: mock dependency modules with `vi.mock(...)` first, then do a top-level `await import('../autoReply')` *after* the mocks (required for the mocks to take effect) rather than a static top-of-file import.
