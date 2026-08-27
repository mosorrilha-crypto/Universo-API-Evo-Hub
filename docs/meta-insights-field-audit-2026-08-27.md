# Auditoria dos campos Meta Insights

A documentação oficial consultada em 27/08/2026 confirma que a Ads Insights API aceita métricas por meio do parâmetro `fields`, mas `landing_page_views` não é um campo direto válido nesta versão. A referência oficial de Ads Action Stats lista `landing_page_view` como um `action_type` retornado dentro de `actions`. A mesma referência lista `outbound_click` como o tipo de ação de cliques de saída.

Correção prevista: remover `landing_page_views` do parâmetro `fields` enviado ao endpoint `/{ad-account-id}/insights` e manter a leitura de `landing_page_view` por `actions`. Também deve ser removido `outbound_clicks` caso a API rejeite o campo direto, mantendo a leitura por `actions` com o nome singular documentado. CPM, frequência, impressões, alcance, cliques, CTR e CPC permanecem como métricas diretas documentadas no contrato de Insights.

Referências:

1. Meta for Developers — Ads Insights API: https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights
2. Meta for Developers — Ads Action Stats, referência v26.0: https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/
3. Meta for Developers — Ad Insights, referência da Graph API: https://developers.facebook.com/documentation/ads-commerce/graph-api/reference/adgroup/insights
