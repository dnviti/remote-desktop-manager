import type {
  GatewayEgressPolicy,
  GatewayEgressPolicyRule,
  GatewayEgressAction,
  GatewayEgressProtocol,
} from '../../api/gateway.api';
import { isValidNetworkEntry } from '../Settings/networkAccessUtils';

export const GATEWAY_EGRESS_PROTOCOL_OPTIONS: Array<{
  value: GatewayEgressProtocol;
  label: string;
}> = [
  { value: 'SSH', label: 'SSH' },
  { value: 'RDP', label: 'RDP' },
  { value: 'VNC', label: 'VNC' },
  { value: 'DATABASE', label: 'Database' },
];

export interface EgressDraftRule {
  id: string;
  description: string;
  enabled: boolean;
  action: GatewayEgressAction;
  protocols: GatewayEgressProtocol[];
  hosts: string[];
  cidrs: string[];
  ports: string[];
  userIds: string[];
  teamIds: string[];
}

export interface EgressRuleErrors {
  protocols?: string;
  targets?: string;
  ports?: string;
}

export type EgressValidationErrors = Record<string, EgressRuleErrors>;

export function createEmptyEgressDraftRule(id: string): EgressDraftRule {
  return {
    id,
    description: '',
    enabled: true,
    action: 'ALLOW',
    protocols: [],
    hosts: [],
    cidrs: [],
    ports: [],
    userIds: [],
    teamIds: [],
  };
}

export function policyToDraftRules(
  policy: GatewayEgressPolicy | undefined,
  nextId: () => string,
): EgressDraftRule[] {
  return (policy?.rules ?? []).map((rule) => ({
    id: nextId(),
    description: rule.description ?? '',
    enabled: rule.enabled ?? true,
    action: rule.action ?? 'ALLOW',
    protocols: rule.protocols ?? [],
    hosts: rule.hosts ?? [],
    cidrs: rule.cidrs ?? [],
    ports: (rule.ports ?? []).map(String),
    userIds: rule.userIds ?? [],
    teamIds: rule.teamIds ?? [],
  }));
}

export function draftRulesToPolicy(rules: EgressDraftRule[]): GatewayEgressPolicy {
  return {
    rules: rules.map((rule) => {
      const policyRule: GatewayEgressPolicyRule = {
        enabled: rule.enabled,
        action: rule.action,
        protocols: uniqueSorted(rule.protocols),
        ports: uniqueSortedNumbers(rule.ports.map((port) => Number.parseInt(port, 10))),
      };

      const description = rule.description.trim();
      const hosts = uniqueSorted(rule.hosts.map(normalizeHostEntry));
      const cidrs = uniqueSorted(rule.cidrs.map(normalizeCidrOrIpEntry).filter(Boolean));

      if (description) {
        policyRule.description = description;
      }
      if (hosts.length > 0) {
        policyRule.hosts = hosts;
      }
      if (cidrs.length > 0) {
        policyRule.cidrs = cidrs;
      }
      if (rule.userIds.length > 0) {
        policyRule.userIds = uniqueSorted(rule.userIds);
      }
      if (rule.teamIds.length > 0) {
        policyRule.teamIds = uniqueSorted(rule.teamIds);
      }

      return policyRule;
    }),
  };
}

export function validateEgressDraftRules(rules: EgressDraftRule[]): EgressValidationErrors {
  return rules.reduce<EgressValidationErrors>((result, rule) => {
    const errors: EgressRuleErrors = {};
    if (!rule.enabled) {
      return result;
    }
    if (rule.protocols.length === 0) {
      errors.protocols = 'Select at least one protocol.';
    }
    if (rule.hosts.length === 0 && rule.cidrs.length === 0) {
      errors.targets = 'Add at least one host, wildcard host, subnet, or IP.';
    }
    if (rule.ports.length === 0) {
      errors.ports = 'Add at least one destination port.';
    }

    if (Object.keys(errors).length > 0) {
      result[rule.id] = errors;
    }
    return result;
  }, {});
}

export function splitEntryInput(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeHostEntry(value: string): string {
  return value.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

export function validateHostEntry(value: string): string | null {
  const host = normalizeHostEntry(value);
  if (!host) {
    return 'Host is required.';
  }
  if (host === '*') {
    return 'Bare wildcard is not allowed; use a leading wildcard such as *.example.com.';
  }
  if (host.includes('://') || host.includes('/')) {
    return 'Enter only a hostname or IP address. Ports and URL schemes are configured separately.';
  }
  if (/\s/.test(host)) {
    return 'Host entries cannot contain whitespace.';
  }
  if (host.includes('*')) {
    const wildcardCount = [...host].filter((char) => char === '*').length;
    if (!host.startsWith('*.') || wildcardCount !== 1 || host.length <= 2) {
      return 'Only leading wildcard hosts such as *.example.com are allowed.';
    }
    const suffix = host.slice(2);
    if (isValidNetworkEntry(suffix)) {
      return 'Wildcard IP patterns are not allowed.';
    }
  }
  return null;
}

export function normalizeCidrOrIpEntry(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('/')) {
    return trimmed;
  }
  return trimmed.includes(':') ? `${trimmed}/128` : `${trimmed}/32`;
}

export function validateCidrOrIpEntry(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'CIDR or IP is required.';
  }
  if (!isValidNetworkEntry(trimmed)) {
    return 'Use a valid IPv4 or IPv6 address, with an optional CIDR prefix.';
  }
  return null;
}

export function normalizePortEntry(value: string): string {
  return String(Number.parseInt(value.trim(), 10));
}

export function validatePortEntry(value: string): string | null {
  if (!/^\d+$/.test(value.trim())) {
    return 'Ports must be whole numbers.';
  }
  const port = Number.parseInt(value, 10);
  if (port < 1 || port > 65535) {
    return 'Ports must be between 1 and 65535.';
  }
  return null;
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean) as T[])].sort();
}

function uniqueSortedNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value)))].sort((a, b) => a - b);
}
