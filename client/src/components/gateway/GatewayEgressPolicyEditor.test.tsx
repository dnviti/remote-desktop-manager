import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayEgressPolicy } from '../../api/gateway.api';
import { useGatewayStore } from '../../store/gatewayStore';
import { useNotificationStore } from '../../store/notificationStore';
import GatewayEgressPolicyEditor from './GatewayEgressPolicyEditor';

describe('GatewayEgressPolicyEditor', () => {
  const updateGatewayEgressPolicy = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
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

    await user.click(screen.getByRole('button', { name: 'Add Allow Rule' }));
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

    await user.click(screen.getByRole('button', { name: 'Add Allow Rule' }));
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

    await user.click(screen.getByRole('button', { name: 'Add Allow Rule' }));
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

    expect(screen.queryByRole('dialog', { name: /edit allow rule 1/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/edit the selected datatable row/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /edit allow rule 1/i }));

    expect(screen.getByRole('dialog', { name: /edit allow rule 1/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Host or Pattern for Rule 1/i)).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: /remove allow rule 1/i }));
    expect(screen.getByText('Default deny')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save Egress Policy' }));

    await waitFor(() => {
      expect(updateGatewayEgressPolicy).toHaveBeenCalledWith('gateway-1', { rules: [] });
    });
  });
});
