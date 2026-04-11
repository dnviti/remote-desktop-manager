import { fireEvent } from '@testing-library/dom';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

import DockedToolbar, { type ToolbarAction } from './DockedToolbar';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';

function jitterClick(handle: HTMLElement) {
  fireEvent.pointerDown(handle, { clientX: 24, clientY: 24, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 27, clientY: 27, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: 27, clientY: 27, pointerId: 1 });
  fireEvent.click(handle);
}

describe('DockedToolbar', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiPreferencesStore.setState({
      toolbarDockedSide: 'left',
      toolbarDockedY: 50,
    });
  });

  it('toggles open and closed on click even with minor pointer jitter', () => {
    const actions: ToolbarAction[] = [
      {
        id: 'test-action',
        icon: <span>T</span>,
        tooltip: 'Test action',
        onClick: () => {},
      },
    ];

    const view = render(
      <TooltipProvider>
        <DockedToolbar actions={actions} />
      </TooltipProvider>,
    );

    const collapseHandle = view.getByRole('button', { name: 'Collapse toolbar' });
    expect(collapseHandle).toHaveAttribute('aria-expanded', 'true');

    jitterClick(collapseHandle);

    const expandHandle = view.getByRole('button', { name: 'Expand toolbar' });
    expect(expandHandle).toHaveAttribute('aria-expanded', 'false');

    jitterClick(expandHandle);

    expect(view.getByRole('button', { name: 'Collapse toolbar' })).toHaveAttribute('aria-expanded', 'true');
  });
});
