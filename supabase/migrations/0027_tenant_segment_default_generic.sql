-- Achado real numa auditoria: o default da coluna tenants.segment era
-- 'beauty_studio' (0003_tenant_segment.sql) — qualquer tenant novo criado
-- sem segmento explícito (inclusive via POST /api/admin/tenants, que também
-- tinha o mesmo fallback hardcoded em server/routes/admin.ts) herdava sem
-- querer as regras da Camada 2 de clínica de estética (nunca prometer
-- resultado idêntico à foto, escalar gravidez/amamentação, "dor não pode
-- ser negada" etc.) — sem sentido nenhum pra um tenant de outro ramo (ex:
-- venda/instalação de piscinas).
--
-- Novo default 'generic': como SEGMENT_LAYERS (autoReply.ts) não tem essa
-- chave, nenhuma regra de segmento é aplicada — só a Camada 1 (Global), que
-- já é genérica o bastante pra qualquer negócio.
--
-- Só afeta INSERTs futuros — não reescreve tenants já existentes (não dá
-- pra distinguir com segurança, só pela coluna, quem escolheu 'beauty_studio'
-- de propósito de quem herdou por acidente). Revisar manualmente o segment
-- de tenants fora do ramo de estética que hoje estão em 'beauty_studio'.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.tenants
  alter column segment set default 'generic';
