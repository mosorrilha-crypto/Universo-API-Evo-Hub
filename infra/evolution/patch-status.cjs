'use strict';
// Backport de WhiskeySockets/Baileys#2883 para o JS compilado de rc.9.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSION = '7.0.0-rc.9';
const MARKER = 'evolution-status-ack:v1';
const HANDLER = `    // ${MARKER}
    const handleStatus = async (node) => {
        try {
            await sendMessageAck(node);
        } catch (error) {
            onUnexpectedError(error, 'acking status stanza');
        }
    };
`;
const LISTENER = `    ws.on('CB:status', async (node) => {
        await processNode('status', node, 'acking status stanza', handleStatus)
            .catch(error => onUnexpectedError(error, 'acking status stanza'));
    });
`;
const QUEUE_GUARD = `                    try {
                        await nodeProcessor(node);
                    } catch (error) {
                        onUnexpectedError(error, 'processing offline node');
                    }`;

function once(source, anchor, replacement) {
  if (source.split(anchor).length !== 2) throw new Error('Âncora Baileys ausente ou ambígua; patch recusado');
  return source.replace(anchor, replacement);
}

function patchSource(source, version) {
  if (version !== VERSION) throw new Error(`Baileys incompatível: ${version}; esperado ${VERSION}`);
  if (source.includes(MARKER)) {
    if (![HANDLER, LISTENER, QUEUE_GUARD, "['status', handleStatus]"].every(part => source.includes(part))) {
      throw new Error('Patch parcial ou modificado; build recusado');
    }
    return source;
  }
  if (source.includes('CB:status')) throw new Error('Handler Status preexistente; revisar antes de aplicar');
  let patched = once(source, '    const makeOfflineNodeProcessor = () => {', `${HANDLER}    const makeOfflineNodeProcessor = () => {`);
  patched = once(patched, "            ['notification', handleNotification]\n", "            ['notification', handleNotification],\n            ['status', handleStatus]\n");
  // rc.9 não protege cada item: uma notificação defeituosa trava toda a fila.
  patched = once(patched, '                    await nodeProcessor(node);', QUEUE_GUARD);
  patched = once(patched, "    ws.on('CB:ack,class:message',", `${LISTENER}    ws.on('CB:ack,class:message',`);
  return patched;
}

function patchPackage(directory) {
  const version = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
  const target = path.join(directory, 'lib/Socket/messages-recv.js');
  const source = fs.readFileSync(target, 'utf8');
  const patched = patchSource(source, version);
  if (source === patched) return false;
  const temporary = `${target}.status-ack-check.mjs`;
  try {
    fs.writeFileSync(temporary, patched, { flag: 'wx' });
    const check = spawnSync(process.execPath, ['--check', temporary], { encoding: 'utf8' });
    if (check.status !== 0) throw new Error('Sintaxe do patch inválida; original preservado');
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return true;
}

module.exports = { patchSource, patchPackage, VERSION, MARKER };
if (require.main === module) {
  const changed = patchPackage(process.argv[2] || '/evolution/node_modules/baileys');
  console.log(`[Evolution Status ACK] ${changed ? 'aplicado' : 'já aplicado'}; Baileys ${VERSION}`);
}
