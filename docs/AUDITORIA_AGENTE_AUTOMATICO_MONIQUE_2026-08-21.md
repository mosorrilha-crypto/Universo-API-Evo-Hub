# Auditoria do Agente Automático — Monique

**Data da análise:** 21 de agosto de 2026  
**Escopo:** agente automático de WhatsApp, painel de continuidade, contexto comercial e conversas do tenant `Monique — Pestañas por Monique`.

## Conclusão executiva

O agente possui uma arquitetura de segurança madura em pontos de alto risco. A entrada é agrupada para evitar respostas a mensagens fragmentadas, o roteamento separa triagem, FAQ, agendamento e reclamação, e há bloqueios determinísticos para horários não confirmados, confirmação prematura de agendamento e concessões não autorizadas. Contudo, a auditoria encontrou uma falha comercial importante: o modelo ainda pode priorizar o contexto antigo, uma oferta anterior ou uma etapa de agenda em vez de responder à pergunta concreta da mensagem mais recente.

> O problema central não é apenas “qualidade de texto”. É uma falha de **prioridade de intenção no turno atual**: perguntas de preço, endereço, duração ou mídia podem ser trocadas por saudação genérica, catálogo ou agenda.

Também foi confirmado o problema informado no painel: **“Marcar como lead de anúncio”** apenas liberava respostas automáticas futuras. A ação não aproveitava o histórico que já estava na conversa, portanto não ajudava o operador a continuar o atendimento no momento em que identifica o lead.

## Evidências da base produtiva

A leitura foi somente consulta, sem alterar mensagens ou cadastro. O recorte abrangeu 170 conversas do tenant ativo.

| Indicador observado | Resultado | Leitura operacional |
|---|---:|---|
| Conversas analisadas | 170 | Base suficiente para identificar padrões recorrentes. |
| Mensagens recebidas de leads | 497 | Volume de entrada usado para o recorte. |
| Mensagens enviadas pela IA | 272 | A automação está ativa em parcela relevante do atendimento. |
| Mensagens enviadas por operador | 231 | Há forte atuação manual em paralelo à IA. |
| Conversas atribuídas a anúncio | 53 | O modo de atribuição de origem é relevante no funil. |
| Perguntas com preço/custo | 37 | Pergunta comercial de maior incidência no recorte. |
| Conversas com IA bloqueada | 19 | Há uma fila significativa que exige retomada humana ou reativação consciente. |
| Turnos sem resposta posterior registrada | 64 | O número inclui silêncios legítimos, tipos de mídia e casos que devem ser investigados como oportunidade de continuidade. |

A métrica de “turnos sem resposta” não deve ser tratada isoladamente como abandono: reações, stickers, conversas bloqueadas e mensagens sem intenção comercial também entram nesse conjunto. Ela é, porém, um bom marcador para a futura fila de retomadas prioritárias.

## Falhas encontradas

| Prioridade | Falha | Evidência observada | Impacto |
|---|---|---|---|
| Crítica | Pergunta atual ignorada | Cliente perguntou a parte de Luque; a IA respondeu sobre Combo Cejas + Labios e preço. | Reduz confiança e aumenta abandono. |
| Crítica | Pergunta dupla incompleta | Mensagem perguntou localização e preço; a IA respondeu somente com disponibilidade. | O lead precisa repetir a pergunta e a conversa perde ritmo. |
| Alta | Preço substituído por triagem | Mensagens como “Y costo” e “Precio para cejas” receberam pergunta genérica de serviço ou saudação. | Falha na intenção de compra mais explícita. |
| Alta | Gatilho manual sem continuidade | “Marcar como lead de anúncio” gravava a liberação, mas esperava a próxima mensagem para agir. | O operador identifica o lead, mas continua sem resposta pronta no momento decisivo. |
| Alta | Resposta para conversa iniciada pelo operador | Foram encontrados contatos que aparentam ser fornecedores/parceiros respondendo a mensagens manuais; a IA os tratou como leads. | Risco reputacional e de respostas indevidas fora do funil. |
| Média | Respostas repetitivas | Foram observados grupos de saudações e perguntas genéricas repetidas. | O atendimento parece automático e pouco contextual. |
| Média | Dados temporais antigos em conversas históricas | Há respostas antigas oferecendo dias específicos que já passaram. | Requer reforço de uso exclusivo da agenda real e monitoramento contínuo. |

## Correções desenvolvidas localmente

### 1. Continuidade contextual no gatilho manual

O item **“Marcar como lead de anúncio”** foi evoluído para **“Ativar IA e preparar rascunho”**. A nova ação faz duas coisas, nesta ordem: grava que o contato está liberado para as próximas respostas automáticas e analisa o histórico já existente. A resposta recomendada é colocada no compositor como rascunho, sem envio automático.

Esse desenho atende ao objetivo comercial sem criar um novo risco de disparo indevido: o atendente revisa, ajusta se necessário e envia conscientemente.

### 2. Prioridade obrigatória para a mensagem atual

O prompt especializado passou a determinar que o modelo responda primeiro às perguntas diretas presentes no turno atual. Ele não pode substituir perguntas sobre preço, localização, duração, procedimento, foto ou vídeo por uma saudação, uma lista de serviços ou convite de agenda.

A regra cobre também perguntas compostas: quando o lead pede preço e localização, ambos devem ser respondidos no mesmo turno. Quando o serviço ainda não estiver claro para calcular preço, a IA faz uma única pergunta curta de esclarecimento em vez de desviar para agenda.

### 3. Resposta honesta a foto e vídeo

O agente agora só pode afirmar que enviou mídia quando a ação de ferramenta confirmar o envio real. Caso não haja material compatível ou ocorra erro, a resposta deve explicar a limitação específica e oferecer a próxima alternativa adequada, sem inventar anexo nem abrir catálogo irrelevante.

### 4. Proteção contra conversas fora do funil

Foi adicionada uma trava no webhook. Quando a primeira mensagem histórica de uma conversa foi enviada manualmente por operador, a automação permanece silenciosa até que o operador marque explicitamente o contato como lead de anúncio. Isso protege conversas com fornecedores, parceiros e contatos pessoais que respondem ao número do estúdio.

## Validação executada

| Validação | Resultado |
|---|---|
| Checagem de tipos | Aprovada. |
| Testes focados de resposta automática | 58 testes aprovados. |
| Teste novo de prioridade de localização e preço | Aprovado. |
| Build de produção | Aprovado. |

## Próximos passos recomendados

A primeira publicação deve ser acompanhada por uma amostra controlada de conversas novas. Recomenda-se monitorar, por sete dias, a proporção de perguntas diretas respondidas no primeiro turno, repetições de perguntas já respondidas, respostas que citam agenda sem consulta real e retomadas deixadas sem ação.

A evolução seguinte é criar uma **fila de continuidade** baseada nos 64 turnos sem resposta posterior: ela deve separar mídia/reação sem ação necessária, conversa bloqueada, mensagem sem intenção comercial e lead comercial com última pergunta não atendida. Assim, o operador não precisa procurar manualmente onde agir.

Por fim, o painel deve manter a distinção explícita entre três ações: **preparar rascunho**, **enviar manualmente** e **reativar automação para as próximas mensagens**. Essa separação preserva controle humano, reduz risco operacional e deixa claro o que o sistema fez em cada etapa.
