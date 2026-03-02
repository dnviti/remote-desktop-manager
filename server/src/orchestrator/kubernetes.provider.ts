import * as k8s from '@kubernetes/client-node';
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

export class KubernetesProvider implements IOrchestratorProvider {
  readonly type = OrchestratorType.KUBERNETES;
  private appsApi: k8s.AppsV1Api;
  private coreApi: k8s.CoreV1Api;
  private namespace: string;

  constructor() {
    const kc = new k8s.KubeConfig();
    try {
      kc.loadFromCluster();
    } catch {
      kc.loadFromDefault();
    }
    this.appsApi = kc.makeApiClient(k8s.AppsV1Api);
    this.coreApi = kc.makeApiClient(k8s.CoreV1Api);
    this.namespace = config.orchestratorK8sNamespace;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.coreApi.listNamespace();
      return true;
    } catch {
      return false;
    }
  }

  async deployContainer(
    containerConfig: ContainerConfig,
  ): Promise<ContainerInfo> {
    const name = containerConfig.name;
    const labels: Record<string, string> = {
      'app.kubernetes.io/managed-by': 'rdm',
      'app.kubernetes.io/name': name,
      ...containerConfig.labels,
    };

    const envVars: k8s.V1EnvVar[] = Object.entries(containerConfig.env).map(
      ([k, v]) => ({ name: k, value: v }),
    );

    const containerPorts: k8s.V1ContainerPort[] =
      containerConfig.ports.map((p) => ({
        containerPort: p.container,
        protocol: 'TCP',
      }));

    const deployment: k8s.V1Deployment = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name, namespace: this.namespace, labels },
      spec: {
        replicas: 1,
        selector: { matchLabels: { 'app.kubernetes.io/name': name } },
        template: {
          metadata: { labels },
          spec: {
            containers: [
              {
                name,
                image: containerConfig.image,
                env: envVars,
                ports: containerPorts,
              },
            ],
            restartPolicy: 'Always',
          },
        },
      },
    };

    const service: k8s.V1Service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name, namespace: this.namespace, labels },
      spec: {
        selector: { 'app.kubernetes.io/name': name },
        ports: containerConfig.ports.map((p) => ({
          port: p.container,
          targetPort: p.container as unknown as k8s.IntOrString,
          protocol: 'TCP',
        })),
        type: 'ClusterIP',
      },
    };

    try {
      await this.appsApi.createNamespacedDeployment({
        namespace: this.namespace,
        body: deployment,
      });
      await this.coreApi.createNamespacedService({
        namespace: this.namespace,
        body: service,
      });

      return {
        id: name,
        name,
        status: ContainerStatus.RUNNING,
        image: containerConfig.image,
        createdAt: new Date(),
        ports: containerConfig.ports,
        labels,
        health: 'starting',
      };
    } catch (err) {
      throw new AppError(
        `Kubernetes deploy failed: ${(err as Error).message}`,
        500,
      );
    }
  }

  async removeContainer(deploymentName: string): Promise<void> {
    try {
      await this.appsApi.deleteNamespacedDeployment({
        name: deploymentName,
        namespace: this.namespace,
      });
    } catch (err) {
      logger.warn(
        `[orchestrator:k8s] Failed to delete deployment ${deploymentName}: ${(err as Error).message}`,
      );
    }
    try {
      await this.coreApi.deleteNamespacedService({
        name: deploymentName,
        namespace: this.namespace,
      });
    } catch (err) {
      logger.warn(
        `[orchestrator:k8s] Failed to delete service ${deploymentName}: ${(err as Error).message}`,
      );
    }
  }

  async listContainers(
    labelFilter: Record<string, string>,
  ): Promise<ContainerInfo[]> {
    const labelSelector = Object.entries(labelFilter)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');

    try {
      const res = await this.appsApi.listNamespacedDeployment({
        namespace: this.namespace,
        labelSelector,
      });

      return (res.items || []).map((d) => this.deploymentToContainerInfo(d));
    } catch (err) {
      logger.error(
        `[orchestrator:k8s] listContainers failed: ${(err as Error).message}`,
      );
      return [];
    }
  }

  async getContainerStatus(deploymentName: string): Promise<ContainerInfo> {
    try {
      const res = await this.appsApi.readNamespacedDeployment({
        name: deploymentName,
        namespace: this.namespace,
      });
      return this.deploymentToContainerInfo(res);
    } catch (err) {
      throw new AppError(
        `Kubernetes inspect failed: ${(err as Error).message}`,
        500,
      );
    }
  }

  async restartContainer(deploymentName: string): Promise<void> {
    try {
      await this.appsApi.patchNamespacedDeployment({
        name: deploymentName,
        namespace: this.namespace,
        body: {
          spec: {
            template: {
              metadata: {
                annotations: {
                  'kubectl.kubernetes.io/restartedAt':
                    new Date().toISOString(),
                },
              },
            },
          },
        },
      });
    } catch (err) {
      throw new AppError(
        `Kubernetes restart failed: ${(err as Error).message}`,
        500,
      );
    }
  }

  async updateContainerEnv(
    deploymentName: string,
    env: Record<string, string>,
  ): Promise<void> {
    try {
      const current = await this.appsApi.readNamespacedDeployment({
        name: deploymentName,
        namespace: this.namespace,
      });

      const containers = current.spec?.template?.spec?.containers ?? [];
      if (containers.length === 0) {
        throw new AppError('Deployment has no containers', 500);
      }

      // Merge environment variables
      const existingEnv = containers[0].env ?? [];
      const envMap = new Map<string, string>();
      for (const e of existingEnv) {
        if (e.name && e.value != null) envMap.set(e.name, e.value);
      }
      for (const [k, v] of Object.entries(env)) {
        envMap.set(k, v);
      }

      containers[0].env = Array.from(envMap.entries()).map(
        ([name, value]) => ({ name, value }),
      );

      await this.appsApi.replaceNamespacedDeployment({
        name: deploymentName,
        namespace: this.namespace,
        body: current,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        `Kubernetes updateContainerEnv failed: ${(err as Error).message}`,
        500,
      );
    }
  }

  async getContainerLogs(
    deploymentName: string,
    tail = 100,
  ): Promise<string> {
    try {
      const pods = await this.coreApi.listNamespacedPod({
        namespace: this.namespace,
        labelSelector: `app.kubernetes.io/name=${deploymentName}`,
      });

      if (!pods.items || pods.items.length === 0) {
        return '(no pods found)';
      }

      const podName = pods.items[0].metadata?.name ?? '';
      const res = await this.coreApi.readNamespacedPodLog({
        name: podName,
        namespace: this.namespace,
        tailLines: tail,
      });

      return typeof res === 'string' ? res : String(res);
    } catch (err) {
      throw new AppError(
        `Kubernetes logs failed: ${(err as Error).message}`,
        500,
      );
    }
  }

  // ---- Private helpers ----

  private deploymentToContainerInfo(d: k8s.V1Deployment): ContainerInfo {
    const name = d.metadata?.name ?? 'unknown';
    const labels = d.metadata?.labels ?? {};
    const container = d.spec?.template?.spec?.containers?.[0];
    const image = container?.image ?? 'unknown';

    const ports: ContainerPortMapping[] = (container?.ports ?? []).map(
      (p) => ({ container: p.containerPort }),
    );

    const readyReplicas = d.status?.readyReplicas ?? 0;
    const replicas = d.status?.replicas ?? 0;

    let status: ContainerStatus;
    if (readyReplicas > 0) status = ContainerStatus.RUNNING;
    else if (replicas > 0) status = ContainerStatus.RESTARTING;
    else status = ContainerStatus.STOPPED;

    return {
      id: name,
      name,
      status,
      image,
      createdAt: d.metadata?.creationTimestamp
        ? new Date(d.metadata.creationTimestamp as unknown as string)
        : new Date(),
      ports,
      labels,
      health: readyReplicas > 0 ? 'healthy' : 'starting',
    };
  }
}
