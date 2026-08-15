-- Modo "somente anúncios" (agent_status.ads_only, 0029): até aqui a única
-- forma de identificar um lead vindo de anúncio era o ctwa_clid, que a Meta
-- quase nunca preenche no tráfego real (achado em produção, 15/08/2026).
-- Complemento: o tenant configura os textos exatos dos "ice breakers" que a
-- Meta oferece no botão do anúncio (ex: "Me gustaría reservar un horario
-- para el combo de cejas y labios 💕") — quando a primeira mensagem de um
-- lead bate com um desses textos, a conversa é tratada como vinda de
-- anúncio mesmo sem ctwa_clid (ver matchesAdTriggerMessage em agentStatus.ts
-- e o gate em webhooks.ts).
alter table agent_status add column if not exists ad_trigger_messages jsonb;
alter table conversations add column if not exists ad_greeting_matched_at timestamptz;
