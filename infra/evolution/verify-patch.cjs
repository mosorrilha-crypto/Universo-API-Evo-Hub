'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { patchSource, VERSION, MARKER } = require('./patch-status.cjs');

const directory = process.env.BAILEYS_DIR || '/evolution/node_modules/baileys';
const version = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
const installed = fs.readFileSync(path.join(directory, 'lib/Socket/messages-recv.js'), 'utf8');
const source = patchSource(installed, version);

// Executa as funções REAIS do módulo compilado da imagem, sem socket externo,
// credenciais, conexão com WhatsApp ou imports do restante da aplicação.
function socket(options = {}) {
  const ackStart = source.indexOf('    const sendMessageAck = ');
  const ackEnd = source.indexOf('    const rejectCall = ', ackStart);
  const queueStart = source.indexOf('    const processNodeWithBuffer = ');
  const queueEnd = source.indexOf("    ev.on('call',", queueStart);
  assert.ok(ackStart >= 0 && ackEnd > ackStart && queueStart >= 0 && queueEnd > queueStart);
  const ws = new EventEmitter();
  ws.isOpen = true;
  const sent = [], errors = [], messages = [];
  const sandbox = {
    ws,
    ev: { buffer() {}, flush() {} },
    logger: { debug() {} },
    sendNode: async stanza => { if (options.send) await options.send(stanza); sent.push(stanza); },
    onUnexpectedError: (error, where) => errors.push({ message: error.message, where }),
    handleMessage: async node => messages.push(node.attrs.id),
    handleCall: async () => {}, handleReceipt: async () => {},
    handleNotification: options.notification || (async () => {}),
    handleBadAck: async () => {},
  };
  vm.runInNewContext(source.slice(ackStart, ackEnd) + source.slice(queueStart, queueEnd), sandbox, { timeout: 1000 });
  return { sent, errors, messages, emit: async (type, node) => {
    const handlers = ws.listeners(`CB:${type}`);
    assert.equal(handlers.length, 1);
    await handlers[0](node);
  } };
}
const node = (id, offline = false) => ({ tag: 'status', attrs: {
  id, from: 'sender@s.whatsapp.net', type: 'media',
  participant: 'participant@s.whatsapp.net', recipient: 'recipient@s.whatsapp.net',
  ...(offline ? { offline: 'true' } : {}),
} });
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

test('ACK Status real mantém classe, tipo, participante e destinatário, sem NACK', async () => {
  const s = socket();
  await s.emit('status', node('live'));
  assert.equal(s.sent.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(s.sent[0])), { tag: 'ack', attrs: {
    id: 'live', to: 'sender@s.whatsapp.net', class: 'status', type: 'media',
    participant: 'participant@s.whatsapp.net', recipient: 'recipient@s.whatsapp.net',
  } });
  assert.equal(s.errors.length, 0);
});

test('Status offline é confirmado antes da mensagem seguinte da fila', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const s = socket({ send: () => gate });
  await s.emit('status', node('offline', true));
  await s.emit('message', { tag: 'message', attrs: { id: 'next', offline: 'true' } });
  assert.equal(s.sent.length, 0);
  assert.equal(s.messages.length, 0);
  release();
  await flush();
  assert.equal(s.sent[0].attrs.id, 'offline');
  assert.deepEqual(s.messages, ['next']);
});

test('notificação defeituosa em rc.9 não trava Status e mensagens pendentes', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const s = socket({ notification: async () => { await gate; throw new Error('w:gp2'); } });
  await s.emit('notification', { tag: 'notification', attrs: { offline: 'true' } });
  await s.emit('status', node('after-failure', true));
  await s.emit('message', { tag: 'message', attrs: { id: 'recovered', offline: 'true' } });
  release();
  await flush();
  assert.equal(s.errors[0].message, 'w:gp2');
  assert.equal(s.sent[0].attrs.id, 'after-failure');
  assert.deepEqual(s.messages, ['recovered']);
  await s.emit('status', node('later', true));
  await flush();
  assert.equal(s.sent[1].attrs.id, 'later');
});

test('falha de ACK é registrada e não deixa rejeição nem fila travada', async () => {
  let calls = 0;
  const s = socket({ send: async () => { if (++calls === 1) throw new Error('send failed'); } });
  await s.emit('status', node('failed', true));
  await s.emit('status', node('success', true));
  await flush();
  assert.equal(s.errors[0].where, 'acking status stanza');
  assert.equal(s.sent[0].attrs.id, 'success');
});

test('patch é idempotente, exige rc.9 e recusa fonte parcialmente alterada', () => {
  assert.equal(version, VERSION);
  assert.equal(patchSource(source, version), source);
  assert.throws(() => patchSource(installed, '7.0.0-rc14'), /incompatível/);
  assert.throws(() => patchSource(source.replace("['status', handleStatus]", ''), version), /parcial/);
  assert.ok(source.includes(MARKER));
});
