# Agenda — refinamento operacional e mobile

A Agenda já possuía uma separação inicial entre Hoje e Calendário no mobile, mas o workspace ainda apresentava calendário, próximos compromissos, ações de atendimento e cobrança dentro da mesma composição. O refinamento adiciona uma terceira visão interna: **Pendências**.

| Visão | Conteúdo exibido | Benefício |
| --- | --- | --- |
| Hoje | Próximos atendimentos e ações operacionais | Entrada rápida para a rotina do dia. |
| Calendário | Navegação mensal e criação de compromisso por data | Consulta de disponibilidade sem disputar espaço com a fila operacional. |
| Pendências | Próximos agendamentos sem cobrança confirmada | Foco direto em registros que exigem ação financeira. |

A nova visão usa o mesmo carregamento de eventos, não cria chamadas adicionais e preserva a integração com o Google Calendar. Os cards continuam permitindo editar, concluir, cancelar e vincular cobrança. O filtro de Pendências considera eventos futuros não concluídos cujo pagamento não está marcado como `pago`.

Também foi melhorada a semântica de navegação: a aba ativa usa `aria-current="page"`, o menu continua acessível no mobile e a regra responsiva oculta apenas a coluna que não pertence à visão selecionada. O desktop permanece com o calendário e os próximos compromissos lado a lado.

A validação local passou em TypeScript, nos três testes da `AgendaWorkspace`, na suíte completa com 204 arquivos e 1.050 testes e no build de produção. O warning de configuração nativa do Vite e o alerta de chunk grande já existentes permanecem informativos e não bloqueiam a compilação.
