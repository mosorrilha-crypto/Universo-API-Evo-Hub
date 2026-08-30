/**
 * Etapa 3 do agente vertical (docs/AGENTE-VERTICAL-ARQUITETURA.md, seções 1 e
 * 7): o prompt de resposta do especialista deixou de ser uma string única
 * concatenada — camadas 1+2 (global/segmento, fixas) vão em
 * `systemInstruction`, camadas 3+4 (tenant/dinâmico) + histórico vão em
 * `contents`. Este teste trava essa separação: se alguém voltar a
 * concatenar tudo numa string só, ele quebra.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { invalidateAllSystemInstructionCaches } from '../geminiSystemInstructionCache';

const uploadWhatsAppMedia = vi.fn(async () => 'media-id-123');
const sendWhatsAppMediaMessage = vi.fn(async () => undefined);
const sendEvolutionMediaMessage = vi.fn(async () => undefined);
const recordOutgoingMessage = vi.fn(async (..._args: any[]) => ({}) as any);
const PRODUCT_WITH_PHOTO = { name: 'Microlips', price: 'Gs 500.000', exampleImageBase64: 'data:image/jpeg;base64,QQ==', exampleImageMimeType: 'image/jpeg' };
const PRODUCT_WITH_VIDEO = { name: 'Efecto Volumen Brasileño', price: 'Gs 200.000', exampleVideoId: 'video-1', exampleVideoMimeType: 'video/mp4', exampleVideoFileName: 'volumen.mp4' };
const getKnowledgeBase = vi.fn(async () => ({ products: [PRODUCT_WITH_PHOTO, PRODUCT_WITH_VIDEO] }));
const getKnowledgeBaseVideo = vi.fn(async () => ({ buffer: Buffer.from('fake-video-bytes'), contentType: 'video/mp4' }));
const saveMediaImage = vi.fn(async (..._args: any[]) => undefined);
// null = sem override salvo pelo saas_admin — cai no DEFAULT_GLOBAL_LAYER hardcoded, que é o que os testes abaixo verificam.
const getGlobalPromptLayerOverride = vi.fn(async () => null as string | null);
// undefined = nenhum agendamento rastreado pra este telefone — o gate de
// confirmação prematura (16/08/2026) não deve mexer em nada nesse caso, que
// é o default de todo teste que não seja sobre esse gate especificamente.
const getAppointmentForPhone = vi.fn(async (..._args: any[]) => undefined as any);

vi.mock('../metaSend', () => ({ uploadWhatsAppMedia, sendWhatsAppMediaMessage }));
vi.mock('../evolutionSend', () => ({ sendEvolutionMediaMessage }));
vi.mock('../conversationStore', () => ({ recordOutgoingMessage }));
const findProductMatch = vi.fn((kb: { products: { name: string }[] } | null, name: string) => {
  const normalized = name.trim().toLowerCase();
  const product = kb?.products?.find((p) => p.name.trim().toLowerCase() === normalized);
  return product ? { product } : undefined;
});
vi.mock('../knowledgeBaseStore', () => ({ getKnowledgeBase, resolveProductPriceAmount: vi.fn(() => 0), isNonBookableProduct: vi.fn(() => false), findProductDurationMinutes: vi.fn(() => undefined), findProductMatch }));
vi.mock('../appointmentStore', () => ({
  getAppointmentForPhone,
  setAppointmentForPhone: vi.fn(async () => undefined),
  clearAppointmentForPhone: vi.fn(async () => undefined),
  confirmPayment: vi.fn(async () => undefined),
}));
vi.mock('../knowledgeBaseVideoStore', () => ({ getKnowledgeBaseVideo }));
vi.mock('../mediaImageStore', () => ({ saveMediaImage }));
vi.mock('../globalPromptStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../globalPromptStore')>();
  return { ...actual, getGlobalPromptLayerOverride };
});

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

// Cache de contexto (geminiSystemInstructionCache.ts) mantém estado em
// memória entre chamadas de propósito (é o que faz o cache funcionar) — sem
// limpar entre testes, um teste que cria um cache de verdade (ex: agent=faq,
// segment=beauty_studio, texto padrão) vazaria pra um teste seguinte que usa
// o mesmo fake ai *sem* `.caches` só porque o texto do systemInstruction
// bateu (mesmo hash), fazendo essa chamada usar cachedContent em vez de
// systemInstruction por engano.
beforeEach(() => {
  invalidateAllSystemInstructionCaches();
  getAppointmentForPhone.mockReset();
  getAppointmentForPhone.mockResolvedValue(undefined);
});

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

    // Camada 1 (global): regras fixas, nunca dado do tenant. Não existe mais
    // Camada 2 (segmento) hardcoded — regras específicas de vertical/tenant
    // (ex: as que existiam pro segmento beauty_studio) foram migradas pra
    // `businessRules` da Base de Conhecimento de cada tenant (14/08/2026,
    // pedido explícito: nenhuma regra de negócio editável deveria depender
    // de deploy pra mudar).
    expect(systemInstruction).toContain('REGRAS DE ESTILO');
    expect(systemInstruction).toContain('Nunca finja escassez');

    // Achado de eficiência (mesmo dia): a Camada 3 (KB do tenant) passou a
    // entrar no texto CACHEADO junto com a Camada 1, em vez de ir solta em
    // `contents` a cada mensagem sem cache nenhum — ver
    // buildCachedSystemInstruction. Só o que muda de verdade por mensagem
    // (histórico, mensagem atual) continua em `contents`.
    expect(systemInstruction).toContain(KB_MARKER);
    expect(userContent).not.toContain(KB_MARKER);
    expect(userContent).toContain('quanto custa o retoque?');
    expect(userContent).not.toContain('REGRAS DE ESTILO');
  });

  it('usa o override da Camada 1 salvo por um saas_admin (global_prompt_layer) em vez do texto padrão hardcoded, quando existir', async () => {
    const customGlobalLayer = 'REGRA CUSTOMIZADA DE TESTE: sempre responda em maiúsculas.';
    getGlobalPromptLayerOverride.mockResolvedValueOnce(customGlobalLayer);
    const { ai, calls } = makeFakeAi();

    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);

    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain(customGlobalLayer);
    expect(systemInstruction).not.toContain('Nunca finja escassez'); // texto do DEFAULT_GLOBAL_LAYER não deveria aparecer junto
  });

  it('cai no texto padrão (DEFAULT_GLOBAL_LAYER) se a busca do override falhar (nunca derruba a resposta por causa disso)', async () => {
    getGlobalPromptLayerOverride.mockRejectedValueOnce(new Error('Supabase fora do ar'));
    const { ai, calls } = makeFakeAi();

    const result = await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);

    expect(result).not.toBeNull();
    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain('Nunca finja escassez');
  });

  it('parâmetro segment não afeta mais o conteúdo do systemInstruction (Camada 2 removida) — mesmo texto pra "generic" e pra qualquer outro valor', async () => {
    const { ai: aiA, calls: callsA } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', aiA, 'oi', undefined, undefined, undefined);

    const { ai: aiB, calls: callsB } = makeFakeAi();
    await generateAutoReplyForText('tenant-piscinas', aiB, 'oi', undefined, undefined, undefined, undefined, undefined, 'qualquer-coisa-inventada');

    expect(callsB[1].config.systemInstruction).toBe(callsA[1].config.systemInstruction);
  });

  it('issue #97: orientação de operador humano (retomada guiada) entra em contents, nunca em systemInstruction, e não muda a classificação do roteador', async () => {
    const { ai, calls } = makeFakeAi();
    const operatorGuidance = 'Diz pra ela que o horário de sábado 14h ainda está livre.';

    await generateAutoReplyForText(
      'tenant-a', ai, 'oi de novo', 'Cliente Teste', undefined, undefined,
      undefined, undefined, 'beauty_studio', undefined, undefined, undefined,
      operatorGuidance
    );

    const routerCall = calls[0];
    // A orientação é conteúdo dinâmico (camada 3+4) — nunca deveria influenciar
    // o prompt do roteador, que só recebe texto/histórico.
    expect(routerCall.contents[0].text).not.toContain(operatorGuidance);

    const specialistCall = calls[1];
    expect(specialistCall.config.systemInstruction).not.toContain(operatorGuidance);
    expect(specialistCall.contents[0].text).toContain(operatorGuidance);
    expect(specialistCall.contents[0].text).toContain('Um atendente humano deixou esta orientação');
  });

  it('sem orientação de operador (caso normal): não adiciona nada extra ao prompt', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', 'Cliente Teste', undefined, undefined);
    const specialistCall = calls[1];
    expect(specialistCall.contents[0].text).not.toContain('atendente humano');
  });

  it('reconhece o nome comercial "Combo Full Face" no título do anúncio sem presumir agendamento no primeiro contato', async () => {
    getKnowledgeBase.mockResolvedValueOnce({
      products: [{
        name: 'Combo Triple: Micro Cejas + Labios + Pestañas',
        aliases: ['Combo Full Face', 'Full Face'],
        price: 'Gs 1.200.000',
        durationMinutes: 240,
      }],
    } as any);
    const { ai, calls } = makeFakeAi();

    const result = await generateAutoReplyForText(
      'tenant-a',
      ai,
      'Me gustaría reservar un horario para el Combo Full Face',
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      'beauty_studio',
      undefined,
      undefined,
      'Combo Full Face',
      undefined,
      undefined,
      undefined,
      true
    );

    const specialistCall = calls[1];
    const userContent: string = specialistCall.contents[0].text;
    expect(userContent).toContain('Clique para WhatsApp');
    expect(userContent).toContain('Combo Triple: Micro Cejas + Labios + Pestañas');
    expect(userContent).toContain('SINAL DE INTERESSE');
    expect(userContent).toContain('sem pressupor que ela quer fechar');
    expect(result?.agent).toBe('triagem');
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

  it('proíbe abrir com frases de efeito ("qué gusto...") em vez de responder a dúvida direto (achado real em produção: praticamente toda primeira mensagem abria com "qué gusto en saludarte/leerte" ou "con gusto te ayudo" antes de responder)', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);
    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain('qué gusto en escribirme/leerte/saludarte');
    expect(systemInstruction).toContain('responda a dúvida real da cliente já na mesma bolha ou na seguinte');
  });

  it('proíbe abrir quase toda mensagem com uma interjeição de entusiasmo (achado real de auditoria, 29/08/2026: conversas reais da Monique mostraram o agente abrindo praticamente toda mensagem consecutiva com "¡Dale!"/"¡Genial!"/"¡Buenísimo!"/"¡Súper!" etc., inclusive em trocas puramente transacionais)', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);
    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain('Não abra quase toda mensagem com uma interjeição de entusiasmo');
    expect(systemInstruction).toContain('nunca como reflexo automático em toda resposta');
  });

  it('proíbe recorrer sempre à mesma fórmula pronta de "evaluación presencial analiza tus rasgos" pra justificar personalização de técnica (achado real de auditoria, 30/08/2026: a mesma ideia apareceu em 3 conversas reais distintas de clientes diferentes na mesma janela de poucas horas)', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);
    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain('Não recorra sempre à mesma fórmula pronta');
    expect(systemInstruction).toContain('tus rasgos');
    expect(systemInstruction).toContain('nunca deixe "tus rasgos"/"evaluación presencial analiza" virar um reflexo automático');
  });

  it('instrui a nunca repetir frase de exemplo do contexto do negócio palavra por palavra (pesquisa de mercado: repetir a mesma frase pronta é um dos sinais mais claros de bot)', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);
    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain('nunca um script pra repetir palavra por palavra');
  });

  it('reforça a regra anti-alucinação de foto/vídeo prometido (achado real em produção: agente de uma piscineira disse "ahí te muestro el video" sem NENHUMA ferramenta de mídia ter rodado — o cliente nunca recebeu nada)', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);
    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain('Nunca diga que está mandando, anexando, ou que "aí vai"/"te mostro" uma foto ou vídeo');
    expect(systemInstruction).toContain('a menos que a seção "Ações reais já executadas nesta mensagem" confirme explicitamente');
  });

  it('proíbe inventar desculpa/equipe/"central" que vai mandar a mídia depois (achado real em produção — 2ª rodada: bloqueada a promessa direta, o agente passou a inventar "ya le dejé dicho a los muchachos para que te lo manden al WhatsApp", uma promessa fictícia igualmente vazia)', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);
    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain('nunca invente desculpa, explicação interna, equipe/pessoa/"central" que cuida disso, nem prometa que alguém vai mandar depois');
    expect(systemInstruction).not.toContain('mencione o recurso visual só se um humano puder providenciar depois');
  });
});

describe('generateAutoReplyForText — cache de contexto da Camada 1+2 (geminiSystemInstructionCache.ts)', () => {
  function makeFakeAiWithCache(cacheImpl: (params: any) => Promise<any>) {
    const calls: any[] = [];
    const cacheCalls: any[] = [];
    const ai = {
      caches: {
        create: async (params: any) => {
          cacheCalls.push(params);
          return cacheImpl(params);
        },
      },
      models: {
        generateContent: async (req: any) => {
          calls.push(req);
          const isRouterCall = req.contents[0].text.includes('Classifique a intenção principal');
          if (isRouterCall) return { text: JSON.stringify({ agent: 'faq' }) } as any;
          return { text: JSON.stringify(SPECIALIST_REPLY) } as any;
        },
      },
    } as unknown as GoogleGenAI;
    return { ai, calls, cacheCalls };
  }

  it('quando o cache de contexto é criado com sucesso, a chamada do especialista usa cachedContent em vez de repetir systemInstruction', async () => {
    const { ai, calls, cacheCalls } = makeFakeAiWithCache(async () => ({ name: 'cachedContents/teste-123' }));

    await generateAutoReplyForText('tenant-a', ai, 'quanto custa o retoque?', 'Cliente Teste', KB_MARKER, undefined, undefined, undefined, 'beauty_studio');

    expect(cacheCalls).toHaveLength(1);
    expect(cacheCalls[0].config.systemInstruction).toContain('REGRAS DE ESTILO');
    // Desde 14/08/2026 a Camada 3 (Base de Conhecimento do tenant) entra no
    // MESMO texto cacheado que a Camada 1 (ver buildCachedSystemInstruction)
    // — cache por tenant, não mais compartilhado, mas cache de verdade.
    expect(cacheCalls[0].config.systemInstruction).toContain(KB_MARKER);

    const specialistCall = calls[1];
    expect(specialistCall.config.cachedContent).toBe('cachedContents/teste-123');
    expect(specialistCall.config.systemInstruction).toBeUndefined();
    // Só o que muda de verdade a cada mensagem (histórico, mensagem atual)
    // continua em `contents`, nunca cacheado.
    expect(specialistCall.contents[0].text).not.toContain(KB_MARKER);
    expect(specialistCall.contents[0].text).toContain('quanto custa o retoque?');
  });

  it('quando criar o cache falha (rede, API indisponível, conteúdo abaixo do mínimo), cai pro comportamento de sempre — systemInstruction inline, resposta ao cliente não é afetada', async () => {
    const { ai, calls } = makeFakeAiWithCache(async () => {
      throw new Error('falha simulada da API de cache');
    });

    const result = await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);

    expect(result).not.toBeNull();
    const specialistCall = calls[1];
    expect(specialistCall.config.cachedContent).toBeUndefined();
    expect(specialistCall.config.systemInstruction).toContain('Nunca finja escassez');
  });

  it('cache criado com sucesso mas a chamada com cachedContent falha (ex: cache expirou entre criar e usar) — tenta de novo sem cache antes de desistir, resposta ao cliente não é afetada', async () => {
    let cachedAttempts = 0;
    const { ai, calls } = makeFakeAiWithCache(async () => ({ name: 'cachedContents/quase-expirado' }));
    // Sobrescreve generateContent: falha toda vez que usar cachedContent (as
    // 3 tentativas do retry padrão), só funciona com systemInstruction —
    // simula o cache genuinamente não existir mais do lado da API.
    (ai as any).models.generateContent = async (req: any) => {
      calls.push(req);
      const isRouterCall = req.contents[0].text.includes('Classifique a intenção principal');
      if (isRouterCall) return { text: JSON.stringify({ agent: 'faq' }) } as any;
      if (req.config.cachedContent) {
        cachedAttempts += 1;
        throw new Error('cached content não encontrado (simulado)');
      }
      return { text: JSON.stringify(SPECIALIST_REPLY) } as any;
    };

    const result = await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, undefined);

    expect(result).not.toBeNull();
    expect(result?.bubbles).toEqual(SPECIALIST_REPLY.bubbles);
    // 1 tentativa original + 2 retries do withGeminiRetry, todas com cachedContent.
    expect(cachedAttempts).toBe(3);
    const lastCall = calls[calls.length - 1];
    expect(lastCall.config.cachedContent).toBeUndefined();
    expect(lastCall.config.systemInstruction).toContain('Nunca finja escassez');
  }, 10000);
});

describe('generateAutoReplyForText — captura o nome que a cliente diz na conversa (pesquisa de mercado: "esquecer" o nome depois de algumas mensagens é um dos sinais mais claros de bot)', () => {
  function makeFakeAiWithName(nomeCapturado: string | null) {
    const ai = {
      models: {
        generateContent: async (req: any) => {
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'triagem' }) } as any;
          return { text: JSON.stringify({ phase: 'abertura', bubbles: ['¡Un gusto, Camila!'], needsHumanConfirmation: false, nomeCapturado }) } as any;
        },
      },
    } as unknown as GoogleGenAI;
    return ai;
  }

  it('devolve capturedClientName quando o modelo extrai um nome e não havia contactName', async () => {
    const ai = makeFakeAiWithName('Camila');
    const result = await generateAutoReplyForText('tenant-a', ai, 'Soy Camila, quería consultar', undefined /* sem contactName */, undefined, []);
    expect(result?.capturedClientName).toBe('Camila');
  });

  it('IGNORA nomeCapturado quando já existe contactName — nunca deixa a IA sobrescrever o nome real de perfil do WhatsApp', async () => {
    const ai = makeFakeAiWithName('Outro Nome');
    const result = await generateAutoReplyForText('tenant-a', ai, 'oi', 'Camila (perfil do WhatsApp)', undefined, []);
    expect(result?.capturedClientName).toBeUndefined();
  });

  it('não define capturedClientName quando o modelo não extraiu nenhum nome', async () => {
    const ai = makeFakeAiWithName(null);
    const result = await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, []);
    expect(result?.capturedClientName).toBeUndefined();
  });
});

describe('generateAutoReplyForText — acompanhamento de funil (pedido real, 15/08/2026: auditoria de conversas reais mostrou lead esfriando sem ninguém perceber)', () => {
  function makeFakeAiWithFollowUp(pendenteAvaliacao: string | null, aguardandoCliente: string | null) {
    const ai = {
      models: {
        generateContent: async (req: any) => {
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'faq' }) } as any;
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['¡Dale!'], needsHumanConfirmation: false, pendenteAvaliacao, aguardandoCliente }) } as any;
        },
      },
    } as unknown as GoogleGenAI;
    return ai;
  }

  it('devolve pendingOwnerReview quando o modelo sinaliza que pediu avaliação da dona do negócio', async () => {
    const ai = makeFakeAiWithFollowUp('trabalho anterior de cejas, aguardando avaliação', null);
    const result = await generateAutoReplyForText('tenant-a', ai, 'tengo cejas tatuadas de otro lugar', undefined, undefined, []);
    expect(result?.pendingOwnerReview).toBe('trabalho anterior de cejas, aguardando avaliação');
    expect(result?.awaitingCustomerChoice).toBeUndefined();
  });

  it('devolve awaitingCustomerChoice quando o modelo sinaliza que ofereceu horário/opção e está esperando o cliente', async () => {
    const ai = makeFakeAiWithFollowUp(null, 'ofereceu sábado 15 ou segunda 17, esperando escolha');
    const result = await generateAutoReplyForText('tenant-a', ai, 'quiero reservar', undefined, undefined, []);
    expect(result?.awaitingCustomerChoice).toBe('ofereceu sábado 15 ou segunda 17, esperando escolha');
    expect(result?.pendingOwnerReview).toBeUndefined();
  });

  it('nenhum dos dois campos definido quando o modelo não sinaliza nada (caso normal)', async () => {
    const ai = makeFakeAiWithFollowUp(null, null);
    const result = await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, []);
    expect(result?.pendingOwnerReview).toBeUndefined();
    expect(result?.awaitingCustomerChoice).toBeUndefined();
  });

  it('string vazia/só espaço conta como "não sinalizado" (nunca cria pendência vazia)', async () => {
    const ai = makeFakeAiWithFollowUp('   ', null);
    const result = await generateAutoReplyForText('tenant-a', ai, 'oi', undefined, undefined, []);
    expect(result?.pendingOwnerReview).toBeUndefined();
  });
});

describe('generateAutoReplyForText — menção ao anúncio na abertura', () => {
  // Achado real em produção: todo lead vinha de anúncio ("Técnica brasileña
  // en Luque") mas a IA nunca sabia disso — toda saudação inicial saía
  // genérica e quase idêntica entre clientes diferentes. ad_headline já era
  // gravado (attachAdReferralIfMissing, pro CAPI), só nunca chegava ao prompt.
  it('contextualiza o anúncio como interesse inicial quando é o primeiro contato de campanha (histórico vazio)', async () => {
    const { ai, calls } = makeFakeAi();
    await generateAutoReplyForText(
      'tenant-a', ai, 'oi', 'Cliente Teste', undefined, [], undefined, undefined, 'beauty_studio', undefined, undefined,
      'Técnica brasileña en Luque', undefined, undefined, undefined, true
    );
    const userContent: string = calls[1].contents[0].text;
    expect(userContent).toContain('Técnica brasileña en Luque');
    expect(userContent).toContain('SINAL DE INTERESSE');
    expect(userContent).toContain('NÃO consulte, ofereça nem cite horários agora');
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
    saveMediaImage.mockClear();
    const { ai } = makeFakeAiWithPhotoTool(true);

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'tem foto do microlips?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1', supabaseUrl: 'https://fake.supabase.co', supabaseKey: 'fake-key' }
    );

    expect(result).not.toBeNull();
    expect(uploadWhatsAppMedia).toHaveBeenCalledWith('pn-1', 'tok-1', expect.any(Buffer), 'image/jpeg', expect.stringContaining('Microlips'));
    expect(sendWhatsAppMediaMessage).toHaveBeenCalledWith('pn-1', 'tok-1', '595981234567', 'media-id-123', 'image/jpeg', 'Microlips');
    expect(recordOutgoingMessage).toHaveBeenCalled();

    // Achado real em produção (Monique, 29/08/2026): a foto abria no
    // WhatsApp real do lead mas o painel mostrava "Imagem indisponível" pra
    // sempre — só a mensagem de texto era gravada, o binário nunca ia pro
    // mediaImageStore (o vídeo já tinha esse fix, a foto ficou pra trás).
    expect(saveMediaImage).toHaveBeenCalledTimes(1);
    const [, , savedMessageId, savedBase64, savedMimeType] = saveMediaImage.mock.calls[0];
    expect(savedMimeType).toBe('image/jpeg');
    expect(typeof savedBase64).toBe('string');
    expect(recordOutgoingMessage.mock.calls[0][6]).toBe(savedMessageId);
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

  // Achado real em produção (Monique, 19/08/2026): esses dois blocos eram
  // um if/else-if mutuamente exclusivos por `agent`. Uma mensagem
  // classificada como "agendamento" (comum no meio de uma conversa já
  // falando de preço/horário) fazia runMidiaTool NUNCA rodar, mesmo quando
  // a cliente pediu foto explicitamente e o produto tinha foto cadastrada.
  it('ainda envia a foto quando o roteador classifica a mensagem como "agendamento"', async () => {
    uploadWhatsAppMedia.mockClear();
    sendWhatsAppMediaMessage.mockClear();
    recordOutgoingMessage.mockClear();
    const calls: any[] = [];
    const ai = {
      models: {
        generateContent: async (req: any) => {
          calls.push(req);
          if (req.config?.tools) {
            return { functionCalls: [{ name: 'enviar_foto_exemplo', args: { nome_produto: 'Microlips' } }] } as any;
          }
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'agendamento' }) } as any;
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Manda ver a foto!'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;

    const result = await generateAutoReplyForText(
      // sem calendarConfig -> runAgendamentoTools nem roda, só o roteador classificou como agendamento
      'tenant-a', ai, 'tem foto do microlips?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1' }
    );

    expect(result).not.toBeNull();
    expect(uploadWhatsAppMedia).toHaveBeenCalledWith('pn-1', 'tok-1', expect.any(Buffer), 'image/jpeg', expect.stringContaining('Microlips'));
    expect(sendWhatsAppMediaMessage).toHaveBeenCalledWith('pn-1', 'tok-1', '595981234567', 'media-id-123', 'image/jpeg', 'Microlips');
  });

  // Achado real em produção (Monique, 20/08/2026): cliente perguntou "Tiene
  // fotos?" logo depois do agente oferecer 2 serviços sem ela escolher
  // nenhum ainda — a ferramenta corretamente decide não enviar nada (não dá
  // pra saber qual produto mandar), mas o especialista, sem nenhum contexto
  // sobre essa decisão, respondia "no tengo ese material disponible" — uma
  // negação falsa, já que o catálogo TEM fotos. O especialista precisa
  // receber essa informação pra nunca negar a existência do material.
  it('avisa o especialista que o catálogo TEM fotos quando o cliente pergunta mas o produto fica ambíguo', async () => {
    uploadWhatsAppMedia.mockClear();
    const { ai, calls } = makeFakeAiWithPhotoTool(false); // modelo decide não chamar a ferramenta

    await generateAutoReplyForText(
      'tenant-a', ai, 'Tiene fotos?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1' }
    );

    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
    const specialistContent: string = calls[calls.length - 1].contents[0].text;
    expect(specialistContent).toContain('nunca diga que não tem nenhum material disponível');
  });

  it('não injeta nenhuma nota sobre foto quando a mensagem não menciona foto/vídeo', async () => {
    const { ai, calls } = makeFakeAiWithPhotoTool(false);

    await generateAutoReplyForText(
      'tenant-a', ai, 'oi, td bem?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1' }
    );

    const specialistContent: string = calls[calls.length - 1].contents[0].text;
    expect(specialistContent).not.toContain('material disponível');
  });

  // Achado real em produção (Monique, 20/08/2026): cliente perguntou
  // "Pestanas vc tem fotos?" — uma CATEGORIA genérica, não o nome exato de
  // um produto do catálogo (que é "Microlips" neste fixture, ou "Lash
  // Lift"/"Volume Brasileiro" no caso real). O modelo tentou chamar a
  // ferramenta com nome_produto="Pestañas", que não bate com nenhum produto
  // — cai no branch de "não bateu com nenhum produto", não no de "nenhuma
  // ação" coberto pelo teste acima. Sem a ressalva nesse branch também, o
  // especialista generalizava isso em "não tenho nenhum material", mesmo
  // tendo foto real de outros serviços da mesma categoria.
  it('avisa que o catálogo TEM foto de outros serviços quando nome_produto não bate com nenhum exato (categoria genérica)', async () => {
    uploadWhatsAppMedia.mockClear();
    const calls: any[] = [];
    const ai = {
      models: {
        generateContent: async (req: any) => {
          calls.push(req);
          if (req.config?.tools) {
            return { functionCalls: [{ name: 'enviar_foto_exemplo', args: { nome_produto: 'Pestañas' } }] } as any;
          }
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'faq' }) } as any;
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Ok!'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;

    await generateAutoReplyForText(
      'tenant-a', ai, 'Pestanas vc tem fotos?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1' }
    );

    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
    const specialistContent: string = calls[calls.length - 1].contents[0].text;
    expect(specialistContent).toContain('NUNCA diga que não tem material nenhum disponível');
    expect(specialistContent).toContain('Microlips');
  });

  // Achado real em produção (Clic Piscinas): o nome do produto no catálogo é
  // só o nome comercial da família ("Piscina Fibratec Maresias"), nunca a
  // medida/variante ("MS F400, 4,00x2,20m") que o cliente usa pra pedir a
  // foto ("o modelo de 4 metros"). Sem esse dado na lista mandada pro
  // modelo, ele não tinha como mapear o pedido — decidia (corretamente, dada
  // a informação que tinha) não chamar nenhuma ferramenta, silenciosamente.
  it('inclui a description do produto (variante/medida) na lista mandada pro modelo, quando existir', async () => {
    getKnowledgeBase.mockResolvedValueOnce({
      products: [{ ...PRODUCT_WITH_PHOTO, description: 'MS F400, 4,00x2,20m' }],
    } as any);
    const { ai, calls } = makeFakeAiWithPhotoTool(false);

    await generateAutoReplyForText(
      'tenant-a', ai, 'tem foto do modelo de 4 metros?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1' }
    );

    const mediaToolCall = calls.find((c) => c.config?.tools);
    expect(mediaToolCall.contents[0].parts[0].text).toContain('Microlips (MS F400, 4,00x2,20m)');
  });

  // Catálogo em família+variante (ProductVariant, PR #341) — cada tamanho
  // tem código e medida próprios; quando existem, prevalecem sobre a
  // description solta (caso acima) porque são o dado estruturado real.
  it('inclui os códigos/medidas das variantes na lista, quando o produto tiver variants', async () => {
    getKnowledgeBase.mockResolvedValueOnce({
      products: [
        {
          ...PRODUCT_WITH_PHOTO,
          name: 'Piscina Fibratec Maresias',
          description: undefined,
          variants: [
            { code: 'MS F400', dimensions: '4,00x2,20m', price: 'Gs 15.000.000' },
            { code: 'MS F500', dimensions: '5,00x2,50m', price: 'Gs 18.000.000' },
          ],
        },
      ],
    } as any);
    const { ai, calls } = makeFakeAiWithPhotoTool(false);

    await generateAutoReplyForText(
      'tenant-a', ai, 'tem foto do modelo de 4 metros?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1' }
    );

    const mediaToolCall = calls.find((c) => c.config?.tools);
    expect(mediaToolCall.contents[0].parts[0].text).toContain('Piscina Fibratec Maresias (MS F400 (4,00x2,20m), MS F500 (5,00x2,50m))');
  });

  it('não quebra e mantém só o nome quando o produto não tem description nem variants', async () => {
    const { ai, calls } = makeFakeAiWithPhotoTool(false);

    await generateAutoReplyForText(
      'tenant-a', ai, 'tem foto?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1' }
    );

    const mediaToolCall = calls.find((c) => c.config?.tools);
    expect(mediaToolCall.contents[0].parts[0].text).toContain('- Microlips\n');
  });

  // Achado real em produção (Gladys, 30/08/2026, pós-fix TASK-0156): a mesma
  // foto foi enviada 3 vezes seguidas em <2min — cada reação curta e
  // entusiasmada da cliente ("Me gusta sabes 🥰") chegou fora da janela de
  // silêncio do messageBuffer (10s), disparando um ciclo INDEPENDENTE de
  // autoReply que decidia de novo, do zero, enviar a mesma foto — mesmo ela
  // já aparecendo no histórico como enviada. Barreira determinística
  // (TASK-0170): quando a bolha "📷 Foto de exemplo: X" já está no histórico
  // recente, nunca reenvia, só avisa o especialista.
  it('NÃO reenvia a mesma foto quando ela já aparece no histórico recente da conversa', async () => {
    uploadWhatsAppMedia.mockClear();
    const { ai, calls } = makeFakeAiWithPhotoTool(true);

    await generateAutoReplyForText(
      'tenant-a', ai, 'Me gusta sabes 🥰', 'Cliente', undefined,
      [{ sender: 'agent', text: '📷 Foto de exemplo: Microlips' }],
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1' }
    );

    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
    const specialistContent: string = calls[calls.length - 1].contents[0].text;
    expect(specialistContent).toContain('Já enviou a foto de exemplo de "Microlips" há pouco');
  });

  it('envia normalmente quando o histórico não tem nenhum envio recente dessa foto', async () => {
    uploadWhatsAppMedia.mockClear();
    const { ai } = makeFakeAiWithPhotoTool(true);

    await generateAutoReplyForText(
      'tenant-a', ai, 'tem foto do microlips?', 'Cliente', undefined,
      [{ sender: 'lead', text: 'oi, vi o anúncio' }],
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1' }
    );

    expect(uploadWhatsAppMedia).toHaveBeenCalled();
  });
});

describe('generateAutoReplyForText — ferramenta de envio de vídeo (paridade com Epic 4.5.2)', () => {
  function makeFakeAiWithVideoTool(shouldCallTool: boolean) {
    const calls: any[] = [];
    const ai = {
      models: {
        generateContent: async (req: any) => {
          calls.push(req);
          if (req.config?.tools) {
            return { functionCalls: shouldCallTool ? [{ name: 'enviar_video_exemplo', args: { nome_produto: 'Efecto Volumen Brasileño' } }] : [] } as any;
          }
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'faq' }) } as any;
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Manda ver o vídeo!'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;
    return { ai, calls };
  }

  it('envia o vídeo real via Meta (busca o binário no Storage) quando o modelo decide chamar a ferramenta', async () => {
    uploadWhatsAppMedia.mockClear();
    sendWhatsAppMediaMessage.mockClear();
    recordOutgoingMessage.mockClear();
    getKnowledgeBaseVideo.mockClear();
    saveMediaImage.mockClear();
    const { ai } = makeFakeAiWithVideoTool(true);

    const result = await generateAutoReplyForText(
      'tenant-a', ai, 'tem vídeo do efecto volumen?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1', supabaseUrl: 'https://fake.supabase.co', supabaseKey: 'fake-key' }
    );

    expect(result).not.toBeNull();
    expect(getKnowledgeBaseVideo).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', 'tenant-a', 'video-1');
    expect(uploadWhatsAppMedia).toHaveBeenCalledWith('pn-1', 'tok-1', expect.any(Buffer), 'video/mp4', 'volumen.mp4');
    expect(sendWhatsAppMediaMessage).toHaveBeenCalledWith('pn-1', 'tok-1', '595981234567', 'media-id-123', 'video/mp4', 'Efecto Volumen Brasileño');
    expect(recordOutgoingMessage).toHaveBeenCalled();

    // Achado real (15/08/2026, Clic Piscinas): o vídeo abria no WhatsApp real
    // do lead mas nunca no painel — salva o binário sob o MESMO id da
    // mensagem gravada, pro painel conseguir tocar de volta (GET /api/media/:messageId).
    expect(saveMediaImage).toHaveBeenCalledTimes(1);
    const [, , savedMessageId, savedBase64, savedMimeType] = saveMediaImage.mock.calls[0];
    expect(savedBase64).toBe(Buffer.from('fake-video-bytes').toString('base64'));
    expect(savedMimeType).toBe('video/mp4');
    expect(recordOutgoingMessage.mock.calls[0][6]).toBe(savedMessageId);
  });

  it('acha o produto mesmo quando o Gemini devolve o nome com caixa/espaçamento diferente do catálogo (achado real em produção: match exato falhava silenciosamente)', async () => {
    uploadWhatsAppMedia.mockClear();
    sendWhatsAppMediaMessage.mockClear();
    getKnowledgeBaseVideo.mockClear();
    const calls: any[] = [];
    const ai = {
      models: {
        generateContent: async (req: any) => {
          calls.push(req);
          if (req.config?.tools) {
            return { functionCalls: [{ name: 'enviar_video_exemplo', args: { nome_produto: '  efecto volumen brasileño  ' } }] } as any;
          }
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'faq' }) } as any;
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Manda ver o vídeo!'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;

    await generateAutoReplyForText(
      'tenant-a', ai, 'tem vídeo?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1', supabaseUrl: 'https://fake.supabase.co', supabaseKey: 'fake-key' }
    );

    expect(getKnowledgeBaseVideo).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', 'tenant-a', 'video-1');
    expect(sendWhatsAppMediaMessage).toHaveBeenCalledWith('pn-1', 'tok-1', '595981234567', 'media-id-123', 'video/mp4', 'Efecto Volumen Brasileño');
  });

  it('não manda nada quando o modelo decide não chamar a ferramenta', async () => {
    uploadWhatsAppMedia.mockClear();
    const { ai } = makeFakeAiWithVideoTool(false);

    await generateAutoReplyForText(
      'tenant-a', ai, 'oi, td bem?', 'Cliente', undefined, undefined,
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1' }
    );

    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
  });

  it('envia o vídeo real via Evolution API quando o tenant é configurado por QR Code — regressão do bug real (13/08/2026): o gate só reconhecia phoneNumberId/accessToken (Meta), então nenhum tenant Evolution (ex: Clic Piscinas) nunca recebia foto/vídeo, mesmo com credencial completa', async () => {
    sendEvolutionMediaMessage.mockClear();
    getKnowledgeBaseVideo.mockClear();
    const { ai } = makeFakeAiWithVideoTool(true);

    const result = await generateAutoReplyForText(
      'tenant-piscinas', ai, 'tem vídeo da piscina?', 'Lucas', undefined, undefined,
      '595981234567', undefined, 'beauty_studio',
      { provider: 'evolution', evolutionInstanceName: 'inst-1', evolutionApiUrl: 'https://evo.example.com', evolutionApiKey: 'evo-key', supabaseUrl: 'https://fake.supabase.co', supabaseKey: 'fake-key' }
    );

    expect(result).not.toBeNull();
    expect(getKnowledgeBaseVideo).toHaveBeenCalledWith('https://fake.supabase.co', 'fake-key', 'tenant-piscinas', 'video-1');
    expect(sendEvolutionMediaMessage).toHaveBeenCalledWith(
      'inst-1', 'https://evo.example.com', 'evo-key', '595981234567',
      Buffer.from('fake-video-bytes').toString('base64'), 'video/mp4', 'volumen.mp4', 'Efecto Volumen Brasileño'
    );
  });

  // Mesma barreira do teste equivalente de foto (TASK-0170) — paridade
  // foto/vídeo, mesmo achado real (Gladys, 30/08/2026).
  it('NÃO reenvia o mesmo vídeo quando ele já aparece no histórico recente da conversa', async () => {
    uploadWhatsAppMedia.mockClear();
    const { ai, calls } = makeFakeAiWithVideoTool(true);

    await generateAutoReplyForText(
      'tenant-a', ai, 'me encantó ese resultado 🥰', 'Cliente', undefined,
      [{ sender: 'agent', text: '🎥 Vídeo de exemplo: Efecto Volumen Brasileño' }],
      '595981234567', undefined, 'beauty_studio', { phoneNumberId: 'pn-1', accessToken: 'tok-1', supabaseUrl: 'https://fake.supabase.co', supabaseKey: 'fake-key' }
    );

    expect(uploadWhatsAppMedia).not.toHaveBeenCalled();
    const specialistContent: string = calls[calls.length - 1].contents[0].text;
    expect(specialistContent).toContain('Já enviou o vídeo de exemplo de "Efecto Volumen Brasileño" há pouco');
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

  function makeFakeAiReclamacaoWithConcessionPromise(promiseText: string) {
    const ai = {
      models: {
        generateContent: async (req: any) => {
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'reclamacao' }) } as any;
          return { text: JSON.stringify({ phase: 'objecao', bubbles: [promiseText], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;
    return ai;
  }

  it('gate de reembolso/desconto (15/08/2026): corrige quando o modelo promete reembolso numa reclamação, sem ferramenta nenhuma pra sustentar isso', async () => {
    const ai = makeFakeAiReclamacaoWithConcessionPromise('Sin problema, ya te hago el reembolso completo del servicio.');
    const result = await generateAutoReplyForText('tenant-a', ai, 'quero meu dinheiro de volta', 'Cliente');
    expect(result?.agent).toBe('reclamacao');
    expect(result?.bubbles).not.toContain('Sin problema, ya te hago el reembolso completo del servicio.');
    expect(result?.bubbles.join(' ')).not.toMatch(/reembols/i);
  });

  it('gate de reembolso/desconto: corrige quando o modelo promete desconto numa reclamação', async () => {
    const ai = makeFakeAiReclamacaoWithConcessionPromise('Te puedo hacer un descuento del 50% en tu próxima visita por las molestias.');
    const result = await generateAutoReplyForText('tenant-a', ai, 'não gostei do resultado', 'Cliente');
    expect(result?.bubbles.join(' ')).not.toMatch(/descont/i);
  });

  it('gate de reembolso/desconto: não mexe numa reclamação normal, sem promessa de reembolso/desconto/cortesia', async () => {
    const ai = makeFakeAiReclamacaoWithConcessionPromise('Lamento mucho el inconveniente, ya avisé al equipo para revisar tu caso.');
    const result = await generateAutoReplyForText('tenant-a', ai, 'não gostei do atendimento', 'Cliente');
    expect(result?.bubbles).toEqual(['Lamento mucho el inconveniente, ya avisé al equipo para revisar tu caso.']);
  });

  it('gate de reembolso/desconto: escopo restrito a reclamacao — um agente FAQ recitando a política de reembolso já cadastrada não é tocado', async () => {
    const ai = {
      models: {
        generateContent: async (req: any) => {
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'faq' }) } as any;
          return { text: JSON.stringify({ phase: 'informacao', bubbles: ['Nuestra política permite reembolso si cancelás con 24h+ de anticipación.'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;
    const result = await generateAutoReplyForText('tenant-a', ai, 'qual a política de cancelamento?', 'Cliente');
    expect(result?.agent).toBe('faq');
    expect(result?.bubbles).toEqual(['Nuestra política permite reembolso si cancelás con 24h+ de anticipación.']);
  });
});

describe('generateAutoReplyForText — pedir o nome na triagem (achado real: falta de personalização quando o WhatsApp não tem nome de perfil)', () => {
  function makeFakeAiTriagem() {
    const calls: any[] = [];
    const ai = {
      models: {
        generateContent: async (req: any) => {
          calls.push(req);
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'triagem' }) } as any;
          return { text: JSON.stringify({ phase: 'abertura', bubbles: ['¡Hola! ¿Cómo estás?'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;
    return { ai, calls };
  }

  it('instrui a perguntar o nome quando "Nome do cliente" não está no contexto', async () => {
    const { ai, calls } = makeFakeAiTriagem();
    await generateAutoReplyForText('tenant-a', ai, 'Hola', undefined /* sem contactName */, undefined, []);
    const systemInstruction: string = calls[1].config.systemInstruction;
    expect(systemInstruction).toContain('pergunte o nome dela de forma natural');
    const userContent: string = calls[1].contents[0].text;
    expect(userContent).not.toContain('Nome do cliente:');
  });
});

describe('generateAutoReplyForText — headline do anúncio nomeando serviço do catálogo (issue #153, Parte 2)', () => {
  function makeFakeAiTriagem() {
    const calls: any[] = [];
    const ai = {
      models: {
        generateContent: async (req: any) => {
          calls.push(req);
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'triagem' }) } as any;
          return { text: JSON.stringify({ phase: 'abertura', bubbles: ['¡Hola!'], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;
    return { ai, calls };
  }

  it('usa o serviço do headline como contexto sem presumir fechamento quando é o primeiro contato de campanha (mock: Microlips)', async () => {
    const { ai, calls } = makeFakeAiTriagem();
    await generateAutoReplyForText(
      'tenant-a', ai, 'Hola', 'Cliente', undefined, [] /* histórico vazio = primeiro contato */,
      undefined, undefined, undefined, undefined, undefined,
      'Conocé Microlips en Luque', undefined, undefined, undefined, true
    );
    const userContent: string = calls[1].contents[0].text;
    expect(userContent).toContain('O tema corresponde ao serviço "Microlips"');
    expect(userContent).toContain('sem pressupor que ela quer fechar');
    expect(userContent).toContain('NÃO faça a pergunta genérica “qual serviço você busca?”');
  });

  it('contextualiza headline genérico sem tratar a mensagem pré-preenchida como pedido de agenda', async () => {
    const { ai, calls } = makeFakeAiTriagem();
    await generateAutoReplyForText(
      'tenant-a', ai, 'Hola', 'Cliente', undefined, [],
      undefined, undefined, undefined, undefined, undefined,
      'Técnica brasileña en Luque', undefined, undefined, undefined, true
    );
    const userContent: string = calls[1].contents[0].text;
    expect(userContent).toContain('Técnica brasileña en Luque');
    expect(userContent).toContain('SINAL DE INTERESSE');
    expect(userContent).toContain('NÃO consulte, ofereça nem cite horários agora');
  });

  it('não menciona o anúncio quando já há histórico (não é mais o primeiro contato)', async () => {
    const { ai, calls } = makeFakeAiTriagem();
    await generateAutoReplyForText(
      'tenant-a', ai, 'Hola de novo', 'Cliente', undefined, [{ sender: 'lead', text: 'oi' }],
      undefined, undefined, undefined, undefined, undefined,
      'Conocé Microlips en Luque'
    );
    const userContent: string = calls[1].contents[0].text;
    expect(userContent).not.toContain('Pule a pergunta genérica');
    expect(userContent).not.toContain('clicou num anúncio');
  });
});

describe('generateAutoReplyForText — mensagens de rajada priorizam a mais recente (18/08/2026)', () => {
  function makeFakeAiTriagem(specialistReply: { phase: string; bubbles: string[]; needsHumanConfirmation: boolean }) {
    const calls: any[] = [];
    const ai = {
      models: {
        generateContent: async (req: any) => {
          calls.push(req);
          if (req.contents[0].text?.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'faq' }) } as any;
          return { text: JSON.stringify(specialistReply) } as any;
        },
      },
    } as unknown as GoogleGenAI;
    return { ai, calls };
  }

  it('mensagem única (sem rajada) mantém o formato de contents de sempre ([{ text }], sem role/parts)', async () => {
    const { ai, calls } = makeFakeAiTriagem({ phase: 'informacao', bubbles: ['Gs 550.000.'], needsHumanConfirmation: false });
    await generateAutoReplyForText('tenant-a', ai, 'Solo cejas precio', 'Cliente', undefined, []);
    const specialistCall = calls[1];
    expect(specialistCall.contents).toHaveLength(1);
    expect(specialistCall.contents[0].role).toBeUndefined();
    expect(typeof specialistCall.contents[0].text).toBe('string');
    expect(specialistCall.contents[0].text).toContain('Solo cejas precio');
  });

  it('mensagens agrupadas pelo buffer de rajada (texto com \\n) viram turnos separados, com a última marcada como mais recente', async () => {
    const { ai, calls } = makeFakeAiTriagem({ phase: 'informacao', bubbles: ['Gs 550.000.'], needsHumanConfirmation: false });
    await generateAutoReplyForText('tenant-a', ai, 'Me gustaría reservar el combo cejas y labios\nSolo cejas precio', 'Cliente', undefined, []);
    const specialistCall = calls[1];
    // Duas mensagens de rajada -> dois turnos "user" separados em contents, sem resposta do agente entre eles.
    expect(specialistCall.contents).toHaveLength(2);
    expect(specialistCall.contents[0].role).toBe('user');
    expect(specialistCall.contents[0].parts[0].text).toContain('Me gustaría reservar el combo cejas y labios');
    expect(specialistCall.contents[1].role).toBe('user');
    expect(specialistCall.contents[1].parts[0].text).toContain('Solo cejas precio');
    expect(specialistCall.contents[1].parts[0].text).toContain('mais recente');
  });

  it('mensagem ÚNICA com quebra de linha interna (colar texto, Shift+Enter) NÃO é tratada como rajada quando messageCount=1 é informado', async () => {
    const { ai, calls } = makeFakeAiTriagem({ phase: 'informacao', bubbles: ['Gs 550.000.'], needsHumanConfirmation: false });
    // Uma única mensagem real do WhatsApp com quebra de linha interna —
    // messageBuffer.ts só entra em jogo (e produz mais de uma linha em
    // `texts.join('\n')`) quando há de fato mais de uma mensagem separada;
    // aqui simulamos o chamador informando messageCount=1 (o real, vindo do
    // buffer) pra essa mesma forma de texto não ser confundida com rajada.
    await generateAutoReplyForText(
      'tenant-a',
      ai,
      'Hola, buenas tardes\nQueria consultar por el precio de cejas',
      'Cliente',
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      1
    );
    const specialistCall = calls[1];
    expect(specialistCall.contents).toHaveLength(1);
    expect(specialistCall.contents[0].role).toBeUndefined();
    expect(specialistCall.contents[0].text).toContain('Hola, buenas tardes\nQueria consultar por el precio de cejas');
  });
});

describe('generateAutoReplyForText — gate de confirmação prematura de agendamento (16/08/2026, Opção A)', () => {
  function makeFakeAiAgendamentoConfirming(confirmationText: string) {
    const ai = {
      models: {
        generateContent: async (req: any) => {
          if (req.contents[0].text.includes('Classifique a intenção principal')) return { text: JSON.stringify({ agent: 'agendamento' }) } as any;
          return { text: JSON.stringify({ phase: 'confirmacao', bubbles: [confirmationText], needsHumanConfirmation: false }) } as any;
        },
      },
    } as unknown as GoogleGenAI;
    return ai;
  }

  const PHONE = '+595981234567';

  it('corrige quando o modelo afirma que o turno está confirmado mas o pagamento ainda está pending_verification', async () => {
    getAppointmentForPhone.mockResolvedValue({ eventId: 'evt-1', summary: 'Cejas', startIso: '2026-08-20T10:00:00', endIso: '2026-08-20T10:30:00', createdAt: '2026-08-16T00:00:00', paymentStatus: 'pending_verification' });
    const ai = makeFakeAiAgendamentoConfirming('¡Listo! Tu turno ya está confirmado para el jueves a las 10.');
    const result = await generateAutoReplyForText('tenant-a', ai, 'te mandé el comprobante', 'Cliente', undefined, undefined, PHONE);
    expect(result?.agent).toBe('agendamento');
    expect(result?.bubbles).not.toContain('¡Listo! Tu turno ya está confirmado para el jueves a las 10.');
    expect(result?.bubbles.join(' ')).not.toMatch(/confirmad/i);
  });

  it('corrige quando o pagamento foi rejected (não só pending_verification)', async () => {
    getAppointmentForPhone.mockResolvedValue({ eventId: 'evt-1', summary: 'Cejas', startIso: '2026-08-20T10:00:00', endIso: '2026-08-20T10:30:00', createdAt: '2026-08-16T00:00:00', paymentStatus: 'rejected' });
    const ai = makeFakeAiAgendamentoConfirming('¡Perfecto! El horario es tuyo, ya quedó agendado.');
    const result = await generateAutoReplyForText('tenant-a', ai, 'ya pagué', 'Cliente', undefined, undefined, PHONE);
    expect(result?.bubbles.join(' ')).not.toMatch(/es tuyo|agendad[oa]/i);
  });

  it('não mexe na resposta quando o pagamento já está confirmed', async () => {
    getAppointmentForPhone.mockResolvedValue({ eventId: 'evt-1', summary: 'Cejas', startIso: '2026-08-20T10:00:00', endIso: '2026-08-20T10:30:00', createdAt: '2026-08-16T00:00:00', paymentStatus: 'confirmed' });
    const ai = makeFakeAiAgendamentoConfirming('¡Listo! Tu turno ya está confirmado para el jueves a las 10.');
    const result = await generateAutoReplyForText('tenant-a', ai, 'gracias', 'Cliente', undefined, undefined, PHONE);
    expect(result?.bubbles).toEqual(['¡Listo! Tu turno ya está confirmado para el jueves a las 10.']);
  });

  it('corrige quando não há nenhum agendamento rastreado pra este telefone (achado real, 19/08/2026, Mabel: criar_agendamento falhou/não rodou e o modelo mesmo assim confirmou em texto — sem appointment nenhum, o comprovante que chegou depois nunca gerou escalação pro operador)', async () => {
    getAppointmentForPhone.mockResolvedValue(undefined);
    const ai = makeFakeAiAgendamentoConfirming('¡Listo! Tu turno ya está confirmado para el jueves a las 10.');
    const result = await generateAutoReplyForText('tenant-a', ai, 'hola', 'Cliente', undefined, undefined, PHONE);
    expect(result?.bubbles).not.toContain('¡Listo! Tu turno ya está confirmado para el jueves a las 10.');
    expect(result?.bubbles.join(' ')).not.toMatch(/confirmad/i);
  });

  it('não mexe quando o texto não afirma confirmação nenhuma, mesmo com pagamento pending_verification', async () => {
    getAppointmentForPhone.mockResolvedValue({ eventId: 'evt-1', summary: 'Cejas', startIso: '2026-08-20T10:00:00', endIso: '2026-08-20T10:30:00', createdAt: '2026-08-16T00:00:00', paymentStatus: 'pending_verification' });
    const ai = makeFakeAiAgendamentoConfirming('Recibí tu comprobante, ya lo estamos revisando.');
    const result = await generateAutoReplyForText('tenant-a', ai, 'te mandé el comprobante', 'Cliente', undefined, undefined, PHONE);
    expect(result?.bubbles).toEqual(['Recibí tu comprobante, ya lo estamos revisando.']);
  });
});
