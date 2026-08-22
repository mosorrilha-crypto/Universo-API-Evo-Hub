/**
 * Extraído de WhatsAppLeadsSim.tsx (era local ao arquivo) pra ser compartilhado
 * com LeadListRow.tsx sem duplicar a lógica nem criar import circular.
 */

// Paleta de cores dos chips de etiqueta — a cor de cada etiqueta vem de um
// hash do próprio texto (determinístico, sem precisar de seletor de cor
// manual nem de tabela de catálogo de etiquetas).
const LABEL_COLOR_PALETTE = [
  'bg-emerald-950 text-emerald-300 border-emerald-800/60',
  'bg-blue-950 text-blue-300 border-blue-800/60',
  'bg-amber-950 text-amber-300 border-amber-800/60',
  'bg-rose-950 text-rose-300 border-rose-800/60',
  'bg-sky-950 text-sky-300 border-sky-800/60',
  'bg-cyan-950 text-cyan-300 border-cyan-800/60',
  'bg-pink-950 text-pink-300 border-pink-800/60',
  'bg-lime-950 text-lime-300 border-lime-800/60',
];

export function labelColorClasses(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return LABEL_COLOR_PALETTE[Math.abs(hash) % LABEL_COLOR_PALETTE.length];
}

// Avatar de iniciais — a Meta Cloud API não expõe foto de perfil de contato
// (diferente do app pessoal do WhatsApp, que é P2P), então lead real nunca
// tem avatarUrl e caía num <img> quebrado; mock/demo tinha o problema
// inverso, todo lead com a mesma foto de stock. Cor determinística por hash
// do nome/telefone — mesmo padrão de labelColorClasses acima.
const AVATAR_COLOR_PALETTE = [
  'bg-emerald-600',
  'bg-blue-600',
  'bg-amber-600',
  'bg-rose-600',
  'bg-sky-600',
  'bg-cyan-600',
  'bg-pink-600',
  'bg-lime-600',
];

export function avatarColorClasses(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_COLOR_PALETTE[Math.abs(hash) % AVATAR_COLOR_PALETTE.length];
}

export function getInitials(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
