import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Save } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { GatewayEgressPolicy } from '../../api/gateway.api';
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Egress Allow Rules</p>
          <p className="text-xs text-muted-foreground">
            Limit tunneled traffic to approved protocols, destinations, and ports.
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
              No allow rules are configured, so tunneled traffic through this gateway is blocked.
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
      />

      <GatewayEgressPolicyRuleDialog
        open={Boolean(editingRule)}
        rule={editingRule}
        ruleNumber={editingRuleIndex + 1}
        errors={editingRule ? validationErrors[editingRule.id] : undefined}
        onOpenChange={(open) => {
          if (!open) setEditingRuleId(null);
        }}
        onChange={updateRule}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRule}>
          <Plus data-icon="inline-start" />
          Add Allow Rule
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
