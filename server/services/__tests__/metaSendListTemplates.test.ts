/**
 * Achado real de auditoria (Central de Operação por WhatsApp): a rota
 * GET /api/conversations/:phone/templates devolvia 4 templates FICTÍCIOS
 * hardcoded (nomes/preço inventados) pra qualquer tenant — a Meta rejeitaria
 * o envio de verdade, e não havia isolamento por tenant nenhum.
 * `listApprovedMetaMessageTemplates` busca de verdade na conta WhatsApp
 * Business (WABA) real do tenant via Graph API.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listApprovedMetaMessageTemplates } from '../metaSend';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
});

describe('listApprovedMetaMessageTemplates', () => {
  it('sem wabaId ou accessToken: devolve lista vazia sem chamar a Meta (nunca inventa template)', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    expect(await listApprovedMetaMessageTemplates(undefined, 'tok')).toEqual([]);
    expect(await listApprovedMetaMessageTemplates('waba-1', undefined)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('busca no endpoint real da Meta com o wabaId e token do tenant, filtra só APPROVED', async () => {
    const fetchMock = vi.fn(async (url: string, _options?: any) => {
      expect(url).toBe('https://graph.facebook.com/v23.0/waba-real-123/message_templates?fields=name,status,category,language,components&limit=100');
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: 't1',
              name: 'lembrete_consulta_real',
              status: 'APPROVED',
              category: 'UTILITY',
              language: 'pt_BR',
              components: [
                { type: 'BODY', text: 'Olá {{1}}, sua consulta na {{2}} está confirmada.', example: { body_text: [['Maria', 'Clínica Real']] } },
                { type: 'FOOTER', text: 'Responda pra remarcar.' },
              ],
            },
            {
              id: 't2',
              name: 'ainda_em_analise',
              status: 'PENDING',
              category: 'MARKETING',
              language: 'pt_BR',
              components: [{ type: 'BODY', text: 'Não deveria aparecer.' }],
            },
          ],
        }),
      };
    });
    global.fetch = fetchMock as any;

    const result = await listApprovedMetaMessageTemplates('waba-real-123', 'tok-real');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect((options as any).headers.Authorization).toBe('Bearer tok-real');

    expect(result).toEqual([
      {
        id: 't1',
        name: 'lembrete_consulta_real',
        category: 'UTILITY',
        language: 'pt_BR',
        bodyText: 'Olá {{1}}, sua consulta na {{2}} está confirmada.',
        headerText: undefined,
        footerText: 'Responda pra remarcar.',
        variableExamples: ['Maria', 'Clínica Real'],
      },
    ]);
  });

  it('template sem componente BODY (só header de mídia, por exemplo) é descartado — nada pra usar neste fluxo', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 't3', name: 'so_imagem', status: 'APPROVED', category: 'MARKETING', language: 'pt_BR', components: [{ type: 'HEADER', format: 'IMAGE' }] }] }),
    })) as any;

    expect(await listApprovedMetaMessageTemplates('waba-1', 'tok')).toEqual([]);
  });

  it('falha da Meta (ex: token inválido, WABA errado) propaga um erro claro, nunca devolve dado fabricado', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid OAuth access token.' } }),
    })) as any;

    await expect(listApprovedMetaMessageTemplates('waba-1', 'tok-invalido')).rejects.toThrow('Invalid OAuth access token.');
  });
});
