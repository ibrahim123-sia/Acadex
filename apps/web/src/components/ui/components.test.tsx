import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDialog } from './confirm';
import { Tabs } from './tabs';

// jsdom has no <dialog> methods
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

describe('Tabs', () => {
  const tabs = [
    { id: 'a', label: 'Alpha', content: () => <p>first</p> },
    { id: 'b', label: 'Beta', content: () => <p>second</p> },
    { id: 'c', label: 'Gamma', hidden: true, content: () => <p>hidden</p> },
  ];

  it('shows one panel, skips hidden tabs and moves with the arrow keys', () => {
    render(<Tabs tabs={tabs} hash={false} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Alpha', 'Beta']);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('first');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('second');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' }); // wraps around
    expect(screen.getByRole('tabpanel')).toHaveTextContent('first');
  });
});

describe('ConfirmDialog', () => {
  it('needs the typed word before confirming a permanent action', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Delete?" confirmLabel="Delete for good" typeToConfirm="DELETE" onConfirm={onConfirm} onClose={() => {}} />);
    const button = screen.getByRole('button', { name: 'Delete for good' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'delete' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE' } });
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
