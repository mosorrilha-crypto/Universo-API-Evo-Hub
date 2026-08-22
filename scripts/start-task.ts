import { mkdir, open, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

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

async function getNextSequence() {
  const entries = await readdir(registryDir, { withFileTypes: true });
  const lastSequence = entries.reduce((highest, entry) => {
    if (!entry.isFile()) return highest;
    const match = TASK_ID_PATTERN.exec(entry.name);
    if (!match) return highest;
    return Math.max(highest, Number(match[1]));
  }, 0);

  return lastSequence + 1;
}

function buildTaskRecord(taskId: string, description: string, agent: string, startedAt: string) {
  return `# ${taskId} — ${description}\n\n- **Iniciado em:** ${startedAt}\n- **Agente/plataforma:** ${agent}\n- **Issue central:** [#290](https://github.com/mosorrilha-crypto/Universo-API-Evo-Hub/issues/290)\n- **Status:** em andamento\n\n## Objetivo\n\n${description}\n\n## Atualizações\n\nRegistre aqui decisões relevantes, arquivos alterados e bloqueios durante a execução.\n\n## Encerramento\n\nAo concluir, atualize o status, informe os commits e as validações na issue #290 usando o identificador **${taskId}**.\n\n### Modelo de atualização na #290\n\n\`\`\`markdown\n### ${taskId} — ${agent} — ${startedAt}\n\n**Tarefa concluída:** descreva o resultado.\n\n**Arquivos/commits:** informe os links.\n\n**Validação:** informe testes, build ou revisão manual.\n\n**Pendente ou risco:** informe o que ainda precisa de confirmação.\n\`\`\`\n`;
}

async function main() {
  const { description, agent } = parseArgs(process.argv.slice(2));
  await assertCleanWorktree();
  const lockHandle = await acquireLock();

  try {
    const sequence = await getNextSequence();
    const taskId = `TASK-${String(sequence).padStart(4, '0')}`;
    const startedAt = new Date().toISOString();
    const taskPath = path.join(registryDir, `${taskId}.md`);

    await writeFile(taskPath, buildTaskRecord(taskId, description, agent, startedAt), 'utf8');

    console.log(`\n${taskId}`);
    console.log(`Descrição: ${description}`);
    console.log(`Agente/plataforma: ${agent}`);
    console.log(`Registro: ${path.relative(root, taskPath)}`);
    console.log('\nPróximos passos:');
    console.log('1. Leia a issue #290 antes de continuar.');
    console.log(`2. Trabalhe usando o identificador ${taskId}.`);
    console.log('3. Ao finalizar, registre resultado, commits, validações e pendências na issue #290.');
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
