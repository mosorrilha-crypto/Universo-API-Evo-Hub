# Guia do Projeto — Universo (fonte única de verdade)

> **Leia este documento primeiro, sempre.** Ele existe porque sessões de trabalho (humanas ou
> de IA) começam do zero com frequência, e os outros docs em `docs/` são snapshots de um
> momento específico — ficam desatualizados e nunca são o lugar certo pra confirmar "o que
> está pronto hoje". Este arquivo é o único que se compromete a refletir o estado real do
> código no momento da última revisão abaixo. Se algo aqui contradiz outro doc, este vence.
>
> **Última auditoria (comparado linha a linha com o código real):** 2026-08-19.
> **Como manter isso confiável:** depois de qualquer mudança estrutural (nova fase concluída,
> gap novo descoberto, decisão de arquitetura), atualize a seção relevante aqui na mesma PR —
> não deixe pra uma "sessão de documentação" depois, ela nunca vem.

## O que é o produto

SaaS multi-tenant de agente de IA pra WhatsApp: cada tenant (negócio) tem um agente Gemini que
responde leads reais, agenda compromissos no Google Calendar de verdade, e acompanha
pagamento/CRM. **Está em produção com um tenant pagante real** (um studio de beleza) recebendo
mensagens reais de clientes — qualquer mudança no caminho mensagem/agendamento/pagamento exige
cuidado extra (ver `CLAUDE.md` na raiz pra convenções de código e comandos).

## Arquitetura em uma tela

```
WhatsApp (Meta Cloud API / Evolution API)
        │  webhook
        ▼
server/routes/webhooks.ts ──► tenantResolver.ts (resolve tenant por phone_number_id, real DB)
        │
        ▼
server/services/autoReply.ts
        ├─ messageBuffer.ts    (agrupa rajada de mensagens, 6s, com recovery persistido)
        ├─ router Gemini/Groq  (classifica: triagem | faq | agendamento | reclamacao)
        └─ especialista Gemini (systemInstruction cacheado por tenant = Camada 1+3;
                                  contents dinâmico = Camada 4 + histórico + mensagem atual)
                │
                ├─ Google Calendar real (function calling, por tenant, tokens em DB)
                ├─ knowledgeBaseStore (jsonb por tenant)
                └─ conversationStore (Postgres, tenant_id obrigatório)

Frontend: React+Vite (src/App.tsx) ──► apiFetch real pra maioria das telas
                                    └─ SSE (/api/conversations/stream) pra atualização ao vivo
```

Todo tenant-scoped route resolve `tenantId` do JWT (`req.user.tenantId`), nunca de
body/query — ver `server/services/tenantContext.ts` e `server/middleware/rbac.ts`
(`operator < manager < admin < saas_admin`).

## Estado real por área (auditado em 2026-08-19)

| Área | Status | Detalhe |
|---|---|---|
| Schema multi-tenant (`tenants`, `operators`) | ✅ Feito | 36 migrations reais em `supabase/migrations/` |
| RLS (Row Level Security) | ⚠️ Parcial | Policies existem (13 `create policy`), mas o backend usa a service key (bypassa RLS) — o isolamento real hoje é feito por `tenantId` obrigatório no código de serviço, não pelo Postgres. RLS é defesa em profundidade, não a barreira ativa. |
| 8 serviços core migrados pra Postgres por `tenant_id` | ✅ Feito | `conversationStore`, `knowledgeBaseStore`, `escalationStore`, `quickRepliesStore`, `agentStatus`, `appointmentStore`, `reminderStore`, `googleCalendar` — nenhum usa mais Map/JSON em memória |
| Roteamento de webhook multi-tenant | ✅ Feito | `tenantResolver.ts` resolve por `phone_number_id`; canal desconhecido descarta a mensagem (fail-closed), nunca cai num tenant default |
| Google Calendar por tenant | ✅ Feito | tokens OAuth em `tenant_calendar_tokens`, não mais env var global |
| Auth real + RBAC | ✅ Feito | login via bcrypt+JWT contra `operators`; `requireRole` ativo em 7 arquivos de rota |
| Onboarding de tenant | ✅ Feito (2 caminhos) | `POST /api/admin/tenants` (saas_admin) além do script CLI antigo |
| Frontend saindo do localStorage | ⚠️ Parcial | `App.tsx` já faz ~21 chamadas reais de API; **`OperatorCRM.tsx` e `FinancialDashboard.tsx` continuam 100% mock em localStorage, zero chamada de API.** `FinancialDashboard.tsx` já tinha um selo "Dados de Exemplo" avisando isso; `OperatorCRM.tsx` não tinha nenhum aviso — corrigido em 19/08/2026 (banner de aviso adicionado). Nenhum dos dois está de fato ligado à API real ainda — o aviso só evita decisão em cima de dado falso sem saber, não resolve o gap de fundo. |
| Idempotência de webhook | ✅ Feito | Postgres (`processed_webhook_messages`), sobrevive restart/multi-instância — **doc antigo dizia "em memória", isso está errado, já foi corrigido no código** |
| Buffer de rajada de mensagens | ✅ Feito, com recovery | Map em memória é o caminho rápido, mas cada rajada é persistida (`pending_message_buffers`) e um sweeper recupera se a instância reiniciar no meio da janela |
| SSE de conversas (`conversationEvents.ts`) | ❌ Gap real | `EventEmitter` em memória, single-instance, não sobrevive restart — só tem um poll de 90s como rede de segurança. Vira problema no dia que escalar horizontalmente. |
| Pagamentos | ❌ Não existe | Nenhum provedor real (Stripe/PIX/etc). Hoje é um campo `payment_status` que um operador humano marca manualmente, com a IA lendo o comprovante só como dica, nunca confirmando sozinha. |
| Observabilidade / error tracking | ❌ Não existe | Só `console.log`/`console.warn` (145 ocorrências em `server/`), zero Sentry/Pino/serviço externo — decisão deliberada de não depender de serviço externo, mas significa que incidentes só aparecem se alguém for procurar nos logs do Render |
| Testes & CI | ✅ Feito | 122 arquivos de teste, `.github/workflows/ci.yml` roda lint+test+build em toda PR |
| Envio real de WhatsApp | ✅ Feito | Meta Cloud API (`metaSend.ts`) e Evolution API (`evolutionSend.ts`) ambos batem em endpoints reais |

## Gaps conhecidos que valem engenharia (priorizados)

1. **SSE single-instance** (`conversationEvents.ts`) — bloqueia escalar horizontalmente sem perder atualização em tempo real pra parte dos usuários. Fix: Postgres `LISTEN/NOTIFY` ou Redis pub/sub.
2. ~~`OperatorCRM.tsx`/`FinancialDashboard.tsx` mockados sem aviso~~ — **badge de aviso aplicado em 19/08/2026 nos dois** (`FinancialDashboard.tsx` já tinha, `OperatorCRM.tsx` não tinha e recebeu um). Continua pendente o fix completo: ligar os dois às APIs reais que já existem no backend (CRM/leads e transações).
3. **Falta de error tracking** — hoje só se descobre incidente lendo log manualmente (como o esgotamento de billing do Gemini, que já aconteceu mais de uma vez em produção). Fix: alerta ativo (não só log) quando padrões de erro conhecidos aparecem.
4. **RLS não é a barreira real de isolamento** — funciona hoje porque o código de serviço é disciplinado em exigir `tenantId`, mas é uma garantia de processo, não de banco de dados. Vale endurecer pra RLS ser a barreira de fato (não usar service key em queries tenant-scoped), ou aceitar conscientemente o risco documentado.
5. **Pagamento sem provedor real** — bloqueia cobrar cliente novo de forma automática; decisão de produto (qual provedor, PYG/BRL/USD) mais que de engenharia pura.

## Mudanças recentes relevantes (não é auditoria completa, só registro)

**20/08/2026:**
- Fallback determinístico anti-alucinação de horário (`autoReply.ts`) reduzido de 6 pra 3 horários e reformulado — o gate em si (Epic 4.5.7) não mudou, só a frase que ele usa quando dispara.
- **Bug real corrigido:** `reminderJob.ts` mandava o lembrete de agendamento sempre em português, mesmo pra tenants/leads de língua espanhola (a única tenant real hoje é paraguaia) — novo campo `tenants.reminder_language` (migration 0038, default `'es'`) resolve o texto certo por tenant.
- **Bug real corrigido:** `reminderJob.ts` disparava o lembrete "mesmo_dia" assim que a DATA batia com hoje, sem checar a HORA — um agendamento de hoje gerava "Bom dia!" às 00:30. Agora só manda depois do horário de abertura configurado do tenant (fallback 07:00 sem expediente configurado).
- Widget de agenda (`UpcomingEventsPanel.tsx`) ganhou: cor do dia por ocupação (verde/âmbar/vermelho), atalho "+" pra criar agendamento já com a data do dia clicado pré-preenchida, e **remarcar/excluir agendamento direto no painel** — antes só dava pra editar o título do serviço ou marcar como concluído, não existia NENHUM jeito de remarcar horário ou cancelar pelo painel (só recriando/apagando manualmente no Google Calendar). Sem drag-and-drop (avaliado, mas maior risco/esforço pro ganho — ficou só o form inline com data/hora).
- Cadastro manual de agendamento (`ManualAppointmentModal.tsx`) agora mostra só os horários REALMENTE livres (nova rota `GET /api/google-calendar/free-slots`, reaproveitando a mesma lógica de `findWeeklyAvailability`) em vez do operador digitar hora às cegas; e ganhou um campo opcional de "valor recebido" pra quando a cliente transfere um valor diferente do preço do catálogo (`paymentAmountReceived` em `POST .../manual-appointment`, propagado pro registro financeiro automático).
- **Bug real CONFIRMADO (validado ponta a ponta, não só suspeita):** o lembrete de agendamento com botões (`sendWhatsAppInteractiveButtons` em `reminderJob.ts`) usa mensagem livre, não template — só funciona dentro da janela de 24h desde a última mensagem do cliente (regra da própria Meta). Teste real feito ao vivo: enviado pra um número de controle, a Meta devolveu 200 na hora (por isso o log sempre diz "✅ Enviado"), mas ~4min depois chegou um webhook de status `"failed"` (código 131047, "Re-engagement message... more than 24 hours have passed since the customer last replied") — e a mensagem de fato **nunca apareceu no celular** (confirmado pelo dono do produto). `reminderJob.ts` não lê esse webhook de status nenhum, então essa falha é 100% silenciosa hoje — nem operador nem cliente sabem que o lembrete não chegou. `sendWhatsAppInteractiveButtons` agora loga o `wamid` (commit anterior) especificamente pra permitir esse tipo de investigação.
  - **Fix real exige template aprovado** (com botão quick-reply) no lugar da mensagem livre atual — só template funciona fora da janela de 24h. Precisa: (1) dono do produto criar e submeter o template no Meta Business Manager (corpo com `{{1}}` pro horário + 2 botões fixos "Confirmar"/"Reprogramar"), (2) código: `sendWhatsAppTemplateMessage` (`metaSend.ts`) hoje só manda texto, sem suporte a componente de botão — precisa ser estendido; `reminderJob.ts` troca pra essa rota.
  - **Isso NÃO bloqueia mais o item "lista interativa no fluxo de agendamento da IA"** (distinto do lembrete): esse fluxo acontece durante uma conversa em que o cliente acabou de mandar mensagem, então está naturalmente dentro da janela de 24h — não precisa de template, pode usar botão/lista livre como o lembrete tentava fazer.
- **Implementado:** o fallback determinístico anti-alucinação (`autoReply.ts`, oferece horários confirmados quando o modelo cita um horário não confirmado) agora também preenche `AutoReplyResult.quickReplyOptions` (bodyText + até 3 botões, um por horário — já batia com o limite de 3 da própria Meta). `sendBubbles.ts` manda a ÚLTIMA bolha como `interactive/button` de verdade no canal Meta (Evolution/Instagram continuam com o texto puro, sem suporte a esse tipo de mensagem). Quando o cliente toca no botão, `webhookParsers.ts` já tratava isso como texto normal (mesmo pipeline usado pelos botões de lembrete) — nenhuma mudança necessária do lado de entrada. Só cobre o caso do fallback determinístico por enquanto (não o texto livre "normal" do modelo, que não é estruturado o bastante pra virar botão com segurança).

## Docs relacionados (contexto histórico/profundo, não confie neles pro status atual)

- `CLAUDE.md` (raiz) — convenções de código, comandos, e as regras de arquitetura que não mudam com frequência (async error handling, idempotência, multi-tenancy). **Ainda é a referência viva pra "como escrever código aqui"**, só não pra "o que já foi feito".
- `docs/AGENTE-VERTICAL-ARQUITETURA.md` — arquitetura do prompt em camadas do agente (global/tenant/dinâmico). Continua consistente com o código atual, é o doc certo pra entender o design do prompt em detalhe.
- `docs/AGENTE-PROMPT-MONIQUE-CAMPOS.md` — snapshot do conteúdo real do prompt/KB do tenant Monique. É conteúdo editável no painel, não código — sempre reconfirme no Supabase antes de operar em cima dele.
- `docs/PLANO-EVOLUCAO.md` — **histórico de planejamento, desatualizado desde ~06/08/2026.** Descreve "Fase 2 — multi-tenant" como pendente; a auditoria de 19/08 confirma que a maior parte já está feita (ver tabela acima). Mantido só como registro de decisões passadas — não use pra saber o que falta.
- `docs/REVISAO_E_REESTRUTURACAO.md` — **snapshot muito mais antigo, pré-refatoração**, descreve um estado do código (3 backends não integrados, login sem senha real, zero testes) que não existe mais. Mantido só como registro histórico de onde o projeto começou.
