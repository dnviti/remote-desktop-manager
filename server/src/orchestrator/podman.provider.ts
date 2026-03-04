import Dockerode from 'dockerode';
import { config } from '../config';
import { OrchestratorType } from './types';
import { DockerProvider } from './docker.provider';

/**
 * Podman provider — thin wrapper around DockerProvider.
 *
 * Podman exposes a Docker-compatible API, so all Dockerode operations
 * work unchanged. The only differences are:
 *   1. The socket path (Podman uses a different default socket)
 *   2. The reported orchestratorType (PODMAN instead of DOCKER)
 */
export class PodmanProvider extends DockerProvider {
  override readonly type: OrchestratorType = OrchestratorType.PODMAN;

  constructor() {
    super();
    this.docker = new Dockerode({
      socketPath: config.podmanSocketPath,
    });
  }
}
