# Evolution 2.3.7 — recuperação da recepção (TASK-0467)

Os logs deste servidor coincidem com [Evolution #2778](https://github.com/evolution-foundation/evolution-api/issues/2778)
e [Baileys #2858](https://github.com/WhiskeySockets/Baileys/issues/2858): um evento
Status sem ACK provoca `stream errored out`, `ack class="status"`; a conexão volta
a `open`, mas mensagens deixam de entrar no banco da própria Evolution.

Este é um backport do [PR upstream #2883](https://github.com/WhiskeySockets/Baileys/pull/2883),
ainda não integrado na consulta de 15/11/2026, para o JavaScript compilado de
Baileys **7.0.0-rc.9**. A imagem base está fixada pelo digest linux/amd64 da tag
oficial v2.3.7, consultado em 15/11/2026 e igual ao digest do deploy ativo
`dep-dbpln9t6e07s73dchnbg` no Render. O patch recusa outra versão ou âncoras
ausentes/ambíguas. Ele confirma Status também na fila offline e protege cada
item dessa fila: uma notificação defeituosa em rc.9 não impede os itens seguintes.

Os testes executam o ACK e o processador offline reais extraídos do módulo da
imagem, com transporte local simulado e sem credenciais. Cobrem ACK sem NACK,
ordem da fila offline, notificação defeituosa, falha de envio e idempotência.
Não comprovam por si só a recuperação de uma sessão real do WhatsApp.

## Construção e revisão

```sh
docker build -t evolution-status-ack:test infra/evolution
docker run --rm --network none --entrypoint node evolution-status-ack:test --test /opt/evolution-status-ack/verify-patch.cjs
```

O workflow **Evolution Status ACK** verifica a imagem no PR. Sua execução manual
na `main`, depois de revisão e CI aprovado no mesmo SHA, publica uma tag
`ghcr.io/mosorrilha-crypto/universo-api-evo-hub:evolution-status-ack-<SHA>`.
Ele não altera nenhum serviço Render. O resumo da execução contém o digest.

## Aplicação no Render

Alvo: workspace **My Workspace**, serviço **evolution-api:v2.3.7**,
`srv-d9ua9g5bedkc73941u90`, com disco de 2 GB em `/evolution/instances`.

1. Antes da aplicação, registrar o estado original dos agentes e **pausar as
   respostas automáticas dos tenants afetados no Universo**. A recuperação pode
   liberar mensagens antigas e disparar respostas/ações atrasadas se a IA ficar
   ativa. A recepção e o registro do histórico continuam sendo necessários.
   Essa pausa não suspende jobs independentes nem o fluxo de revisão de imagens
   como possíveis comprovantes: revisar eventuais itens antigos usando o horário
   original da mensagem antes de agir sobre uma reserva ou pagamento atual.
2. Registrar a imagem/digest e o deploy atual para reversão. Confirmar que o
   pacote GHCR é acessível ao Render, por acesso público ou credencial de registro
   já configurada; não colocar tokens na URL.
3. Nas configurações do **mesmo serviço**, trocar somente a imagem pela referência
   publicada, preferencialmente `ghcr.io/mosorrilha-crypto/universo-api-evo-hub@sha256:<digest>`.
   Preservar disco, variáveis, banco, cache, chaves, URL e configuração dos webhooks.
4. Fazer deploy e aguardar `live`. **O disco anexado exige breve interrupção de
   todas as instâncias deste serviço**. Não fazer logout nem recriar instâncias
   como parte deste procedimento.
5. Conferir a API HTTP 200 e o estado das instâncias. Receber uma mensagem nova
   enviada de um número de teste e correlacionar ID/timestamp no Manager, webhook
   e banco do Universo. Conferir o webhook antes de atribuir qualquer ausência ao
   painel. Não reenviar mensagens antigas automaticamente.
6. Acompanhar a recuperação do histórico com os agentes pausados e observar pelo
   menos 60 minutos, ultrapassando o ciclo relatado de aproximadamente 50 minutos.
   Exigir recepção atual e ausência de novos erros `ack class="status"`; apenas
   `open` não é prova de saúde. Retomar cada agente ao seu estado original depois
   da revisão das pendências. Não ativar agentes que já estavam pausados.

Os conectores Render disponíveis nesta sessão permitem deploys e variáveis, mas
não substituem a imagem de um serviço existente. Essa etapa exige o Dashboard ou
uma credencial Render API fornecida por mecanismo seguro; não é necessário
alterar plano nem criar outro serviço.

## Reversão

Se a nova imagem não iniciar, restaurar a referência exata anterior no mesmo
serviço e fazer deploy, preservando o disco e as configurações. Essa reversão
não desfaz mensagens já recebidas nem ações externas, por isso a pausa dos agentes
antes da recuperação é parte da operação. Não é uma garantia de resolver todos
os erros `Bad MAC` ou sessões criptográficas degradadas; isso exige validação
depois do ACK corrigido.
