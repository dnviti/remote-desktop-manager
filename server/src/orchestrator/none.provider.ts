import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import {
  IOrchestratorProvider,
  OrchestratorType,
  ContainerConfig,
  ContainerInfo,
  ContainerStatus,
} from './types';

const UNAVAILABLE_MSG =
  'Container orchestration not available. Configure Docker socket, Podman socket, or Kubernetes credentials.';

export class NoneProvider implements IOrchestratorProvider {
  readonly type = OrchestratorType.NONE;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async deployContainer(_config: ContainerConfig): Promise<ContainerInfo> {
    throw new AppError(UNAVAILABLE_MSG, 501);
  }

  async removeContainer(_containerId: string): Promise<void> {
    throw new AppError(UNAVAILABLE_MSG, 501);
  }

  async listContainers(
    _labelFilter: Record<string, string>,
  ): Promise<ContainerInfo[]> {
    return [];
  }

  async getContainerStatus(containerId: string): Promise<ContainerInfo> {
    logger.warn(
      `[orchestrator:none] getContainerStatus called for ${containerId} but no orchestrator is configured`,
    );
    return {
      id: containerId,
      name: 'unknown',
      status: ContainerStatus.UNKNOWN,
      image: 'unknown',
      createdAt: new Date(0),
      ports: [],
      labels: {},
      health: 'none',
    };
  }

  async restartContainer(_containerId: string): Promise<void> {
    throw new AppError(UNAVAILABLE_MSG, 501);
  }

  async updateContainerEnv(
    _containerId: string,
    _env: Record<string, string>,
  ): Promise<void> {
    throw new AppError(UNAVAILABLE_MSG, 501);
  }

  async getContainerLogs(
    _containerId: string,
    _tail?: number,
  ): Promise<string> {
    throw new AppError(UNAVAILABLE_MSG, 501);
  }
}
