# Como pegar e executar trabalho neste repo

## Abertura obrigatória de toda nova conversa de desenvolvimento

Antes de analisar, editar código, alterar configuração ou escolher uma tarefa,
leia a issue [#290](https://github.com/mosorrilha-crypto/Universo-API-Evo-Hub/issues/290)
("[PAINEL] Status consolidado do backlog"). Ela é o painel único e vivo com
o backlog real, o estado mais recente do sistema e os handoffs compartilhados
entre Manus.Ai, Claude e outras plataformas. Confirme nela se a tarefa já foi
realizada, está em andamento, bloqueada ou aguardando validação. Em seguida,
leia este workflow e `CLAUDE.md` antes de executar o trabalho.

Ao finalizar qualquer tarefa, registre na #290 um comentário ou atualização
contendo o identificador sequencial da tarefa, o responsável, a data, o que foi
concluído, os arquivos/commits, as validações e as pendências. Não presuma que
uma nova conversa consiga enxergar o histórico de outra sessão.

**A #290 é a issue canônica.** Não abra uma nova issue apenas para registrar uma
sessão ou um handoff. A issue #357 foi encerrada como duplicata depois que seu
conteúdo de ponte foi incorporado à #290.

Para iniciar uma tarefa, gere primeiro um identificador compartilhado:

```bash
npm run task:start -- --agent "Manus.Ai" "descrição da tarefa"
```

O comando cria o próximo identificador (`TASK-0001`, `TASK-0002`, etc.) e um
registro em `docs/task-registry/`. Inclua esse registro no commit da tarefa e
use o mesmo identificador no comentário de conclusão da issue #290. Como a
sequência é compartilhada por Git, atualize a branch antes de iniciar quando
houver possibilidade de outra sessão ter criado uma tarefa simultaneamente.

## Onde encontrar trabalho

Migrado do board Trello "Universo — Backlog Técnico" (lista "📜 Diretrizes") em
2026-08-09 — GitHub (issues + PRs) passou a ser o canal oficial de trabalho e
status, no lugar do Trello.

## Onde encontrar trabalho

- **Pronto pra pegar**: issues abertas com a label `backlog` E sem ninguém
  atribuído (`assignee`). Pegue sempre a mais antiga entre as de prioridade
  mais alta (labels `P0`/🔴 no título têm prioridade sobre o resto), nunca
  duas issues em paralelo na mesma branch.
- **Bloqueada**: label `blocked` — precisa de decisão de negócio ou
  dependência externa antes de codar. Não tente resolver sozinho; comente a
  pergunta específica na issue.
- **Em execução**: label `in-progress` (issue já reivindicada — ver seção
  abaixo) e/ou uma branch/PR (mesmo draft) já vinculada à issue.
- **Aguardando revisão**: um PR aberto, não-draft (ou draft pedindo review
  explicitamente no corpo) já É esse status.
- **Concluído**: issue fechada + PR mergeado referenciando ela (`Closes #N`
  no corpo do PR). Não recrie o que já virou PR mergeado — o histórico de PR
  já é o registro.

## Reivindicar uma issue antes de codar (múltiplos agentes em paralelo)

Várias sessões podem estar rodando ao mesmo tempo neste repo. Sem um sinal
explícito de "peguei", duas sessões podem escolher a mesma issue no mesmo
minuto e gerar branches/PRs conflitantes pro mesmo problema. Protocolo:

1. **Reconsulte a issue na hora**, não confie em uma lista vista há alguns
   minutos — outra sessão pode ter reivindicado nesse intervalo.
2. **Antes de escrever qualquer código**, faça as duas coisas juntas (na
   mesma resposta, sem pausa entre elas):
   - troque a label `backlog` por `in-progress`;
   - atribua a issue a si mesmo (`assignees`) — mesmo que todas as sessões
     compartilhem a mesma identidade de commit/API, o campo `assignee`
     preenchido já é o sinal de "está em uso", suficiente pra outra sessão
     pular essa issue.
   - opcional mas recomendado: comente com o nome da branch que você vai usar.
3. **Se ao reconsultar a issue ela já não tiver mais `backlog` ou já estiver
   atribuída**, outra sessão chegou primeiro — solte e pegue a próxima da
   lista. Não abra uma segunda branch pro mesmo problema.
4. **Colisão mesmo assim** (duas sessões reivindicaram quase ao mesmo
   tempo): quem abrir o PR primeiro segue normalmente; a outra sessão, ao
   tentar abrir o PR e notar que já existe um cobrindo a mesma issue,
   comenta reconhecendo a colisão, descarta/fecha o que tiver feito, e pega
   a próxima issue disponível — não force merge nem dispute a mesma issue.
5. Ao terminar (PR aberto ou mergeado), a label `in-progress` pode ficar —
   o PR vinculado já deixa claro que não é mais "pronto pra pegar"; ela some
   naturalmente quando a issue fecha.

## Regras de execução

1. **Canal oficial de status é o GitHub**: comente na issue ao começar, ao
   terminar, ou ao travar num bloqueio real — não narre passo a passo (não
   comente a cada arquivo editado).
2. **Autorização permanente**: siga a issue do início ao fim sem pausar pra
   perguntar "posso continuar?" — vale pra issue do backlog e pra pedido
   direto no chat.
3. **Uma issue por branch**, nunca duas em paralelo, exceto quando duas
   issues são a mesma causa raiz e o dono do produto autoriza explicitamente
   combinar (registre isso no PR). Reivindique a issue (ver seção acima)
   antes de começar, pra outra sessão rodando em paralelo não pegar a mesma.
4. **Bloqueio real**: comente na issue exatamente o que travou. Não tente
   resolver algo que exige decisão de negócio — pare e pergunte.
5. **Nunca mergeie seu próprio PR** quando o PR tocar autenticação,
   pagamento/mensageria ou `tenant_id`/isolamento multi-tenant — abra o PR e
   peça revisão explícita. Fora dessas três áreas, self-merge é permitido se
   `npm run lint`, `npx vitest run` e `npm run build` estiverem limpos e o
   escopo bater com o que a issue pedia.
6. **Migration nova**: nunca mergear código que dependa de uma tabela/coluna
   nova sem confirmação explícita de que a migration já rodou em produção
   (aplicada manualmente via SQL Editor do Supabase — não há migration
   runner neste projeto).
7. **Sempre em português**: commits, título/corpo de PR, comentários.
8. **Pedido direto fora de uma issue**: responda objetivo em 1-2 frases o
   que entendeu, depois execute sem pedir "posso começar?".
9. **Nunca rode script que grave em produção** (ex: `npm run seed:monique-kb`,
   `npm run migrate:legacy-data`) sem pedido explícito naquele momento
   específico.
10. **"Como está o andamento"** já deveria estar visível na issue (label +
    comentário) — não repita tudo no chat, só confirme e aponte pro link.

## Convenções de negócio fora do código

Nem toda diretriz é sobre commitar código — algumas são combinados
operacionais que afetam como o dado é lido depois. Exemplo real: a convenção
de prefixar `[IND]`/`[ORG]`/`[?]` no título de eventos da agenda do Google
Calendar pra marcar a origem do lead (indicação vs. orgânico) quando não veio
de anúncio — ver issue de referência linkada no board antigo. Esse tipo de
combinado fica documentado como issue de referência (label `docs`, sem
ficar "pronta pra pegar"), não se perde numa lista separada.
