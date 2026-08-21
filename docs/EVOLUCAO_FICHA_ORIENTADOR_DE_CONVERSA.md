# Evolução da Ficha IA — Orientador de Conversa

**Data:** 21 de agosto de 2026  
**Escopo:** Painel de atendimento em WhatsApp, com foco em decisão comercial, revisão humana e segurança operacional.

## Diagnóstico

A ficha anterior concentrava recursos úteis — análise, resposta sugerida, orientação livre, eventos de conversão e perguntas à IA — mas os apresentava como uma sequência de blocos e botões. Em telas estreitas, o atendente via primeiro a ausência de análise, em seguida eventos Meta e depois uma área de instruções genéricas. O contexto que justificava uma decisão ficava disperso ou recolhido. O efeito era uma operação de tentativa e erro: o atendente escolhia um chip, gerava um texto e precisava decidir sozinho se a mensagem fazia sentido, se respondia à dúvida real e se era seguro enviá-la.

> A ficha não deve ser uma coleção de ferramentas de IA. Ela deve funcionar como uma mesa de decisão: mostrar o que fazer agora, por que fazer, o que não prometer e como revisar a mensagem antes de enviá-la.

| Problema anterior | Risco operacional | Evolução aplicada |
|---|---|---|
| “Próxima ação” aparecia como um bloco entre vários outros. | A recomendação perde prioridade visual. | A decisão agora é o primeiro conteúdo de trabalho após o resumo de status. |
| Chips genéricos como “Mais persuasiva” e “Criar urgência real”. | Prompts vagos ou incentivo a urgência sem contexto verificável. | Atalhos descrevem objetivos concretos, como responder à última dúvida, tratar preço sem desconto e preparar agendamento sem prometer horário. |
| A resposta recomendada ficava recolhida. | Mais cliques e menor chance de revisão. | O rascunho recomendado aparece de forma visível, com cópia, tradução sob demanda e ações claras. |
| “Enviar resposta no WhatsApp” era a ação principal. | Mensagem real pode ser disparada sem revisão no compositor. | Foi adicionada a ação **Editar antes de enviar**, que preenche o campo de mensagem sem disparar o WhatsApp. “Enviar agora” permanece explícito e separado. |
| O modelo gerava apenas a ação e a resposta. | O operador não sabia a evidência nem o limite da recomendação. | A análise agora devolve **objetivo**, **justificativa baseada no histórico** e **limite operacional**. |
| CRM, mídias, Meta CAPI e perguntas livres competiam visualmente com a resposta. | Sobrecarga cognitiva no momento de decidir. | Esses recursos permanecem acessíveis em seções secundárias recolhíveis. |

## Nova arquitetura da ficha

A ficha passou a ter quatro níveis de informação, na ordem de uso do atendente.

| Nível | Pergunta respondida | Conteúdo |
|---|---|---|
| 1. Estado | “Em que ponto está esta conversa?” | Etapa do lead, probabilidade e idioma. |
| 2. Decisão | “O que faço agora e por quê?” | Objetivo da ação, evidência do histórico e guarda de segurança. |
| 3. Mensagem | “O que posso revisar e enviar?” | Rascunho recomendado, orientação manual e fluxo de rascunho antes do envio. |
| 4. Contexto | “Quais detalhes sustentam a decisão?” | Síntese, orçamento, prazo, interesses, objeções, tópicos e insights de mídia. |

### Fluxo de trabalho proposto

1. O atendente abre a conversa e vê **etapa, probabilidade e idioma**.
2. A ficha apresenta a **Decisão para agora**, acompanhada da evidência que a motivou e do limite que não pode ser ultrapassado.
3. O rascunho recomendado aparece pronto para leitura. O atendente pode copiá-lo, enviá-lo de modo explícito ou escolher **Editar antes de enviar**.
4. Ao editar antes de enviar, o texto é inserido no compositor do WhatsApp e não cria uma mensagem real. A revisão humana é preservada.
5. Caso queira ajustar a intenção, o atendente escolhe um objetivo comercial ou descreve uma orientação livre. O resultado volta como **rascunho com orientação**, seguindo o mesmo fluxo de revisão.
6. A síntese, os sinais de CRM, a Meta CAPI e as perguntas livres permanecem disponíveis sem disputar atenção com a decisão principal.

## Evolução do prompt de análise

O endpoint de análise agora solicita três campos adicionais.

| Campo | Função na experiência | Regra de qualidade |
|---|---|---|
| `actionObjective` | Explicar o que o atendente deve tentar realizar agora. | Frase curta, específica e iniciada por verbo. |
| `actionRationale` | Mostrar por que a ação faz sentido. | Deve usar somente sinal realmente presente no histórico. |
| `actionGuardrail` | Mostrar o que não pode ser prometido. | Deve explicitar o principal limite de agenda, preço, pagamento, resultado ou política. |

O prompt também reforça que a mensagem pronta deve responder primeiro à última dúvida direta, executar a ação escolhida e encerrar com, no máximo, uma pergunta de continuidade. Se faltar contexto, o modelo deve declarar a lacuna em vez de criar uma solução aparente.

## Ajustes de interface implementados

A implementação foi realizada em `ConversationAnalysisPanel.tsx`, `WhatsAppLeadsSim.tsx`, `server/routes/ai.ts` e no contrato de tipos.

| Elemento | Comportamento implementado |
|---|---|
| Cabeçalho | Renomeado para **Orientador de conversa**, com idioma, momento da análise e atualização manual compacta. |
| Decisão para agora | Mostra ação, motivo e guarda de segurança em um único bloco de alta prioridade. |
| Rascunho recomendado | Exibe a mensagem principal sem colapsar, com cópia, tradução sob demanda e ações de revisão/envio. |
| Rascunho antes do envio | Nova ação que preenche o compositor do WhatsApp e evita disparo automático. |
| Atalhos de orientação | Substitui comandos vagos por intenções comerciais seguras e contextualizáveis. |
| Contexto e sinais | Recolhível, com orçamento, prazo, interesse, objeções, tópicos e mídia. |
| Meta CAPI e IA livre | Mantidos como ferramentas secundárias recolhíveis. |
| Fallback | Recebe objetivo, justificativa e guarda seguros, sem inventar dados de venda. |

## Critérios para avaliação em operação

A melhoria deve ser validada com conversas reais em que o operador revise os rascunhos antes de enviar. O objetivo não é maximizar a quantidade de mensagens geradas, e sim melhorar a qualidade da próxima ação.

| Indicador | Sinal desejado |
|---|---|
| Aderência à última mensagem da cliente | O rascunho responde à pergunta direta antes de propor um avanço. |
| Clareza para o atendente | O operador entende a decisão sem abrir o resumo completo. |
| Segurança comercial | Não há preço, desconto, horário, pagamento ou resultado inventados. |
| Uso de revisão | Operadores usam “Editar antes de enviar” quando precisam ajustar tom ou detalhes. |
| Menos resposta genérica | A orientação livre é usada para complementar contexto, não para corrigir um prompt estruturalmente vago. |
| Conversão válida | Avanços de etapa e reservas acontecem com informações e confirmações reais. |

## Validação técnica

| Verificação | Resultado |
|---|---|
| Checagem de tipos | `npm run lint` aprovado. |
| Teste de fallback de análise | Aprovado, incluindo os novos campos seguros. |
| Build de produção | `npm run build` aprovado. |

## Próximo refinamento recomendado

A próxima evolução deve substituir progressivamente os chips fixos por sugestões contextualizadas a partir da própria análise. Por exemplo, diante de uma objeção de preço, a ficha pode sugerir “Explorar o que torna o investimento difícil agora” em vez de oferecer um rótulo genérico de persuasão. Essa mudança deve vir depois de observar como a nova ficha é usada em conversas reais e quais orientações os atendentes digitam repetidamente.
