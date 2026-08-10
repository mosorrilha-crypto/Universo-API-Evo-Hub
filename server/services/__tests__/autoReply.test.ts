/**
 * Etapa 3 do agente vertical (docs/AGENTE-VERTICAL-ARQUITETURA.md, seções 1 e
 * 7): o prompt de resposta do especialista deixou de ser uma string única
 * concatenada — camadas 1+2 (global/segmento, fixas) vão em
 * `systemInstruction`, camadas 3+4 (tenant/dinâmico) + histórico vão em
 * `contents`. Este teste trava essa separação: se alguém voltar a
 * concatenar tudo numa string só, ele quebra.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';

const uploadWhatsAppMedia = vi.fn(async () => 'media-id-123');
const sendWhatsAppMediaMessage = vi.fn(async () => undefined);
const recordOutgoingMessage = vi.fn(async () => ({}) as any);
const PRODUCT_WITH_PHOTO = { name: 'Microlips', price: 'Gs 500.000', exampleImageBase64: 'data:image/jpeg;base64,QQ==', exampleImageMimeType: 'image/jpeg' };
const getKnowledgeBase = vi.fn(async () => ({ products: [PRODUCT_WITH_PHOTO] }));

vi.mock('../metaSend', () => ({ uploadWhatsAppMedia, sendWhatsAppMediaMessage }));
vi.mock('../conversationStore', () => ({ recordOutgoingMessage }));
vi.mock('../knowledgeBaseStore', () => ({ getKnowledgeBase, resolveProductPriceAmount: vi.fn(() => 0), isNonBookableProduct: vi.fn(() => false) }));

const { generateAutoReplyForText } = await import('../autoReply');

const KB_MARKER = 'Retoque Gs 150.000 — MARCADOR-DE-BASE-DE-CONHECIMENTO';
const SPECIALIST_REPLY = { phase: 'informacao', bubbles: ['Oi! O retoque sai Gs 150.000.'], needsHumanConfirmation: false };

function makeFakeAi() {
  const calls: any[] = [];
  const ai = {
    models: {
      generateContent: async (req: any) => {
        calls.push(req);
        const isRouterCall = req.contents[0].text.includes('Classifique a intenção principal');
        if (isRouterCall) return { text: JSON.stringify({ agent: 'faq' }) } as any;
        return { text: JSON.stringify(SPECIALIST_REPLY) } as any;
      },
    },
  } as unknown as GoogleGenAI;
  return { ai, calls };
}

describe('generateAutoReplyForText — camadas do prompt (Etapa 3)', () => {
  it('manda camada global/segmento em systemInstruction, e tenant/dinâmico/histórico em contents', async () => {
    const { ai, calls } = makeFakeAi();

    const result = await generateAutoReplyForText(
      'tenant-a',
      ai,
      'quanto custa o retoque?',
      'Cliente Teste',
      KB_MARKER,
      [{ sender: 'lead', text: 'oi' }],
      undefined,
      undefined,
      'beauty_studio'
    );

    expect(result).not.toBeNull();
    expect(result?.bubbles).toEqual(SPECIALIST_REPLY.bubbles);

    const specialistCall = calls[1];
    const systemInstruction: string = specialistCall.config.systemInstruction;
    const userContent: string = specialistCall.contents[0].text;

    // Camada 1 (global): regras fixas, nunca dado do tenant.
    expect(systemInstruction).toContain('REGRAS DE ESTILO');
    expect(systemInstruction).not.toContain(KB_MARKER);

    // Etapa 4: conteúdo real das camadas 1 (global) e 2 (segmento) precisa
    // estar sendo injetado de verdade, não só a seção fixa de estilo.
    expect(systemInstruction).toContain('Nunca finja escassez');
    expect(systemInstruction).toContain('Fotos de referência');

    // Achado real em produção: a IA tentava vender procedimento pra um
    // contato que claramente não era um lead genuíno (mandando foto pessoal
    // sem relação com o serviço, assediando a atendente) — regra nova pra
    // reconhecer isso e parar de tentar vender.
    expect(systemInstruction).toContain('não demonstra interesse genuíno');

    // Camadas 3+4 (tenant/dinâmico) + histórico: nunca a instrução fixa.
    expect(userContent).toContain(KB_MARKER);
    expect(userContent).toContain('quanto custa o retoque?');
    expect(userContent).not.toContain('REGRAS DE ESTILO');
  });

  it('usa o segmento default (beauty_studio) quando o chamador não passa nenhum', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);
    expect(calls[1].config.systemInstruction).toBeTruthy();
  });

  it('reforça a regra anti-parênteses/dois-pontos na camada Global (achado real em produção)', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);
    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain('Nunca use parênteses nem dois-pontos explicativos dentro da mensagem');
  });

  it('reforça a regra anti-repetição de pergunta já respondida (achado real em produção: agente perguntava "cejas, pestañas o labios?" de novo logo depois do cliente responder "Las cejas")', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);
    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain('nunca repita uma pergunta/informação que o cliente já respondeu');
    expect(systemInstruction).toContain('UM ÚNICO pensamento contínuo');
  });

  it('reforça a regra anti-repetição do que o PRÓPRIO agente já disse (achado real em produção: mesma conversa da claudia🥰 — "voy a pasar tu caso a Monique... ¿sí?" repetido quase palavra por palavra 2x em 23s, e o pedido de foto repetido 3x)', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);
    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain('nunca repita algo que VOCÊ MESMO já disse antes nesta conversa');
  });

  it('reforça a regra anti-alucinação de nome do cliente (achado real em produção: agente chamou uma lead de "Maricela" sem esse nome existir em nenhum lugar do contexto — nem no campo "Nome do cliente" nem gravado no banco)', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);
    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain('nome do cliente');
    expect(systemInstruction).toContain('Nunca chame o cliente por um nome que não apareceu');
  });
});

describe('generateAutoReplyForText — menção ao anúncio na abertura', () => {
  // Achado real em produção: todo lead vinha de anúncio ("Técnica brasileña
  // en Luque") mas a IA nunca sabia disso — toda saudação inicial saía
  // genérica e quase idêntica entre clientes diferentes. ad_headline já era
  // gravado (attachAdReferralIfMissing, pro CAPI), só nunca chegava ao prompt.
  it('menciona o anúncio no contents quando é o primeiro contato (histórico vazio)', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText(
      'tenant-a', ai, 'oi', 'Cliente Teste', undefined, [], undefined, undefined, 'beauty_studio', undefined, undefined,
      'Técnica brasileña en Luque'
    );
    const userContent: string = calls[1].contents[0].text;
    expect(userContent).toContain('Técnica brasileña en Luque');
  });

  it('NUNCA repete a menção ao anúncio quando já existe histórico (evita virar outro tique repetitivo)', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText(
      'tenant-a', ai, 'oi de novo', 'Cliente Teste', undefined, [{ sender: 'lead', text: 'oi' }], undefined, undefined, 'beauty_studio', undefined, undefined,
      'Técnica brasileña en Luque'
    );
    const userContent: string = calls[1].contents[0].text;
    expect(userContent).not.toContain('Técnica brasileña en Luque');
  });

  it('não quebra quando não há ad_headline (conversa não veio de anúncio)', async () => {
    const { ai, calls } = makeFakeAi();
    const result = await generateAutoReplyForText('tenant-a', ai, 'oi', 'Cliente Teste', undefined, [], undefined, undefined, 'beauty_studio');
    expect(result).not.toBeNull();
    const userContent: string = calls[1].contents[0].text;
    expect(userContent).not.toContain('anúncio');
  });
});

describe('generateAutoReplyForText — ferramenta de envio de foto (Epic 4.5.2)', () => {
  function makeFakeAiWithPhotoTool(shouldCallTool: boolean) {
    const calls: any[] = [];
    const ai = {
      models: {
        generateContent: async (req: any) => {
          calls.push(req);
          if (req.config?.tools) {
            return { functionCalls: shouldCallTool ? [{ name: 'enviar_foto_exemplo', args: { nome_produto: 'Microlips' } }] : [] } as any;
          }
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'faq' }) } as any;
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Manda ver a foto!'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;
    return { ai, calls };
  }

  it('envia a foto real via Meta quando o modelo decide chamar a ferramenta', async () => {
    uploadWhatsAppMedia.mockClear();
    sendWhatsAppMediaMessage.mockClear();
    recordOutgoingMessage.mockClear();
    const { ai } = makeFakeAiWithPhotoTool(true);

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'tem foto do microlips?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1' }
    );

    expect(result).not.toBeNull();
    expect(uploadWhatsAppMedia).toHaveBeenCalledWith('pn-1', 'tok-1', expect.any(Buffer), 'image/jpeg', expect.stringContaining('Microlips'));
    expect(sendWhatsAppMediaMessage).toHaveBeenCalledWith('pn-1', 'tok-1', '595981234567', 'media-id-123', 'image/jpeg', 'Microlips');
    expect(recordOutgoingMessage).toHaveBeenCalled();
  });

  it('não manda nada quando o modelo decide não chamar a ferramenta', async () => {
    uploadWhatsAppMedia.mockClear();
    const { ai } = makeFakeAiWithPhotoTool(false);

    await generateAutoReplyForText(
      'tenant-a', ai, 'oi, td bem?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1' }
    );

    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
  });

  it('nunca chama a ferramenta sem mediaConfig (sem credencial Meta resolvida)', async () => {
    uploadWhatsAppMedia.mockClear();
    const { ai, calls } = makeFakeAiWithPhotoTool(true);

    await generateAutoReplyForText('tenant-a', ai, 'tem foto?', 'Cliente', undefined, undefined, '595981234567');

    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
    // nenhuma chamada ao Gemini deveria ter usado function-calling de foto
    expect(calls.every((c) => !c.config?.tools)).toBe(true);
  });
});

describe('generateAutoReplyForText — etapa de reclamação (Epic 4.5.8)', () => {
  function makeFakeAiReclamacao() {
    const ai = {
      models: {
        generateContent: async (req: any) => {
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'reclamacao' }) } as any;
          // O especialista "esquece" de marcar needsHumanConfirmation — o agente força true mesmo assim.
          return { text: JSON.stringify({ phase: 'objecao', bubbles: ['Sinto muito por isso, vou confirmar com cuidado.'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;
    return ai;
  }

  it('sempre marca needsHumanConfirmation=true, mesmo se o especialista não marcou', async () => {
    const ai = makeFakeAiReclamacao();
    const result = await generateAutoReplyForText('tenant-a', ai, 'me machucou muito, tô com alergia', 'Cliente');
    expect(result?.agent).toBe('reclamacao');
    expect(result?.needsHumanConfirmation).toBe(true);
  });
});
