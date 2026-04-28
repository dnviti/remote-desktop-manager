import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayEgressPolicy } from '../../api/gateway.api';
import { useGatewayStore } from '../../store/gatewayStore';
import { useNotificationStore } from '../../store/notificationStore';
import GatewayEgressPolicyEditor from './GatewayEgressPolicyEditor';

const { listTeamsMock } = vi.hoisted(() => ({
  listTeamsMock: vi.fn(),
}));

vi.mock('../../api/team.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/team.api')>();
  return {
    ...actual,
    listTeams: listTeamsMock,
  };
});

describe('GatewayEgressPolicyEditor', () => {
  const updateGatewayEgressPolicy = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    listTeamsMock.mockResolvedValue([]);
    updateGatewayEgressPolicy.mockResolvedValue(undefined);
    useNotificationStore.setState({ notification: null });
    useGatewayStore.setState({ updateGatewayEgressPolicy });
  });

  const renderEditor = (policy?: GatewayEgressPolicy) => {
    render(<GatewayEgressPolicyEditor gatewayId="gateway-1" policy={policy} />);
  };

  it('renders default deny when no allow rules are configured', () => {
    renderEditor();

    expect(screen.getByText('Default deny')).toBeInTheDocument();
    expect(screen.getByText(/tunneled traffic through this gateway is blocked/i)).toBeInTheDocument();
  });

  it('saves a valid SSH host rule', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Add Rule' }));
    await user.click(screen.getByRole('button', { name: 'SSH' }));
    await user.type(screen.getByLabelText(/Host or Pattern for Rule 1/i), 'app.example.com');
    await user.click(screen.getByRole('button', { name: /add host or pattern/i }));
    await user.type(screen.getByLabelText(/Port for Rule 1/i), '22');
    await user.click(screen.getByRole('button', { name: /add port/i }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save Egress Policy' }));

    await waitFor(() => {
      expect(updateGatewayEgressPolicy).toHaveBeenCalledWith('gateway-1', {
        rules: [
          {
            enabled: true,
            action: 'ALLOW',
            protocols: ['SSH'],
            hosts: ['app.example.com'],
            ports: [22],
          },
        ],
      });
    });
    expect(useNotificationStore.getState().notification).toMatchObject({
      message: 'Gateway egress policy saved.',
      severity: 'success',
    });
  });

  it('accepts exact IP entries as normalized CIDR rules', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Add Rule' }));
    await user.click(screen.getByRole('button', { name: 'Database' }));
    await user.type(screen.getByLabelText(/CIDR or IP for Rule 1/i), '10.25.0.15');
    await user.click(screen.getByRole('button', { name: /add cidr or ip/i }));
    await user.type(screen.getByLabelText(/Port for Rule 1/i), '5432');
    await user.click(screen.getByRole('button', { name: /add port/i }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save Egress Policy' }));

    await waitFor(() => {
      expect(updateGatewayEgressPolicy).toHaveBeenCalledWith('gateway-1', {
        rules: [
          {
            enabled: true,
            action: 'ALLOW',
            protocols: ['DATABASE'],
            cidrs: ['10.25.0.15/32'],
            ports: [5432],
          },
        ],
      });
    });
  });

  it('rejects bare wildcard hosts and blocks saving incomplete rules', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Add Rule' }));
    await user.click(screen.getByRole('button', { name: 'SSH' }));
    await user.type(screen.getByLabelText(/Host or Pattern for Rule 1/i), '*');
    await user.click(screen.getByRole('button', { name: /add host or pattern/i }));
    await user.type(screen.getByLabelText(/Port for Rule 1/i), '22');
    await user.click(screen.getByRole('button', { name: /add port/i }));

    expect(screen.getByText(/bare wildcard is not allowed/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Save Egress Policy' })).toBeDisabled();
    expect(updateGatewayEgressPolicy).not.toHaveBeenCalled();
  });

  it('opens the rule editor in a popup from the datatable', async () => {
    const user = userEvent.setup();
    renderEditor({
      rules: [
        {
          protocols: ['RDP'],
          hosts: ['desktop.example.com'],
          ports: [3389],
        },
      ],
    });

    expect(screen.queryByRole('dialog', { name: /edit egress rule 1/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/edit the selected datatable row/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /edit rule 1/i }));

    expect(screen.getByRole('dialog', { name: /edit egress rule 1/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Host or Pattern for Rule 1/i)).toBeInTheDocument();
  });

  it('keeps destination fields in the main rule editor column after scope', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Add Rule' }));

    const dialog = screen.getByRole('dialog', { name: /edit egress rule 1/i });
    const layout = dialog.querySelector('.px-4.pb-4');
    const scopeLabel = within(dialog).getByText('Scope');
    const hostsLabel = within(dialog).getByText('Hosts');
    const hostsInput = within(dialog).getByLabelText(/Host or Pattern for Rule 1/i);

    expect(layout).toHaveClass('flex');
    expect(layout).toHaveClass('flex-col');
    expect(layout?.className).not.toContain('grid-cols');
    expect(layout).toContainElement(scopeLabel);
    expect(layout).toContainElement(hostsLabel);
    expect(layout).toContainElement(hostsInput);
    expect(Boolean(scopeLabel.compareDocumentPosition(hostsLabel) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('saves an empty policy after removing the last rule', async () => {
    const user = userEvent.setup();
    renderEditor({
      rules: [
        {
          protocols: ['RDP'],
          hosts: ['desktop.example.com'],
          ports: [3389],
        },
      ],
    });

    await user.click(screen.getByRole('button', { name: /remove rule 1/i }));
    expect(screen.getByText('Default deny')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Egress Policy' }));

    await waitFor(() => {
      expect(updateGatewayEgressPolicy).toHaveBeenCalledWith('gateway-1', { rules: [] });
    });
  });
});
