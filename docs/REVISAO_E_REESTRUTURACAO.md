# Revisão do projeto Universo (WhatsSaaS Pro / Evo Hub) e plano de reestruturação

Este documento resume a revisão feita no repositório (originado no Google AI Studio),
os erros concretos que já foram corrigidos nesta revisão, e um plano de reestruturação
para quem for assumir o projeto de forma sustentável.

## Resumo executivo

O código funciona como protótipo visual (React + Vite + Tailwind, ~12.700 linhas em
`src/`), mas foi montado por geração de IA em cima de **três backends que não conversam
entre si** (Supabase, Firebase e um mock 100% em `localStorage`), tem uma tela de login
que aceita qualquer senha com 4+ caracteres, uma chave de banco de dados com acesso
total exposta no código-fonte, e o build de produção **não compilava** por dependência
faltante. Nada disso é intuito de design — é o padrão típico de apps gerados por IA sem
revisão humana: cada tela foi gerada isoladamente, sem integração real entre elas.

## 🔴 Crítico — segurança (ação sua, fora do código)

- **`server.ts` tinha a `service_role key` do Supabase cravada em texto puro no
  código**, já commitada e enviada ao GitHub (commit `67cac74`, presente em `main` e na
  branch remota). Essa chave dá acesso total ao banco, ignorando RLS. **Ela deve ser
  rotacionada no painel do Supabase (Project Settings → API → Reset service_role key)
  assim que possível** — a correção de código abaixo remove a chave do arquivo, mas não
  invalida a que já vazou.
- O `JWT_SECRET` também tinha um valor padrão hardcoded (`'universo_secret_key_2024'`),
  ou seja, qualquer pessoa que leia o repositório sabia como forjar tokens válidos.

## 🟠 Erros concretos corrigidos nesta revisão

1. **Build de produção quebrado.** `src/lib/googleAuth.ts` e
   `GoogleCalendarIntegration.tsx` importam `firebase/app` e `firebase/auth`, mas o
   pacote `firebase` (SDK de cliente) nunca foi adicionado ao `package.json` — só
   `firebase-admin` (SDK de servidor) estava presente. `npm run build` falhava com
   `Rollup failed to resolve import "firebase/app"`. → Adicionado `firebase` como
   dependência; `tsc --noEmit` e `vite build` agora passam limpos.
2. **Credenciais do Supabase hardcoded** em `server.ts` → movidas para
   `process.env.SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, com falha explícita na
   subida do servidor se não configuradas. `.env.example` atualizado com todas as
   variáveis que o projeto realmente precisa (Supabase, JWT, Firebase, webhook Meta).
3. **`JWT_SECRET` com fallback hardcoded** → agora obrigatória via `.env`, sem valor
   padrão.
4. **`npm start` nunca definia `NODE_ENV=production`**, então o servidor buildado em
   `dist/server.cjs` tentava subir o middleware de desenvolvimento do Vite mesmo em
   "produção" (o `if (process.env.NODE_ENV !== 'production')` em `server.ts` nunca era
   satisfeito). → script corrigido para `NODE_ENV=production node dist/server.cjs`.
5. **`"vite"` duplicado** em `dependencies` e `devDependencies` no `package.json`
   (avisado pelo instalador) → removida a duplicata.
6. **Arquivos mortos removidos**: `untitled.tsx` e `untitled-1.tsx` (vazios, sobras do
   AI Studio), `src/lib/auth.ts` (não importado em lugar nenhum; usava uma API tipo
   Firestore que não existe no projeto, e puxava `bcrypt`/`jsonwebtoken` — pacotes
   Node-only — para dentro de `src/`, o que quebraria o build se algum componente
   chegasse a importá-lo) e `src/lib/whatsapp-integration.ts` (classe `EvoHubIntegration`
   nunca usada; o componente de mesmo nome tem sua própria implementação independente).

Depois dessas correções: `bunx tsc --noEmit`, `vite build` e o bundle do servidor via
`esbuild` rodam sem erro.

## 🟡 Problemas estruturais (decisões de produto — não alterados ainda)

Estes não são "bugs" isolados, são o motivo real de o projeto parecer instável. Corrigir
exige decisão de arquitetura, então não foram tocados nesta revisão:

- **Três sistemas de autenticação/dados que não se conectam:**
  - `server.ts` + Supabase: rota real `/api/auth/login`, com bcrypt e JWT — funcional,
    mas **sem nenhuma tela do app a chamando**.
  - `src/components/Login.tsx`: tela que chama essa rota real — **não é importada em
    lugar nenhum do app** (código morto).
  - `src/components/LoginModal.tsx`: é a tela de login **realmente usada** em
    `App.tsx`, e não fala com o backend — aceita **qualquer senha com 4+ caracteres**
    (`isPasswordValid = validPasswords.includes(...) || password.trim().length >= 4`),
    além de uma lista de senhas fixas (`123456`, `admin123`, etc). Ou seja, a
    autenticação "de verdade" que existe no repo está desconectada; a que está no ar é
    decorativa.
  - Todo o estado de negócio (tenants, leads, transações, base de conhecimento) vive em
    `localStorage` do navegador (`App.tsx`), não no Supabase. Os dados "somem" trocando
    de navegador/dispositivo.
- **Firebase configurado com projeto fictício.** `googleAuth.ts` tem fallback para um
  projeto Firebase inexistente (`monique-studio-crm`, chave `AIzaSyDummyKey...`). A aba
  de Google Calendar não funciona de verdade sem você criar um projeto Firebase real e
  preencher as variáveis `VITE_FIREBASE_*`.
- **Branding/dados de exemplo inconsistentes com o nome do produto.** O app se chama
  "Universo" / "WhatsSaaS Pro" / "Evo Hub" no código, mas o usuário demo padrão e a base
  de conhecimento do agente são "Monique Studio" (`SAAS_DEMO_USERS[0]`,
  `moniqueStudioKnowledgeBase`) — sobra de um projeto-modelo anterior que não foi
  adaptado.
- **Componentes monolíticos.** Vários arquivos de tela passam de 700–1600 linhas
  (`SaaSAdminDashboard.tsx` 1589, `WhatsAppLeadsSim.tsx` 1533, `AdAttributionCAPI.tsx`
  1210, `AgentKnowledgeBase.tsx` 942), misturando estado, chamadas de API simuladas e
  UI no mesmo arquivo — difícil de revisar, testar ou dar manutenção com segurança.
- **Bundle único de 1,1 MB** (aviso do próprio Vite no build) — nenhuma tela usa
  `React.lazy`/code-splitting, então o usuário baixa o dashboard inteiro (CRM,
  financeiro, calendário, atribuição de anúncios etc.) para abrir qualquer aba.
- **Zero testes automatizados** no repositório — qualquer refatoração de verdade
  precisa disso para não regredir.

## Plano de reestruturação (fases)

**Fase 0 — Segurança (você, fora do código):** rotacionar a `service_role key` do
Supabase; se possível, reescrever o histórico do Git para remover o commit com a chave
antiga (força push coordenado) — rotacionar já resolve o risco prático, reescrever
histórico é limpeza adicional.

**Fase 1 — Estabilizar o build (feito nesta revisão):** dependências corretas,
segredos fora do código-fonte, remoção de código morto. ✅

**Fase 2 — Escolher UM backend de verdade.** Hoje há Supabase (Postgres) e Firebase
(Auth) competindo. Recomendo: Supabase como fonte única de dados e autenticação
(já tem tabela `operators`, JWT, RLS), usando Firebase **só** se você realmente quiser
login social do Google para a agenda — caso contrário, dá para trocar o Calendar por
OAuth direto do Google sem depender do Firebase. Depois disso: apagar o caminho morto
(`Login.tsx` real vira o único login, e `LoginModal.tsx` vira apenas seletor de perfil
de demonstração, claramente marcado como "modo demo", nunca como autenticação).

**Fase 3 — Persistir dados reais.** Migrar `tenants`, `leads`, `transactions` e
`knowledgeBase` de `localStorage` para tabelas no Supabase, com endpoints Express
protegidos por `authenticateToken`, substituindo os `useState`+`localStorage` de
`App.tsx` por chamadas de API (`fetch`/React Query).

**Fase 4 — Modularizar telas grandes.** Quebrar os componentes de 700+ linhas em
subcomponentes + hooks de dados (`useLeads`, `useTransactions` etc.), e aplicar
`React.lazy` por aba para reduzir o bundle inicial.

**Fase 5 — Qualidade.** Adicionar testes (Vitest + Testing Library) para os fluxos
críticos (login, CRUD de leads, faturamento), CI no GitHub Actions rodando `tsc
--noEmit`, `vite build` e os testes a cada PR.

## Perguntas em aberto (decisões suas antes de eu avançar)

1. O projeto realmente precisa da integração com Google Calendar/Firebase, ou dá para
   remover essa aba por ora e simplificar (um backend a menos para manter)?
2. Confirma Supabase como banco/autenticação definitivos (em vez de Firestore, que
   aparecia no código morto removido)?
3. Quer que eu já comece a Fase 3 (mover os dados de `localStorage` para o Supabase) ou
   prefere revisar este documento com o time antes?
