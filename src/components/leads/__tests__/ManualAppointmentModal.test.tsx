// @vitest-environment jsdom
/**
 * TASK-0409 (achado real, pedido direto com print anotado): "os serviços não
 * estão sincronizados com o catálogo e não preenche o preço" — o <select>
 * só listava produtos de nível superior, nunca as `variants` (ex: "Pestañas"
 * da Monique só existe como 7 variantes — Lash Lift, Efecto Foxy... — sem
 * nenhuma opção de nível superior agendável de verdade). Também: "pode tirar
 * agendamento pra de dentro da caixa de texto" — o bloco "Agendamento para"
 * tinha fundo/borda igual um input real, mas não era editável.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualAppointmentModal } from '../ManualAppointmentModal';

afterEach(() => cleanup());

const noop = () => {};

const baseProps = {
  isOpen: true,
  leadName: 'Lucas Gimenes',
  leadPhone: '5567998038466',
  isCustomService: false,
  onIsCustomServiceChange: noop,
  customDurationMinutes: '',
  onCustomDurationMinutesChange: noop,
  date: '',
  onDateChange: noop,
  time: '',
  onTimeChange: noop,
  freeSlots: [],
  isLoadingFreeSlots: false,
  freeSlotsError: null,
  notes: '',
  onNotesChange: noop,
  paymentReceived: false,
  onPaymentReceivedChange: noop,
  paymentAmountReceived: '',
  onPaymentAmountReceivedChange: noop,
  error: null,
  isCreating: false,
  onSubmit: (e: React.FormEvent) => e.preventDefault(),
  onClose: noop,
};

const catalogWithVariants = [
  {
    id: 'p1',
    name: 'Pestañas',
    priceText: 'Gs 140.000 a Gs 350.000 (varia por efeito)',
    variants: [
      { id: 'p1:Lash Lift', code: 'Lash Lift', priceText: 'Gs 140.000' },
      { id: 'p1:Efecto Foxy', code: 'Efecto Foxy', priceText: 'Gs 200.000' },
    ],
  },
  {
    id: 'p2',
    name: 'Cejas Microshading',
    priceText: 'Gs 550.000',
    variants: [],
  },
];

describe('ManualAppointmentModal — catálogo com variantes (TASK-0409)', () => {
  it('lista as variantes dentro de um optgroup, e o produto sem variantes direto', () => {
    render(<ManualAppointmentModal {...baseProps} products={catalogWithVariants} serviceName="" onServiceNameChange={noop} />);

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('Lash Lift');
    expect(options).toContain('Efecto Foxy');
    expect(options).toContain('Cejas Microshading');
    // O produto-pai "Pestañas" em si nunca vira uma opção selecionável — só as variantes.
    expect(options).not.toContain('Pestañas');
  });

  it('escolher uma variante chama onServiceNameChange com o code exato (o mesmo que o backend casa via findProductMatch)', () => {
    const onServiceNameChange = vi.fn();
    render(<ManualAppointmentModal {...baseProps} products={catalogWithVariants} serviceName="" onServiceNameChange={onServiceNameChange} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Lash Lift' } });
    expect(onServiceNameChange).toHaveBeenCalledWith('Lash Lift');
  });

  it('mostra o preço da variante escolhida, não a faixa do produto-pai', () => {
    render(<ManualAppointmentModal {...baseProps} products={catalogWithVariants} serviceName="Lash Lift" onServiceNameChange={noop} />);
    expect(screen.getByText('Gs 140.000')).toBeTruthy();
    expect(screen.queryByText('Gs 140.000 a Gs 350.000 (varia por efeito)')).toBeNull();
  });

  it('mostra o preço de um produto sem variantes', () => {
    render(<ManualAppointmentModal {...baseProps} products={catalogWithVariants} serviceName="Cejas Microshading" onServiceNameChange={noop} />);
    expect(screen.getByText('Gs 550.000')).toBeTruthy();
  });

  it('sem serviço escolhido ainda, não mostra nenhum preço', () => {
    render(<ManualAppointmentModal {...baseProps} products={catalogWithVariants} serviceName="" onServiceNameChange={noop} />);
    expect(screen.queryByText(/Gs \d/)).toBeNull();
  });

  it('"Agendando para" aparece como texto simples, sem caixa de input por trás', () => {
    render(<ManualAppointmentModal {...baseProps} products={catalogWithVariants} serviceName="" onServiceNameChange={noop} />);
    const label = screen.getByText(/Agendando para/).closest('p')!;
    expect(label.className).not.toContain('border');
    expect(label.className).not.toContain('bg-slate-950');
    expect(screen.getByText('Lucas Gimenes')).toBeTruthy();
    expect(screen.getByText(/5567998038466/)).toBeTruthy();
  });
});
