# Central de Tráfego e Guia de Meta CAPI — Monique Sorrilha Beauty Studio

**Data da validação:** 22 de agosto de 2026  
**Conta monitorada:** `act_677275869339059`  
**Tenant:** Monique (Teste) (`8a786c2a-aa8c-4c2a-bc12-d50058c598ce`)

## Resultado da implantação

A página **Meta CAPI** passou a reunir uma **Central de Tráfego** com atualização manual. A Central consulta, com uma autorização de leitura separada e protegida no servidor, as métricas reais da conta Meta Ads. Nenhum token é devolvido ao navegador depois de salvo.

A validação em produção foi concluída com sucesso em **22/08/2026 às 04:04**, consultando os últimos 30 dias, de **23/07/2026 a 21/08/2026**. A consulta retornou dados reais da Meta, incluindo campanhas, anúncios, gasto, conversas iniciadas, custo por conversa, CTR, situação de entrega e rankings de qualidade quando disponibilizados.

| Indicador consolidado | Valor validado |
|---|---:|
| Investimento | R$ 1.599,14 |
| Conversas iniciadas | 412 |
| Custo médio por conversa | R$ 3,88 |
| Cliques | 4.385 |
| Impressões | 176.552 |
| CTR | 2,48% |
| Anúncios ativos | 5 |
| Anúncios em análise | 1 |
| Anúncios reprovados | 0 |

> Os números acima se referem ao período completo de 30 dias e não devem ser comparados diretamente com valores de um único dia ou de uma única campanha.

## Leitura inicial dos dados reais

A campanha ativa de Luque — **Combo | Cejas y Pestañas | Mulheres 25-55 | Luque** — foi a principal fonte de conversas: R$ 809,21 investidos, 270 conversas e custo de **R$ 3,00 por conversa**. Dentro dela, o criativo **A1 – TÉCNICA BRASILEÑA** foi o destaque: R$ 667,61 investidos, 236 conversas, custo de **R$ 2,83** por conversa e CTR de 3,30%, com qualidade e engajamento acima da média.

A campanha **Micro em Assunção** registrou R$ 66,53, 19 conversas e custo médio de R$ 3,50. O anúncio **Assunção Full Face 1200** gerou 18 conversas a R$ 2,88 por conversa, enquanto o anúncio em teste gerou uma conversa a R$ 14,71. Este último ainda possui amostra pequena; não deve ser alterado ou pausado somente com base nesse primeiro resultado.

| Ponto de observação | Dado atual | Orientação operacional |
|---|---:|---|
| Melhor criativo com volume | A1 – TÉCNICA BRASILEÑA: R$ 2,83/conversa | Manter como controle e comparar novas variações contra ele. |
| Campanha Luque | R$ 3,00/conversa | Boa referência atual para novas variações de criativo. |
| Campanha Assunção | R$ 3,50/conversa | Acompanhar diariamente; o teste ainda precisa acumular conversas antes de uma decisão. |
| Anúncio em análise | 1 | Não tomar decisão de orçamento antes do resultado da revisão da Meta. |
| Criativos pausados com custo alto | Há históricos acima de R$ 6/conversa | Servem como aprendizado; não reativar sem hipótese criativa ou de público diferente. |

## O que é a Meta CAPI

A **Conversions API (CAPI)** é uma integração servidor a servidor. Em vez de depender apenas de sinais do navegador, o sistema pode avisar a Meta quando um evento de negócio relevante aconteceu. Na operação da Monique, isso significa que o atendimento pode comunicar eventos reais associados ao anúncio e ao WhatsApp, como um avanço seguro no funil ou uma conversão confirmada.

A CAPI não substitui o atendimento, não cria anúncios e não agenda ninguém. Ela registra sinais de conversão que ajudam a Meta a compreender quais conversas vindas dos anúncios tiveram qualidade. O agente mantém as regras de segurança: entrada via campanha representa interesse inicial, e nenhum agendamento é confirmado sem aprovação humana do comprovante.

| Elemento | Papel na operação da Monique |
|---|---|
| Anúncio Meta | Atrai a pessoa e inicia a conversa no WhatsApp. |
| Central de Tráfego | Lê métricas da conta e mostra qual campanha ou criativo está trazendo conversas com melhor custo. |
| WhatsApp e agente Ana | Qualificam o interesse, respondem dúvidas e conduzem o atendimento com as regras comerciais aprovadas. |
| Meta CAPI | Envia de volta para a Meta eventos de conversão reais e elegíveis, ligados ao atendimento. |
| Revisão humana | Confirma comprovante e evita que uma reserva ou compra seja sinalizada antes de estar realmente validada. |

> A leitura de campanhas exige a permissão `ads_read`. O token usado pela CAPI pode ter capacidade de enviar eventos, mas não necessariamente possui permissão para ler dados de anúncios. Por isso, a Central guarda um token específico de leitura quando necessário.

## Como usar a Central de Tráfego

A rotina recomendada é abrir **Meta CAPI → Central de Tráfego**, selecionar **Hoje**, **7 dias**, **14 dias** ou **30 dias** e clicar em **Atualizar métricas**. A tela informa a hora da última consulta. A atualização é manual, portanto não consome recursos em segundo plano nem mistura períodos sem que a pessoa responsável escolha o intervalo.

| Frequência | Período recomendado | Objetivo |
|---|---|---|
| Manhã, todos os dias | Hoje e 7 dias | Ver gasto, conversas e se algum anúncio entrou em análise ou foi reprovado. |
| Duas vezes por semana | 14 dias | Comparar estabilidade de custo por conversa entre criativos. |
| Uma vez por semana | 30 dias | Avaliar decisões maiores de criativo, público e orçamento com volume suficiente. |

Ao analisar a Central, a ordem correta é observar primeiro o **custo por conversa**, depois o volume de conversas e, por último, o CTR. Um CTR alto não é suficiente se não gerar conversas com custo sustentável. Do mesmo modo, um anúncio com poucas conversas ainda não oferece base suficiente para decisão; ele deve acumular dados antes de ser comparado com o criativo controle.

## Configuração e segurança

O botão **Configurar acesso** permite atualizar a conta de anúncios ou cadastrar um novo token da Marketing API com `ads_read`. O token entra uma única vez, é armazenado no servidor e não volta a ser exibido no painel. A Central foi desenhada apenas para leitura: ela não cria, edita, pausa ou altera campanhas.

A autorização foi validada com a conta `act_677275869339059`. A migração de banco adicionou os campos protegidos `meta_ads_account_id` e `meta_ads_access_token` à configuração Meta do tenant, separados dos dados de WhatsApp e dos eventos CAPI.

## Validação técnica e publicação

| Verificação | Resultado |
|---|---|
| Migração do banco aplicada | Aprovada em produção |
| Leitura de conexão protegida | Aprovada |
| Atualização real de métricas da Meta | Aprovada |
| Testes automatizados | 757 testes aprovados em 138 arquivos |
| Checagem de tipos | Aprovada |
| Build de produção | Aprovado |
| Branch publicada | `main` |
| Commits principais | `978c58b` e `1669db0` |

## Referências

[1] [Meta for Developers — Conversions API](https://developers.facebook.com/docs/marketing-api/conversions-api/)  
[2] [Meta for Developers — Marketing API: autorização e permissões](https://developers.facebook.com/docs/marketing-api/get-started/authorization/)  
[3] [Meta for Developers — Ads Insights](https://developers.facebook.com/docs/marketing-api/insights/)
