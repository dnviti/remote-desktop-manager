export enum ContainerStatus {
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
  RESTARTING = 'RESTARTING',
  REMOVING = 'REMOVING',
  UNKNOWN = 'UNKNOWN',
}

export enum OrchestratorType {
  DOCKER = 'DOCKER',
  PODMAN = 'PODMAN',
  KUBERNETES = 'KUBERNETES',
  NONE = 'NONE',
}

export interface ContainerPortMapping {
  container: number;
  host?: number;
}

export interface ContainerHealthcheck {
  test: string[];
  interval: number;
  timeout: number;
  retries: number;
}

export interface ContainerConfig {
  image: string;
  name: string;
  env: Record<string, string>;
  ports: ContainerPortMapping[];
  labels: Record<string, string>;
  healthcheck?: ContainerHealthcheck;
  network?: string;
  restartPolicy?: 'no' | 'always' | 'unless-stopped' | 'on-failure';
  /** Kubernetes namespace override. When set, the K8s provider deploys into
   *  this namespace (creating it if needed) instead of the global default. */
  namespace?: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  status: ContainerStatus;
  image: string;
  createdAt: Date;
  ports: ContainerPortMapping[];
  labels: Record<string, string>;
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
}

export interface IOrchestratorProvider {
  readonly type: OrchestratorType;

  isAvailable(): Promise<boolean>;

  deployContainer(config: ContainerConfig): Promise<ContainerInfo>;

  removeContainer(containerId: string): Promise<void>;

  listContainers(
    labelFilter: Record<string, string>,
  ): Promise<ContainerInfo[]>;

  getContainerStatus(containerId: string): Promise<ContainerInfo>;

  restartContainer(containerId: string): Promise<void>;

  updateContainerEnv(
    containerId: string,
    env: Record<string, string>,
  ): Promise<void>;

  getContainerLogs(containerId: string, tail?: number): Promise<string>;
}
