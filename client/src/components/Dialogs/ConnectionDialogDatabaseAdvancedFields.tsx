import type { Dispatch, SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { DbSettings, OracleConnectionType, OracleRole } from '../../api/connections.api';

interface ConnectionDialogDatabaseAdvancedFieldsProps {
  dbSettings: Partial<DbSettings>;
  onChange: Dispatch<SetStateAction<Partial<DbSettings>>>;
  setOptionalString: <K extends keyof DbSettings>(key: K, value: string) => void;
}

export default function ConnectionDialogDatabaseAdvancedFields({
  dbSettings,
  onChange,
  setOptionalString,
}: ConnectionDialogDatabaseAdvancedFieldsProps) {
  if (dbSettings.protocol === 'oracle') {
    return (
      <>
        <ToggleGroup
          type="single"
          value={dbSettings.oracleConnectionType ?? 'basic'}
          onValueChange={(value) => {
            if (!value) return;
            onChange((prev) => ({
              ...prev,
              protocol: 'oracle',
              oracleConnectionType: value as OracleConnectionType,
            }));
          }}
          className="w-full"
        >
          <ToggleGroupItem value="basic" className="flex-1">Basic</ToggleGroupItem>
          <ToggleGroupItem value="tns" className="flex-1">TNS</ToggleGroupItem>
          <ToggleGroupItem value="custom" className="flex-1">Custom</ToggleGroupItem>
        </ToggleGroup>

        {(dbSettings.oracleConnectionType ?? 'basic') === 'basic' && (
          <div className="flex gap-3">
            <div className="w-[160px] space-y-2">
              <Label>Identifier Type</Label>
              <Select
                value={dbSettings.oracleSid ? 'sid' : 'service'}
                onValueChange={(value) => {
                  if (value === 'sid') {
                    onChange((prev) => ({
                      ...prev,
                      oracleSid: prev.oracleServiceName || prev.oracleSid || '',
                      oracleServiceName: undefined,
                    }));
                    return;
                  }
                  onChange((prev) => ({
                    ...prev,
                    oracleServiceName: prev.oracleSid || prev.oracleServiceName || '',
                    oracleSid: undefined,
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="service">Service Name</SelectItem>
                  <SelectItem value="sid">SID</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-2">
              <Label>{dbSettings.oracleSid !== undefined ? 'SID' : 'Service Name'}</Label>
              <Input
                value={dbSettings.oracleSid ?? dbSettings.oracleServiceName ?? ''}
                onChange={(event) => {
                  const value = event.target.value || undefined;
                  onChange((prev) => (
                    prev.oracleSid !== undefined
                      ? { ...prev, oracleSid: value }
                      : { ...prev, oracleServiceName: value }
                  ));
                }}
                placeholder={dbSettings.oracleSid !== undefined ? 'e.g. ORCL' : 'e.g. FREEPDB1'}
              />
            </div>
          </div>
        )}

        {dbSettings.oracleConnectionType === 'tns' && (
          <>
            <div className="space-y-2">
              <Label>TNS Alias</Label>
              <Input
                value={dbSettings.oracleTnsAlias ?? ''}
                onChange={(event) => setOptionalString('oracleTnsAlias', event.target.value)}
                placeholder="e.g. MYDB"
              />
              <p className="text-xs text-muted-foreground">Alias from tnsnames.ora (resolved via TNS_ADMIN)</p>
            </div>
            <div className="space-y-2">
              <Label>TNS Descriptor</Label>
              <Textarea
                value={dbSettings.oracleTnsDescriptor ?? ''}
                onChange={(event) => setOptionalString('oracleTnsDescriptor', event.target.value)}
                rows={3}
                placeholder="(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=...)(PORT=...))(CONNECT_DATA=(SERVICE_NAME=...)))"
              />
              <p className="text-xs text-muted-foreground">Full TNS descriptor (overrides alias if both provided)</p>
            </div>
          </>
        )}

        {dbSettings.oracleConnectionType === 'custom' && (
          <div className="space-y-2">
            <Label>Connect String</Label>
            <Textarea
              value={dbSettings.oracleConnectString ?? ''}
              onChange={(event) => setOptionalString('oracleConnectString', event.target.value)}
              rows={3}
              placeholder="host:port/service_name or full TNS descriptor"
            />
            <p className="text-xs text-muted-foreground">Raw connect string passed directly to the Oracle driver</p>
          </div>
        )}

        <div className="space-y-2">
          <Label>Role</Label>
          <Select
            value={dbSettings.oracleRole ?? 'normal'}
            onValueChange={(value) => onChange((prev) => ({
              ...prev,
              oracleRole: (value === 'normal' ? undefined : value) as OracleRole | undefined,
            }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="sysdba">SYSDBA</SelectItem>
              <SelectItem value="sysoper">SYSOPER</SelectItem>
              <SelectItem value="sysasm">SYSASM</SelectItem>
              <SelectItem value="sysbackup">SYSBACKUP</SelectItem>
              <SelectItem value="sysdg">SYSDG</SelectItem>
              <SelectItem value="syskm">SYSKM</SelectItem>
              <SelectItem value="sysrac">SYSRAC</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </>
    );
  }

  if (dbSettings.protocol === 'mssql') {
    return (
      <>
        <div className="space-y-2">
          <Label>Instance Name (optional)</Label>
          <Input
            value={dbSettings.mssqlInstanceName ?? ''}
            onChange={(event) => setOptionalString('mssqlInstanceName', event.target.value)}
            placeholder="e.g. SQLEXPRESS"
          />
        </div>
        <div className="space-y-2">
          <Label>Authentication Mode</Label>
          <Select
            value={dbSettings.mssqlAuthMode ?? 'sql'}
            onValueChange={(value) => onChange((prev) => ({
              ...prev,
              mssqlAuthMode: value as 'sql' | 'windows',
            }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sql">SQL Server Authentication</SelectItem>
              <SelectItem value="windows">Windows Authentication (NTLM/Kerberos)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </>
    );
  }

  if (dbSettings.protocol === 'db2') {
    return (
      <div className="space-y-2">
        <Label>Database Alias (optional)</Label>
        <Input
          value={dbSettings.db2DatabaseAlias ?? ''}
          onChange={(event) => setOptionalString('db2DatabaseAlias', event.target.value)}
          placeholder="e.g. SAMPLE"
        />
        <p className="text-xs text-muted-foreground">Alias as cataloged on the DB2 Connect gateway</p>
      </div>
    );
  }

  return null;
}
