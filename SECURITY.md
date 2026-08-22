# Política de segurança

## Como reportar uma vulnerabilidade

O Universo é um SaaS multi-tenant em produção, com integrações reais de WhatsApp, autenticação, CRM, financeiro e dados de clientes. **Não publique tokens, credenciais, dados pessoais, comprovantes, payloads reais ou uma prova de conceito em uma issue pública, pull request ou discussão.**

Para reportar uma vulnerabilidade, use o canal privado do próprio GitHub:

1. abra a aba **Security** deste repositório;
2. escolha **Report a vulnerability** ou **Private vulnerability reporting**;
3. descreva o impacto, os passos mínimos para reproduzir, a área afetada e, se necessário, anexe evidências sem dados reais.

Se a opção de reporte privado não estiver disponível na sua conta, não publique os detalhes. Solicite ao mantenedor, por um canal privado do GitHub, a abertura de um Security Advisory privado.

## Informações recomendadas

Inclua a versão ou commit afetado, o ambiente em que o problema foi observado, o impacto esperado e uma sugestão de correção, quando houver. Remova ou substitua tokens, números de telefone, nomes de clientes, URLs privadas e qualquer outro dado sensível antes do envio.

## Tratamento

O mantenedor fará a triagem de forma privada, avaliará o impacto e coordenará a correção antes de divulgar detalhes técnicos. Relatos de boa-fé não devem explorar dados de clientes além do estritamente necessário para demonstrar o problema.

## Escopo

A política cobre o código, os workflows, as migrações e as integrações mantidas neste repositório, especialmente autenticação, autorização, isolamento entre tenants, webhooks, mensagens, uploads de mídia, CRM e pagamentos.
