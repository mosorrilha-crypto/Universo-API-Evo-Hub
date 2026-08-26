# Proposta — Issue #96: Base de Conhecimento em documentos tipados

**Status:** proposta para revisão humana antes de qualquer migration em produção.  
**Rastreabilidade:** TASK-0101 · Issue #96.  
**Escopo:** substituir a edição direta do blob `knowledge_base.data` por documentos tipados, versionados e publicáveis, sem alterar o conteúdo que alimenta o agente durante a transição.

## Decisão arquitetural

Propõe-se uma **tabela genérica versionada**, `knowledge_base_documents`, em vez de uma tabela por tipo. Os oito documentos compartilham o mesmo ciclo de vida — tenant, versão, rascunho/publicação, autor e carimbos de tempo — e usam `data jsonb` com validação em TypeScript por `document_type`. Uma tabela por tipo repetiria índices, RLS, rotas, publicação e auditoria oito vezes, além de tornar a evolução do catálogo mais cara.

| Campo | Regra |
|---|---|
| `id` | UUID do documento. |
| `tenant_id` | Obrigatório, FK para `tenants`, sempre resolvido do JWT nas rotas. |
| `document_type` | Um dos oito tipos fechados: `business_profile`, `brand_voice`, `service_catalog`, `pricing_policies`, `opening_hours`, `faq`, `human_handoff_rules`, `media_assets`. |
| `version` | Inteiro sequencial por tenant e tipo. Nunca é reescrito após publicação. |
| `status` | `draft` ou `published`. Só uma versão publicada por tenant e tipo. |
| `data` | JSON do contrato específico do tipo, validado no serviço antes de persistir. |
| `created_at` / `created_by` | Criação do rascunho. |
| `updated_at` / `updated_by` | Última edição do rascunho. |
| `published_at` / `published_by` | Ato de publicação. |

O histórico de versões preserva o conteúdo completo usado em cada publicação. Um registro complementar `knowledge_base_document_events` guarda eventos mínimos de auditoria (`draft_created`, `draft_updated`, `published`), ator, tipo, versão e timestamp. Assim, a auditoria responde **quem publicou o quê e quando**, enquanto a versão preserva o valor efetivo.

## Contrato inicial dos oito documentos

| Tipo | Dados migrados | Observação de transição |
|---|---|---|
| `business_profile` | `companyName`, `agentGoal`, `businessModel`, `locationMapsUrl` | País, cidade e segmento só entram quando existirem de fato; nenhum dado será inferido. |
| `brand_voice` | `toneOfVoice` | Novos campos estruturados de idioma/voseo serão opcionais. |
| `service_catalog` | `products` completo, incluindo variações, preços, mídia, vídeos e antes/depois | Mantém todas as funções atuais de preço, duração, agendabilidade e mídia. |
| `pricing_policies` | `pricingAndPolicies`, `businessRules` | Preserva regras livres até sua classificação manual; não interpreta texto automaticamente. |
| `opening_hours` | Objeto vazio na primeira migração, quando não existir fonte estruturada | Horários legados continuam em `businessModel`; nada é inventado ou removido. |
| `faq` | `faqs` | Contrato direto. |
| `human_handoff_rules` | Objeto vazio na primeira migração, quando não houver regra explicitamente separada | Não extrairá gatilhos de texto livre sem revisão humana. |
| `media_assets` | `documents`, `firstContactBlocks` | Preserva IDs de Storage e todos os metadados já usados no envio. |

## Migração de dados reais

A migration será **idempotente**. Ela cria as tabelas, índices parciais e RLS com `IF NOT EXISTS`/`DROP POLICY IF EXISTS`; depois lê cada linha existente de `knowledge_base` e insere exatamente oito documentos `published`, versão `1`, somente quando ainda não houver uma versão publicada daquele tenant e tipo. O mapeamento copia os valores existentes sem preenchimento fictício e sem parsear texto livre.

O blob legado não será removido nesta etapa. Ele permanece como rollback e fonte de comparação até a validação pós-publicação de cada tenant, incluindo Monique e Clic Piscinas. A migration será aplicada apenas via `apply_migration` do Supabase MCP e conferida com `list_migrations`.

## Compatibilidade e corte em etapas

| PR | Entrega | Comportamento em produção |
|---|---|---|
| PR 1 | Schema, backfill idempotente, tipos, serviço de composição e testes de equivalência | O agente continua lendo o blob legado; nenhum comportamento muda. |
| PR 2 | Rotas de leitura, edição de rascunho e publicação com RBAC, além de auditoria | Operadores passam a salvar rascunhos tipados; ainda sem troca do runtime. |
| PR 3 | Editor com estado publicado/rascunho e botão de publicação para `admin`/`saas_admin` | A publicação torna a versão visível, sem alterar a conversa em curso. |
| PR 4 | Corte do runtime para documentos publicados e remoção do adaptador de escrita legado | A cada resposta, o agente recompõe a KB a partir das versões `published` vigentes. |

O adaptador `composePublishedKnowledgeBase(tenantId)` devolve o contrato legado `AgentKnowledgeBase` para que `formatKnowledgeBaseForPrompt`, cálculo de preço, duração, agendabilidade, catálogo público, transcrição, vídeos e mídia continuem consumindo uma única estrutura compatível. Durante os PRs 1–3, o adaptador é testado em paralelo ao blob; somente o PR 4 altera a fonte do runtime.

## RBAC, isolamento e qualidade de resposta

Todas as rotas resolvem `tenantId` exclusivamente de `req.user.tenantId`. Operador e manager poderão criar e editar rascunhos do próprio tenant conforme a política atual; somente `admin` e `saas_admin` poderão publicar. A edição nunca atualiza uma versão publicada: ela cria ou atualiza o rascunho seguinte.

O agente chama `composePublishedKnowledgeBase` no início de **cada resposta**. Nenhuma versão é guardada no estado da conversa. Isso garante que uma nova publicação seja usada já no próximo turno, sem fazer o agente responder com conteúdo de rascunho nem ficar preso a preço, catálogo ou regra antiga.

O ganho de qualidade será mensurável por testes de contrato: respostas devem conter apenas dados publicados, preferir preço/duração estruturados, respeitar produto pausado/não agendável e preservar idioma e regras comerciais. Não será criada resposta fictícia para campo ainda não migrado.

## Critérios de aceite e riscos

1. A composição dos oito documentos publicados precisa reproduzir integralmente os campos hoje consumidos pelo agente.
2. Um rascunho de tenant A não pode ser lido, publicado ou listado por tenant B.
3. Publicar uma nova versão muda o contexto no turno seguinte, sem alterar o turno já em execução.
4. Os fluxos de preço, duração, agenda, catálogo, vídeo, mídia e transcrição precisam passar pelos testes existentes e pelos novos testes de equivalência.
5. A migration só será aplicada após revisão humana desta proposta e autorização explícita para alterar o schema e os dados publicados em produção.

> **Ponto de revisão:** a primeira migration afeta a Base de Conhecimento da Monique em produção. A próxima etapa deve confirmar o schema e o plano de corte acima antes de executar DDL ou backfill no Supabase.
