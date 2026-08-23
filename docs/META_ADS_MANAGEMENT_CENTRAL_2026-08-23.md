# Central de Anúncios Meta — escopo e controles

**TASK-0023 — revisão humana obrigatória**

A Central de Anúncios é uma interface do Universo sobre a Meta Marketing API. A Meta continua sendo a plataforma que executa as campanhas; o Universo apenas apresenta a operação, envia a chamada autenticada quando o administrador confirma e registra o resultado mínimo para auditoria.

## Escopo da primeira versão

A primeira versão permite criar uma campanha Click to WhatsApp com objetivo documentado pela Meta e `special_ad_categories=[]`. Toda campanha nova é criada com `status=PAUSED`, de modo que não comece a veicular no momento da criação. Também permite solicitar pausa, ativação e arquivamento de campanhas existentes e alterar o orçamento diário dentro do limite operacional do painel. A montagem completa de conjunto, mídia, criativo e anúncio final permanece uma etapa separada, pois exige assets na Meta, uma página com WhatsApp vinculado e parâmetros específicos do tipo de anúncio.

A ativação e a alteração de orçamento são ações de impacto financeiro. O painel mostra a consequência, exige uma segunda etapa de confirmação e o backend recusa a operação sem `confirmation=CONFIRMAR_NO_UNIVERSO`. A exclusão de campanhas não foi exposta na primeira versão porque a documentação da Meta trata a operação como irreversível.

## Permissões e isolamento

O token usado para leitura de métricas (`ads_read`) permanece separado do token usado para operações de escrita (`ads_management`). No fluxo Click to WhatsApp, a documentação da Meta também cita `pages_manage_ads`, `pages_read_engagement` e `pages_show_list`, além de um Page access token associado a uma pessoa com tarefa ADVERTISE na página.

Todas as rotas exigem autenticação e `admin`/`saas_admin`. O tenant é resolvido pelo JWT e pelo seletor protegido já existente para `saas_admin`; nem a conta de anúncios nem o tenant podem ser escolhidos por body/query. Tokens não são retornados ao frontend. Cada escrita exige `Idempotency-Key` e seu resultado é guardado em `meta_ads_operation_requests`; eventos operacionais não armazenam tokens, prompts, criativos completos ou dados desnecessários.

## Ativação operacional

A migration `0045_meta_ads_management.sql` deve ser revisada e aplicada no Supabase antes do deploy do código. Depois, o administrador deve salvar um token separado com as permissões aprovadas pela Meta e confirmar a conta `act_<id>`. O backend não executa chamadas de escrita durante a instalação, o desenvolvimento ou a abertura desta PR.

## Referências oficiais

[1] [Meta — Basic Ad Creation](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/basic-ad-creation)

[2] [Meta — Authorization](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization)

[3] [Meta — Ads that Click to WhatsApp](https://developers.facebook.com/documentation/ads-commerce/marketing-api/ad-creative/messaging-ads/click-to-whatsapp)

[4] [Meta — Ad Campaign Management](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/manage-campaigns)

[5] [Meta — Create an Ad Set](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/basic-ad-creation/create-an-ad-set)

[6] [Meta — Create an Ad Creative](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/basic-ad-creation/create-an-ad-creative)

[7] [Meta — Create an Ad](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/basic-ad-creation/create-an-ad)
