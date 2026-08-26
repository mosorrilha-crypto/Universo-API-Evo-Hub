# Rollout de RLS efetivo no runtime

A migration `0049_rls_jwt_tenant_runtime.sql` transforma as policies existentes para usar o claim `tenant_id` de um JWT curto enviado ao PostgREST. O backend continua mantendo a chave secreta de plataforma somente para operações explicitamente cross-tenant, como administração global, resolução de canal e o catálogo público.

> **Não aplique a migration sem configurar as duas variáveis de runtime.** Em produção, a nova configuração faz o servidor recusar iniciar sem elas, para não voltar silenciosamente ao bypass de RLS.

## Variáveis necessárias

| Variável | Finalidade | Onde obter |
|---|---|---|
| `SUPABASE_PUBLISHABLE_KEY` | Chave publicável usada pelo cliente tenant-scoped | Supabase Dashboard → Project Settings → API Keys |
| `SUPABASE_JWT_SECRET` | Segredo que assina o JWT interno curto com o `tenant_id` validado | Supabase Dashboard → Project Settings → JWT / JWT signing secret |
| `SUPABASE_KEY` | Chave secreta de plataforma, já existente | Manter apenas no backend; nunca expor ao frontend |

O segredo de assinatura não deve ser adicionado ao repositório, à interface do navegador ou a logs. Qualquer pessoa que possua esse segredo pode forjar JWTs para o projeto.

## Ordem segura de produção

1. Cadastre `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_JWT_SECRET` no provedor que executa o backend. A versão atual do código ainda em produção não consome essas variáveis, portanto esta etapa é segura.
2. Aplique a migration `0049_rls_jwt_tenant_runtime.sql` ao projeto Supabase. A versão antiga do backend continua operando com a chave de plataforma durante a transição.
3. Publique a versão do backend que contém `tenantDbContext`, o cliente tenant-scoped e as alterações de middleware.
4. Faça login com um operador de tenant A e valide leitura e escrita de uma conversa pertencente a A.
5. Tente acessar, com o mesmo token, um recurso conhecido de tenant B. A resposta deve ser vazia, `404` ou erro de policy; ela nunca pode conter dados de B.
6. Valide um webhook real ou controlado para cada provedor ativo. Após resolver o canal, suas gravações devem passar pelo contexto RLS do tenant correspondente.
7. Consulte os alertas de segurança do Supabase e os logs do backend nas primeiras 24 horas.

## Comportamento do código

| Caminho | Cliente de banco | Proteção |
|---|---|---|
| Rotas autenticadas | Chave publicável + JWT curto | RLS filtra por `auth.jwt()->>'tenant_id'` |
| Processamento de webhook após resolver canal | Chave publicável + JWT curto | Mesmo tenant do canal validado |
| Recuperação assíncrona de buffer | Chave publicável + JWT curto | Tenant persistido no buffer |
| Administração global, resolução de canal e catálogo público | Chave de plataforma explícita | Chamadores auditáveis e restritos ao backend |

## Rollback

Se for necessário reverter a aplicação, a chave de plataforma continua permitindo a versão anterior operar. Não remova as policies de RLS como rollback padrão: primeiro investigue o erro de contexto, JWT ou credencial. Uma reversão de policy deve ser tratada como uma nova migration revisada, pois remover RLS reabre o risco de vazamento cross-tenant.
