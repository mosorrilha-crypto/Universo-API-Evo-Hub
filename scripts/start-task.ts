import { mkdir, open, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';

const TASK_ID_PATTERN = /^TASK-(\d{4,})\.md$/;
const LOCK_STALE_AFTER_MS = 5 * 60 * 1000;
const LOCK_RETRY_COUNT = 50;
const LOCK_RETRY_DELAY_MS = 100;

const root = process.cwd();
const registryDir = path.join(root, 'docs', 'task-registry');
const lockPath = path.join(registryDir, '.sequence.lock');
const execFile = promisify(execFileCallback);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(args: string[]) {
  const descriptionParts: string[] = [];
  let agent = process.env.TASK_AGENT?.trim() || 'não informado';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--agent') {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error('O argumento --agent precisa receber um nome.');
      }
      agent = value;
      index += 1;
      continue;
    }
    descriptionParts.push(arg);
  }

  const description = descriptionParts.join(' ').trim();
  if (!description) {
    throw new Error('Informe a descrição da tarefa. Ex.: npm run task:start -- "corrigir histórico"');
  }

  return { description, agent };
}

async function assertCleanWorktree() {
  try {
    const { stdout } = await execFile('git', ['status', '--porcelain=v1'], { cwd: root });
    if (stdout.trim()) {
      throw new Error('O checkout possui alterações ou conflitos. Faça commit/stash e sincronize a main antes de gerar outro TASK-XXXX.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('O checkout possui alterações')) throw error;
    throw new Error(`Não foi possível verificar o estado do Git antes de gerar a tarefa: ${(error as Error).message}`);
  }
}

async function acquireLock() {
  await mkdir(registryDir, { recursive: true });

  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}\n`);
      return handle;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }

      try {
        const lockStats = await stat(lockPath);
        if (Date.now() - lockStats.mtimeMs > LOCK_STALE_AFTER_MS) {
          await unlink(lockPath);
          continue;
        }
      } catch {
        // A outra execução pode ter liberado o lock entre stat e unlink.
      }

      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }

  throw new Error('Não foi possível reservar a sequência: o registro está bloqueado por outra execução.');
}

async function getLocalMaxSequence() {
  const entries = await readdir(registryDir, { withFileTypes: true });
  return entries.reduce((highest, entry) => {
    if (!entry.isFile()) return highest;
    const match = TASK_ID_PATTERN.exec(entry.name);
    if (!match) return highest;
    return Math.max(highest, Number(match[1]));
  }, 0);
}

const CLAIM_REF_PREFIX = 'task-claim';
const CLAIM_HEAD_PATTERN = /refs\/heads\/task-claim\/(\d{4,})$/;
const CLAIM_RETRY_COUNT = 30;

/**
 * O maior TASK-XXXX.md commitado localmente só reflete o que ESTA sessão já
 * viu — duas sessões em checkouts diferentes (ex: Claude e Manus.Ai) podem
 * ler o mesmo "último número" ao mesmo tempo e gerar o mesmo próximo, mesmo
 * sincronizando a main antes (achado real, 23-24/08/2026: colidiu comigo
 * duas vezes e com outra sessão uma vez na mesma janela). O remote é a
 * única fonte compartilhada de verdade.
 *
 * `git push` de uma ref nova é atômico no servidor — mas duas sessões
 * limpas sincronizadas com a mesma `main` costumam estar no MESMO commit,
 * então empurrar esse commit pro mesmo nome de branch novo não colide (a
 * segunda tentativa vê "Everything up-to-date" e sai com sucesso, porque
 * pra um branch, git só rejeita quando os SHAs divergem — não quando são
 * iguais). Por isso cada tentativa de reserva cria antes um commit vazio
 * local (mensagem com nonce aleatório) só pra gerar um SHA garantidamente
 * único, empurra ESSE SHA pra `refs/heads/task-claim/XXXX` e devolve o
 * checkout pro HEAD original em seguida — quem empurrar primeiro fica com
 * o número; a segunda tentativa recebe uma rejeição real (non-fast-forward)
 * porque os SHAs agora são diferentes de verdade, e tenta o próximo número.
 * (Tags seriam mais idiomáticas pra isso, mas `refs/tags/*` está bloqueado
 * pelas credenciais de push desta sessão — confirmado por teste real,
 * 24/08/2026; `refs/heads/*` funciona normalmente.) Os branches de reserva
 * ficam pra sempre — são só uma trava, não apontam pra nada que precise
 * revisão, e apagar ref remota também está bloqueado pra esta sessão.
 */
async function getRemoteMaxSequence(): Promise<number> {
  const { stdout } = await execFile('git', ['ls-remote', '--heads', 'origin', `refs/heads/${CLAIM_REF_PREFIX}/*`], { cwd: root });
  return stdout
    .split('\n')
    .reduce((highest, line) => {
      const match = CLAIM_HEAD_PATTERN.exec(line.trim());
      if (!match) return highest;
      return Math.max(highest, Number(match[1]));
    }, 0);
}

async function claimSequence(startCandidate: number): Promise<number> {
  const { stdout: originalHeadOut } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: root });
  const originalHead = originalHeadOut.trim();

  let candidate = startCandidate;
  for (let attempt = 0; attempt < CLAIM_RETRY_COUNT; attempt += 1) {
    const claimRef = `refs/heads/${CLAIM_REF_PREFIX}/${String(candidate).padStart(4, '0')}`;
    const nonce = randomBytes(6).toString('hex');

    let claimSha: string;
    try {
      await execFile('git', ['commit', '--allow-empty', '-m', `chore: reserva ${claimRef} (${nonce})`], { cwd: root });
      const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: root });
      claimSha = stdout.trim();
    } finally {
      // Sempre volta o checkout pro HEAD original, empurrado ou não — o
      // commit vazio existe só pra ter um SHA único pra reservar a ref,
      // nunca deve sobrar no branch real de quem está rodando o comando.
      await execFile('git', ['reset', '--hard', originalHead], { cwd: root });
    }

    try {
      await execFile('git', ['push', 'origin', `${claimSha}:${claimRef}`], { cwd: root });
      return candidate;
    } catch (error) {
      const message = (error as { stderr?: string; message?: string }).stderr || (error as Error).message || '';
      if (/already exists|stale info|fetch first|non-fast-forward|rejected/i.test(message)) {
        candidate += 1;
        continue;
      }
      throw new Error(`Não foi possível reservar ${claimRef} no remote: ${message.trim() || error}`);
    }
  }
  throw new Error(`Não foi possível reservar um número de sequência após ${CLAIM_RETRY_COUNT} tentativas — muita concorrência ao mesmo tempo.`);
}

function buildTaskRecord(taskId: string, description: string, agent: string, startedAt: string) {
  return `# ${taskId} — ${description}\n\n- **Iniciado em:** ${startedAt}\n- **Agente/plataforma:** ${agent}\n- **Issue central:** [#504](https://github.com/mosorrilha-crypto/Universo-API-Evo-Hub/issues/504)\n- **Status:** em andamento\n\n## Objetivo\n\n${description}\n\n## Atualizações\n\nRegistre aqui decisões relevantes, arquivos alterados e bloqueios durante a execução.\n\n## Encerramento\n\nAo concluir, atualize o status, informe os commits e as validações na issue #504 usando o identificador **${taskId}**.\n\n### Modelo de atualização na #504\n\n\`\`\`markdown\n### ${taskId} — ${agent} — ${startedAt}\n\n**Tarefa concluída:** descreva o resultado.\n\n**Arquivos/commits:** informe os links.\n\n**Validação:** informe testes, build ou revisão manual.\n\n**Pendente ou risco:** informe o que ainda precisa de confirmação.\n\`\`\`\n`;
}

async function main() {
  const { description, agent } = parseArgs(process.argv.slice(2));
  await assertCleanWorktree();
  const lockHandle = await acquireLock();

  try {
    const [localMax, remoteMax] = await Promise.all([getLocalMaxSequence(), getRemoteMaxSequence()]);
    const sequence = await claimSequence(Math.max(localMax, remoteMax) + 1);
    const taskId = `TASK-${String(sequence).padStart(4, '0')}`;
    const startedAt = new Date().toISOString();
    const taskPath = path.join(registryDir, `${taskId}.md`);

    await writeFile(taskPath, buildTaskRecord(taskId, description, agent, startedAt), 'utf8');

    console.log(`\n${taskId}`);
    console.log(`Descrição: ${description}`);
    console.log(`Agente/plataforma: ${agent}`);
    console.log(`Registro: ${path.relative(root, taskPath)}`);
    console.log(`Reservado no remote: refs/heads/${CLAIM_REF_PREFIX}/${String(sequence).padStart(4, '0')} (garante que nenhuma outra sessão gere este mesmo número)`);
    console.log('\nPróximos passos:');
    console.log('1. Leia a issue #504 antes de continuar.');
    console.log(`2. Trabalhe usando o identificador ${taskId}.`);
    console.log('3. Ao finalizar, registre resultado, commits, validações e pendências na issue #504.');
    console.log('4. Inclua o arquivo de registro no commit da tarefa para compartilhar a sequência com outros agentes.');
  } finally {
    await lockHandle.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

try {
  await main();
} catch (error) {
  console.error(`Erro ao iniciar tarefa: ${(error as Error).message}`);
  process.exitCode = 1;
}
