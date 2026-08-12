-- Unifica a verificação de pagamento dentro do card de escalonamento (pedido
-- real do dono do produto: hoje existiam dois lugares desconectados pro
-- mesmo caso — o banner Confirmar/Rejeitar dentro da conversa, e o
-- escalonamento gerado automaticamente pra esse mesmo comprovante). `kind`
-- distingue o escalonamento de comprovante de pagamento dos demais, pra o
-- painel saber quando mostrar os botões "Confirmar pagamento"/"Rejeitar
-- pagamento" em vez das ações genéricas.
--
-- Como aplicar: cole este arquivo no SQL Editor do painel Supabase do
-- projeto e rode uma vez. Idempotente, seguro rodar de novo.

alter table public.escalations
  add column if not exists kind text not null default 'general' check (kind in ('general', 'payment_proof'));
