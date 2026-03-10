 
import { Command } from 'commander';
import { config } from '../../config';
import * as appConfigService from '../../services/appConfig.service';
import { printJson } from '../helpers/output';

// Keys that should be redacted in output
const REDACT_PATTERNS = [
  /secret/i, /password/i, /token/i, /key/i, /apikey/i,
];

function redactValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string' || !value) return value;
  if (REDACT_PATTERNS.some((p) => p.test(key))) {
    return value.length > 4 ? `${value.slice(0, 4)}****` : '****';
  }
  return value;
}

export function registerConfigCommands(program: Command): void {
  const cfg = program
    .command('config')
    .description('Application configuration commands');

  cfg
    .command('show')
    .description('Show application configuration (database-stored)')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (opts: { format: string }) => {
      const publicConfig = await appConfigService.getPublicConfig();

      if (opts.format === 'json') {
        printJson(publicConfig);
      } else {
        console.log(`Self-signup enabled:    ${publicConfig.selfSignupEnabled}`);
        console.log(`Self-signup env-locked: ${publicConfig.selfSignupEnvLocked}`);
      }
    });

  cfg
    .command('env')
    .description('Show environment configuration (redacts secrets)')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action((opts: { format: string }) => {
      // Build a flat object of non-sensitive config values
      const envSnapshot: Record<string, unknown> = {
        port: config.port,
        guacamoleWsPort: config.guacamoleWsPort,
        nodeEnv: config.nodeEnv,
        jwtExpiresIn: config.jwtExpiresIn,
        jwtRefreshExpiresIn: config.jwtRefreshExpiresIn,
        guacdHost: config.guacdHost,
        guacdPort: config.guacdPort,
        vaultTtlMinutes: config.vaultTtlMinutes,
        logLevel: config.logLevel,
        logFormat: config.logFormat,
        logTimestamps: config.logTimestamps,
        logHttpRequests: config.logHttpRequests,
        driveBasePath: config.driveBasePath,
        fileUploadMaxSize: config.fileUploadMaxSize,
        userDriveQuota: config.userDriveQuota,
        emailProvider: config.emailProvider,
        emailVerifyRequired: config.emailVerifyRequired,
        smsProvider: config.smsProvider || '(disabled)',
        selfSignupEnabled: config.selfSignupEnabled,
        clientUrl: config.clientUrl,
        orchestratorType: config.orchestratorType || '(auto-detect)',
        dockerNetwork: config.dockerNetwork,
        keyRotationCron: config.keyRotationCron,
        sessionIdleThresholdMinutes: config.sessionIdleThresholdMinutes,
        sessionCleanupRetentionDays: config.sessionCleanupRetentionDays,
        sessionInactivityTimeoutSeconds: config.sessionInactivityTimeoutSeconds,
        oauthGoogle: config.oauth.google.enabled,
        oauthMicrosoft: config.oauth.microsoft.enabled,
        oauthGithub: config.oauth.github.enabled,
        oauthOidc: config.oauth.oidc.enabled,
        saml: config.oauth.saml.enabled,
        webauthnRpId: config.webauthn.rpId,
      };

      // Redact any sensitive-looking values that slipped through
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(envSnapshot)) {
        safe[k] = redactValue(k, v);
      }

      if (opts.format === 'json') {
        printJson(safe);
      } else {
        const maxKeyLen = Math.max(...Object.keys(safe).map((k) => k.length));
        for (const [k, v] of Object.entries(safe)) {
          console.log(`${k.padEnd(maxKeyLen)}  ${v}`);
        }
      }
    });
}
