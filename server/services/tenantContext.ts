/**
 * Ponte temporária até o Bloco 2.B (roteamento multi-canal) existir: hoje
 * ainda não há lógica pra resolver de qual tenant é cada mensagem/requisição
 * (isso depende de extrair phone_number_id do payload da Meta e consultar
 * tenant_meta_credentials — trabalho do próximo bloco). Enquanto isso, todo
 * o tráfego real de produção pertence à Monique, então usamos o UUID fixo
 * dela (semeado em supabase/migrations/0001_multi_tenant_schema.sql) como
 * tenantId em todo lugar que hoje seria "o único tenant que existe".
 *
 * Nenhum dos 8 serviços tem esse valor hardcoded neles mesmos — todos
 * recebem tenantId como parâmetro obrigatório. Este é o único lugar que
 * decide qual tenant usar, e é o único arquivo que o Bloco 2.B precisa
 * trocar por resolução real.
 */
export const LEGACY_DEFAULT_TENANT_ID = '11111111-1111-1111-1111-111111111111';
