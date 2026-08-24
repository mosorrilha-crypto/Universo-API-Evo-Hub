# Auditoria do modo claro — Universo

## Critério de aceitação

A auditoria considera uma tela aprovada quando cartões, estados vazios, campos, botões, métricas, ícones e descrições mantêm superfície clara, hierarquia de texto visível e cor semântica distinguível no modo claro, incluindo a composição mobile. Nenhum componente pode depender de texto claro sobre fundo claro, de texto apagado por opacidade ou de uma superfície `slate` criada para o tema noturno.

## Escopo de navegação

As abas avaliadas são: Hoje, WhatsApp, CRM, Financeiro, Agenda & Caixa, Empresas, Crescimento, Conhecimento, Catálogo, Pendências/Escalonamentos e Qualidade IA. O inventário técnico inicial identificou uso extenso de superfícies `slate-800`, `slate-900` e `slate-950` nos componentes, o que exige separar os usos que pertencem ao modo escuro dos que ainda vazam para o modo claro.

## Achados já confirmados por captura

| Área | Elemento | Defeito observado | Estado |
| --- | --- | --- | --- |
| Conhecimento | Diagnóstico de completude | Métricas e aviso com texto claro em superfície clara | Corrigido e publicado anteriormente |
| Catálogo | Resumo de operação | Métricas com cartões grafite no modo claro | Corrigido e publicado anteriormente |
| Catálogo | Editor de variantes | Caixa grafite e controles de desconto com baixo contraste | Incluído na correção consolidada atual |
| Hoje | Acessos rápidos | Atalhos em cinza-grafite e texto apagado | Incluído na correção consolidada atual |
| Hoje | Fila inteligente | Item operacional em cinza-grafite e detalhe apagado | Incluído na correção consolidada atual |
| Pendências | Estado vazio de escalonamentos | Cartão grafite com descrição pouco legível | Prioridade alta da auditoria global |

## Próxima etapa

A inspeção seguirá por aba autenticada e por componentes de estado vazio, lista, formulário, card de métrica e ação secundária. Cada correção será associada a uma classe ou token de superfície claro, validada com testes e consolidada antes da publicação.

## Observação de sessão

Durante a recarga com o parâmetro de auditoria, o navegador autenticado exibiu temporariamente uma tela vazia, sem elementos interativos. Esse comportamento já ocorreu durante transições de bundle anteriores e será separado dos defeitos de contraste da interface; a inspeção será retomada com uma recarga limpa após a estabilização da sessão.

| Pendências | Escalonamentos — estado vazio | Área de conteúdo usa fundo grafite e texto de baixo contraste no modo claro | Confirmado na sessão autenticada; prioridade alta |

## Inspeção autenticada por aba

| Aba | Estado observado | Avaliação preliminar |
| --- | --- | --- |
| WhatsApp | Cabeçalho, resumo operacional, filtros e lista de conversas renderizaram no modo claro com leitura operacional preservada. A conversa aberta manteve contraste adequado entre área de contexto e mensagens. | Sem defeito crítico confirmado no primeiro viewport; revisar estados de seleção, ações secundárias e compositor na correção global. |
| CRM | Cabeçalho, métricas, busca e seletor de estágio renderizaram em superfícies claras. O Kanban contém cards de lead densos e pequenos controles por estágio, com risco de contraste em mobile e prioridade de revisão por uso intenso de `slate`. | Revisão de código e de cards de lead necessária antes de aprovar. |
| Pendências | O estado vazio de Escalonamentos confirmou fundo grafite e texto apagado no modo claro. | Correção obrigatória. |

A evidência visual foi coletada na sessão autenticada de produção em `https://universo-api-evo-hub.onrender.com/` no modo claro.

## Causa sistêmica identificada

A interface reutiliza utilitários Tailwind `slate` criados para o tema noturno. A primeira camada clara cobria somente parte dos modificadores de opacidade. A auditoria encontrou, no código de componentes, variações de `bg-slate-700`, `bg-slate-800`, `bg-slate-900` e `bg-slate-950` entre `/25` e `/90`. Variações ausentes, sobretudo `bg-slate-900/60` e `bg-slate-950/60`, explicam os cartões grafite vistos em Escalonamentos, Catálogo e painéis operacionais.

Também foram encontrados painéis legados do atendimento com cores WhatsApp hardcoded, incluindo variantes com opacidade e hover. Esses elementos passam a receber tokens claros apenas quando `data-theme='light'`; bolhas de conversa e backdrops permanecem fora dessa normalização para preservar sua função visual.

## Cobertura aplicada

| Família visual | Tratamento no modo claro |
| --- | --- |
| `slate-700` a `slate-950` | Todas as variações usadas pelo código passam a superfícies neutras claras e bordas de baixo contraste. |
| Verde, azul, âmbar e vermelho `950` | Fundos profundos passam a superfícies semânticas suaves; a cor passa a comunicar estado, não a escurecer o cartão. |
| Painéis WhatsApp hardcoded | Cabeçalhos, menus, caixas de composição e respostas rápidas usam superfícies claras quando o tema é claro. |
| Texto e valores semânticos | Tons 50–400 permanecem em equivalentes escuros e legíveis para cada categoria. |
| Botões e estados desabilitados | Mantêm contraste de rótulo, borda, foco e superfície; não dependem de opacidade baixa. |

## Proteção contra regressão

O teste `lightThemeButtonContrast.test.ts` agora contém o inventário de todas as variações `slate` encontradas nos componentes. A alteração falhará em teste se uma dessas superfícies deixar de ter seletor correspondente no modo claro. Esta cobertura complementa os testes de interface e a validação de produção.

## Confirmação após publicação

O bundle de produção estabilizado contém as regras da auditoria global. Após recarregar a sessão autenticada, o CRM voltou a renderizar no modo claro com cartões, métricas, busca e colunas do Kanban em superfícies claras. A sessão preservou seus dados e permissões durante a verificação.
O estado vazio de **Escalonamentos**, que aparecia em grafite na captura original, foi reaberto após o deploy e agora exibe fundo claro, ícone verde, título grafite e descrição legível no modo claro.
