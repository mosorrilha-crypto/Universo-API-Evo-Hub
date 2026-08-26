/**
 * Direção visual: atalho operacional compacto, discreto e reposicionável.
 * Usa verde WhatsApp como sinal de conversa; toque abre Atendimento e arraste move o atalho.
 */
import { PointerEvent, useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';

type FloatingAttendanceButtonProps = {
  onOpen: () => void;
  storageKey: string;
};

type Position = { right: number; bottom: number };

const BUTTON_SIZE = 48;
const SAFE_MARGIN = 12;
const DEFAULT_POSITION: Position = { right: 18, bottom: 18 };

function clampPosition(position: Position): Position {
  const maxRight = Math.max(SAFE_MARGIN, window.innerWidth - BUTTON_SIZE - SAFE_MARGIN);
  const maxBottom = Math.max(SAFE_MARGIN, window.innerHeight - BUTTON_SIZE - SAFE_MARGIN);
  return {
    right: Math.min(Math.max(position.right, SAFE_MARGIN), maxRight),
    bottom: Math.min(Math.max(position.bottom, SAFE_MARGIN), maxBottom),
  };
}

export function FloatingAttendanceButton({ onOpen, storageKey }: FloatingAttendanceButtonProps) {
  const [position, setPosition] = useState<Position>(DEFAULT_POSITION);
  const positionRef = useRef<Position>(DEFAULT_POSITION);
  const dragRef = useRef<{ startX: number; startY: number; origin: Position; moved: boolean } | null>(null);
  const ignoreClickRef = useRef(false);

  const updatePosition = (next: Position) => {
    positionRef.current = next;
    setPosition(next);
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        updatePosition(DEFAULT_POSITION);
        return;
      }
      const saved = JSON.parse(raw) as Partial<Position>;
      if (typeof saved.right !== 'number' || typeof saved.bottom !== 'number') throw new Error('Posição inválida');
      updatePosition(clampPosition({ right: saved.right, bottom: saved.bottom }));
    } catch {
      updatePosition(DEFAULT_POSITION);
    }
  }, [storageKey]);

  const savePosition = (next: Position) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Sem storage disponível, o atalho continua movível durante a sessão atual.
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // O arraste continua mesmo quando o navegador não puder capturar esse ponteiro.
      }
    }
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: positionRef.current,
      moved: false,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) drag.moved = true;
    if (!drag.moved) return;
    updatePosition(clampPosition({
      right: drag.origin.right - deltaX,
      bottom: drag.origin.bottom - deltaY,
    }));
  };

  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (
      typeof event.currentTarget.hasPointerCapture === 'function'
      && typeof event.currentTarget.releasePointerCapture === 'function'
      && event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved) {
      ignoreClickRef.current = true;
      savePosition(positionRef.current);
    }
    dragRef.current = null;
  };

  return (
    <button
      type="button"
      onClick={() => {
        if (ignoreClickRef.current) {
          ignoreClickRef.current = false;
          return;
        }
        onOpen();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      aria-label="Abrir Atendimento por WhatsApp"
      title="Toque para abrir Atendimento. Arraste para mover."
      style={{ right: `${position.right}px`, bottom: `calc(${position.bottom}px + env(safe-area-inset-bottom))` }}
      className="fixed z-40 inline-flex h-12 w-12 touch-none select-none items-center justify-center rounded-full border border-emerald-300/50 bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-950/35 transition-[transform,background-color,box-shadow] duration-150 hover:bg-emerald-400 hover:shadow-xl hover:shadow-emerald-950/45 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-300/45 active:scale-[0.97] cursor-grab active:cursor-grabbing"
    >
      <MessageCircle className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
