# Organização multi-tenant — estrutura comercial e segurança/privacidade de dados dos tenants

> **TASK-0070.** Proposta de organização, não um plano já implementado — confronte com
> `docs/GUIA-DO-PROJETO.md` (estado real do código) antes de agir em cima de qualquer item aqui.
> Pedido direto de chat (regra 5 da issue #290), sem issue própria. Onde este doc contradiz
> `GUIA-DO-PROJETO.md`, o `GUIA-DO-PROJETO.md` vence — ele é a fonte de verdade de status.

## 1. Por que este documento existe

O Universo hoje tem isolamento técnico de tenant (schema, RBAC, resolução de `tenantId` pelo
JWT — ver `CLAUDE.md`), mas **não tem uma estrutura comercial formal** (planos, ciclo de vida,
cobrança) nem **uma política de privacidade de dados pessoais** documentada. Isso importa porque
o produto já processa dados pessoais reais de terceiros que nunca assinaram nada com o Universo:
o cliente final do tenant (quem manda mensagem no WhatsApp). Este documento organiza os dois
problemas juntos porque eles se cruzam: todo tenant novo, todo plano cancelado, toda exclusão de
conta é também um evento de dados pessoais (de quem contrata E de quem conversa com o agente).

## 2. Estado real hoje (auditado no código, 25/08/2026)

| Área | Estado |
|---|---|
| Onboarding de tenant | `POST /api/admin/tenants` (saas_admin) + script CLI `create:tenant` — cria linha em `tenants`, sem plano/limite/cobrança associado (`supabase/migrations/0001_multi_tenant_schema.sql`) |
| Ciclo de vida do tenant | Não existe. Não há status (`trial`/`ativo`/`suspenso`/`cancelado`), não há data de expiração, não há job que suspenda tenant inadimplente |
| Cobrança do próprio SaaS (Universo → tenant) | Não existe nenhuma. É relação comercial fora do sistema (combinado manualmente) |
| Isolamento de dados entre tenants | Disciplina de código: toda rota resolve `tenantId` do JWT (`server/services/tenantContext.ts`), nunca de body/query. **RLS existe mas não é a barreira ativa** — o backend fala com o Postgres via service key do Supabase, que tem `BYPASSRLS` (documentado no cabeçalho de `supabase/migrations/0001_multi_tenant_schema.sql` e no gap #4 do `GUIA-DO-PROJETO.md`) |
| RBAC | `operator < manager < admin < saas_admin` (`server/middleware/rbac.ts`), aplicado em 7 arquivos de rota |
| Dados pessoais de terceiros coletados | Telefone + nome do lead (`conversations`), histórico completo de mensagens de texto/mídia/áudio (`messages`), comprovante de pagamento enviado no chat (`escalations`, kind `payment_proof`), dados de agendamento nome+telefone+serviço (`appointments`), estado de negociação/CRM (`crm_lead_state`), valores financeiros ligados a uma pessoa (`financial_transactions`) — tudo em Postgres/Supabase, sem TTL/expiração |
| Política de privacidade / LGPD / retenção | Não existe nenhuma, nem como texto nem como código. Nenhum menção a LGPD/GDPR encontrada em `server/`, `docs/` (fora de dois docs de tráfego pago que citam o termo de passagem) |
| Log de acesso a dado sensível | Não existe — nenhum log de "quem viu o comprovante de pagamento do lead X" |
| Terceiros que recebem dado pessoal (subprocessadores) | Meta (WhatsApp Cloud API), Google (Calendar + Gemini), Supabase (Postgres), Render (hosting) — nenhum DPA/acordo de processamento documentado no repo |

## 3. Estrutura comercial — proposta

### 3.1 Modelo de tenant como cliente do SaaS

Hoje um tenant nasce e vive indefinidamente sem estado comercial. Proposta mínima, sem
reescrever nada que já funciona:

- **Novo campo `tenants.plan_status`** (`trial | ativo | inadimplente | suspenso | cancelado`),
  `tenants.plan_started_at`, `tenants.plan_renews_at`. Não é gateway de pagamento (fora de
  escopo, ver gap 6 do `GUIA-DO-PROJETO.md`) — é só o **estado**, hoje inexistente até como
  campo, que qualquer decisão comercial futura (cobrar, suspender, alertar) precisa pra existir.
- **`suspenso` é reversível, `cancelado` dispara o relógio de retenção** (seção 4.4) —
  distinção importante: suspender por falta de pagamento não é a mesma decisão que encerrar a
  conta e apagar dado de terceiro.
- Um job leve (mesmo padrão de `agentPausedAlertJob.ts`/`evolutionConnectionAlertJob.ts`) pode
  alertar o `saas_admin` quando `plan_renews_at` vence sem renovação — não decide sozinho,
  só levanta a mão, do mesmo jeito que os outros alertas do projeto já fazem.

### 3.2 Papéis comerciais vs. papéis técnicos

O RBAC atual (`operator/manager/admin/saas_admin`) é só técnico-operacional. Ele já resolve
"quem pode fazer o quê dentro do painel" — não precisa mudar. O que falta é separado disso:
**quem é o responsável comercial e legal por cada tenant** (o contato que assina o contrato,
autoriza tratar dado do cliente final dele, recebe aviso de vazamento). Isso não precisa virar
uma tabela nova agora — pode ser um campo simples (`tenants.legal_contact_email`,
`tenants.legal_contact_name`) que hoje nem tem onde morar, e que a seção 4 usa como destinatário
de notificação de incidente.

### 3.3 Onboarding — o que falta pra deixar de ser manual

`POST /api/admin/tenants` já existe e funciona, mas onboarding comercial completo tem mais
etapas que criação de linha no banco:

1. **Checklist de LGPD no onboarding** (seção 4.3) — hoje zero passo disso existe.
2. **Segmento/plano declarado no cadastro** — `tenants.segment` está "aposentado" desde
   14/08/2026 (virou cosmético, ver #290); reviver como campo de negócio real só faz sentido
   junto com `plan_status` acima, não isoladamente.
3. **Offboarding é o onboarding ao contrário** — hoje não existe rota nem processo pra
   desativar um tenant e não há nenhuma trilha de "esse tenant pediu pra sair, os dados dele e
   dos leads dele seguem X regra". Ver seção 4.4.

## 4. Segurança e privacidade de dados pessoais

Trata dois grupos de dados pessoais, propositalmente separados porque a base legal e o
consentimento de cada um são diferentes:

- **Dado do tenant** (operador, admin) — relação contratual direta, coletada no onboarding.
- **Dado do cliente final do tenant** ("lead", quem manda mensagem no WhatsApp) — o Universo
  processa esse dado **em nome do tenant** (é sub-processador), sem relação contratual direta
  com essa pessoa. É o grupo mais sensível e o que hoje tem zero política formal.

### 4.1 Fechar o gap real de isolamento (RLS)

É o item técnico mais concreto e já está registrado como gap #4 no `GUIA-DO-PROJETO.md` — este
documento não descobre o problema, só o prioriza dentro do quadro de privacidade:

- **Curto prazo (baixo risco, sem mudar arquitetura):** manter a disciplina de código atual
  (obrigatoriedade de `tenantId`, nunca fallback silencioso) e tratar as policies de RLS já
  escritas como *documentação executável* do modelo de dados — continuam certas, só não são a
  barreira ativa hoje.
  - **Uma auditoria automatizada de "toda query em `server/services/*.ts` que lê/escreve tabela
    tenant-scoped inclui `tenant_id` no filtro" fecha a maior parte do risco sem mexer em
    infraestrutura** — um teste/lint dedicado que falha o CI se alguém adicionar uma query nova
    sem esse filtro é mais barato que trocar de role Postgres, e pode ser feito primeiro.
- **Médio prazo (fecha o gap de verdade):** conexão direta com uma role Postgres restrita (sem
  `BYPASSRLS`) para as leituras/escritas tenant-scoped, mantendo a service key só onde
  realmente precisa (migrations, jobs administrativos cross-tenant). É trabalho de
  infraestrutura, não trivial — mas é o único jeito de RLS parar de ser só "pronto e correto,
  mas inerte" e virar a barreira real que o Postgres aplicaria mesmo se o código de serviço
  tivesse um bug.
- **saas_admin cross-tenant é intencional e documentado** (`resolveTenantId` em
  `tenantContext.ts`) — qualquer solução de RLS precisa preservar esse caminho sem reabrir a
  possibilidade de qualquer outro papel usar o mesmo header.

### 4.2 Inventário de dados pessoais (o que existe, onde, de quem)

| Dado | Tabela | Titular | Sensibilidade |
|---|---|---|---|
| Nome, telefone | `conversations` | Lead (cliente final do tenant) | Pessoal |
| Conteúdo de mensagens (texto/áudio/imagem) | `messages` | Lead | Pessoal, pode incluir dado sensível (ex: foto de comprovante bancário) |
| Comprovante de pagamento | `escalations` (kind `payment_proof`) | Lead | Pessoal + financeiro |
| Nome, telefone, horário do serviço | `appointments` | Lead | Pessoal |
| Estado de negociação/CRM | `crm_lead_state` | Lead | Pessoal comercial |
| Valor e status de transação | `financial_transactions` | Lead (associado ao lead) | Financeiro |
| Nome, e-mail, senha (hash) | `operators` | Operador do tenant | Pessoal (relação direta) |
| Telefone de alerta admin | `tenants.admin_alert_phone` | Operador/dono do tenant | Pessoal (relação direta) |

Nenhuma dessas tabelas tem hoje campo de expiração/anonimização. Isso não é um bug de código —
é a ausência completa de uma política de retenção, que é o que a seção 4.4 propõe.

### 4.3 Base legal e consentimento — o ponto mais frágil hoje

O agente inicia conversas automáticas via WhatsApp com pessoas que nunca deram consentimento
explícito ao Universo (deram, no máximo, ao tenant, e mesmo isso raramente é formalizado hoje).
Prioridades concretas, não genéricas:

1. **Aviso de privacidade acessível a partir da primeira mensagem do agente** — hoje a primeira
   mensagem (`autoReply.ts`) não linka nenhum texto de privacidade. Adicionar um link curto (ex:
   `/privacidade` servido como página pública, no mesmo padrão do `/catalogo/:slug` que já
   existe) resolve a lacuna mais visível sem mexer no fluxo de conversa.
2. **Opt-out real e imediato** — se um lead pede "não quero mais receber mensagem", isso hoje
   vira o mesmo fluxo de "pausar atendimento" (`agent_status`) ou simplesmente é ignorado pelo
   roteador de intenção. Precisa virar um estado de dado explícito por lead (não só por tenant),
   e o agente precisa reconhecer esse pedido como uma instrução preventiva, não deixar pra
   heurística do modelo interpretar "não quero mais falar" como reclamação genérica.
3. **Checklist de onboarding do tenant** (ligado à seção 3.3): o tenant que assina o Universo
   precisa confirmar que tem base legal pra tratar o dado dos próprios clientes finais (LGPD
   art. 7º, ou a lei paraguaia equivalente — Ley 6534/2020 de Protección de Datos Personales
   Crediticios cobre só dado creditício, então o enquadramento correto pro Paraguai ainda
   precisa de confirmação jurídica local antes de qualquer texto final ser publicado — não
   travar o resto do plano por isso).

### 4.4 Retenção, exclusão e direito do titular

- **Política de retenção por padrão, não por exceção**: propor um TTL default (ex: 24 meses
  sem interação do lead) que anonimiza (não necessariamente apaga — apagar quebra histórico de
  agendamento/financeiro) nome/telefone nas tabelas da seção 4.2, mantendo o registro financeiro
  agregado. É decisão de produto, não só de engenharia — precisa validação do dono do produto
  antes de virar código, porque afeta o histórico que a Central de Qualidade e o CRM usam hoje.
- **Direito de exclusão sob pedido**: hoje não existe rota nem processo pra um lead pedir "apague
  meus dados" e alguém do tenant conseguir atender isso num prazo razoável. Não precisa ser
  self-service automatizado no primeiro momento — pode começar como um processo manual
  documentado (o operador aciona o saas_admin, que roda uma query/script auditável), desde que
  exista e esteja registrado, em vez de inexistente como hoje.
- **Offboarding de tenant cancelado**: quando `plan_status` vira `cancelado` (seção 3.1), definir
  e documentar o que acontece com o dado dos leads dele — retenção mínima legal (ex: obrigação
  fiscal sobre `financial_transactions`) vs. exclusão do resto. Hoje esse cenário simplesmente
  não foi pensado — a única saída de tenant que já aconteceu no projeto (Evo Hub, 18/08) foi
  remoção de código, não de dado de tenant real.

### 4.5 Log de acesso e resposta a incidente

- **Quem acessou o comprovante de pagamento/dado sensível de um lead** não é logado hoje. Não
  precisa de um sistema de auditoria completo pra começar — um log estruturado simples (quem,
  quando, qual `tenant_id`/`lead_id`) nas rotas que já servem esse dado (`escalations`,
  `conversations`) é suficiente pra ter rastro no dia que precisar investigar.
- **Plano de resposta a incidente** (vazamento de dado): hoje não existe nem o "quem avisa quem".
  Proposta mínima: reusar o padrão de alerta já existente no projeto (`systemErrorAlertService.ts`
  como referência de canal) para notificar o `legal_contact_email` do tenant afetado (seção 3.2)
  e o dono do produto, com um prazo definido (ex: 48h) — não precisa reinventar infraestrutura de
  alerta, o projeto já tem o padrão, só falta o gatilho e o destinatário certos pra esse caso.

## 5. Priorização sugerida (mesmo formato do `GUIA-DO-PROJETO.md`)

1. **P0 — Aviso de privacidade + opt-out real por lead** (4.3.1, 4.3.2): maior exposição de
   confiança/regulatória com menor esforço de engenharia, não depende de decisão de produto
   fora do escopo técnico.
2. **P0 — Auditoria automatizada de `tenant_id` em toda query tenant-scoped** (4.1, curto prazo):
   fecha a maior fatia do risco de isolamento sem mexer em infraestrutura de conexão.
3. **P1 — Log de acesso a dado sensível + plano de resposta a incidente** (4.5): baixo custo de
   implementação, alto valor no dia que precisar.
4. **P1 — `plan_status` + checklist de onboarding LGPD** (3.1, 4.3.3): depende de decisão do
   dono do produto sobre modelo comercial, mas o campo em si é simples.
5. **P2 — Política de retenção/anonimização com TTL** (4.4): decisão de produto primeiro
   (quanto tempo reter, o que agregar antes de anonimizar), implementação depois.
6. **P2 — Role Postgres restrita sem `BYPASSRLS`** (4.1, médio prazo): maior esforço de
   infraestrutura da lista, mas é o único item que fecha o gap de isolamento de fato, não só
   reduz o risco.

## 6. O que este documento não decide

Enquadramento jurídico final (LGPD vs. legislação paraguaia aplicável ao tratamento de dado de
lead, textos de aviso de privacidade, prazo de retenção exato) precisa de validação jurídica
real antes de virar texto publicado ou política operacional — este documento organiza o que
precisa ser decidido e por quem, não substitui essa decisão.
