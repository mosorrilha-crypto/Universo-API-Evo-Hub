# Diagnóstico preliminar — primeira mensagem de anúncio não aparece no histórico

## Evidência observada

No WhatsApp Web, a primeira bolha verde contém o cartão “Anúncio do Facebook”, o texto de saudação e a marca “Mensagem de saudação automática”. Depois disso, a cliente envia “Hola”. No painel do agente, a conversa mostra apenas “Hola”.

## Evidência no código

1. `server/services/webhookParsers.ts`, linhas 41–90: o parser da Meta percorre apenas `entry[].changes[].value.messages[]`. Para cada mensagem comum, extrai `msg.text.body` e, quando presente, copia `msg.referral` apenas como metadado (`headline`, `source_id`, `ctwa_clid`).
2. `server/routes/webhooks.ts`, linhas 375–406: o webhook grava o referral na conversa com `attachAdReferralIfMissing`, mas grava no histórico somente a mensagem que chegou em `msg.type === 'text'`, usando `recordIncomingMessage`.
3. `server/services/conversationStore.ts`, linhas 216–234: `attachAdReferralIfMissing` salva `ctwa_clid`, `ad_source_id` e `ad_headline` em colunas da conversa; não cria uma mensagem visível.
4. `src/components/WhatsAppLeadsSim.tsx`, linhas 1327–1330 e 3481–3483: o frontend mapeia `conv.messages` e renderiza todas as mensagens recebidas da API sem filtro que remova a primeira mensagem.

## Hipótese técnica principal

O cartão de saudação automática exibido pelo WhatsApp é uma camada nativa do fluxo de anúncio Clique para WhatsApp, não uma mensagem inbound normal emitida pelo contato. O webhook do backend recebe a primeira mensagem efetivamente enviada pela pessoa (`Hola`) e, no máximo, o referral do anúncio como metadado. Como o painel só renderiza registros da tabela `messages`, a saudação não aparece.

## Documentação externa

A documentação da Meta descreve os anúncios Clique para WhatsApp como direcionamento para iniciar conversas e documenta uma mensagem de saudação/autofill configurável no criativo. A página também identifica o formato de saudação com `landing_screen_type: welcome_message` e `customer_action_type: ice_breakers`/`autofill_message`. Isso é compatível com o cartão nativo visto no print, mas não prova, sozinho, que ele seja entregue como linha independente no webhook.

## Correção provável

Se o produto precisa mostrar essa saudação no histórico, é necessário sintetizar um registro interno no momento em que o primeiro webhook trouxer `msg.referral` ou outro payload identificável do CTWA: inserir uma mensagem `sender='agent'` ou um novo tipo explícito de mensagem “ad_greeting”, com o texto/headline disponível, e proteger contra duplicação por `message_id`/conversa. A alternativa mais fiel é criar um bloco visual de “Origem do anúncio” no frontend usando `adHeadline`/`ctwa_clid`, deixando claro que é metadado do anúncio e não mensagem enviada pelo agente.

## Observação

O código atual já possui `adHeadline` e `adGreetingMatchedAt` na conversa, mas não possui campo de texto para a saudação automática nem uma rotina que transforme o referral em uma bolha do histórico.

## Confirmação na documentação oficial

A referência de “Payload de Webhook de Entrada do WhatsApp” descreve o webhook como o canal de mensagens e interações enviados de usuários do WhatsApp para empresas. O exemplo de entrada contém `messages[]` com `from`, `id`, `timestamp`, `type` e `text.body`. A página de criação de anúncios documenta a saudação como parte da configuração/experiência do anúncio (`welcome_message`, `ice_breakers` e `autofill_message`). A busca pelo texto `ctwa_clid` não retornou resultado na página genérica de payload, portanto a conclusão sobre o campo referral permanece baseada no código do repositório e na referência específica de Conversions API, não no exemplo genérico dessa página.
