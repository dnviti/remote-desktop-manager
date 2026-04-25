import { useEffect } from 'react';
import { fireEvent, waitFor } from '@testing-library/dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsDialog from './SettingsDialog';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';

const { getProfile, buildSettingsConcerns } = vi.hoisted(() => ({
  getProfile: vi.fn(),
  buildSettingsConcerns: vi.fn(),
}));

vi.mock('../../api/user.api', () => ({
  getProfile,
}));

vi.mock('./settingsConcerns', () => ({
  buildSettingsConcerns,
}));

function createConcern(id: string, label: string, sectionId: string, sectionLabel: string) {
  return {
    id,
    label,
    description: `${label} settings`,
    icon: <span>{label}</span>,
    keywords: [label.toLowerCase()],
    sections: [
      {
        id: sectionId,
        label: sectionLabel,
        description: `${sectionLabel} details`,
        keywords: [sectionLabel.toLowerCase(), label.toLowerCase()],
        content: <div>{sectionLabel} content</div>,
      },
    ],
  };
}

function createConcernWithSections(
  id: string,
  label: string,
  sections: Array<{ id: string; label: string }>,
) {
  return {
    id,
    label,
    description: `${label} settings`,
    icon: <span>{label}</span>,
    keywords: [label.toLowerCase()],
    sections: sections.map((section) => ({
      id: section.id,
      label: section.label,
      description: `${section.label} details`,
      keywords: [section.label.toLowerCase(), label.toLowerCase()],
      content: <div>{section.label} content</div>,
    })),
  };
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    globalThis.IntersectionObserver = class IntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
    } as unknown as typeof IntersectionObserver;

    useAuthStore.setState({
      user: {
        id: 'user-1',
        email: 'admin@example.com',
        username: 'Admin',
        avatarData: null,
        tenantId: 'tenant-1',
        tenantRole: 'OWNER',
      },
      permissions: {
        ...useAuthStore.getState().permissions,
        canManageGateways: true,
      },
      permissionsLoaded: true,
    });

    useFeatureFlagsStore.setState({
      connectionsEnabled: true,
      databaseProxyEnabled: true,
      keychainEnabled: true,
      zeroTrustEnabled: true,
      agenticAIEnabled: true,
      enterpriseAuthEnabled: true,
    });

    useUiPreferencesStore.setState({
      settingsActiveTab: 'personal',
    });

    getProfile.mockResolvedValue({ hasPassword: true });
    buildSettingsConcerns.mockReturnValue([
      createConcern('personal', 'Personal', 'profile', 'Profile'),
      createConcern('security', 'Security', 'passkeys', 'Passkeys'),
      createConcern('governance', 'Governance', 'audit', 'Audit Log'),
    ]);
  });

  it('maps legacy tabs into concern groups and persists the resolved concern', async () => {
    render(
      <SettingsDialog
        open
        onClose={() => {}}
        initialTab="administration"
      />,
    );

    expect(await screen.findByText('Audit Log content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Audit Log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close settings' })).toBeInTheDocument();
    await waitFor(() => {
      expect(useUiPreferencesStore.getState().settingsActiveTab).toBe('governance');
    });
    expect(getProfile).toHaveBeenCalledTimes(1);
  });

  it('filters concerns and sections from the search box', async () => {
    render(
      <SettingsDialog
        open
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText('Profile content')).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText('Search settings...'),
      { target: { value: 'settings' } },
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Profile' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Passkeys' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Audit Log' })).toBeInTheDocument();
    });
    expect(screen.getByText('Profile content')).toBeInTheDocument();
  });

  it('keeps the main settings pane shrinkable for wide section content', async () => {
    render(
      <SettingsDialog
        open
        onClose={() => {}}
      />,
    );

    const activeContent = await screen.findByText('Profile content');
    const mainPane = activeContent.closest('main');
    const section = activeContent.closest('.settings-section');
    const contentWrapper = activeContent.closest('.settings-content');
    const contentScrollContainer = contentWrapper?.parentElement;

    expect(mainPane).toHaveClass('min-w-0');
    expect(mainPane).toHaveClass('w-full');
    expect(section).toHaveClass('min-w-0');
    expect(section).toHaveClass('w-full');
    expect(contentWrapper).toHaveClass('min-w-0');
    expect(contentWrapper).toHaveClass('w-full');
    expect(contentScrollContainer).toHaveClass('overflow-y-auto');
    expect(contentScrollContainer).not.toHaveAttribute('data-radix-scroll-area-viewport');
  });

  it('falls back to the first available section when no requested section exists', async () => {
    buildSettingsConcerns.mockReturnValue([
      createConcernWithSections('personal', 'Personal', [
        { id: 'profile', label: 'Profile' },
        { id: 'appearance', label: 'Appearance' },
      ]),
      createConcern('security', 'Security', 'passkeys', 'Passkeys'),
    ]);

    render(
      <SettingsDialog
        open
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText('Profile content')).toBeInTheDocument();
    expect(screen.queryByText('Appearance content')).not.toBeInTheDocument();
  });

  it('switches sections within the active concern through the derived requested section id', async () => {
    buildSettingsConcerns.mockReturnValue([
      createConcernWithSections('personal', 'Personal', [
        { id: 'profile', label: 'Profile' },
        { id: 'appearance', label: 'Appearance' },
      ]),
    ]);

    render(
      <SettingsDialog
        open
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText('Profile content')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Appearance' })[0]);

    await waitFor(() => {
      expect(screen.getByText('Appearance content')).toBeInTheDocument();
    });
    expect(screen.queryByText('Profile content')).not.toBeInTheDocument();
  });

  it('does not invoke the organization delete trigger when the concern mounts', async () => {
    const deleteTrigger = vi.fn();

    function OrganizationSection({ registerDeleteTrigger }: { registerDeleteTrigger: () => void }) {
      useEffect(() => {
        registerDeleteTrigger();
      }, [registerDeleteTrigger]);

      return <div>Organization content</div>;
    }

    buildSettingsConcerns.mockImplementation((context) => [
      createConcern('personal', 'Personal', 'profile', 'Profile'),
      {
        id: 'organization',
        label: 'Organization',
        description: 'Organization settings',
        icon: <span>Organization</span>,
        keywords: ['organization'],
        sections: [
          {
            id: 'organization-overview',
            label: 'Organization',
            description: 'Organization details',
            keywords: ['organization'],
            content: (
              <OrganizationSection
                registerDeleteTrigger={() => context.setDeleteOrgTrigger(deleteTrigger)}
              />
            ),
          },
        ],
      },
    ]);

    render(
      <SettingsDialog
        open
        onClose={() => {}}
        initialTab="organization"
      />,
    );

    expect(await screen.findByText('Organization content')).toBeInTheDocument();
    expect(deleteTrigger).not.toHaveBeenCalled();
  });
});
