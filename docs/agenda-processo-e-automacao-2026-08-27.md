# Agenda — mapa de processos, automações e plano de refinamento

**Data:** 27 de agosto de 2026  
**Escopo:** Agenda operacional do Universo, integração com Google Calendar e vínculo opcional com Financeiro.  
**Objetivo:** reduzir esforço de navegação sem duplicar consultas, quebrar regras de negócio ou transformar automações assistidas em ações automáticas sem controle humano.

## 1. Diagnóstico executivo

A Agenda já possui uma separação mobile entre **Hoje** e **Calendário**, carrega eventos reais do Google Calendar por tenant e permite criar, editar, remarcar, concluir, cancelar e vincular cobranças ao compromisso. O principal problema remanescente é de hierarquia: o mesmo workspace combina criação, calendário mensal, compromissos próximos, estado financeiro e configurações recorrentes. No mobile, isso aumenta a rolagem e torna menos evidente qual é a próxima decisão operacional.

A recomendação é manter a Agenda como um módulo operacional, mas separar claramente quatro contextos: **Hoje**, **Calendário**, **Pendências** e **Configurações**. A primeira entrega deve ser de orientação e compactação. O sistema deve mostrar o próximo atendimento e as pendências que exigem decisão; o calendário mensal e o financeiro entram sob demanda.

## 2. Processo real atual

| Etapa | Entrada | Processamento atual | Saída | Responsável |
|---|---|---|---|---|
| 1. Disponibilidade | Configuração Google Calendar do tenant | O serviço lista eventos do mês selecionado | Eventos reais por período | Sistema |
| 2. Reserva | Lead/telefone, serviço, data, horário e valor opcional | Rota de agendamento manual cria evento e pode vincular cobrança pendente | Compromisso criado e evento sincronizado | Operador ou agente |
| 3. Confirmação | Evento existente | Cliente pode confirmar pelo fluxo de atendimento; operador pode editar o evento | Estado de confirmação/compromisso | Cliente e sistema |
| 4. Operação | Evento futuro ou do dia | Operador conclui, edita, remarca ou cancela | Agenda atualizada | Operador |
| 5. Cobrança | Evento com ou sem pagamento | O operador vincula ou atualiza a cobrança sem criar lançamento duplicado | Status financeiro do agendamento | Operador |
| 6. Pós-atendimento | Evento concluído | O estado do evento é preservado e pode alimentar acompanhamento | Histórico operacional | Sistema e operador |

O fluxo deve ser tratado como uma máquina de estados simples: **disponível → reservado → aguardando confirmação/pagamento → confirmado → atendido → concluído**, com saídas controladas para **remarcado**, **cancelado** ou **expirado**. A interface não deve inferir confirmação apenas porque existe um evento; confirmação, pagamento e conclusão são estados diferentes.

## 3. Automações existentes e limites

| Automação | Estado | Gatilho | Ação | Proteção necessária |
|---|---|---|---|---|
| Sincronização de eventos | Implementada | Entrada na Agenda ou troca de mês | Consulta eventos reais do Google Calendar | Estado de carregamento, erro e retry explícito |
| Criação de agendamento | Implementada | Envio do formulário | Cria compromisso pelo telefone do lead ou telefone informado | Não criar sem telefone; respeitar tenant e validação de data |
| Vínculo de cobrança | Implementada | Ação do operador no evento | Cria/atualiza pagamento do próprio evento | Não gerar lançamento financeiro duplicado |
| Conclusão do atendimento | Implementada | Ação manual | Marca evento como concluído | Feedback de sucesso/falha e possibilidade de reabertura |
| Lembrete prévio | Implementada fora da tela | Job periódico para eventos com telefone associado | Envia template WhatsApp na véspera e no dia | Deduplicação por tenant/evento/tipo; respeitar janela e template aprovado |
| Expiração de reserva sem pagamento | Implementada fora da tela | Job periódico | Identifica reservas pendentes conforme regra do sistema | Não liberar horário sem regra explícita e log auditável |
| Follow-up de pré-reserva | Assistida/limitada | Fluxo conversacional e data combinada | Orienta o agente; não deve liberar horário sozinho | Decisão humana quando pagamento não ocorre |
| Cobrança automática | Não recomendar nesta etapa | — | Não implementar disparo ou baixa automática | Exigir confirmação humana e trilha de auditoria |
| Remarcação automática | Não implementada | — | Não inferir novo horário | Operador ou cliente deve escolher novo horário |

As automações periódicas devem continuar no backend e não ser reimplementadas dentro do componente visual. A Agenda precisa expor apenas o estado operacional: sincronizado, sincronizando, erro de sincronização, pagamento pendente e ação humana necessária.

## 4. Arquitetura de navegação recomendada

A navegação interna deve ter quatro destinos, com **Hoje** como entrada padrão:

| Seção | Conteúdo | O que fica oculto |
|---|---|---|
| **Hoje** | Atendimentos de hoje, próximo compromisso, pendências de confirmação/pagamento e CTA de novo agendamento | Grade mensal, histórico financeiro completo e recorrências |
| **Calendário** | Mês, data selecionada e eventos do dia | Indicadores extensos e configurações financeiras |
| **Pendências** | Eventos sem confirmação/pagamento, erros de sincronização e reservas que exigem decisão | Grade mensal e formulários não relacionados |
| **Configurações** | Integração, recorrências e preferências da Agenda | Fila operacional e detalhes dos eventos |

No desktop, o calendário pode usar duas colunas, mas o conteúdo operacional deve continuar com uma ação dominante. No mobile, cada seção deve ocupar o viewport com uma fila curta; a rolagem deve acontecer dentro de listas quando necessário, não por uma sequência longa de hero, métricas, calendário e financeiro.

## 5. Prioridade objetiva da fila Pendências

A fila deve ordenar os itens por risco e proximidade, não apenas por data de criação:

1. **Erro de sincronização** que impede visualizar ou atualizar a agenda.
2. **Atendimento de hoje sem confirmação de cobrança**, quando o módulo financeiro estiver habilitado.
3. **Reserva sem confirmação ou pagamento próximo do horário**, sem liberar o horário automaticamente.
4. **Compromisso futuro sem confirmação**, ordenado pelo início mais próximo.
5. **Evento concluído com cobrança ainda aberta**, para revisão pós-atendimento.
6. **Configuração ausente**, como agenda desconectada ou serviço sem duração/preço, apenas quando bloquear uma ação.

Cada item deve exibir origem, horário, cliente quando disponível, estado financeiro e uma ação primária. O clique deve abrir o evento ou o contexto correto; nenhuma mudança de estado deve ocorrer somente ao abrir o item.

## 6. Fontes de dados e contratos

A fonte de eventos é a rota de eventos futuros/mensais do Google Calendar, consumida por `AgendaFinanceiroCenter`. A criação manual usa o fluxo de atendimento associado ao telefone e pode incluir valor para gerar cobrança pendente. As transações financeiras entram por `transactions` e são resumidas por `summarizeFinancialTransactions`; não devem ser recarregadas apenas para montar a fila.

O isolamento deve continuar sendo feito no backend pelos tokens e pelo tenant autenticado. O frontend não deve aceitar um `tenant_id` arbitrário para buscar eventos ou cobranças. Falhas devem ser tratadas como estado explícito, nunca como agenda vazia silenciosa.

## 7. Escopo recomendado para a próxima alteração

A próxima implementação deve ser uma fatia vertical pequena: consolidar o menu interno **Hoje / Calendário / Pendências / Configurações**, mover a fila de decisão para Hoje/Pendências, reduzir o hero e os indicadores, e reutilizar os dados já carregados. O trabalho não deve introduzir novos jobs, envio automático, liberação automática de horários, baixa financeira automática ou alterações de contrato externo.

Os testes devem cobrir a seção inicial, a alternância de menu, a ordem da fila, estado vazio, erro de sincronização, abertura do contexto correto e preservação das ações de criar, concluir, remarcar, cancelar e vincular cobrança.

## 8. Critérios de aceite

| Critério | Resultado esperado |
|---|---|
| Entrada mobile | Hoje aparece primeiro e mostra a próxima ação sem exigir rolagem longa |
| Menu | Hoje, Calendário, Pendências e Configurações alternam sem duplicar consultas |
| Fila | Pendências respeita a ordem objetiva e identifica a fonte do item |
| Contexto | Um clique abre o evento/lead/financeiro correto |
| Segurança | Nenhuma ação crítica é persistida sem interação explícita e retorno de sucesso/falha |
| Sincronização | O usuário diferencia carregando, sincronizado, erro e vazio real |
| Financeiro | Cobrança permanece opcional por tenant e não gera duplicidade |
| Mobile | Conteúdo principal não depende de tabela horizontal nem de cards gigantes |
| Regressão | Google Calendar, lembretes, conclusão, cancelamento e remarcação continuam funcionando |

## 9. Decisão de produto

A Agenda deve ser tratada como uma **fila operacional contextual**, não como um dashboard financeiro com calendário anexado. A evolução recomendada é tornar a próxima decisão visível, reduzir a superfície inicial e preservar automações existentes com logs, deduplicação e decisão humana nos pontos irreversíveis. Depois dessa etapa, entrevistas curtas com operadores devem validar se a fila realmente reduz o tempo para encontrar o próximo atendimento.

## Referências internas

- `src/components/AgendaWorkspace.tsx`
- `src/components/AgendaFinanceiroCenter.tsx`
- `src/App.tsx`
- `server/services/googleCalendar.ts`
- `server/services/reminderJob.ts`
- `server/services/reminderStore.ts`
- `server/services/heldAppointmentExpiryJob.ts`
- `server/routes/conversations.ts`
- `server/services/globalPromptStore.ts`
