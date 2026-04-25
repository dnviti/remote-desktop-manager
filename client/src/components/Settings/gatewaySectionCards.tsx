import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  KeyRound,
  Loader2,
  ShieldEllipsis,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Textarea } from '@/components/ui/textarea';
import {
  SettingsButtonRow,
  SettingsPanel,
  SettingsStatusBadge,
  SettingsSummaryGrid,
  SettingsSummaryItem,
} from './settings-ui';
import type { SshKeyPairData } from '../../api/gateway.api';

export function GatewaySshKeyPanel({
  copied,
  keyActionLoading,
  onCopyPublicKey,
  onDownloadPrivateKey,
  onDownloadPublicKey,
  onGenerateKeyPair,
  onRotateKeyPair,
  sshKeyLoading,
  sshKeyPair,
}: {
  copied: boolean;
  keyActionLoading: boolean;
  onCopyPublicKey: () => void;
  onDownloadPrivateKey: () => void;
  onDownloadPublicKey: () => void;
  onGenerateKeyPair: () => void;
  onRotateKeyPair: () => void;
  sshKeyLoading: boolean;
  sshKeyPair: SshKeyPairData | null;
}) {
  return (
    <SettingsPanel
      title="SSH Key Pair"
      description="Manage the tenant-wide key pair used by managed SSH gateways."
      heading={(
        <SettingsStatusBadge tone={sshKeyPair ? 'success' : 'warning'}>
          {sshKeyPair ? 'Ready' : 'Missing'}
        </SettingsStatusBadge>
      )}
      contentClassName="space-y-4"
    >
      {sshKeyLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading the current SSH key pair.
        </div>
      ) : !sshKeyPair ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <KeyRound className="size-10 text-muted-foreground" />
            <div className="space-y-1">
              <div className="text-base font-medium text-foreground">No SSH key pair generated</div>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                Generate a tenant key pair before onboarding Managed SSH gateways so the control
                plane can authenticate cleanly.
              </p>
            </div>
            <Button type="button" onClick={onGenerateKeyPair} disabled={keyActionLoading}>
              {keyActionLoading ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              {keyActionLoading ? 'Generating...' : 'Generate Key Pair'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <SettingsSummaryGrid className="xl:grid-cols-3">
            <SettingsSummaryItem label="Algorithm" value={sshKeyPair.algorithm.toUpperCase()} />
            <SettingsSummaryItem label="Fingerprint" value={sshKeyPair.fingerprint} />
            <SettingsSummaryItem
              label="Created"
              value={new Date(sshKeyPair.createdAt).toLocaleDateString()}
            />
          </SettingsSummaryGrid>

          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">Public Key</div>
            <Textarea
              value={sshKeyPair.publicKey}
              readOnly
              className="min-h-28 font-mono text-xs leading-6"
            />
          </div>

          <SettingsButtonRow>
            <Button type="button" variant="outline" size="sm" onClick={onCopyPublicKey}>
              <Copy className="size-4" />
              {copied ? 'Copied' : 'Copy Public Key'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onDownloadPublicKey}>
              <ArrowDownToLine className="size-4" />
              Download Public Key
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onDownloadPrivateKey}>
              <ArrowUpToLine className="size-4" />
              Download Private Key
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={keyActionLoading} onClick={onRotateKeyPair}>
              {keyActionLoading ? <Loader2 className="size-4 animate-spin" /> : <ShieldEllipsis className="size-4" />}
              {keyActionLoading ? 'Rotating...' : 'Rotate Key Pair'}
            </Button>
          </SettingsButtonRow>

          <Accordion type="single" collapsible>
            <AccordionItem value="usage" className="border-border/70 bg-background/60">
              <AccordionTrigger>How to use this key</AccordionTrigger>
              <AccordionContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  Use <strong>Push Key</strong> on a managed SSH gateway to deploy the public key over
                  the control channel. You can also place the public key in
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">SSH_AUTHORIZED_KEYS</code>
                  or mount it as
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">/config/authorized_keys</code>.
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}
    </SettingsPanel>
  );
}
