# Arquitetura do Agente Vertical — Monique + Multi-tenant

> Documento vivo, no mesmo espírito do `docs/PLANO-EVOLUCAO.md`. Nasceu de uma sessão de
> alinhamento em 06/08/2026 entre pesquisa de arquitetura (separação em camadas pra SaaS
> multi-tenant) e o script de vendas/atendimento definitivo da Monique. Consenso alcançado:
> **estratégia e prompt em 9,8/10** — os 0,2 restantes são integrações concretas, não dúvida
> de conteúdo. Este documento é o mapa de como sair do estado atual (prompt monolítico, um
> blob de conhecimento por tenant) pro estado desenhado (camadas separadas + integrações
> reais), sem se perder no meio do caminho.
>
> **Nada neste documento está implementado ainda.** É o projeto antes da obra.

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

## 4. As 3 integrações novas pra chegar em 10/10

Confirmado pelo dono do produto: só falta conectar isso ao sistema — o prompt já está pronto.

### 4.1 — Registro de pré-reserva

- Nova tabela `pre_reservations`: `tenant_id, phone, service_name, committed_date, status
  (pending/confirmed/expired/cancelled), created_at`.
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

## 5. O que já está pronto e não muda

- Agenda real via Google Calendar (Bloco 2.C) — dado dinâmico já funciona.
- Isolamento por tenant no banco (Bloco 2.A/2.B) — a base de conhecimento tipada da seção 3
  herda o mesmo padrão (`tenant_id` obrigatório em tudo).
- RBAC (Bloco 2.D) — os alertas de pré-reserva/verificação de pagamento usam a mesma noção de
  papel (operador vê só o próprio tenant, saas_admin vê tudo).

## 6. Dependência com o Bloco 2.E (CRM real)

O item "histórico do lead" da lista de integrações do dono do produto **é** o Bloco 2.E
(CRM ainda em `localStorage`, não veio pro backend). As tarefas/alertas de pré-reserva (4.1,
4.2) fazem mais sentido nascendo já como parte do CRM real, não como uma tabela solta que
depois precisa ser integrada — **recomendação: fazer 2.E e essas integrações juntos**, não em
sequência separada.

## 7. Ordem de implementação sugerida

```
1. Schema: pre_reservations + estado de pagamento no appointment/CRM
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
- [ ] Pagamento só é confirmado após verificação humana explícita, nunca pela IA sozinha
- [ ] Agente consegue responder sobre disponibilidade da semana com dados reais, não estimativa
- [ ] Base de conhecimento da Monique migrada pros documentos tipados, sem perda de conteúdo
