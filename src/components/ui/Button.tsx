/**
 * Issue #125 — levantamento real do painel (16/08/2026, grep em
 * src/components/*.tsx) mostrou que a PALETA por variante já é
 * consistente hoje (bg-emerald-600 hover:bg-emerald-500 pro CTA
 * primário, bg-slate-800 hover:bg-slate-700 pro secundário, vermelho
 * pro destrutivo — 25/23/poucos casos, sem inconsistência real). O gap
 * real e mensurável: `focus:outline-none` aparece 85 vezes no painel,
 * mas só ~11 lugares devolvem um anel de foco depois — a grande maioria
 * dos botões fica sem NENHUM indicador visível de foco pra quem navega
 * por teclado. `disabled` também não tem tratamento uniforme (8 de 10
 * arquivos com `disabled=`).
 *
 * Este componente é a combinação tamanho × variante (mesmo padrão do
 * Huly citado na issue original): cada combinação já nasce com foco
 * (`:focus-visible`, não `:focus` — nunca aparece num clique de mouse,
 * só na navegação real por teclado, pra não poluir visualmente o painel
 * de quem usa mouse o tempo todo) e `disabled` padronizados uma única
 * vez, nunca por instância.
 *
 * Adoção incremental (mesmo espírito do #124): não migra todo botão
 * existente numa passada só — Header.tsx usa como referência (ver
 * comentário lá). Resto do painel adota aos poucos, código novo já
 * nasce usando isto em vez de reescrever a combinação de classes na mão.
 */
import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** true = padding quadrado (só ícone, sem label) em vez do padding retangular normal. */
  iconOnly?: boolean;
  /** Estado "selecionado" (aba ativa, filtro ativo, pill de status atual) — visualmente distinto da variante normal, sem trocar de variante. */
  active?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold shadow disabled:hover:bg-emerald-600',
  secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:hover:bg-slate-800',
  ghost: 'text-slate-400 hover:text-white hover:bg-slate-800 disabled:hover:bg-transparent disabled:hover:text-slate-400',
  danger: 'text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 disabled:hover:bg-transparent disabled:hover:text-rose-400',
};

/** Variante quando `active` está ligado — mesma cor em todas as variantes (o "selecionado" sempre lê como o CTA primário, independente da variante base do botão). */
const ACTIVE_CLASSES = 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold shadow-sm shadow-emerald-900/50';

const SIZE_TEXT_GAP: Record<ButtonSize, string> = {
  xs: 'text-[11px] gap-1',
  sm: 'text-xs gap-1.5',
  md: 'text-sm gap-2',
};

const SIZE_PADDING: Record<ButtonSize, { normal: string; icon: string }> = {
  xs: { normal: 'px-2 py-1', icon: 'p-1' },
  sm: { normal: 'px-2.5 py-1.5', icon: 'p-1.5' },
  md: { normal: 'px-3.5 py-2', icon: 'p-2' },
};

/**
 * Anel de foco só em `:focus-visible` (Tailwind `focus-visible:`) — ao
 * contrário de `focus:`, que dispara em QUALQUER foco (inclusive clique de
 * mouse). Mesmo raciocínio do anel documentado na issue original (Huly):
 * cor de destaque única, offset visível contra o fundo escuro do painel.
 */
const FOCUS_RING_CLASSES = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';

const DISABLED_CLASSES = 'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none';

/** CTA primário usa o mesmo raio de card/badge maior (rounded-panel, ver issue #124) — os demais usam o raio de controle padrão (rounded-control). Convenção já em uso no painel antes deste componente existir, não uma escolha nova. */
function radiusClassFor(variant: ButtonVariant, active: boolean): string {
  return variant === 'primary' || active ? 'rounded-panel' : 'rounded-control';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
    const variant: ButtonVariant = props.variant ?? 'secondary';
    const size: ButtonSize = props.size ?? 'sm';
    const iconOnly = props.iconOnly ?? false;
    const active = props.active ?? false;
    const { variant: _variant, size: _size, iconOnly: _iconOnly, active: _active, className = '', type = 'button', children, ...rest } = props;
    const padding = iconOnly ? SIZE_PADDING[size].icon : SIZE_PADDING[size].normal;
    const colors = active ? ACTIVE_CLASSES : VARIANT_CLASSES[variant];
    return (
      <button
        ref={ref}
        type={type}
        className={`inline-flex items-center justify-center ${radiusClassFor(variant, active)} transition-all cursor-pointer whitespace-nowrap ${padding} ${SIZE_TEXT_GAP[size]} ${colors} ${FOCUS_RING_CLASSES} ${DISABLED_CLASSES} ${className}`}
        {...rest}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
