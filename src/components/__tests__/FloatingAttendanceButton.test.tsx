// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingAttendanceButton } from '../FloatingAttendanceButton';

const STORAGE_KEY = 'floating_attendance_position:operator-test';

describe('FloatingAttendanceButton', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('é compacto, acessível e abre Atendimento com um toque', () => {
    const onOpen = vi.fn();
    render(<FloatingAttendanceButton onOpen={onOpen} storageKey={STORAGE_KEY} />);

    const button = screen.getByRole('button', { name: 'Abrir Atendimento por WhatsApp' });
    expect(button.className).toContain('h-12');
    expect(button.className).toContain('w-12');
    expect(button.textContent).toBe('');

    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('move o botão, grava a posição e não abre Atendimento ao finalizar um arraste', () => {
    const onOpen = vi.fn();
    render(<FloatingAttendanceButton onOpen={onOpen} storageKey={STORAGE_KEY} />);

    const button = screen.getByRole('button', { name: 'Abrir Atendimento por WhatsApp' });
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 160, clientY: 160 });
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(button, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.click(button);

    expect(onOpen).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ right: 78, bottom: 78 }));
  });

  it('restaura a última posição registrada para o mesmo operador', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ right: 140, bottom: 96 }));
    render(<FloatingAttendanceButton onOpen={() => undefined} storageKey={STORAGE_KEY} />);

    const button = screen.getByRole('button', { name: 'Abrir Atendimento por WhatsApp' });
    expect(button.style.right).toBe('140px');
    expect(button.style.bottom).toContain('96px');
  });

  it('mantém o ícone dentro da área utilizável em uma tela mobile', () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });

    render(<FloatingAttendanceButton onOpen={() => undefined} storageKey={STORAGE_KEY} />);
    const button = screen.getByRole('button', { name: 'Abrir Atendimento por WhatsApp' });
    fireEvent.pointerDown(button, { pointerId: 2, clientX: 200, clientY: 400 });
    fireEvent.pointerMove(button, { pointerId: 2, clientX: -800, clientY: -600 });
    fireEvent.pointerUp(button, { pointerId: 2, clientX: -800, clientY: -600 });

    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ right: 330, bottom: 784 }));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
  });
});
