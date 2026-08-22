## Objetivo

Descreva em poucas linhas o problema e o resultado esperado.

## Checklist de segurança e qualidade

- [ ] Consultei a issue #290 e registrei a tarefa com `npm run task:start` quando aplicável.
- [ ] Verifiquei o isolamento por `tenant_id`; não há leitura ou gravação cruzada entre tenants.
- [ ] Não incluí segredos hardcoded, tokens, dados pessoais, comprovantes ou payloads reais.
- [ ] Se esta alteração depende de migration, confirmei que ela foi aplicada em produção antes do merge; caso contrário, marquei como não aplicável.
- [ ] Executei `npm run lint`.
- [ ] Executei `npx vitest run`.
- [ ] Executei `npm run build`.
- [ ] Informei abaixo se a alteração toca autenticação, pagamento/mensageria ou `tenant_id`.

## Áreas críticas

- [ ] Esta alteração toca autenticação, pagamento/mensageria ou `tenant_id`/isolamento multi-tenant.
- [ ] Se marquei a opção anterior, solicitei revisão explícita e não farei self-merge.
- [ ] A alteração não toca essas áreas críticas.

## Validação manual

Descreva a validação manual realizada, ou informe `Não aplicável`.

## Riscos e pendências

Informe riscos conhecidos, decisões pendentes ou `Nenhum conhecido`.
