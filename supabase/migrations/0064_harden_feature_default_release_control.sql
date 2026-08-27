-- A função é interna ao trigger de catálogo e não deve ficar exposta via RPC.
revoke execute on function public.seed_disabled_rule_for_new_feature() from public, anon, authenticated;
