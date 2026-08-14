import React from 'react';

/**
 * Textarea que cresce junto com o conteúdo, em vez de ficar presa numa
 * altura fixa com scroll interno — achado real: vários campos de texto
 * livre do painel (Base de Conhecimento, notas do CRM, descrição de
 * pendência) guardam textos longos, mas a caixa só mostrava 2-4 linhas,
 * obrigando a rolar dentro dela pra ler/editar o resto. Ajusta a altura via
 * `scrollHeight` a cada mudança de valor — sem precisar de biblioteca nova.
 *
 * Não usar em campos que guardam texto GRANDE por natureza (JSON cru,
 * prompt global inteiro) — aí um tamanho fixo com scroll/resize manual é
 * melhor do que a página inteira esticar pra caber milhares de caracteres.
 */
export function AutoResizeTextarea({
  value,
  className,
  minRows = 2,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={minRows}
      className={`${className || ''} resize-none overflow-hidden`}
      {...rest}
    />
  );
}
