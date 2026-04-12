import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DbProtocol, DbSettings } from '../../api/connections.api';
import { getAiConfig, type AiConfig } from '../../api/aiQuery.api';
import {
  cloudProviderHint,
  nextSSLModeForCloudProvider,
  normalizeCloudProviderSelection,
  remapSSLModeOnProtocolChange,
  supportsCloudProviderPresets,
  tlsModeOptions,
} from '../../utils/dbConnectionSecurity';
import ConnectionDialogDatabaseAdvancedFields from './ConnectionDialogDatabaseAdvancedFields';
import ConnectionDialogDatabaseAISection from './ConnectionDialogDatabaseAISection';
import ConnectionDialogDatabasePolicyOverrides from './ConnectionDialogDatabasePolicyOverrides';

interface ConnectionDialogDatabaseSectionProps {
  dbSettings: Partial<DbSettings>;
  onChange: Dispatch<SetStateAction<Partial<DbSettings>>>;
  onPortChange: (port: string) => void;
}

const protocolPorts: Record<DbProtocol, string> = {
  postgresql: '5432',
  mysql: '3306',
  mongodb: '27017',
  oracle: '1521',
  mssql: '1433',
  db2: '50000',
};

function supportsPersistedExecutionPlans(protocol?: DbProtocol): boolean {
  return protocol === 'postgresql' || protocol === 'mysql' || protocol === 'oracle' || protocol === 'mssql';
}

export default function ConnectionDialogDatabaseSection({
  dbSettings,
  onChange,
  onPortChange,
}: ConnectionDialogDatabaseSectionProps) {
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAiConfig()
      .then((config) => {
        if (!cancelled) {
          setAiConfig(config);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAiConfig(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dbTLSOptions = useMemo(() => tlsModeOptions(dbSettings.protocol), [dbSettings.protocol]);
  const currentDbTLSOption = dbTLSOptions.find((option) => option.value === (dbSettings.sslMode || '__default__'))
    ?? dbTLSOptions[0];
  const dbCloudHint = cloudProviderHint(dbSettings.protocol, dbSettings.cloudProvider);

  const updateDbSettings = (updater: (prev: Partial<DbSettings>) => Partial<DbSettings>) => {
    onChange((prev) => updater(prev));
  };

  const setOptionalString = <K extends keyof DbSettings>(key: K, value: string) => {
    updateDbSettings((prev) => ({
      ...prev,
      [key]: value.trim() === '' ? undefined : value,
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <Label>Database Protocol</Label>
        <Select
          value={dbSettings.protocol ?? 'postgresql'}
          onValueChange={(value) => {
            const protocol = value as DbProtocol;
            updateDbSettings((prev) => ({
              ...prev,
              protocol,
              cloudProvider: supportsCloudProviderPresets(protocol) ? prev.cloudProvider : undefined,
              sslMode: remapSSLModeOnProtocolChange(
                prev.protocol,
                protocol,
                prev.sslMode,
                supportsCloudProviderPresets(protocol) ? prev.cloudProvider : undefined,
              ),
              persistExecutionPlan: supportsPersistedExecutionPlans(protocol)
                ? prev.persistExecutionPlan
                : undefined,
              ...(protocol === 'oracle'
                ? { oracleConnectionType: prev.oracleConnectionType ?? 'basic' }
                : {}),
            }));
            onPortChange(protocolPorts[protocol]);
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="postgresql">PostgreSQL</SelectItem>
            <SelectItem value="mysql">MySQL / MariaDB</SelectItem>
            <SelectItem value="mongodb">MongoDB</SelectItem>
            <SelectItem value="oracle">Oracle (TNS)</SelectItem>
            <SelectItem value="mssql">Microsoft SQL Server (TDS)</SelectItem>
            <SelectItem value="db2">IBM DB2 (DRDA)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="db-name">Database Name (optional)</Label>
        <Input
          id="db-name"
          value={dbSettings.databaseName ?? ''}
          onChange={(event) => setOptionalString('databaseName', event.target.value)}
          placeholder="e.g. mydb"
        />
      </div>

      {supportsCloudProviderPresets(dbSettings.protocol) && (
        <>
          <div className="space-y-2">
            <Label>Cloud Provider Preset</Label>
            <Select
              value={dbSettings.cloudProvider ?? 'generic'}
              onValueChange={(value) => {
                const nextProvider = normalizeCloudProviderSelection(value);
                updateDbSettings((prev) => ({
                  ...prev,
                  cloudProvider: nextProvider,
                  sslMode: nextSSLModeForCloudProvider(
                    prev.protocol,
                    prev.sslMode,
                    prev.cloudProvider,
                    nextProvider,
                  ),
                }));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="generic">Generic / self-hosted</SelectItem>
                <SelectItem value="azure">Azure Database</SelectItem>
                <SelectItem value="aws">AWS RDS / Aurora</SelectItem>
                <SelectItem value="gcp">GCP Cloud SQL</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>TLS Mode</Label>
            <Select
              value={dbSettings.sslMode || '__default__'}
              onValueChange={(value) => updateDbSettings((prev) => ({
                ...prev,
                sslMode: value === '__default__' ? undefined : value,
              }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dbTLSOptions.map((option) => (
                  <SelectItem key={option.value || 'default'} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">{currentDbTLSOption.helperText}</p>
          {dbCloudHint && (
            <div className="rounded-md border border-blue-600/50 bg-blue-600/10 px-4 py-3 text-sm text-blue-400">
              {dbCloudHint}
            </div>
          )}
          {dbSettings.sslMode === 'skip-verify' && (
            <div className="rounded-md border border-yellow-600/50 bg-yellow-600/10 px-4 py-3 text-sm text-yellow-500">
              Skip verification accepts any server certificate. Use it only when you control the network and cannot trust the certificate chain yet.
            </div>
          )}
        </>
      )}

      {supportsPersistedExecutionPlans(dbSettings.protocol ?? 'postgresql') && (
        <div>
          <div className="flex items-center gap-3">
            <Switch
              id="persist-plan"
              checked={Boolean(dbSettings.persistExecutionPlan)}
              onCheckedChange={(checked) => updateDbSettings((prev) => ({
                ...prev,
                persistExecutionPlan: checked || undefined,
              }))}
            />
            <Label htmlFor="persist-plan" className="font-normal">Persist execution plans in audit logs</Label>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Store the DB proxy execution plan with each audited query so it remains visible after the session closes.
          </p>
        </div>
      )}

      <ConnectionDialogDatabasePolicyOverrides dbSettings={dbSettings} onChange={onChange} />
      <ConnectionDialogDatabaseAISection
        aiConfig={aiConfig}
        dbSettings={dbSettings}
        onChange={onChange}
        setOptionalString={setOptionalString}
      />
      <ConnectionDialogDatabaseAdvancedFields
        dbSettings={dbSettings}
        onChange={onChange}
        setOptionalString={setOptionalString}
      />
    </div>
  );
}
