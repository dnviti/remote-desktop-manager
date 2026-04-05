import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SetupWizardPage from './SetupWizardPage';

const { getSetupStatus, getDbStatus, completeSetup } = vi.hoisted(() => ({
  getSetupStatus: vi.fn(),
  getDbStatus: vi.fn(),
  completeSetup: vi.fn(),
}));

vi.mock('../api/setup.api', () => ({
  getSetupStatus,
  getDbStatus,
  completeSetup,
}));

describe('SetupWizardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects away when setup is already complete', async () => {
    getSetupStatus.mockResolvedValue({ required: false });

    const view = render(
      <MemoryRouter initialEntries={['/setup']}>
        <Routes>
          <Route path="/setup" element={<SetupWizardPage />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await view.findByText('home')).toBeInTheDocument();
  });

  it('renders the wizard when setup is still required', async () => {
    getSetupStatus.mockResolvedValue({ required: true });

    const view = render(
      <MemoryRouter initialEntries={['/setup']}>
        <Routes>
          <Route path="/setup" element={<SetupWizardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await view.findByText('Arsenale Setup')).toBeInTheDocument();
  });
});
