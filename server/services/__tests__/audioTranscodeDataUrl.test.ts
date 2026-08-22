import { describe, expect, it } from 'vitest';
import { stripDataUrlPrefix } from '../audioTranscode';

describe('stripDataUrlPrefix', () => {
  it('remove o Data URL de OGG com codecs=opus sem alterar os bytes codificados', () => {
    const oggBytes = Buffer.from('OggS\u0000OpusHead\u0001\u00018>\u0000\u0000\u0000\u0000\u0000\u0000');
    const encoded = oggBytes.toString('base64');

    const cleaned = stripDataUrlPrefix(`data:audio/ogg;codecs=opus;base64,${encoded}`);

    expect(cleaned).toBe(encoded);
    expect(Buffer.from(cleaned, 'base64')).toEqual(oggBytes);
    expect(Buffer.from(cleaned, 'base64').subarray(0, 4).toString('ascii')).toBe('OggS');
  });

  it('mantém base64 puro e remove Data URLs sem parâmetros de codec', () => {
    const encoded = Buffer.from('audio').toString('base64');
    expect(stripDataUrlPrefix(encoded)).toBe(encoded);
    expect(stripDataUrlPrefix(`data:audio/ogg;base64,${encoded}`)).toBe(encoded);
  });
});
