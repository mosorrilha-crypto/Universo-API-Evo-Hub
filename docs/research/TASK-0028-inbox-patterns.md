# TASK-0028 — padrões pesquisados para atomização da Central de Atendimento

## Síntese

A pesquisa foi feita em documentação oficial de Intercom, HubSpot, Respond.io, SleekFlow e Zendesk. O padrão consistente é separar o trabalho em três camadas: fila/visão, conversa e contexto/ações. No celular, essa separação deve virar navegação contextual ou seções recolhíveis, não uma longa página com todos os cartões abertos.

| Plataforma | Padrão observado | Aplicação segura no Universo |
|---|---|---|
| Intercom Inbox | Filtros por estado, pesquisa por palavra/tag/usuário/data, views salvas, ações diretas por conversa, preview/contexto lateral e atalhos de ação. | Transformar “Pendências”, “Minhas”, “Todas” e busca em uma barra de fila; manter contexto e ações no contato selecionado; não criar ações em massa sem suporte persistido. |
| HubSpot Help Desk | Workspace central para canais, priorização, triagem, roteamento, sidebar contextual e relatórios; criação e resposta sem sair do workspace. | Manter a conversa no centro e revelar contexto/qualidade da IA sob demanda; evitar duplicar dashboards na tela de atendimento. |
| Respond.io Inbox | Painel lateral com All/Mine/Unassigned/Team/Custom, indicadores de novas conversas e abertas, lista, sidebar vertical de contato/atividades/anexos e ações de atribuir/fechar. | Priorizar filtros de pendências e não respondidas, contexto colapsável e uma ação clara de assumir/encaminhar; usar indicadores genuínos existentes. |
| SleekFlow Inbox | Inbox omnichannel com ownership claro, perfil do cliente ao lado, atribuição, colaboradores, notas internas, resumo/assistência de IA e templates. | Dar destaque à propriedade da conversa, resumo supervisionado e próximo passo; preservar o gate de aprovação antes do envio. |
| Zendesk Agent Workspace | Interface unificada de ticket/canais e painel de apps/contexto; a documentação/comentários também mostram que excesso de caixas coloridas, largura reduzida e ações escondidas geram atrito. | Manter densidade controlada, contraste acessível, largura útil para mensagens e ações visíveis, sem adicionar uma terceira coluna permanente no mobile. |

## Decisões para TASK-0028

1. O topo deve ser um resumo curto da fila: conversas em acompanhamento, pendências humanas, estado da supervisão e empresa ativa.
2. As pendências devem funcionar como filtro/atalho primário e não como um cartão decorativo.
3. A conversa selecionada deve concentrar identificação, status, etiqueta, contexto supervisionado e ações em uma faixa compacta.
4. “Mais opções” deve abrigar ações secundárias sem remover ações de segurança ou aprovação.
5. O contexto deve ser recolhível no mobile e a lista de conversas deve ficar acessível sem ocupar o histórico inteiro.
6. Não implementar atribuição, snooze, colaboração ou views persistidas até confirmar que há estado e endpoint reais para esses recursos.
7. Manter ações de envio protegidas pelo fluxo de aprovação existente.

## Fontes oficiais

- Intercom, “The Inbox explained”: https://www.intercom.com/help/en/articles/6258745-the-inbox-explained
- Intercom, “Get started with Intercom Inbox”: https://www.intercom.com/help/en/articles/6274899-get-started-with-intercom-inbox
- HubSpot, “Set up help desk”: https://knowledge.hubspot.com/help-desk/overview-of-the-help-desk-workspace
- Respond.io, “Getting Started with Inbox”: https://respond.io/help/inbox/getting-started-with-inbox
- Respond.io, “Managing Custom Inboxes”: https://respond.io/help/inbox/managing-custom-inbox
- Respond.io, “Collaborating with your Team in Inbox”: https://respond.io/help/inbox/collaborating-with-your-team-in-inbox
- SleekFlow, “AI Omnichannel Messaging, Call & Email Inbox”: https://sleekflow.io/en-us/inbox
- Zendesk, “About the Zendesk Agent Workspace”: https://support.zendesk.com/hc/en-us/articles/4408821259930-About-the-Zendesk-Agent-Workspace

Data da consulta: 23/08/2026.
