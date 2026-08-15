/**
 * Complemento ao modo "somente anúncios" (agentStatusAdsOnly.test.ts):
 * achado real em produção (15/08/2026) — o ctwa_clid quase nunca vem
 * preenchido no tráfego real de anúncio, então o tenant cadastra o texto
 * exato do "ice breaker" que a Meta oferece no botão do anúncio pra
 * identificar esses leads mesmo sem ctwa_clid (ver matchesAdTriggerMessage).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { initDb } from '../db';
import { createFakeSupabase } from './fakeSupabase';
import { getAdTriggerMessages, setAdTriggerMessages, matchesAdTriggerMessage } from '../agentStatus';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  initDb(createFakeSupabase());
});

describe('getAdTriggerMessages / setAdTriggerMessages', () => {
  it('lista vazia quando nunca configurado', async () => {
    expect(await getAdTriggerMessages(TENANT_A)).toEqual([]);
  });

  it('grava e devolve a lista configurada', async () => {
    await setAdTriggerMessages(TENANT_A, [
      'Me gustaría reservar un horario para el combo de cejas y labios 💕',
      '¡Hola! Vi el anuncio y me gustaría agendar un horario. 😊',
    ]);
    expect(await getAdTriggerMessages(TENANT_A)).toEqual([
      'Me gustaría reservar un horario para el combo de cejas y labios 💕',
      '¡Hola! Vi el anuncio y me gustaría agendar un horario. 😊',
    ]);
  });

  it('isolado por tenant', async () => {
    await setAdTriggerMessages(TENANT_A, ['Quiero agendar']);
    expect(await getAdTriggerMessages(TENANT_B)).toEqual([]);
  });

  it('substitui a lista inteira (não faz merge)', async () => {
    await setAdTriggerMessages(TENANT_A, ['Primeira', 'Segunda']);
    await setAdTriggerMessages(TENANT_A, ['Terceira']);
    expect(await getAdTriggerMessages(TENANT_A)).toEqual(['Terceira']);
  });
});

describe('matchesAdTriggerMessage', () => {
  const triggers = ['Me gustaría reservar un horario para el combo de cejas y labios 💕'];

  it('bate com o texto idêntico', () => {
    expect(matchesAdTriggerMessage('Me gustaría reservar un horario para el combo de cejas y labios 💕', triggers)).toBe(true);
  });

  it('bate ignorando maiúsculas/minúsculas e espaços nas pontas', () => {
    expect(matchesAdTriggerMessage('  ME GUSTARÍA RESERVAR UN HORARIO PARA EL COMBO DE CEJAS Y LABIOS 💕  ', triggers)).toBe(true);
  });

  it('NÃO bate com mensagem parecida mas diferente (evita falso positivo de cliente orgânico)', () => {
    expect(matchesAdTriggerMessage('quería reservar un horario', triggers)).toBe(false);
  });

  it('NÃO bate com texto vazio', () => {
    expect(matchesAdTriggerMessage('', triggers)).toBe(false);
    expect(matchesAdTriggerMessage('   ', triggers)).toBe(false);
  });

  it('lista de gatilhos vazia nunca bate com nada', () => {
    expect(matchesAdTriggerMessage('qualquer coisa', [])).toBe(false);
  });

  it('achado real (15/08/2026): bate quando o lead emenda algo depois do gatilho sem espaço (ex: "hola" colado no fim)', () => {
    expect(matchesAdTriggerMessage('Me gustaría reservar un horario para el combo de cejas y labios 💕hola', triggers)).toBe(true);
    expect(matchesAdTriggerMessage('Me gustaría reservar un horario para el combo de cejas y labios 💕 hola, buenas!', triggers)).toBe(true);
  });

  it('continua NÃO batendo quando o texto do gatilho aparece no MEIO/FIM, não como prefixo (não virou substring solto)', () => {
    expect(matchesAdTriggerMessage('hola, Me gustaría reservar un horario para el combo de cejas y labios 💕', triggers)).toBe(false);
  });
});
