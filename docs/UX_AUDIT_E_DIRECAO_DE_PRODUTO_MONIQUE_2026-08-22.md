# Auditoria de Experiência e Direção de Produto — Monique Sorrilha Beauty Studio

**Data:** 22 de agosto de 2026  
**Base da auditoria:** telas reais de Atendimento WhatsApp, CRM, Agenda & Financeiro, Meta CAPI/Central de Tráfego e Base de Conhecimento, além da estrutura de navegação do produto.

## Diagnóstico executivo

A plataforma possui funcionalidades relevantes e maduras, mas a experiência atual se apresenta como um conjunto de telas técnicas conectadas por abas. O produto entrega capacidade operacional, porém ainda não comunica uma jornada única para quem administra atendimento, vendas, agenda e aquisição. A evolução recomendada é transformar as telas em uma **Central de Operação Comercial**: uma interface que priorize as decisões do dia, reduza deslocamentos entre módulos e revele o detalhe somente quando ele for necessário.

> O objetivo não é remover funcionalidade. É reduzir a carga cognitiva, criar um único caminho de trabalho e fazer cada área parecer parte do mesmo produto premium.

## Achados visuais e de fluxo

| Área observada | O que funciona | Fricção principal | Direção de melhoria |
|---|---|---|---|
| Navegação global | Funções principais já existem e são segmentadas por permissão. | Cabeçalho alto, mais de uma camada de navegação e rolagem horizontal de abas. O usuário precisa interpretar muitos destinos antes de começar a trabalhar. | Um shell fixo com navegação lateral no desktop, menu compacto no mobile e uma única camada de contexto por tela. |
| Atendimento WhatsApp | Lista de conversas, contexto e orientação da IA estão disponíveis no mesmo ambiente. | Três colunas muito densas, barra de atalhos com muitas ações concorrentes e pouca prioridade para o que precisa de decisão humana. | Centralizar a conversa ativa, transformar pendências em fila priorizada e tornar a IA uma copilota contextual recolhível. |
| CRM | O funil visual torna os estágios comerciais compreensíveis. | Kanban amplo exige rolagem horizontal e vertical, cartões contêm informações repetidas e ações ficam dispersas. | Criar visão resumida de pipeline com foco em próxima ação, filtros persistentes e detalhes em painel lateral. |
| Agenda & Financeiro | Calendário e próximos compromissos já se conectam à operação. | A tela concorre com muitos indicadores e divisões; não deixa evidente a ação principal do dia. | Uma agenda operacional que priorize confirmações, pendências de pagamento e próximos horários, com financeiro como camada complementar. |
| Central de Tráfego / Meta CAPI | Dados reais, comparativo de criativos e status de anúncios estão integrados. | Há duplicação de abas no módulo, tabelas extensas e pouca orientação sobre qual decisão tomar. | Um dashboard de crescimento com resumo executivo, alertas acionáveis e detalhe progressivo de campanhas/criativos. |
| Base de Conhecimento | A fonte de verdade do agente é completa e organizada por blocos. | Muitas seções, controles e conteúdo técnico competem visualmente; editar parece uma tarefa de configuração pesada. | Transformar em um centro de treinamento do agente, com progresso, busca, validação e edição guiada por tarefa. |

## Problemas de experiência prioritários

1. **Arquitetura de informação fragmentada.** O mesmo contexto de cliente pode exigir WhatsApp, CRM, Agenda, Financeiro e Escalonamentos, mas cada um opera como destino independente.
2. **Hierarquia visual excessivamente homogênea.** Cards, abas, botões e blocos usam pesos parecidos. Isso dificulta distinguir uma ação urgente de uma informação de apoio.
3. **Densidade inadequada para o trabalho diário.** Tabelas e barras de ação comprimem texto e geram rolagem excessiva, sobretudo em CRM e Atendimento.
4. **Navegação técnica em vez de orientada à tarefa.** O usuário pensa em “responder clientes”, “confirmar pagamentos”, “ver minha agenda” e “acompanhar anúncios”, não em módulos internos como atribuição, CAPI ou qualidade.
5. **Ausência de uma página inicial operacional.** Atendimento abre como entrada correta, mas não há uma visão curta e acionável que reúna pendências, agenda do dia, desempenho comercial e alertas de tráfego.

## Direção de produto premium

A proposta é posicionar a plataforma como uma **Central de Operação de Vendas por WhatsApp**, e não como um painel de integrações. A navegação será orientada às tarefas diárias:

| Novo destino | Promessa para o usuário | Recursos integrados |
|---|---|---|
| Hoje | “O que precisa da minha atenção agora?” | Pendências, comprovantes, escalonamentos, agenda do dia, oportunidades e alertas de campanha. |
| Conversas | “Atendo e fecho sem perder o contexto.” | WhatsApp, ficha comercial, histórico, copilota Ana, próximos passos e pagamento. |
| Vendas | “Acompanho os leads até a conversão.” | Pipeline CRM, tarefas, valor em aberto e origem do lead. |
| Agenda | “Organizo horários e pagamentos com segurança.” | Calendário, confirmações, comprovantes, receita e recebimentos. |
| Crescimento | “Sei onde investir e o que melhorar.” | Central de Tráfego, CAPI, métricas, criativos e recomendações. |
| Configurar | “Mantenho o agente e a operação alinhados.” | Base de Conhecimento, qualidade IA, conexão WhatsApp e permissões. |

## Princípios para a implementação

A experiência final deverá usar um sistema visual único: superfícies claras de leitura, espaços respirados, tipografia com contraste, cards apenas para síntese, tabelas no detalhe e botões com uma ação primária inequívoca. O tom seguirá um produto de operação de alto valor: preciso, calmo, confiável e orientado a resultados, sem estética genérica de dashboard.

A prioridade funcional seguirá esta ordem: **resolver pendências humanas**, **conduzir conversas**, **proteger agenda e pagamento**, **acompanhar conversão**, e só então **configurar tecnologia**. Cada tela terá um objetivo explícito, um resumo do contexto e uma próxima ação destacada.

## Arquitetura de informação proposta

A navegação será simplificada em seis destinos, todos organizados em uma barra lateral persistente no desktop e em um menu de acesso rápido no mobile. Cada destino representará uma intenção de trabalho, não uma tecnologia interna.

| Destino | Ícone conceitual | Conteúdo prioritário | Papéis |
|---|---|---|---|
| Hoje | visão operacional | Pendências, agenda, vendas, crescimento e atalhos de alta prioridade. | Todos, com informações adequadas ao papel. |
| Conversas | atendimento | Caixa de entrada, conversa, ficha da cliente, próximos passos e orientação da IA. | Todos. |
| Vendas | pipeline | Funil CRM, oportunidades e tarefas de acompanhamento. | Todos. |
| Agenda & Caixa | operação | Calendário, confirmações de pagamento, receita e despesas. | Gerente ou superior. |
| Crescimento | aquisição | Central de Tráfego, conversões CAPI, criativos e desempenho. | Administrador ou superior. |
| Configurar | inteligência operacional | Base de conhecimento, qualidade IA e conexões. | Administrador ou superior. |

O painel multi-tenant continua disponível apenas ao perfil SaaS Master, porém como opção secundária do menu de perfil, não como item de trabalho diário. Escalonamentos não serão um módulo isolado; serão tratados como uma fila prioritária dentro de **Hoje** e como atalho contextual em **Conversas**.

## Linguagem visual: Atelier Operations

A direção estética combinará a confiança de um sistema financeiro com a delicadeza de uma marca de beleza premium. A base será grafite profundo e azul-noite, com superfícies de leitura em ardósia; o esmeralda continuará como cor de confirmação e crescimento. Em vez de bordas excessivas, cada área usará contraste de superfície, sombra baixa e uma escala de espaçamento ampla. Um acento violeta suave ficará reservado para inteligência artificial, preservando significado visual.

| Token visual | Decisão |
|---|---|
| Fundo | Azul-noite profundo com gradientes muito sutis, sem ruído visual. |
| Superfícies | Camadas de ardósia com contraste suficiente para separar zonas de trabalho. |
| Cor de ação | Esmeralda para concluir, salvar, responder e avançar vendas. |
| Cor de inteligência | Violeta apenas para análises e sugestões da IA. |
| Estados críticos | Âmbar para revisão humana; rosa para bloqueio, risco ou erro. |
| Tipografia | Hierarquia objetiva, títulos compactos, números grandes para decisão e textos auxiliares discretos. |
| Movimento | Transições curtas em opacidade e transformação, respeitando redução de movimento. |

## Padrões de interação

A página **Hoje** abre como porta de entrada. Ela mostrará o que requer ação humana antes de qualquer indicador: comprovantes, escalonamentos, conversas sem resposta e próximos horários. Os números serão exibidos como contexto, nunca como obstáculo à ação. Cada card terá uma ação clara que leva diretamente ao contexto correto.

Os módulos especializados manterão seus dados e regras atuais, mas entrarão dentro de um shell comum com título de página, explicação curta, ação principal e trilha de contexto. A informação detalhada será revelada em painéis laterais, modais ou seções expansíveis em vez de duplicar barras de navegação no topo.

## Escopo da primeira evolução

A primeira entrega criará o shell premium responsivo, substituirá o cabeçalho por navegação orientada à tarefa, adicionará a Central **Hoje** baseada em dados reais já disponíveis no estado da aplicação e reorganizará o acesso aos módulos existentes. Em seguida, Atendimento, CRM, Agenda & Caixa e Crescimento receberão cabeçalhos e pontos de ação mais claros, preservando toda a lógica de negócio, autorização, agente, agenda, pagamentos e Meta CAPI já validados.

> A implementação não alterará mensagens do agente, preços, regras de pagamento, eventos CAPI ou permissões. Ela reorganizará a experiência que apresenta essas capacidades ao operador.

## Verificação inicial do shell premium

A prévia local confirmou o carregamento da navegação lateral e da Central **Hoje** em desktop. A interface passou a expor apenas os destinos operacionais adequados ao papel visível, reduzindo a navegação principal para **Hoje**, **Conversas** e **Vendas** no contexto de acesso não autenticado. A Central abre com uma fila de prioridade, indicadores de operação e atalhos de rotina, enquanto a autenticação permanece bloqueante e não expõe dados de cliente antes do login.

A inspeção também confirmou que os cards da Central permanecem legíveis em uma viewport de desktop e que o modal de autenticação continua acima da aplicação, preservando o controle de acesso existente. A validação autenticada e dos módulos especializados será realizada após integrar os refinamentos de cada área.
## Validação visual em produção

A versão publicada foi verificada com sessão administrativa ativa. A navegação lateral aparece como uma estrutura única, com os destinos **Hoje**, **Conversas**, **Vendas**, **Agenda & Caixa**, **Crescimento**, **Configurar**, **Qualidade da IA** e **Empresas** — os últimos itens respeitando o papel SaaS Master. A antiga combinação de cabeçalho, abas horizontais e subabas foi removida da entrada do produto.

A Central **Hoje** carregou dados reais já existentes no contexto da empresa ativa, incluindo 175 oportunidades em andamento, e apresentou as ações de rotina em uma hierarquia clara: pendências humanas, leads, próximas ações, recebimentos e atalhos para Conversas, Vendas, Agenda e Crescimento. O layout confirmou boa separação visual entre navegação, resumo executivo, fila inteligente e ações rápidas em desktop.

O resultado atende ao objetivo de converter o produto de um painel de módulos em uma central operacional: a primeira tela comunica o que exige atenção e todos os módulos permanecem acessíveis sem repetição de barras ou navegação horizontal.

## Validação dos fluxos integrados

O acesso a **Conversas** pela barra lateral abriu o atendimento com os controles críticos preservados e reordenados: **Pendências**, assistente da IA, filtro de contatos/anúncios, gatilhos, agenda e opções secundárias. O operador não precisa mais retornar a uma barra de abas superior para encontrar essas ações.

O acesso a **Crescimento** abriu o módulo de métricas reais e confirmou a simplificação de linguagem: os destinos internos passaram a ser **Central de Tráfego**, **Origem dos leads**, **Diagnóstico IA**, **Eventos CAPI** e **Simular entrada UTM**. As ações de análise e configuração continuam acessíveis, sem duplicar a entrada para a Central de Tráfego.
