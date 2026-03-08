import { config } from '../config';
import { logger } from '../utils/logger';
import { IOrchestratorProvider } from './types';
import { DockerProvider } from './docker.provider';
import { KubernetesProvider } from './kubernetes.provider';
import { PodmanProvider } from './podman.provider';
import { NoneProvider } from './none.provider';

export {
  IOrchestratorProvider,
  OrchestratorType,
  ContainerConfig,
  ContainerInfo,
  ContainerStatus,
} from './types';

let instance: IOrchestratorProvider | null = null;

/**
 * Detect and initialize the orchestrator provider.
 * Call once during server startup.
 *
 * Priority:
 * 1. If ORCHESTRATOR_TYPE env is set, use it directly
 * 2. Auto-detect: K8s first, then Docker, then NoneProvider
 */
export async function detectOrchestrator(): Promise<IOrchestratorProvider> {
  const override = config.orchestratorType;

  if (override === 'kubernetes') {
    instance = new KubernetesProvider();
    logger.info(
      '[orchestrator] Using Kubernetes provider (configured via ORCHESTRATOR_TYPE)',
    );
  } else if (override === 'docker') {
    instance = new DockerProvider();
    logger.info(
      '[orchestrator] Using Docker provider (configured via ORCHESTRATOR_TYPE)',
    );
  } else if (override === 'podman') {
    instance = new PodmanProvider();
    logger.info(
      '[orchestrator] Using Podman provider (configured via ORCHESTRATOR_TYPE)',
    );
  } else if (override === 'none') {
    instance = new NoneProvider();
    logger.info(
      '[orchestrator] Using NoneProvider (configured via ORCHESTRATOR_TYPE)',
    );
  } else {
    // Auto-detect: K8s has priority because a Docker socket inside
    // a K8s pod means both are available, but K8s-native is preferred
    const k8sProvider = new KubernetesProvider();
    if (await k8sProvider.isAvailable()) {
      instance = k8sProvider;
      logger.info('[orchestrator] Auto-detected Kubernetes provider');
    } else {
      const dockerProvider = new DockerProvider();
      if (await dockerProvider.isAvailable()) {
        instance = dockerProvider;
        logger.info('[orchestrator] Auto-detected Docker provider');
      } else {
        const podmanProvider = new PodmanProvider();
        if (await podmanProvider.isAvailable()) {
          instance = podmanProvider;
          logger.info('[orchestrator] Auto-detected Podman provider');
        } else {
          instance = new NoneProvider();
          logger.info(
            '[orchestrator] No orchestrator detected — using NoneProvider (manual gateway management only)',
          );
        }
      }
    }
  }

  // Verify availability for explicit providers
  if (override && override !== 'none') {
    const available = await instance.isAvailable();
    if (!available) {
      logger.warn(
        `[orchestrator] Provider '${override}' was configured but is not available. Falling back to NoneProvider.`,
      );
      instance = new NoneProvider();
    }
  }

  return instance;
}

/**
 * Synchronous getter for the initialized orchestrator.
 * Must be called after detectOrchestrator() has completed.
 */
export function getOrchestrator(): IOrchestratorProvider {
  if (!instance) {
    throw new Error(
      'Orchestrator not initialized. Call detectOrchestrator() during server startup first.',
    );
  }
  return instance;
}
