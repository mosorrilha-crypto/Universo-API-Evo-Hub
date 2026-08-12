-- Dica gerada pelo Gemini (análise da imagem do comprovante) pro operador
-- decidir mais rápido se deve confirmar/rejeitar — nunca confirma pagamento
-- sozinho, é só um resumo do que a IA conseguiu ler na imagem. Ver
-- server/services/paymentReceiptAnalysis.ts e webhooks.ts.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.appointments
  add column if not exists payment_receipt_hint text;
