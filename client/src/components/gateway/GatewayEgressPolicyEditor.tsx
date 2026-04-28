import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Play, Plus, Save } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { GatewayEgressPolicy, GatewayEgressProtocol, GatewayEgressPolicyTestResult } from '../../api/gateway.api';
import { testGatewayEgressPolicy } from '../../api/gateway.api';
import { listTeams, type TeamData } from '../../api/team.api';
import { useNotificationStore } from '../../store/notificationStore';
import { useGatewayStore } from '../../store/gatewayStore';
import { extractApiError } from '../../utils/apiError';
import {
  createEmptyEgressDraftRule,
  draftRulesToPolicy,
  type EgressDraftRule,
  policyToDraftRules,
  validateEgressDraftRules,
} from './gatewayEgressPolicyUtils';
import GatewayEgressPolicyRuleDialog from './GatewayEgressPolicyRuleDialog';
import GatewayEgressPolicyTable from './GatewayEgressPolicyTable';

interface GatewayEgressPolicyEditorProps {
  gatewayId: string;
  policy?: GatewayEgressPolicy;
}

export default function GatewayEgressPolicyEditor({
  gatewayId,
  policy,
}: GatewayEgressPolicyEditorProps) {
  const idCounterRef = useRef(0);
  const [rules, setRules] = useState<EgressDraftRule[]>([]);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [testProtocol, setTestProtocol] = useState<GatewayEgressProtocol>('SSH');
  const [testHost, setTestHost] = useState('');
  const [testPort, setTestPort] = useState('');
  const [testUserId, setTestUserId] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<GatewayEgressPolicyTestResult | null>(null);
  const notify = useNotificationStore((state) => state.notify);
  const updateGatewayEgressPolicy = useGatewayStore((state) => state.updateGatewayEgressPolicy);

  const nextRuleId = useCallback(() => {
    idCounterRef.current += 1;
    return `egress-rule-${idCounterRef.current}`;
  }, []);

  useEffect(() => {
    idCounterRef.current = 0;
    const nextRules = policyToDraftRules(policy, nextRuleId);
    setRules(nextRules);
    setEditingRuleId(null);
    setError('');
  }, [gatewayId, policy, nextRuleId]);

  useEffect(() => {
    listTeams('tenant').then(setTeams).catch(() => setTeams([]));
  }, []);

  const validationErrors = useMemo(() => validateEgressDraftRules(rules), [rules]);
  const hasValidationErrors = Object.keys(validationErrors).length > 0;
  const editingRule = useMemo(
    () => rules.find((rule) => rule.id === editingRuleId) ?? null,
    [rules, editingRuleId],
  );
  const editingRuleIndex = editingRule
    ? rules.findIndex((rule) => rule.id === editingRule.id)
    : -1;

  const updateRule = (ruleId: string, patch: Partial<EgressDraftRule>) => {
    setRules((currentRules) =>
      currentRules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    );
  };

  const addRule = () => {
    const newRule = createEmptyEgressDraftRule(nextRuleId());
    setRules((currentRules) => [...currentRules, newRule]);
    setEditingRuleId(newRule.id);
  };

  const removeRule = (ruleId: string) => {
    const nextRules = rules.filter((rule) => rule.id !== ruleId);
    setRules(nextRules);

    if (editingRuleId === ruleId) {
      setEditingRuleId(null);
    }
  };

  const moveRule = (ruleId: string, direction: -1 | 1) => {
    setRules((currentRules) => {
      const index = currentRules.findIndex((rule) => rule.id === ruleId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= currentRules.length) return currentRules;
      const nextRules = [...currentRules];
      const [rule] = nextRules.splice(index, 1);
      if (!rule) return currentRules;
      nextRules.splice(target, 0, rule);
      return nextRules;
    });
  };

  const handleSave = async () => {
    setError('');
    if (hasValidationErrors) {
      setError('Resolve egress policy validation errors before saving.');
      return;
    }

    const payload = draftRulesToPolicy(rules);
    setSaving(true);
    try {
      await updateGatewayEgressPolicy(gatewayId, payload);
      const savedRules = policyToDraftRules(payload, nextRuleId);
      setRules(savedRules);
      setEditingRuleId(null);
      notify('Gateway egress policy saved.', 'success');
    } catch (requestError: unknown) {
      setError(extractApiError(requestError, 'Failed to save gateway egress policy'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setError('');
    setTestResult(null);
    const port = Number.parseInt(testPort, 10);
    if (!testHost.trim() || !testUserId.trim() || !Number.isInteger(port)) {
      setError('Enter protocol, host, port, and user ID before testing egress policy.');
      return;
    }
    setTesting(true);
    try {
      const result = await testGatewayEgressPolicy(gatewayId, {
        protocol: testProtocol,
        host: testHost.trim(),
        port,
        userId: testUserId.trim(),
        policy: draftRulesToPolicy(rules),
      });
      setTestResult(result);
    } catch (requestError: unknown) {
      setError(extractApiError(requestError, 'Failed to test gateway egress policy'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Egress Firewall Rules</p>
          <p className="text-xs text-muted-foreground">
            Ordered allow and disallow rules are evaluated top to bottom. First match wins.
          </p>
        </div>
        <Badge variant={rules.length > 0 ? 'outline' : 'secondary'}>
          {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
        </Badge>
      </div>

      {rules.length === 0 && (
        <Alert variant="warning">
          <AlertTriangle className="absolute left-4 top-3.5 size-4" />
          <div className="pl-6">
            <AlertTitle>Default deny</AlertTitle>
            <AlertDescription>
              No firewall rules are configured, so tunneled traffic through this gateway is blocked.
            </AlertDescription>
          </div>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <GatewayEgressPolicyTable
        rules={rules}
        editingRuleId={editingRule?.id ?? null}
        validationErrors={validationErrors}
        onEditRule={setEditingRuleId}
        onRemoveRule={removeRule}
        onMoveRule={moveRule}
      />

      <GatewayEgressPolicyRuleDialog
        open={Boolean(editingRule)}
        rule={editingRule}
        ruleNumber={editingRuleIndex + 1}
        errors={editingRule ? validationErrors[editingRule.id] : undefined}
        teams={teams}
        onOpenChange={(open) => {
          if (!open) setEditingRuleId(null);
        }}
        onChange={updateRule}
      />

      <div className="rounded-md border p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">Test policy decision</p>
            <p className="text-xs text-muted-foreground">Tests the current draft rules before saving.</p>
          </div>
          {testResult && (
            <Badge variant={testResult.allowed ? 'outline' : 'destructive'}>
              {testResult.allowed ? 'Allowed' : 'Denied'}
            </Badge>
          )}
        </div>
        <div className="grid gap-2 md:grid-cols-[140px_1fr_120px_1fr_auto]">
          <Select value={testProtocol} onValueChange={(value) => setTestProtocol(value as GatewayEgressProtocol)}>
            <SelectTrigger aria-label="Test protocol">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {['SSH', 'RDP', 'VNC', 'DATABASE'].map((protocol) => (
                  <SelectItem key={protocol} value={protocol}>{protocol}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Input value={testHost} placeholder="Host" aria-label="Test host" onChange={(event) => setTestHost(event.target.value)} />
          <Input value={testPort} placeholder="Port" aria-label="Test port" onChange={(event) => setTestPort(event.target.value)} />
          <Input value={testUserId} placeholder="User ID" aria-label="Test user ID" onChange={(event) => setTestUserId(event.target.value)} />
          <Button type="button" variant="outline" size="sm" disabled={testing} onClick={handleTest}>
            {testing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Play data-icon="inline-start" />}
            Test
          </Button>
        </div>
        {testResult && (
          <p className="mt-2 text-xs text-muted-foreground">
            {testResult.ruleIndex
              ? `Matched rule #${testResult.ruleIndex} (${testResult.ruleAction?.toLowerCase() ?? 'rule'}${testResult.rule ? `: ${testResult.rule}` : ''}).`
              : testResult.reason}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRule}>
          <Plus data-icon="inline-start" />
          Add Rule
        </Button>
        <Button type="button" size="sm" disabled={saving || hasValidationErrors} onClick={handleSave}>
          {saving ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Save data-icon="inline-start" />
          )}
          {saving ? 'Saving...' : 'Save Egress Policy'}
        </Button>
      </div>
    </div>
  );
}
