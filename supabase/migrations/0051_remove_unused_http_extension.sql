-- A extensão HTTP instalada no schema public não é relocável no pacote
-- disponibilizado pelo Supabase. A análise de funções, triggers e código da
-- aplicação não encontrou consumidores. Removê-la elimina a superfície de
-- API pública e o alerta de segurança sem afetar os fluxos do produto.
drop extension if exists http;
