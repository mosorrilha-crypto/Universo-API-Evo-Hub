# Arquitetura do Agente Vertical — Monique + Multi-tenant

> Documento vivo, no mesmo espírito do `docs/PLANO-EVOLUCAO.md`. Nasceu de uma sessão de
> alinhamento em 06/08/2026 entre pesquisa de arquitetura (separação em camadas pra SaaS
> multi-tenant) e o script de vendas/atendimento definitivo da Monique. Consenso alcançado:
> **estratégia e prompt em 9,8/10** — os 0,2 restantes são integrações concretas, não dúvida
> de conteúdo. Este documento é o mapa de como sair do estado atual (prompt monolítico, um
> blob de conhecimento por tenant) pro estado desenhado (camadas separadas + integrações
> reais), sem se perder no meio do caminho.
>
> **Nada deste roadmap (seções 1–4, 6–8) está implementado ainda** — é o projeto antes da
> obra, sob o embargo combinado de "não implementar até consenso 10/10". A única exceção é a
> correção de segurança da seção 5 (fallback de canal desconhecido, PR #39): tratada à parte
> por ser correção de um risco real em produção, não uma feature do agente vertical.

---

## 1. Decisão de arquitetura (consenso)

O agente deixa de ser "um prompt gigante por tenant" e passa a ser montado em **4 camadas**,
nessa ordem, toda vez que uma mensagem chega:

```
1. Prompt Global do Agente       (fixo, nunca muda por tenant/segmento)
2. Regras do Segmento             (fixo por segmento — ex: "beauty_studio")
3. Base do Tenant                 (dado específico da Monique, editável sem tocar prompt)
4. Dados Dinâmicos                (agenda real, status de pagamento — nunca "lembrado", sempre consultado)
5. Histórico da conversa
6. Mensagem atual do cliente
```

**Por que isso importa pra nós especificamente:** hoje (`server/services/autoReply.ts`) tudo
isso é uma string só, concatenada. Funciona pra 1 tenant (Monique) com script curto. Não
escala pra um segundo tenant de outro segmento sem editar código, e não escala pra um
catálogo grande sem estourar o prompt em tamanho/custo/diluição de atenção do modelo.

## 2. Onde cada parte do script da Monique vai morar

Classificação completa das 30 seções do script definitivo (mensagem do dono do produto,
06/08/2026), pra não perder nada na migração:

| Camada | Seções do script | Conteúdo |
|---|---|---|
| **1 — Global** | 2, 4 (mecanismo), 5 (esqueleto), 6, 7, 8, 16, 20 (fluxo), 21 (fluxo), 22, 23 (fluxo), 25 (fluxo/gatilhos genéricos), 28, 29 (regras genéricas) | Prioridade de regras, "responda no idioma do cliente", schema de memória do lead, técnica de primeira resposta/diagnóstico, lidar com objeção de preço, fluxo de pré-reserva/fechamento/follow-up (a estrutura, não o texto específico), nunca fingir escassez, privacidade, regras absolutas genéricas (nunca confirmar pagamento sem verificação, nunca inventar horário) |
| **2 — Segmento `beauty_studio`** | 12, 13, 14, gatilhos de handoff específicos de estética (procedimento anterior, alergia, gravidez, cicatriz) dentro da 25 | Regra de fotos (nunca prometer resultado idêntico, máx. 1 por conversa), dor/conforto (nunca dizer "não dói"), cautela sobre duração de resultado |
| **3 — Base do tenant (Monique)** | 1, 3, 9, 15, 17, 18, 26, 27 | Identidade ("não sou a Monique literalmente"), diferenciais, catálogo completo, preço do retoque (Gs 150.000, confirmado), dados da seña (Gs 50.000, abatida do total, confirmado), alias 5286155, política de cancelamento 24h, cursos só no Brasil, endereço/horário |
| **4 — Dinâmico** | 19 (parcialmente), 22 (parcialmente) | Disponibilidade real da agenda (já existe), status de pagamento/pré-reserva (a construir) |

## 3. Schema da Base do Tenant — de blob único pra documentos tipados

Hoje `knowledge_base.data` é um jsonb único (companyName, agentGoal, toneOfVoice,
businessModel, pricingAndPolicies, products[], businessRules[], faqs[]). Passa a ser
organizado por **tipo de documento**, cada um com seu próprio ciclo de vida (versão, status,
validade) em vez de tudo editado junto:

| document_type | Conteúdo | Novo em relação a hoje |
|---|---|---|
| `business_profile` | Nome, segmento, país, cidade, endereço, Instagram | Ganha campo `segment` (não existe hoje) |
| `brand_voice` | Tom, voseo, vocativos, idiomas permitidos | Estruturado — hoje é texto livre |
| `service_catalog` | Catálogo completo (id, nome, categoria, preço, duração, descrição) | Já existe como `products[]`, ganha `category` |
| `pricing_policies` | Seña, abatimento, retoque, formas de pagamento, cancelamento | Novo — hoje misturado em `pricingAndPolicies` texto livre |
| `opening_hours` | Horário estruturado por dia | Já existe em texto, vira estruturado |
| `faq` | Perguntas frequentes | Já existe |
| `human_handoff_rules` | Gatilhos de encaminhamento (deste tenant, além dos de segmento) | Novo |
| `media_assets` | As 3 fotos de referência + regra de uso | Já existe parcial (`exampleImageBase64` por produto) |

Cada documento carrega `tenant_id`, `version`, `status` (`draft`/`published`), `updated_at`,
`updated_by` — resolve o "editar sem risco" (rascunho vs. publicado) e a auditoria que
faltavam.

**Regra de publicação (fechada em 06/08/2026):** só `admin` ou `saas_admin` publica
(`draft` → `published`) — role já existe no RBAC (Bloco 2.D), não é conceito novo. O agente
sempre lê a versão `published` mais recente **no início de cada resposta**, nunca fixa a
versão pro resto de uma conversa em andamento — evita o cenário "cliente reclama de preço
antigo porque o agente decorou a versão de ontem" se alguém publicar uma correção no meio de
um atendimento.

## 4. As 3 integrações novas pra chegar em 10/10

Confirmado pelo dono do produto: só falta conectar isso ao sistema — o prompt já está pronto.

### 4.1 — Registro de pré-reserva

- Nova tabela `pre_reservations`: `tenant_id, phone, service_name, committed_date, status
  (pending/confirmed/expired/cancelled), created_at`, mais uma chave de idempotência
  (`wa_message_id`, único por `tenant_id`) — sem isso, uma reentrega de webhook da Meta (retry
  por timeout, cenário real e já tratado em outros pontos via `markProcessedIfNew`) duplicaria
  a pré-reserva e a `CRMTask` associada. Entra no schema desde a etapa 1 da implementação
  (seção 7), não como refinamento posterior.
- O agente, ao usar a seção 20 do script, **grava** aqui em vez de só "prometer verbalmente".
- Vira uma `CRMTask` (tipo já existe em `src/types.ts`) com prazo = `committed_date`, visível
  pra **qualquer operador do tenant** (não só quem atendeu).

### 4.2 — Job de follow-up na data combinada

- Mesmo padrão do `server/services/reminderJob.ts` (Bloco 2.C: iterar por tenant), mas em vez
  de mandar mensagem automática pro cliente, **dispara um alerta pro operador** — decisão
  explícita do dono do produto: a IA não confirma pré-reserva sozinha.
- O alerta carrega: contexto da negociação (dados coletados no primeiro contato — objeção,
  serviço de interesse, etc., seção 6 do script), e trecho do histórico da conversa se
  necessário.
- Operador confere disponibilidade real + condições (preço/promoção não mudou) antes de agir.

### 4.3 — Verificação de transferência → confirmação de pagamento

- Hoje: comprovante (imagem) chega, fica salvo (`mediaImageStore`), sem estado nenhum.
- Novo: estado explícito por agendamento — `pending_verification → verified → confirmed`
  (ou `rejected`). Painel do operador marca "verifiquei, bate" → sistema libera a mensagem de
  confirmação de turno (seção 21 do script) — a IA nunca confirma pagamento sozinha, só o
  operador ou uma integração bancária real (fora de escopo por ora).

### 4.4 — Ferramenta nova pro agente: disponibilidade da semana

- Necessária pra seção 22 (escassez real) ser **verdadeira**. Hoje `verificar_disponibilidade`
  só checa um horário específico pedido.
- Nova função-calling tool: retorna os slots livres da semana (respeitando duração do
  serviço), pro agente poder dizer "essa semana só tenho sexta às 9h" com honestidade.
- Decisão do dono do produto: entra no escopo já, mesmo que a seção 22 só seja "ativada"
  depois.

### 4.5 — Tabela de permissão de ferramentas (o que a IA chama direto vs. o que exige aprovação)

Formaliza em um lugar só o que já estava decidido espalhado pelo doc (seções 4.1–4.3):

| Ação | Quem executa | Observação |
|---|---|---|
| Consultar disponibilidade da semana (4.4) | IA, direto | Só leitura |
| Registrar pré-reserva (4.1, rascunho) | IA, direto | Gera `CRMTask`, não confirma nada |
| Enviar lembrete/follow-up na data combinada (4.2) | Bloqueado — só alerta pro operador | IA nunca manda essa mensagem sozinha |
| Marcar comprovante como verificado (4.3) | Bloqueado — só operador | |
| Confirmar agendamento pro cliente (4.3) | Bloqueado — só depois do operador liberar | |
| Editar base de conhecimento (`draft`, seção 3) | `admin`+ | |
| Publicar base de conhecimento (`draft`→`published`, seção 3) | `admin`+ | |

## 5. O que já está pronto — e o que isso realmente significa

- Agenda real via Google Calendar (Bloco 2.C) — dado dinâmico já funciona.
- RBAC (Bloco 2.D) — os alertas de pré-reserva/verificação de pagamento usam a mesma noção de
  papel (operador vê só o próprio tenant, saas_admin vê tudo).
- **Isolamento por tenant (Bloco 2.A/2.B) — reformulado após revisão de segurança de
  06/08/2026.** Não é "RLS ativa protegendo o banco". As policies de RLS existem e estão
  `ENABLE`+`FORCE` no schema, mas o backend fala com o Postgres pela **service key** do
  Supabase (`server.ts` → `initDb(supabase)`), que ignora RLS por design. O isolamento real
  hoje é **disciplina de código**: todo service (`conversationStore`, `knowledgeBaseStore`,
  etc.) exige `tenant_id` como primeiro parâmetro e filtra com `.eq('tenant_id', ...)` em toda
  query. Funciona, mas não tem uma segunda camada no banco pra pegar o erro se um service
  esquecer o filtro — RLS aqui é defesa em profundidade que não está mordendo ainda, não uma
  garantia.
- **Corrigido em 06/08/2026 (PR #39):** o roteamento de webhook por `phone_number_id`
  (`server/services/tenantResolver.ts`) caía no tenant legado (Monique) sempre que o número
  não batia com nenhum `tenant_meta_credentials` cadastrado — incluindo canais totalmente
  desconhecidos. Isso não vazava nada enquanto só existe um tenant real, mas era uma mina
  pronta pra explodir no dia do segundo cliente. Agora só cai no tenant legado quando o número
  é exatamente o número compartilhado configurado (`META_PHONE_NUMBER_ID`, o número real da
  Monique) ou quando não há `phone_number_id` no payload; qualquer outro número não
  reconhecido é descartado como canal desconhecido (`unknownChannel: true`), logado, e **não
  grava em tenant nenhum**.

## 6. Dependência com o Bloco 2.E (CRM real)

O item "histórico do lead" da lista de integrações do dono do produto **é** o Bloco 2.E
(CRM ainda em `localStorage`, não veio pro backend). As tarefas/alertas de pré-reserva (4.1,
4.2) fazem mais sentido nascendo já como parte do CRM real, não como uma tabela solta que
depois precisa ser integrada — **recomendação: fazer 2.E e essas integrações juntos**, não em
sequência separada.

## 7. Ordem de implementação sugerida

```
1. Schema: pre_reservations (com chave de idempotência wa_message_id) + estado de pagamento
   no appointment/CRM
2. Reestruturar knowledge_base em documentos tipados (Seção 3 deste doc)
3. Separar o prompt em camadas (server/services/autoReply.ts deixa de concatenar tudo numa
   string, monta as 4 camadas como mensagens distintas)
4. Escrever o conteúdo real das camadas 1 (global) e 2 (segmento beauty_studio) a partir do
   script — uma vez só, reutilizável pra qualquer tenant/segmento futuro
5. Migrar o conteúdo específico da Monique pra camada 3 (tenant)
6. Ferramenta nova: disponibilidade da semana
7. Job de follow-up de pré-reserva (por tenant, alerta pro operador)
8. Fluxo de verificação de transferência → confirmação de pagamento
9. Bloco 2.E (CRM real) — idealmente junto com 7-8, não depois
```

## 8. Critério de aceite (10/10)

- [ ] Prompt do agente montado em camadas distintas (não é mais uma string concatenada)
- [ ] Um segundo tenant de outro segmento consegue ser configurado só cadastrando dado —
      zero edição de código/prompt
- [ ] Pré-reserva vira tarefa real no CRM, com alerta no prazo certo pro operador certo
- [ ] Reentrega de webhook (mesmo `wa_message_id`) nunca duplica pré-reserva/CRMTask
- [ ] Pagamento só é confirmado após verificação humana explícita, nunca pela IA sozinha
- [ ] Agente consegue responder sobre disponibilidade da semana com dados reais, não estimativa
- [ ] Base de conhecimento da Monique migrada pros documentos tipados, sem perda de conteúdo
- [x] Correção do fallback de canal desconhecido no roteamento de webhook (PR #39) — feito fora
      do embargo de implementação por ser correção de segurança em produção, não feature nova
