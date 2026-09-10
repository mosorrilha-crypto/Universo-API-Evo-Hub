import React from 'react';

type AtendimentoWorkspaceFrameProps = {
  children: React.ReactNode;
};

/**
 * Refinamento de UI (pedido do dono do produto, 28/08/2026, com print
 * comparando lado a lado com o app real do WhatsApp): o card de "Resumo da
 * operação" (título grande + estatísticas 223 conversas/pendências/IA
 * supervisionada) foi removido por completo — repetia informação que já
 * fica visível na própria lista de conversas logo abaixo, e ocupava tela
 * útil que o WhatsApp real não gasta com isso.
 *
 * TASK-0212 (pedido direto, 01/09/2026, novo print comparando com o
 * WhatsApp Web): o que sobrou do refinamento acima (faixa fina só com
 * "Atendimento" + seletor de empresa) foi removido também. Era escondido no
 * mobile desde 29/08/2026 por ser redundante com a barra de abas inferior
 * (a aba "Conversas" já ativa já deixa claro onde a tela está); a
 * justificativa original pra manter no desktop ("há espaço de sobra e o
 * seletor de empresa é mais usado ali") não se sustenta mais — o dono do
 * produto apontou que essa faixa some espaço útil de tela mesmo no
 * desktop, e o seletor de empresa que ela carregava é uma DUPLICATA exata
 * do que já existe no menu de perfil do SaaS Admin em `Header.tsx`
 * (`isProfileMenuOpen`, mesmos `tenants`/`activeTenant`/`onSelectTenant`) —
 * nunca foi a única forma de trocar de empresa, só uma segunda entrada
 * redundante. O componente agora é só o wrapper de layout
 * (`.atendimento-workspace`/`.atendimento-workspace__content`), que
 * continua existindo porque a cadeia de flexbox que resolve a altura do
 * Atendimento no mobile (TASK-0159/TASK-0162) depende dessas duas classes.
 */
export default function AtendimentoWorkspaceFrame({ children }: AtendimentoWorkspaceFrameProps) {
  return (
    <section className="atendimento-workspace" aria-label="Central de atendimento">
      <div className="atendimento-workspace__content">{children}</div>
    </section>
  );
}
