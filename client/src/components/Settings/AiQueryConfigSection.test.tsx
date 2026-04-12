import { fireEvent, waitFor } from '@testing-library/dom';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AiQueryConfigSection from './AiQueryConfigSection';
import { useNotificationStore } from '../../store/notificationStore';

const { getAiConfig, updateAiConfig } = vi.hoisted(() => ({
  getAiConfig: vi.fn(),
  updateAiConfig: vi.fn(),
}));

vi.mock('../../api/aiQuery.api', () => ({
  getAiConfig,
  updateAiConfig,
}));

describe('AiQueryConfigSection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useNotificationStore.setState({ notification: null });

    getAiConfig.mockResolvedValue({
      backends: [
        {
          name: 'primary',
          provider: 'openai',
          hasApiKey: true,
          baseUrl: null,
          defaultModel: 'gpt-4o',
        },
      ],
      queryGeneration: {
        enabled: false,
        backend: 'primary',
        modelId: 'gpt-4o',
        maxTokensPerRequest: 4096,
        dailyRequestLimit: 100,
      },
      queryOptimizer: {
        enabled: true,
        backend: 'primary',
        modelId: 'gpt-4o-mini',
        maxTokensPerRequest: 4096,
      },
      temperature: 0.2,
      timeoutMs: 60000,
      provider: 'openai',
      hasApiKey: true,
      modelId: 'gpt-4o',
      baseUrl: null,
      maxTokensPerRequest: 4096,
      dailyRequestLimit: 100,
      enabled: false,
    });
    updateAiConfig.mockResolvedValue({
      backends: [
        {
          name: 'primary',
          provider: 'openai',
          hasApiKey: true,
          baseUrl: null,
          defaultModel: 'gpt-4o',
        },
      ],
      queryGeneration: {
        enabled: true,
        backend: 'primary',
        modelId: 'gpt-4.1',
        maxTokensPerRequest: 4096,
        dailyRequestLimit: 100,
      },
      queryOptimizer: {
        enabled: true,
        backend: 'primary',
        modelId: 'gpt-4o-mini',
        maxTokensPerRequest: 4096,
      },
      temperature: 0.2,
      timeoutMs: 60000,
      provider: 'openai',
      hasApiKey: true,
      modelId: 'gpt-4.1',
      baseUrl: null,
      maxTokensPerRequest: 4096,
      dailyRequestLimit: 100,
      enabled: true,
    });
  });

  it('loads AI settings and saves the updated configuration', async () => {
    render(<AiQueryConfigSection />);

    fireEvent.click(await screen.findByRole('switch', { name: 'Enable Query Generation' }));
    fireEvent.change(screen.getByLabelText('Query generation model'), {
      target: { value: 'gpt-4.1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateAiConfig).toHaveBeenCalledWith({
        backends: [
          {
            name: 'primary',
            provider: 'openai',
            baseUrl: null,
            defaultModel: 'gpt-4o',
          },
        ],
        queryGeneration: {
          enabled: true,
          backend: 'primary',
          modelId: 'gpt-4.1',
          maxTokensPerRequest: 4096,
          dailyRequestLimit: 100,
        },
        queryOptimizer: {
          enabled: true,
          backend: 'primary',
          modelId: 'gpt-4o-mini',
          maxTokensPerRequest: 4096,
        },
        temperature: 0.2,
        timeoutMs: 60000,
      });
    });

    expect(useNotificationStore.getState().notification).toMatchObject({
      message: 'AI configuration saved',
      severity: 'success',
    });
  });
});
