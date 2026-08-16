/**
 * Achado real em produção (16/08/2026): alguns contatos usam o WhatsApp do
 * negócio pra paquerar/assediar a persona da IA (mensagem de voz real:
 * "Hola Morel, ¿cómo estás? Tanto tiempo, amor. Te quiero mucho.") — a IA
 * respondia calorosamente e seguia o script de agendamento normal, gastando
 * transcrição de áudio à toa e sem nenhum operador percebendo. Deliberadamente
 * conservador: só frases fortes e inequívocas, nunca "amor"/"linda"/"reina"
 * soltas, que são vocativos culturais normais no espanhol paraguaio (o
 * próprio toneOfVoice da Monique usa esses termos de volta pra clientes reais
 * com moderação) — testa explicitamente que isso não gera alarme falso.
 */
import { describe, expect, it } from 'vitest';
import { looksLikeHarassment } from '../escalationStore';

describe('looksLikeHarassment', () => {
  it('detecta frases fortes e inequívocas de conteúdo romântico/pessoal', () => {
    expect(looksLikeHarassment('Hola Morel, ¿cómo estás? Tanto tiempo, amor. Te quiero mucho.')).toBe(true);
    expect(looksLikeHarassment('me enamoré de vos')).toBe(true);
    expect(looksLikeHarassment('eres hermosa, quiero conocerte en persona')).toBe(true);
    expect(looksLikeHarassment('¿estás soltera?')).toBe(true);
    expect(looksLikeHarassment('mándame una foto tuya real')).toBe(true);
    expect(looksLikeHarassment('cásate conmigo')).toBe(true);
  });

  it('NÃO dispara em vocativos culturais normais do espanhol paraguaio (mesmos que o toneOfVoice da Monique usa de volta)', () => {
    expect(looksLikeHarassment('Hola amor, ¿tenés horario para el viernes?')).toBe(false);
    expect(looksLikeHarassment('Gracias linda, nos vemos el sábado')).toBe(false);
    expect(looksLikeHarassment('¿Cuánto cuesta el combo, reina?')).toBe(false);
  });

  it('não dispara em dúvida real sobre o negócio', () => {
    expect(looksLikeHarassment('quanto custa o microlips?')).toBe(false);
    expect(looksLikeHarassment('¿tenés disponibilidad el viernes?')).toBe(false);
  });
});
