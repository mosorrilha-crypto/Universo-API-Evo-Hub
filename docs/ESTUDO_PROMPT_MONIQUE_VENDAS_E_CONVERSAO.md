# Estudo de Prompt — Agente de Atendimento da Monique Sorrilha Beauty Studio

**Data:** 21 de agosto de 2026  
**Autor:** Manus AI  
**Base de verdade utilizada:** `base-conhecimento-monique-sorrilha-beauty-studio-2026-08-19.md`, exportada em 21 de agosto de 2026.

## 1. Objetivo e escopo

Este estudo reposiciona o agente de atendimento da Monique para uma operação de **vendas consultivas e conversão via WhatsApp e Instagram**. O propósito não é fazer o agente pressionar a cliente; é reduzir atrito, responder com precisão, qualificar com uma pergunta útil por vez e conduzir cada conversa ao próximo estágio válido: entendimento da necessidade, recomendação, consulta real de agenda, seña e confirmação humana.

O documento anterior de legenda de anúncio foi desconsiderado como fonte de configuração. A fonte adotada para preços, serviços, duração, política e persona foi a base de conhecimento correta fornecida posteriormente. Essa decisão elimina a divergência mais crítica identificada: o catálogo versionado no repositório ainda tinha valores e durações diferentes dos atuais.

> **Princípio comercial:** conversão não pode significar prometer resultado, inventar urgência, confirmar horário sem agenda ou confirmar pagamento sem revisão humana. O prompt deve aumentar a clareza e a progressão da conversa sem ultrapassar os controles reais do negócio.

| Resultado esperado | Como o agente deve se comportar |
|---|---|
| Mais respostas ao anúncio | Reconhecer o serviço anunciado e não reabrir a pergunta genérica sobre o que a cliente procura. |
| Mais avanço de conversa | Entregar a informação pedida e fazer somente uma pergunta curta que ajude a avançar. |
| Menos abandono após preço | Conectar o valor a um benefício real e investigar a objeção sem desconto ou pressão não autorizados. |
| Mais reservas válidas | Só partir para agenda após serviço, intenção e dados necessários; só confirmar após as etapas reais. |
| Mais confiança | Usar espanhol paraguaio consistente, tom humano e dados oficiais do catálogo. |

## 2. O que Groq e Gemini recebem no fluxo atual

A arquitetura atual possui duas etapas com objetivos distintos. Portanto, é incorreto comparar a resposta de Groq com a resposta comercial final de Gemini como se ambos estivessem redigindo a mesma mensagem.

| Etapa | Provedor principal | Dados enviados | Saída esperada | Impacto em conversão |
|---|---|---|---|---|
| Roteamento | **Groq**, quando configurado | Mensagem atual, histórico recente e instrução de classificação | JSON com `agent`, `confidence` e `reasoning` | Indireto: escolhe entre triagem, FAQ, agendamento e reclamação. |
| Fallback de roteamento | **Gemini** | O mesmo prompt de classificação | O mesmo JSON de rota | Mantém a continuidade se Groq falhar. |
| Resposta especializada | **Gemini** | Instruções do agente, camada global, base do negócio, histórico, nova mensagem, contexto de anúncio e resultado de ferramentas | JSON com fase, bolhas e sinais operacionais | Direto: produz a mensagem que será enviada à cliente. |

### 2.1 Groq: router de intenção, não redator da venda

Quando há uma chave Groq, o sistema usa o modelo `openai/gpt-oss-20b`, temperatura zero, uma única mensagem de usuário e resposta JSON. O prompt contém as quatro categorias operacionais — `triagem`, `faq`, `agendamento` e `reclamacao` — mais a mensagem e o histórico recente. Ele **não recebe o catálogo completo, preço, duração, regras de pagamento nem o contexto da campanha**. Isso é intencional: a função dele é classificar de modo rápido e barato, não aconselhar ou vender.[1] [2]

Em caso de erro, timeout, JSON inválido ou classificação fora do enum, o router usa Gemini. O fallback é operacionalmente seguro, mas os registros atuais guardam a decisão de rota, confiança e justificativa; eles não formam, por si só, um banco de comparação de prompts e respostas completas para auditoria comercial.[2]

### 2.2 Gemini: redator com contexto comercial e controles operacionais

Gemini é quem redige a resposta para a cliente. Sua instrução de sistema combina o papel especializado, a camada global, a camada efetiva do tenant e a base de conhecimento. A mensagem dinâmica reúne, quando aplicável, histórico, nome, ações reais de agenda/mídia, orientação humana e contexto do anúncio clicado.[2] [3]

A consequência prática é simples: **a qualidade da conversão depende sobretudo da base enviada ao Gemini e da regra de progressão da conversa**. O router influencia a especialização escolhida, mas não escreve a oferta nem realiza o fechamento.

> Para avaliar Groq e Gemini de forma justa, deve-se comparar os dois no problema de roteamento. Para avaliar a mensagem comercial, deve-se testar Gemini com o prompt vigente versus uma versão candidata. Usar Groq como redator em produção exigiria uma alteração arquitetural separada, em modo sombra e sem envio ao cliente até aprovação.

## 3. Diagnóstico da base correta e divergências encontradas

A base correta definiu o nome comercial, os preços, as durações e as limitações operacionais em vigor. O repositório continha itens históricos diferentes. A tabela seguinte demonstra os pontos comerciais que foram sincronizados no código-fonte.

| Elemento | Configuração anterior no repositório | Base correta | Ajuste aplicado |
|---|---|---|---|
| Micropigmentação de cejas | Microshading e Pelo a Pelo separados, Gs 500.000 | **Cejas Microshading o Microblading**, Gs 550.000, 120 min; técnica definida presencialmente | Serviço unificado, preço corrigido e aliases preservados. |
| Microlips | Gs 500.000 | **Microlips Labios**, Gs 550.000, 120 min | Nome, preço e alias atualizados. |
| Combo cejas + labios | Gs 800.000, 180 min | **Combo Micro Cejas + Labios**, Gs 850.000, 210 min | Nome, preço e duração atualizados. |
| Combo Full Face | Combo Triple a Gs 1.000.000, 180 min | **Combo Triple: Micro Cejas + Labios + Pestañas**, Gs 1.200.000, 240 min | Dados corrigidos e aliases `Combo Full Face` e `Full Face` adicionados. |
| Combo pestañas + labios | 210 min | **Combo Pestañas + Micro Labios**, 180 min | Nome e duração corrigidos. |
| Browlamination | Efeito informado por cerca de 1 semana | Efeito full por cerca de 3 semanas | Descrição atualizada. |
| Políticas | Não continha todos os detalhes do material correto | Tolerância de 15 min, remarcação com 24h, ausência sem reembolso e regra de retoque | Regras inseridas na seed e no editor local. |
| Localização | Link de busca textual do Maps | Link oficial por coordenadas | Link atualizado. |

A base também afirma que os serviços de pestañas e os tratamentos/design de cejas não são agendáveis diretamente pela IA. Essa restrição foi representada com `bookable: false` nos itens correspondentes. Ela impede que um fluxo automatizado trate uma intenção comercial como confirmação de serviço sem a intervenção prevista pela política.

## 4. Ajustes de prompt e de catálogo aplicados

Os ajustes foram desenhados para aumentar conversão sem tornar o agente agressivo. Eles estão no código-fonte local e precisam ser promovidos ao ambiente produtivo por deploy e sincronização da base.

| Ajuste | Efeito comercial | Proteção operacional |
|---|---|---|
| Alias de produto | O agente reconhece `Combo Full Face` como o combo oficial, embora o nome do catálogo seja `Combo Triple: Micro Cejas + Labios + Pestañas`. | Mantém um único produto, preço e duração como fonte de verdade. |
| Match de headline por nome ou alias | Um clique em anúncio de Full Face injeta o serviço correto no contexto de Gemini. | Continua priorizando a correspondência mais específica e só atua no primeiro contato. |
| Regra de triagem orientada a anúncio | Se a cliente veio de uma oferta identificada, o agente apresenta a oferta em vez de perguntar novamente qual serviço ela quer. | Valor, duração e composição só podem ser citados se existirem no contexto do negócio. |
| Pergunta única de avanço | Após responder, o agente pede a informação que destrava a próxima etapa. | Evita interrogatório e repetição de perguntas já respondidas. |
| Sincronização da seed e do editor | O painel não deve reintroduzir preços antigos depois de uma edição manual. | Mantém catálogo, prompt e ferramenta de agenda na mesma versão comercial. |

### 4.1 Regra comercial incorporada à triagem

A instrução adicionada ao agente de triagem estabelece o seguinte comportamento:

> Quando o anúncio informa que a cliente veio de uma oferta específica do catálogo, esse clique é sinal de interesse. O agente não deve perguntar novamente qual serviço ela busca; deve apresentar objetivamente a oferta identificada, usando apenas benefício, componentes, valor e duração presentes no contexto oficial, e fazer uma única pergunta de avanço.

Essa regra resolve uma fricção comum em anúncios de clique para WhatsApp: a pessoa toca em uma oferta específica e recebe como primeira resposta “¿Qué servicio buscás?”. Para uma cliente que já demonstrou interesse no Full Face, essa pergunta quebra a continuidade e faz o atendimento parecer genérico.

### 4.2 Prompt operacional recomendado para a camada da Monique

O bloco abaixo é uma recomendação para a camada específica do tenant. Ele não substitui as regras globais de segurança, pagamento ou agenda; ele complementa a estratégia de conversão da Monique.

```text
OBJETIVO COMERCIAL DO ATENDIMENTO

Conduza a cliente com clareza e naturalidade até o próximo passo válido, sem pressão. Primeiro responda a pergunta direta. Em seguida, faça somente UMA pergunta curta que reduza a incerteza ou permita avançar.

LEADS VINDAS DE ANÚNCIO

Se o contexto disser que a conversa começou por um anúncio de um serviço específico, considere o serviço já identificado. Não pergunte de novo “qué servicio buscás?”. Apresente o serviço somente com dados oficiais do catálogo: o que inclui, benefício relevante, valor e duração. Depois avance com uma pergunta de qualificação adequada.

EXEMPLO DE PROGRESSÃO

1. Interesse inicial: explique a oferta e pergunte uma preferência relevante, sem pedir dados demais.
2. Dúvida ou objeção: responda diretamente; use no máximo um diferencial real; descubra a dúvida central antes de oferecer outra solução.
3. Intenção de reserva: confirme nome, serviço e dia desejado; só então consulte disponibilidade real.
4. Horário retornado pela agenda: ofereça somente horários realmente devolvidos pela ferramenta.
5. Cliente pronta para confirmar: explique a seña conforme a política; nunca confirme pagamento ou turno sem aprovação humana e criação do evento.

NUNCA use falsa escassez, desconto não autorizado, promessa de resultado, confirmação antecipada ou dados ausentes no contexto.
```

## 5. Roteiros esperados para o Combo Full Face

Os roteiros não são textos para repetição literal. Eles mostram a estrutura da resposta que deve ser obtida em testes. O agente deve variar a redação, respeitar o histórico e usar espanhol paraguaio quando a cliente falar em espanhol.

| Situação | Objetivo da resposta | Exemplo de resposta esperada |
|---|---|---|
| Clique no anúncio e saudação | Reconhecer o interesse e apresentar a proposta de modo objetivo | “Hola, sí. El Combo Full Face reúne cejas, labios y pestañas en la misma sesión, buscando un resultado armonioso. El valor es Gs 1.200.000 y dura aproximadamente 4 horas. ¿Ya te hiciste alguna micropigmentación antes?” |
| Pergunta pelo valor | Dar preço exato e manter a conversa viva | “El Combo Full Face está Gs 1.200.000 e incluye cejas, labios y pestañas en la misma sesión. Dura unas 4 horas. ¿Buscás un resultado más natural o más definido?” |
| “Me parece caro” | Acolher a objeção, reforçar um diferencial real e descobrir a barreira | “Te entiendo, es una inversión importante. Se trabaja de forma personalizada para buscar armonía entre cejas, labios y pestañas en una misma sesión. ¿Lo que más te hace dudar es el valor, el procedimiento o el resultado?” |
| Cliente quer reservar | Coletar apenas o necessário antes da agenda | “Perfecto. Para consultar la agenda, ¿me confirmás tu nombre y qué día te quedaría mejor?” |
| Após disponibilidade real | Levar a uma escolha sem inventar vagas | “Tengo estas opciones reales para ese día. ¿Cuál te queda mejor?” |
| Comprovante enviado | Criar expectativa correta, sem confirmação prematura | “Recibí tu comprobante, gracias. Voy a dejarlo para revisión y apenas esté aprobado te confirmo el turno.” |

Os exemplos acima só são corretos quando a oferta, o preço e a duração estiverem no contexto. Caso uma campanha mude, o catálogo e o headline devem ser atualizados antes de ativar qualquer texto semelhante.

## 6. Metodologia de comparação entre Groq e Gemini

### 6.1 Dois experimentos, não um único teste

O desenho recomendado separa as responsabilidades técnicas.

| Experimento | Comparação válida | Material de entrada | Critério de sucesso |
|---|---|---|---|
| **A. Roteamento** | Groq versus Gemini router | Mesma mensagem anonimizada, mesmo histórico e mesmo prompt de classificação | Mesma categoria correta, JSON válido, baixa latência e ausência de fallback indevido. |
| **B. Resposta comercial** | Gemini com prompt vigente versus Gemini com prompt candidato | Mesma base, mesmo contexto de anúncio, histórico e mensagem da cliente | Maior aderência comercial, clareza, uma pergunta útil e nenhum erro de política. |

Não se deve tratar uma resposta Groq de router como se fosse resposta de venda: no fluxo atual ela não recebe a base comercial completa e não é enviada à cliente. Se houver interesse em avaliar Groq como redator, crie uma rota de **modo sombra**, sem disparo de mensagem, com revisão humana e anonimização de dados antes de qualquer uso real.

### 6.2 Conjunto de casos de teste

Crie uma amostra anonimizada de conversas reais e cubra pelo menos as categorias abaixo. Para cada caso, registre entrada, histórico permitido, contexto de anúncio, rota esperada, resposta esperada por critérios e resposta efetivamente retornada.

| Caso | Entrada da cliente | Rota esperada | Critérios de avaliação |
|---|---|---|---|
| 1 | “Hola, vi el Combo Full Face” | Triagem ou FAQ, conforme a formulação | Reconhece o combo, informa apenas dados oficiais e não pergunta qual serviço ela quer. |
| 2 | “¿Cuánto cuesta el Full Face?” | FAQ | Gs 1.200.000, 240 min, composição correta e uma pergunta de avanço. |
| 3 | “Quiero algo natural, pero tengo miedo” | Triagem | Acolhe o medo, não diagnostica por texto e faz pergunta que ajude a recomendar. |
| 4 | “Quiero reservar para el sábado” | Agendamento | Solicita/confirmar nome e dados faltantes; não afirma que há vaga. |
| 5 | “Te mandé el comprobante” | Agendamento | Declara revisão pendente; não confirma turno. |
| 6 | “Está muy caro” | FAQ ou triagem | Valida objeção, evita desconto e descobre a barreira específica. |
| 7 | “¿Puedo pagar en efectivo?” | FAQ | Só informa a alternativa prevista, sem confirmar automaticamente. |
| 8 | “No me gustó el resultado” | Reclamação | Empatia, escalonamento humano e nenhuma compensação inventada. |

### 6.3 Rubrica de avaliação da resposta comercial

Avalie cada resposta em escala de 0 a 2 por critério. Uma nota 0 representa falha, 1 representa aderência parcial e 2 representa aderência plena. O resultado deve ser revisado por uma pessoa do estúdio em uma pequena amostra antes de qualquer mudança ampla.

| Critério | Nota 0 | Nota 1 | Nota 2 |
|---|---|---|---|
| Correção comercial | Erra preço, duração, serviço ou política | Está incompleta, mas não inventa | Usa o dado oficial necessário e contextualiza corretamente. |
| Continuidade do anúncio | Ignora o serviço clicado | Menciona o serviço, mas repete uma pergunta inútil | Reconhece o anúncio e avança a conversa naturalmente. |
| Conversão consultiva | Despeja catálogo ou não propõe continuidade | Faz pergunta pouco útil | Faz uma única pergunta que reduz fricção ou avança o funil. |
| Linguagem e tom | Mistura idiomas, é fria ou excessivamente comercial | Pequenas inconsistências | Espanhol paraguaio ou português consistentes, humano e sem pressão. |
| Segurança operacional | Promete agenda, pagamento, desconto ou resultado | Linguagem ambígua | Respeita agenda real, seña, revisão humana e limites clínicos. |
| Memória e não repetição | Pergunta ou explica algo já resolvido | Recupera apenas parte do histórico | Usa o histórico para dar continuidade sem repetição. |

### 6.4 Registros mínimos para auditoria

O sistema já registra a decisão do router, incluindo provedor, agente, confiança e justificativa. Para um estudo de conversão, recomenda-se guardar um conjunto de avaliação separado, **anonimizado e com acesso restrito**, contendo os campos abaixo. Não é recomendável gravar conteúdo bruto de produção sem uma política de privacidade e retenção definida.

| Campo | Finalidade |
|---|---|
| ID opaco do caso | Reproduzir o teste sem expor telefone ou nome. |
| Mensagem e histórico anonimizados | Comparar contexto idêntico entre modelos. |
| Headline do anúncio | Verificar reconhecimento de campanha e oferta. |
| Router Groq e Gemini | Comparar categoria, confiança, JSON válido, tempo e fallback. |
| Resposta Gemini vigente e candidata | Avaliar qualidade comercial com a mesma entrada. |
| Rubrica e justificativa humana | Transformar opinião em critério auditável. |
| Resultado posterior do funil | Medir resposta, avanço, reserva, seña aprovada e perda, sem atribuição simplista. |

## 7. Validação realizada neste repositório

Foi criada uma proteção automatizada para garantir que o headline `Combo Full Face` encontre o serviço oficial `Combo Triple: Micro Cejas + Labios + Pestañas` através dos aliases cadastrados. Também foi executada a suíte focal de `autoReply` e a checagem estática de TypeScript.

| Verificação | Resultado |
|---|---|
| Testes de `server/services/__tests__/autoReply.test.ts` | **56 testes aprovados** |
| Checagem `tsc --noEmit` | **Aprovada** |
| Suíte completa `npm test` | **720 testes aprovados; 2 falhas em lembretes por comportamento de fuso horário**, em arquivos não alterados (`reminderJobButtons.test.ts` e `reminderJobLanguageAndTiming.test.ts`). |
| Alteração da base de produção | **Não executada** |
| Envio de mensagens reais | **Não executado** |
| Comparação ao vivo entre Groq e Gemini | **Não executada**, pois o repositório não contém pares de respostas reais nem um ambiente sombra configurado. |

## 8. Ativação segura em produção

Os arquivos de seed e o editor local foram atualizados, mas não houve alteração em banco produtivo, deploy ou envio de WhatsApp. Essa separação evita substituir acidentalmente uma base que tenha recebido mudanças posteriores pelo painel.

| Ordem | Ação recomendada | Motivo |
|---|---|---|
| 1 | Exportar a base atual do tenant e comparar com o documento correto. | Preserva qualquer edição recente não presente no repositório. |
| 2 | Revisar no painel o catálogo, especialmente o Combo Full Face e os itens `bookable: false`. | Confirma a aderência comercial antes de ativar. |
| 3 | Fazer deploy do código com aliases e regra de triagem. | Permite reconhecer o headline da campanha. |
| 4 | Aplicar a seed apenas com as credenciais produtivas e após a conferência. | A seed substitui integralmente a base legada do tenant. |
| 5 | Realizar um teste interno de ponta a ponta no WhatsApp. | Valida headline, idioma, catálogo, agenda, seña e confirmação humana. |
| 6 | Rodar o experimento com casos anonimizados por alguns dias. | Mede o efeito do prompt sem expor a operação a um teste não controlado. |

## 9. Conclusão

A melhoria mais importante não é tornar a IA “mais persuasiva” de forma genérica. É fazer com que ela reconheça o **sinal comercial já dado pela cliente** — especialmente o clique no anúncio Full Face — e responda com dados corretos, benefício relevante e um próximo passo simples. O ajuste aplicado elimina o desencontro entre o headline da campanha e o nome oficial do catálogo, atualiza os dados comerciais conforme a base correta e preserva as travas de agenda, pagamento e segurança.

A próxima etapa recomendada é ativar os ajustes somente após revisar a base produtiva e, em paralelo, iniciar a coleta anonimizada para comparar Groq e Gemini em suas funções reais: Groq/Gemini no roteamento e Gemini vigente/candidato na redação comercial.

## Referências internas

[1]: `server/services/groqClient.ts` — cliente Groq, modelo, temperatura, JSON e timeout.
[2]: `server/services/autoReply.ts` — prompt do router, seleção de agente, contexto de anúncio e geração da resposta especializada.
[3]: `server/services/knowledgeBaseStore.ts` — serialização da base de conhecimento para o prompt do especialista.
[4]: `scripts/seed-monique-knowledge-base.ts` — base de conhecimento sincronizada no repositório.
[5]: `src/components/AgentKnowledgeBase.tsx` — base padrão exibida no editor.
[6]: `base-conhecimento-monique-sorrilha-beauty-studio-2026-08-19.md` — documento correto fornecido pela usuária.
