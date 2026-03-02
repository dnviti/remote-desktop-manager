import Dockerode from 'dockerode';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';
import {
  IOrchestratorProvider,
  OrchestratorType,
  ContainerConfig,
  ContainerInfo,
  ContainerStatus,
  ContainerPortMapping,
} from './types';

export class DockerProvider implements IOrchestratorProvider {
  readonly type = OrchestratorType.DOCKER;
  private docker: Dockerode;

  constructor() {
    this.docker = new Dockerode({
      socketPath: config.dockerSocketPath,
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  async deployContainer(
    containerConfig: ContainerConfig,
  ): Promise<ContainerInfo> {
    const exposedPorts: Record<string, Record<string, never>> = {};
    const portBindings: Record<string, Array<{ HostPort: string }>> = {};
    for (const p of containerConfig.ports) {
      const key = `${p.container}/tcp`;
      exposedPorts[key] = {};
      if (p.host != null) {
        portBindings[key] = [{ HostPort: String(p.host) }];
      }
    }

    const envArray = Object.entries(containerConfig.env).map(
      ([k, v]) => `${k}=${v}`,
    );

    let healthcheck: Dockerode.ContainerCreateOptions['Healthcheck'];
    if (containerConfig.healthcheck) {
      healthcheck = {
        Test: containerConfig.healthcheck.test,
        Interval: containerConfig.healthcheck.interval * 1_000_000,
        Timeout: containerConfig.healthcheck.timeout * 1_000_000,
        Retries: containerConfig.healthcheck.retries,
      };
    }

    const restartPolicyMap: Record<string, string> = {
      no: '',
      always: 'always',
      'unless-stopped': 'unless-stopped',
      'on-failure': 'on-failure',
    };
    const restartPolicyName =
      restartPolicyMap[containerConfig.restartPolicy ?? 'unless-stopped'] ??
      'unless-stopped';

    const createOptions: Dockerode.ContainerCreateOptions = {
      Image: containerConfig.image,
      name: containerConfig.name,
      Env: envArray,
      Labels: containerConfig.labels,
      ExposedPorts: exposedPorts,
      Healthcheck: healthcheck,
      HostConfig: {
        PortBindings: portBindings,
        RestartPolicy: { Name: restartPolicyName },
        NetworkMode:
          containerConfig.network || config.dockerNetwork || undefined,
      },
    };

    try {
      // Pull image (best-effort — continue with local if pull fails)
      try {
        const stream = await this.docker.pull(containerConfig.image, {});
        await new Promise<void>((resolve, reject) => {
          this.docker.modem.followProgress(
            stream,
            (pullErr: Error | null) => {
              if (pullErr) reject(pullErr);
              else resolve();
            },
          );
        });
      } catch (pullErr) {
        logger.warn(
          `[orchestrator:docker] Could not pull image ${containerConfig.image}, trying with local: ${(pullErr as Error).message}`,
        );
      }

      const container = await this.docker.createContainer(createOptions);
      await container.start();

      const inspect = await container.inspect();
      return this.inspectToContainerInfo(inspect);
    } catch (err) {
      throw new AppError(
        `Docker deploy failed: ${(err as Error).message}`,
        500,
      );
    }
  }

  async removeContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      try {
        await container.stop({ t: 10 });
      } catch {
        // May already be stopped
      }
      await container.remove({ force: true });
    } catch (err) {
      throw new AppError(
        `Docker remove failed: ${(err as Error).message}`,
        500,
      );
    }
  }

  async listContainers(
    labelFilter: Record<string, string>,
  ): Promise<ContainerInfo[]> {
    const labelFilters = Object.entries(labelFilter).map(
      ([k, v]) => `${k}=${v}`,
    );

    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: labelFilters },
    });

    return containers.map((c) => this.listItemToContainerInfo(c));
  }

  async getContainerStatus(containerId: string): Promise<ContainerInfo> {
    try {
      const container = this.docker.getContainer(containerId);
      const inspect = await container.inspect();
      return this.inspectToContainerInfo(inspect);
    } catch (err) {
      throw new AppError(
        `Docker inspect failed: ${(err as Error).message}`,
        500,
      );
    }
  }

  async restartContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.restart({ t: 10 });
    } catch (err) {
      throw new AppError(
        `Docker restart failed: ${(err as Error).message}`,
        500,
      );
    }
  }

  async updateContainerEnv(
    containerId: string,
    env: Record<string, string>,
  ): Promise<void> {
    // For SSH gateways: write authorized_keys via exec (no downtime)
    if (env.SSH_AUTHORIZED_KEYS != null) {
      await this.execUpdateAuthorizedKeys(
        containerId,
        env.SSH_AUTHORIZED_KEYS,
      );
      return;
    }

    // For other env changes: recreate the container with merged env
    await this.recreateWithEnv(containerId, env);
  }

  async getContainerLogs(
    containerId: string,
    tail = 100,
  ): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);
      const logBuffer = (await container.logs({
        stdout: true,
        stderr: true,
        tail,
        follow: false,
      })) as Buffer;
      return this.demuxDockerLogs(logBuffer);
    } catch (err) {
      throw new AppError(
        `Docker logs failed: ${(err as Error).message}`,
        500,
      );
    }
  }

  // ---- Private helpers ----

  private async execUpdateAuthorizedKeys(
    containerId: string,
    publicKeys: string,
  ): Promise<void> {
    const container = this.docker.getContainer(containerId);
    const escapedKeys = publicKeys.replace(/'/g, "'\\''");
    const exec = await container.exec({
      Cmd: [
        'sh',
        '-c',
        `echo '${escapedKeys}' > /config/authorized_keys`,
      ],
      AttachStdout: true,
      AttachStderr: true,
    });
    const stream = await exec.start({ Detach: false });
    await new Promise<void>((resolve) => {
      stream.on('end', resolve);
      stream.on('error', resolve);
      stream.resume();
    });
  }

  private async recreateWithEnv(
    containerId: string,
    newEnv: Record<string, string>,
  ): Promise<void> {
    const container = this.docker.getContainer(containerId);
    const inspect = await container.inspect();

    // Merge existing env with new env
    const existingEnv = (inspect.Config.Env || []).reduce(
      (acc: Record<string, string>, e: string) => {
        const idx = e.indexOf('=');
        if (idx > -1) acc[e.slice(0, idx)] = e.slice(idx + 1);
        return acc;
      },
      {},
    );
    const mergedEnv = { ...existingEnv, ...newEnv };

    // Stop and remove old container
    try {
      await container.stop({ t: 10 });
    } catch {
      // already stopped
    }
    await container.remove({ force: true });

    // Recreate with merged env
    const envArray = Object.entries(mergedEnv).map(([k, v]) => `${k}=${v}`);
    const newContainer = await this.docker.createContainer({
      ...inspect.Config,
      Env: envArray,
      HostConfig: inspect.HostConfig,
      name: inspect.Name.replace(/^\//, ''),
    });
    await newContainer.start();
  }

  private inspectToContainerInfo(
    inspect: Dockerode.ContainerInspectInfo,
  ): ContainerInfo {
    const ports: ContainerPortMapping[] = [];
    const portBindings = (inspect.HostConfig?.PortBindings || {}) as Record<
      string,
      Array<{ HostIp: string; HostPort: string }> | undefined
    >;
    for (const [key, bindings] of Object.entries(portBindings)) {
      const containerPort = parseInt(key.split('/')[0], 10);
      if (bindings && bindings.length > 0) {
        ports.push({
          container: containerPort,
          host: parseInt(bindings[0].HostPort, 10) || undefined,
        });
      } else {
        ports.push({ container: containerPort });
      }
    }

    return {
      id: inspect.Id,
      name: inspect.Name.replace(/^\//, ''),
      status: this.mapDockerState(inspect.State?.Status),
      image: inspect.Config?.Image ?? 'unknown',
      createdAt: new Date(inspect.Created),
      ports,
      labels: inspect.Config?.Labels ?? {},
      health: this.mapDockerHealth(inspect.State?.Health?.Status),
    };
  }

  private listItemToContainerInfo(
    item: Dockerode.ContainerInfo,
  ): ContainerInfo {
    const ports: ContainerPortMapping[] = (item.Ports || []).map((p) => ({
      container: p.PrivatePort,
      host: p.PublicPort || undefined,
    }));

    return {
      id: item.Id,
      name: (item.Names?.[0] || '').replace(/^\//, ''),
      status: this.mapDockerState(item.State),
      image: item.Image,
      createdAt: new Date(item.Created * 1000),
      ports,
      labels: item.Labels ?? {},
      health: this.mapDockerHealth(item.Status),
    };
  }

  private mapDockerState(state?: string): ContainerStatus {
    switch (state?.toLowerCase()) {
      case 'running':
        return ContainerStatus.RUNNING;
      case 'exited':
      case 'dead':
        return ContainerStatus.STOPPED;
      case 'restarting':
        return ContainerStatus.RESTARTING;
      case 'removing':
        return ContainerStatus.REMOVING;
      default:
        return ContainerStatus.UNKNOWN;
    }
  }

  private mapDockerHealth(
    health?: string,
  ): ContainerInfo['health'] {
    if (!health) return 'none';
    if (health.includes('healthy') && !health.includes('unhealthy'))
      return 'healthy';
    if (health.includes('unhealthy')) return 'unhealthy';
    if (health.includes('starting')) return 'starting';
    return 'none';
  }

  private demuxDockerLogs(buffer: Buffer): string {
    // Docker multiplexed stream: 8-byte header per frame
    // Header: [stream_type(1), 0, 0, 0, size(4 BE)]
    const lines: string[] = [];
    let offset = 0;
    while (offset < buffer.length) {
      if (offset + 8 > buffer.length) break;
      const size = buffer.readUInt32BE(offset + 4);
      offset += 8;
      if (offset + size > buffer.length) break;
      lines.push(buffer.subarray(offset, offset + size).toString('utf8'));
      offset += size;
    }
    return lines.join('');
  }
}
