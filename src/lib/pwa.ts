/**
 * Detecta se o app está rodando instalado (PWA, aberto pelo ícone da tela
 * inicial), não numa aba comum do navegador — usado pra restringir o "app
 * do atendente" só às telas de Atendimento/CRM/Escalonamentos quando
 * aberto pelo ícone instalado (issue #159), mantendo o painel completo
 * disponível quando acessado normalmente pelo navegador (desktop/admin).
 *
 * `display-mode: standalone` cobre Android/Chrome; `navigator.standalone`
 * é a forma específica do iOS Safari pro mesmo caso (não expõe
 * display-mode do jeito padrão).
 */
export function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false;
  const matchesStandalone = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = (window.navigator as any).standalone === true;
  return !!(matchesStandalone || iosStandalone);
}
