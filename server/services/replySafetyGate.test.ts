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
});
