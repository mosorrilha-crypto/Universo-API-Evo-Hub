# Estudo inicial e diagnóstico — 31/10/2026

Base examinada: `main`, commit `f1112b52c0d32891c09fe8d2b482aed218a06f92`. Responsável pela análise: Codex. Escopo: arquitetura, fluxo de mídia recebida, saúde Evolution e histórico recente. Não é uma auditoria exaustiva de cada módulo nem validação de produção.

## Arquitetura verificada no código

| Área | Implementação | Implicação operacional |
| --- | --- | --- |
| Aplicação | React 19/Vite, Express 5/TypeScript no mesmo serviço | Uma publicação atualiza painel e backend; falhas devem ser correlacionadas com o commit realmente implantado. |
| Identidade e isolamento | Cookie de sessão, JWT, tenantResolver e contexto de banco por tenant | Diagnóstico sempre por empresa e instância; nenhum fallback entre tenants. |
| Mensageria | Webhooks Meta/Evolution → parser → conversa → fila/autoReply | Receber a mensagem e persistir seu arquivo são etapas diferentes. |
| Imagens e figurinhas | Webhook → download do provedor → R2 → GET autenticado /api/media/:messageId → RealClientImage | Um erro visual 404 não identifica sozinho se falhou download, upload ou leitura. |
| Áudio | transcriptionQueue → download → persistência/transcrição → resposta | A chave de mídia original também é necessária aqui. |
| IA e agenda | Gemini/Groq, autoReply, safety gate e ferramentas Google Calendar | Fluxo crítico; evitar mudanças junto de incidentes de infraestrutura sem evidência. |
| Persistência | Supabase/Postgres, migrações SQL manuais, R2 com leitura legada Supabase Storage | Confirmar schema implantado e disponibilidade de ambos os storages. |
| Atualização do painel | SSE, com polling de segurança | Estado pending/stored/failed ajuda a distinguir processamento de falha. |
| Saúde Evolution | Job a cada 5 min, push e template Meta | Sem push configurado/template aprovado, não há garantia de entrega de alerta. |

## Achados e correções propostas — TASK-0455

### Chave de download era reconstruída incorretamente

O parser normaliza o telefone da conversa (nono dígito brasileiro) e resolve @lid usando remoteJidAlt. Os consumidores de mídia reconstruíam remoteJid com esse telefone normalizado, descartando a chave original, inclusive fromMe. Isso perde a identidade original da mensagem ao pedir os bytes à Evolution.

Correção: transportar evolutionMessageKey apenas nos eventos de mídia e usá-la em imagens, figurinhas, eco de imagem/áudio enviado pelo celular e fila de áudio. O telefone do CRM continua normalizado. Eventos antigos/sintéticos sem essa chave mantêm o fallback anterior. Testes cobrem @lid, número brasileiro legado e fromMe, incluindo execução do handler real até o armazenamento.

**Limite da conclusão:** defeito confirmado no transporte de identidade; sem payload/log do incidente de hoje, não é possível afirmar que explica todas as imagens ausentes. Também não recupera arquivos históricos que nunca chegaram ao R2.

### Indisponibilidade da API ficava sem alerta

O catch do monitor apenas logava e retornava. Timeout, erro 5xx ou 401 persistente nunca iniciavam o episódio de falha, mesmo após horas.

Correção: registrar api_unavailable, aguardar a mesma tolerância do monitor existente e alertar uma vez por episódio. Push diferencia API indisponível de sessão WhatsApp desconectada. Retorno a open limpa os marcadores. Sem logout, recriação da instância ou reconexão automática. O template WhatsApp existente é reutilizado, sem inventar template não aprovado.

### Migração de mídia requer confirmação em produção

O commit mais recente adicionou `0095_message_media_persistence_status.sql`, e as leituras de conversas já selecionam media_status/media_error incondicionalmente. Se o schema implantado não tiver essas colunas, a consulta falha. Não existe confirmação de aplicação dessa migração nos registros examinados; isso é uma verificação pendente, não prova de que esteja ausente.

## Sequência para fechar o incidente de hoje

1. Confirmar tenant afetado, horário aproximado e um messageId de imagem com erro; verificar se o problema ocorre também em fotos novas.
2. Consultar Render: commit implantado, reinícios, logs do webhook e erros de download/upload/status. Verificar o serviço Evolution separadamente do backend Universo.
3. Consultar Supabase somente em leitura: existência das colunas da migração 0095, media_status/media_error/media_attempts dos exemplos e estado em tenant_evolution_credentials.
4. Consultar connectionState com as credenciais armazenadas de forma segura: distinguir servidor inacessível, chave rejeitada, instância ausente e sessão close/connecting/open. Não recriar instância como primeiro recurso.
5. Verificar no R2 se o objeto media/<messageId codificado> existe. Não expor arquivo de cliente nem credenciais em issue pública.
6. Após revisão e implantação, enviar uma imagem de teste e confirmar: webhook recebido → stored → GET 200 → imagem visível no celular. Validar alerta de API em ambiente controlado.

## Evolução por prioridade

| Prioridade | Entrega | Critério de conclusão |
| --- | --- | --- |
| P0 | Restaurar conexão e confirmar schema/armazenamento | Mensagem nova recebida, arquivo salvo e exibido no dispositivo afetado. |
| P0 | Revisar e implantar TASK-0455 | Testes da chave original e alerta persistente aprovados, smoke test real. |
| P1 | Recovery durável de mídia | Reiniciar processo entre download/upload não perde arquivo; retentativa busca novamente o provedor, não apenas a URL do painel. Exige desenho de persistência da referência original e política de retenção. |
| P1 | Observabilidade por etapa | Correlation ID por mensagem, tempos download/upload/leitura e contagem real de tentativas; hoje attempts recebe 1 mesmo quando withMediaDownloadRetry tenta até três vezes. |
| P1 | Verificação de schema no processo de release | Impedir publicação incompatível com migrações manuais pendentes. |
| P2 | Reduzir acoplamento do Atendimento | Extrair player de mídia e fluxo de conversa do componente grande, mantendo regressões e validação mobile. |
| P2 | Atualizar documentação e saúde operacional | Handoff consistente e alertas com canal de entrega comprovado. |

## Divergências de processo verificadas

- CLAUDE.md e o guia apontam #758 como painel atual, enquanto .github/WORKFLOW.md e os modelos do registro ainda apontam #290/#504. Para esta análise foi lida #758, sem alterar threads históricas.
- Os quatro commits mais recentes de mídia (até 28/10) não aparecem nos últimos relatos da #758, cujo último comentário é de 06/10. Por isso o status documental não prova o estado implantado.
- A execução de task:start foi tentada; o CLI tsx não abriu seu pipe neste ambiente. Via node --import tsx o script executou, mas o push Git não tem credenciais. A reserva task-claim/0455 foi criada pela integração autenticada do GitHub; alterações serão publicadas por essa mesma integração.

## Acesso operacional

GitHub confirmado. Render e Supabase foram encontrados como integrações disponíveis, mas ainda precisam de instalação/autorização do titular. Sem esses acessos, esta entrega não declara a causa da queda de 31/10 nem a conexão restaurada. Nenhum dado ou configuração de produção foi alterado nesta análise.

## Validação local

Typecheck e build aprovados. Oito arquivos de testes direcionados (34 testes) aprovados; os testes de regressão falham no código anterior e passam com a correção. A suíte completa identifica duas falhas preexistentes, reproduzidas também no checkout original: expectativa de headers sem AbortSignal no teste de legacySupabaseStorage e chamada esperada de cadastro no teste AgendaFinanceiroCenter.catalogService. Nenhum dos dois testes foi modificado nesta entrega. O build mantém aviso de bundle frontend grande, compatível com a recomendação de reduzir o acoplamento do Atendimento.
