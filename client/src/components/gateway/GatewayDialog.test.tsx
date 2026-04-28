import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GatewayDialog from './GatewayDialog';

describe('GatewayDialog', () => {
  it('uses viewport-relative sizing for the gateway editor popup', () => {
    render(<GatewayDialog open onClose={vi.fn()} gateway={null} />);

    const dialog = screen.getByRole('dialog', { name: /new gateway/i });

    expect(dialog).toHaveClass('w-[calc(100vw-1rem)]');
    expect(dialog).toHaveClass('sm:w-[90vw]');
    expect(dialog).toHaveClass('sm:max-w-[90vw]');
    expect(dialog).toHaveClass('overflow-hidden');
  });

  it('keeps header and footer outside the scrollable gateway form body', () => {
    render(<GatewayDialog open onClose={vi.fn()} gateway={null} />);

    const dialog = screen.getByRole('dialog', { name: /new gateway/i });
    const title = screen.getByText('New Gateway');
    const saveButton = screen.getByRole('button', { name: 'Create' });
    const scrollBody = dialog.querySelector('.min-h-0');

    expect(scrollBody).toHaveClass('flex-1');
    expect(scrollBody).toHaveClass('overflow-y-auto');
    expect(scrollBody).toHaveClass('overflow-x-hidden');
    expect(scrollBody).not.toContainElement(title);
    expect(scrollBody).not.toContainElement(saveButton);
    expect(dialog).toContainElement(title);
    expect(dialog).toContainElement(saveButton);
  });
});
