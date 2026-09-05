import { describe, expect, it, vi } from 'vitest';
import { generateCorrectedReplySuggestion, reviewAutoReplyBeforeSend } from './replySafetyGate';

describe('revisor pré-envio de respostas automáticas', () => {
  it('bloqueia uma apresentação repetida em conversa em andamento sem chamar outro modelo', async () => {
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Y ese cuanto año dura?',
      draftBubbles: ['¡Hola! Soy Ana, la asistente de Monique. ¿Cómo te ayudo?'],
      history: [{ sender: 'agent', text: 'El Combo Full Face incluye cejas, labios y pestañas.' }],
    }, { ai: null });

    expect(verdict.approved).toBe(false);
    expect(verdict.source).toBe('rules');
    expect(verdict.reason).toContain('reinicia o atendimento');
  });

  it('bloqueia convite de agenda após pergunta puramente factual', async () => {
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Cuánto dura el procedimiento de cejas?',
      draftBubbles: ['Dura aproximadamente un año. ¿Agendamos tu turno?'],
    }, { ai: null });

    expect(verdict.approved).toBe(false);
    expect(verdict.source).toBe('rules');
    expect(verdict.reason).toContain('agenda');
  });

  it('bloqueia quando nenhum revisor independente está disponível', async () => {
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Hola, cuánto cuesta?',
      draftBubbles: ['El valor es el que figura en nuestro catálogo.'],
    }, { ai: null });

    expect(verdict).toMatchObject({ approved: false, source: 'unavailable', severity: 'high' });
  });

  it('gera uma sugestão supervisionada sem enviar e preserva a exigência de espanhol/voseo no prompt', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify({ reply: '¡Claro! ¿Qué servicio te gustaría consultar?' }) });
    const suggestion = await generateCorrectedReplySuggestion({
      customerMessage: 'Hola, ¿cuánto dura?',
      blockedDraft: 'Dura un año. ¿Agendamos tu turno?',
      reviewerReason: 'A resposta conduzia para agenda após pergunta informativa.',
      history: [{ sender: 'lead', text: 'Hola, ¿cuánto dura?' }],
      knowledgeContext: 'Pestañas: duración según servicio; no afirmar disponibilidad.',
    }, { ai: { models: { generateContent } } as any });

    expect(suggestion).toEqual({ text: '¡Claro! ¿Qué servicio te gustaría consultar?', source: 'gemini-suggestion' });
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      contents: expect.stringContaining('espanhol paraguaio natural com voseo'),
    }));
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      contents: expect.stringContaining('NUNCA será enviada automaticamente'),
    }));
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      contents: expect.stringContaining('descartar informação correta não é uma correção'),
    }));
  });

  it('rejeita a sugestão quando o modelo troca o idioma da cliente (achado real 26/08/2026)', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify({ reply: 'Qual é o teu nome, pra eu poder marcar o combo?' }) });
    const suggestion = await generateCorrectedReplySuggestion({
      customerMessage: 'Me gustaría reservar un horario para el combo de cejas y labios',
      blockedDraft: '¡Hola! El Combo Micro Cejas + Labios está Gs 850.000. ¿Cuál horario te queda mejor?',
      reviewerReason: 'No se solicita ni confirma el nombre del cliente ni el servicio exacto.',
      knowledgeContext: 'Combo Micro Cejas + Labios: Gs 850.000, incluye evaluación presencial.',
    }, { ai: { models: { generateContent } } as any });

    expect(suggestion).toBeNull();
  });

  it('não gera sugestão para pagamento ou dado sensível', async () => {
    const generateContent = vi.fn();
    const suggestion = await generateCorrectedReplySuggestion({
      customerMessage: 'Te envío el comprobante de pago.',
      blockedDraft: 'Pago confirmado.',
      reviewerReason: 'Pagamento requer conferência humana.',
    }, { ai: { models: { generateContent } } as any });

    expect(suggestion).toBeNull();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('falha de forma segura quando o modelo retorna JSON sem resposta', async () => {
    const suggestion = await generateCorrectedReplySuggestion({
      customerMessage: 'Hola, ¿cuánto dura?',
      blockedDraft: 'Te confirmo un horario.',
      reviewerReason: 'Não confirmar disponibilidade sem verificar.',
    }, { ai: { models: { generateContent: vi.fn().mockResolvedValue({ text: '{"reply":""}' }) } } as any });

    expect(suggestion).toBeNull();
  });

  it('informa ao segundo revisor a ação de agenda planejada, ainda sem execução', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify({ approved: true, severity: 'low', reason: 'Plano e resposta consistentes.' }) });
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Quiero el turno de las diez.',
      draftBubbles: ['Perfecto, te dejo reservado para las 10:00.'],
      isBookingFlow: true,
      plannedCalendarActions: ['Planejou reservar "Lash Lift" para 2026-09-02T10:00:00 depois da aprovação do revisor pré-envio.'],
    }, { ai: { models: { generateContent } } as any });

    expect(verdict.approved).toBe(true);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      contents: expect.stringContaining('Planejou reservar "Lash Lift"'),
    }));
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      contents: expect.stringContaining('ainda NÃO foram executadas'),
    }));
  });

  it('bloqueia repetição parafraseada de uma mensagem recente do próprio agente (achado real 29/08/2026: "que incluye cejas" vs "que incluye las cejas", mesmo preço repetido 2x em menos de 2min)', async () => {
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Y eso qué incluye?',
      draftBubbles: ['El Combo Full Face, que incluye las cejas, labios y pestañas, está Gs 1.200.000, Teresa.'],
      history: [{ sender: 'agent', text: 'El Combo Full Face, que incluye cejas, labios y pestañas, está Gs 1.200.000, Teresa.' }],
    }, { ai: null });

    expect(verdict.approved).toBe(false);
    expect(verdict.source).toBe('rules');
    expect(verdict.reason).toContain('reformulado');
  });

  it('bloqueia a mesma pergunta repetida com palavras diferentes (achado real: "así ya te anoto" vs "así ya te agendo")', async () => {
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Hola',
      draftBubbles: ['¿Cómo es tu nombre? Así ya te agendo por acá 😊'],
      history: [{ sender: 'agent', text: '¿Cómo es tu nombre? Así ya te anoto por acá.' }],
    }, { ai: null });

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toContain('reformulado');
  });

  it('não bloqueia bolhas curtas de confirmação mesmo quando parecidas entre si (evita falso positivo em "¡Dale!"/"Listo")', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify({ approved: true, severity: 'low', reason: 'Confirmação curta e coerente.' }) });
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Dale, gracias',
      draftBubbles: ['¡Listo!'],
      history: [{ sender: 'agent', text: '¡Dale!' }],
    }, { ai: { models: { generateContent } } as any });

    expect(verdict.approved).toBe(true);
  });

  it('não bloqueia quando a resposta traz informação nova, mesmo com histórico recente de agente', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify({ approved: true, severity: 'low', reason: 'Resposta nova e coerente.' }) });
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Y las pestañas cuánto cuestan?',
      draftBubbles: ['El Lash Lift está Gs 140.000 y realza tus pestañas naturales sin extensiones.'],
      history: [{ sender: 'agent', text: 'El Combo Full Face, que incluye cejas, labios y pestañas, está Gs 1.200.000, Teresa.' }],
    }, { ai: { models: { generateContent } } as any });

    expect(verdict.approved).toBe(true);
  });

  it('informa ao revisor o nome já conhecido e instrui a não reprovar só por falta de confirmação verbal (TASK-0181: achado real de auditoria, 8 de 15 bloqueios em 10 dias citavam "nome não confirmado" mesmo usando o nome de perfil real)', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify({ approved: true, severity: 'low', reason: 'Nome de perfil usado corretamente.' }) });
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Cuánto cuesta el combo de cejas y labios?',
      draftBubbles: ['Hola, Celeste. El Combo Micro Cejas + Labios está Gs 850.000.'],
      contactName: 'Celeste',
    }, { ai: { models: { generateContent } } as any });

    expect(verdict.approved).toBe(true);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      contents: expect.stringContaining('NOME JÁ CONHECIDO: Celeste'),
    }));
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      contents: expect.stringContaining('NUNCA reprove só porque a resposta ainda não perguntou ou confirmou verbalmente o nome'),
    }));
  });

  it('sinaliza ao revisor quando não há nenhum nome conhecido, pra distinguir de um nome inventado', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: JSON.stringify({ approved: false, severity: 'high', reason: 'Nome inventado, não bate com nenhum nome conhecido.' }) });
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: '¡Hola! Quiero más información',
      draftBubbles: ['¡Hola, Liz! ¿Cómo estás?'],
    }, { ai: { models: { generateContent } } as any });

    expect(verdict.approved).toBe(false);
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      contents: expect.stringContaining('NOME JÁ CONHECIDO: [nenhum — perfil do WhatsApp sem nome configurado]'),
    }));
  });

  it('aceita a aprovação estruturada do segundo agente', async () => {
    const ai: any = {
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({ approved: true, severity: 'low', reason: 'Resposta contextual e respaldada.' }) }),
      },
    };
    const verdict = await reviewAutoReplyBeforeSend({
      customerMessage: 'Hola, cuánto dura?',
      draftBubbles: ['Cada procedimiento tiene una duración diferente. ¿Te referís a cejas, labios o pestañas?'],
      history: [{ sender: 'agent', text: 'El Combo Full Face incluye cejas, labios y pestañas.' }],
    }, { ai });

    expect(verdict).toMatchObject({ approved: true, source: 'gemini-reviewer', severity: 'low' });
  });

  describe('override determinístico pra bloqueio falso-positivo só por "nome ausente" (achado real 04/09/2026, TASK-0277)', () => {
    it('aprova automaticamente quando o motivo é exclusivamente sobre nome ausente e o rascunho não avança pra agenda', async () => {
      const ai: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({
            approved: false,
            severity: 'medium',
            reason: 'O rascunho informa o preço e serviços, mas não solicita ou confirma o nome da cliente antes de avançar, conforme exigido pelas regras de atendimento.',
          }) }),
        },
      };
      const verdict = await reviewAutoReplyBeforeSend({
        customerMessage: 'Hola, cuánto cuesta el combo de cejas y labios?',
        draftBubbles: ['Para ambas zonas tenemos el Combo Micro Cejas + Labios a Gs 850.000, que incluye la evaluación presencial previa con Monique.', '¿Tenés algún procedimiento previo en cejas o labios, o sería tu primera vez?'],
      }, { ai });

      expect(verdict.approved).toBe(true);
      expect(verdict.reason).toContain('override determinístico');
    });

    it('NÃO aprova quando o bloqueio mistura nome ausente com outro problema real (confusão com o nome da própria assistente)', async () => {
      const ai: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({
            approved: false,
            severity: 'medium',
            reason: 'A assistente se apresentou como Ana, mas incluiu o próprio nome na saudação como se estivesse falando com ela mesma ("Hola, Ana, todo bien?"), além de ainda não ter solicitado ou confirmado o nome da cliente antes de avançar.',
          }) }),
        },
      };
      const verdict = await reviewAutoReplyBeforeSend({
        customerMessage: 'Hola, quiero info',
        draftBubbles: ['Hola, Ana, todo bien?', '¿Qué servicio te gustaría consultar?'],
      }, { ai });

      expect(verdict.approved).toBe(false);
    });

    it('NÃO aprova quando o rascunho realmente empurra pra agenda, mesmo que o motivo cite só nome', async () => {
      const ai: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({
            approved: false,
            severity: 'medium',
            reason: 'O rascunho não solicita ou confirma o nome da cliente antes de avançar.',
          }) }),
        },
      };
      const verdict = await reviewAutoReplyBeforeSend({
        customerMessage: 'Quiero agendar',
        draftBubbles: ['¿Qué día te queda mejor para agendar tu turno?'],
      }, { ai });

      expect(verdict.approved).toBe(false);
    });
  });

  describe('override determinístico pra bloqueio falso-positivo por "ordem" de pedir o nome (achado real 04/09/2026, TASK-0293/TASK-0296)', () => {
    it('aprova quando o motivo reclama de ordem (nome depois do preço) e o rascunho já pede o nome na mesma resposta', async () => {
      const ai: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({
            approved: false,
            severity: 'medium',
            reason: 'A assistente informou o preço e detalhes do combo antes de solicitar ou confirmar o nome da cliente, violando a regra de solicitar o nome antes de avançar, e a ordem das etapas exige pedir o nome primeiro.',
          }) }),
        },
      };
      const verdict = await reviewAutoReplyBeforeSend({
        customerMessage: 'Oi, quero marcar o combo de sobrancelhas e cílios pra semana que vem',
        draftBubbles: [
          'Oi, tudo bem? O Combo de Micro Sobrancelhas + Cílios sai por Gs 600.000 e já inclui a avaliação inicial.',
          'Qual é o seu nome? Me conta também qual dia ou horário da semana que vem você prefere pra eu verificar a agenda pra você.',
        ],
      }, { ai });

      expect(verdict.approved).toBe(true);
      expect(verdict.reason).toContain('override determinístico');
    });

    it('NÃO aprova quando o rascunho empurra pra agenda de verdade e não pede o nome em lugar nenhum (violação real da regra 24, não falso-positivo de ordem)', async () => {
      const ai: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({
            approved: false,
            severity: 'medium',
            reason: 'A resposta avança pra agenda sem ter confirmado o nome antes; a ordem correta exige pedir o nome primeiro.',
          }) }),
        },
      };
      const verdict = await reviewAutoReplyBeforeSend({
        customerMessage: 'Quiero agendar mi turno',
        draftBubbles: ['¿Qué día te queda mejor para agendar tu turno?'],
      }, { ai });

      expect(verdict.approved).toBe(false);
    });

    it('NÃO aprova quando o motivo mistura ordem do nome com outro problema real (idioma)', async () => {
      const ai: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({
            approved: false,
            severity: 'medium',
            reason: 'A assistente informou o preço antes de pedir o nome (a ordem das etapas exige pedir o nome primeiro) e também misturou idioma espanhol na resposta.',
          }) }),
        },
      };
      const verdict = await reviewAutoReplyBeforeSend({
        customerMessage: 'Oi, quero marcar pra semana que vem',
        draftBubbles: ['O Combo sai por Gs 600.000. Qual é o seu nome?'],
      }, { ai });

      expect(verdict.approved).toBe(false);
    });
  });

  describe('override determinístico pra bloqueio falso-positivo do pronome "te" como mistura de idioma (achado real 04/09/2026, TASK-0294/TASK-0296)', () => {
    it('aprova quando o motivo cita mistura de idioma só por causa do "te", num rascunho 100% em português', async () => {
      const ai: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({
            approved: false,
            severity: 'medium',
            reason: 'A cliente escreveu em português, mas a última mensagem do rascunho utiliza expressões em espanhol/português misturadas ("como te comentei antes") sem manter a consistência do idioma português do Brasil exigido pelo histórico e pela mensagem da cliente.',
          }) }),
        },
      };
      const verdict = await reviewAutoReplyBeforeSend({
        customerMessage: 'Qual é o valor do procedimento de lábios?',
        draftBubbles: [
          'O Microlips Labios sai por Gs 550.000, como te comentei antes. Se a sua intenção for uniformizar tons mais escuros, temos também a Neutralização por Gs 450.000.',
          'Você já tem algum procedimento antigo nos lábios ou seria sua primeira vez?',
        ],
      }, { ai });

      expect(verdict.approved).toBe(true);
      expect(verdict.reason).toContain('override determinístico');
    });

    it('NÃO aprova quando existe mistura real de idioma (conectivo exclusivo de espanhol, não só "te")', async () => {
      const ai: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({
            approved: false,
            severity: 'medium',
            reason: 'A resposta mistura espanhol e português na mesma frase.',
          }) }),
        },
      };
      const verdict = await reviewAutoReplyBeforeSend({
        customerMessage: 'Qual é o valor do procedimento de lábios?',
        draftBubbles: ['O Microlips Labios sai por Gs 550.000, pero também inclui a avaliação.'],
      }, { ai });

      expect(verdict.approved).toBe(false);
    });

    it('NÃO aprova quando o motivo não fala de mistura/idioma nenhuma', async () => {
      const ai: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({
            approved: false,
            severity: 'high',
            reason: 'A resposta promete um reembolso não autorizado.',
          }) }),
        },
      };
      const verdict = await reviewAutoReplyBeforeSend({
        customerMessage: 'Qual é o valor do procedimento de lábios?',
        draftBubbles: ['Vamos te devolver o dinheiro, como te comentei antes.'],
      }, { ai });

      expect(verdict.approved).toBe(false);
    });
  });

  describe('correção automática de empurrão de agenda após pergunta informativa, em vez de bloquear (achado real, Soledad/TASK-0287, TASK-0297)', () => {
    it('aprova e devolve correctedBubbles sem a bolha que empurra agenda, quando ela está isolada numa segunda bolha', async () => {
      const verdict = await reviewAutoReplyBeforeSend({
        customerMessage: 'Y sobre la hinchazón, es normal que quede así? Y sobre el procedimiento en sí?',
        draftBubbles: [
          'Y sobre la hinchazón, es normal que queden algo inflamados al terminar el procedimiento, pero va bajando rápidamente en las primeras horas.',
          '¿Querés que revisemos la disponibilidad de la agenda para coordinar tu turno?',
        ],
      }, { ai: null });

      expect(verdict.approved).toBe(true);
      expect(verdict.source).toBe('rules');
      expect(verdict.correctedBubbles).toEqual([
        'Y sobre la hinchazón, es normal que queden algo inflamados al terminar el procedimiento, pero va bajando rápidamente en las primeras horas.',
      ]);
    });

    it('NÃO corrige (continua bloqueando) quando é uma bolha única misturando informação e empurrão de agenda', async () => {
      const verdict = await reviewAutoReplyBeforeSend({
        customerMessage: 'Cuánto dura el procedimiento de cejas?',
        draftBubbles: ['Dura aproximadamente un año. ¿Agendamos tu turno?'],
      }, { ai: null });

      expect(verdict.approved).toBe(false);
      expect(verdict.correctedBubbles).toBeUndefined();
    });

    it('NÃO corrige quando a cliente já manifestou intenção explícita de agendar (empurrar agenda aí é legítimo, cai no revisor por IA normalmente)', async () => {
      const ai: any = {
        models: {
          generateContent: vi.fn().mockResolvedValue({ text: JSON.stringify({ approved: true, severity: 'low', reason: 'Resposta contextual e segura.' }) }),
        },
      };
      const verdict = await reviewAutoReplyBeforeSend({
        customerMessage: 'Quiero agendar mi turno para la semana que viene',
        draftBubbles: [
          'Genial, tenemos disponibilidad esta semana.',
          '¿Qué día te queda mejor para agendar tu turno?',
        ],
      }, { ai });

      expect(verdict.approved).toBe(true);
      expect(verdict.correctedBubbles).toBeUndefined();
    });
  });
});
