import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { X, RefreshCw } from 'lucide-react';
import type { CredentialOverride } from '../../store/tabsStore';
import {
  createSshDirectory,
  deleteSshPath,
  downloadSshFile,
  listSshFiles,
  renameSshPath,
  type SshFileEntry,
  uploadSshFile,
} from '../../api/sshFiles.api';
import {
  deleteManagedHistoryItem,
  downloadManagedHistoryItem,
  listManagedHistory,
  restoreManagedHistoryItem,
  sshManagedTransferScope,
  type ManagedHistoryEntry,
} from '../../api/managedTransfer.api';
import type { TransferItem } from '../../hooks/useSftpTransfers';
import { extractApiError } from '../../utils/apiError';
import ManagedHistoryList from '../shared/ManagedHistoryList';
import {
  isDisallowedSandboxPath,
  joinSandboxPath,
  mapSandboxBrowserMessage,
  normalizeSandboxRelativePath,
  REMOTE_BROWSING_DISABLED_COPY,
  SANDBOX_BROWSER_BANNER_TEXT,
  triggerBlobDownload,
} from '../shared/managedSandboxUi';
import SftpTransferQueue from './SftpTransferQueue';
import SftpBrowserDialogs from './SftpBrowserDialogs';
import {
  normalizeCredentials,
  updateTransfer,
} from './sftpBrowserUtils';
import SftpWorkspacePane from './SftpWorkspacePane';

interface SftpBrowserProps {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  credentials?: CredentialOverride;
  disableDownload?: boolean;
  disableUpload?: boolean;
}

export default function SftpBrowser({
  open,
  onClose,
  connectionId,
  credentials,
  disableDownload,
  disableUpload,
}: SftpBrowserProps) {
  const [activeView, setActiveView] = useState<'workspace' | 'history'>('workspace');
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<SshFileEntry[]>([]);
  const [historyItems, setHistoryItems] = useState<ManagedHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SshFileEntry | null>(null);
  const [renameTarget, setRenameTarget] = useState<SshFileEntry | null>(null);
  const [renameName, setRenameName] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<ManagedHistoryEntry | null>(null);
  const [restorePath, setRestorePath] = useState('');
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const requestCredentials = useCallback(
    () => normalizeCredentials(connectionId, credentials),
    [connectionId, credentials],
  );

  const setMappedError = useCallback((message: string) => {
    setError(mapSandboxBrowserMessage(message));
  }, []);

  const fetchEntries = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await listSshFiles({ ...requestCredentials(), path: dirPath });
      setEntries(result.entries);
    } catch (err) {
      setMappedError(extractApiError(err, 'Failed to load workspace files'));
    } finally {
      setLoading(false);
    }
  }, [requestCredentials, setMappedError]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setError('');
    try {
      const result = await listManagedHistory(sshManagedTransferScope(requestCredentials()));
      setHistoryItems(result);
    } catch (err) {
      setMappedError(extractApiError(err, 'Failed to load upload history'));
    } finally {
      setHistoryLoading(false);
    }
  }, [requestCredentials, setMappedError]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (activeView === 'workspace') {
      void fetchEntries(currentPath);
      return;
    }
    void fetchHistory();
  }, [activeView, currentPath, fetchEntries, fetchHistory, open]);

  useEffect(() => () => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
  }, []);

  const handleUploadOne = useCallback(async (file: File) => {
    const transferId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const remotePath = joinSandboxPath(currentPath, file.name);
    const controller = new AbortController();
    controllersRef.current.set(transferId, controller);

    setTransfers((prev) => [...prev, {
      transferId,
      filename: file.name,
      direction: 'upload',
      totalBytes: file.size,
      bytesTransferred: 0,
      status: 'active',
      remotePath,
      file,
    }]);

    try {
      await uploadSshFile(
        {
          ...requestCredentials(),
          remotePath,
          file,
        },
        {
          signal: controller.signal,
          onProgress: (loaded, total) => {
            updateTransfer(setTransfers, transferId, {
              bytesTransferred: loaded,
              totalBytes: total || file.size,
            });
          },
        },
      );
      updateTransfer(setTransfers, transferId, {
        bytesTransferred: file.size,
        totalBytes: file.size,
        status: 'complete',
      });
      await fetchEntries(currentPath);
      await fetchHistory();
    } catch (err) {
      updateTransfer(setTransfers, transferId, {
        status: controller.signal.aborted ? 'cancelled' : 'error',
        errorMessage: controller.signal.aborted
          ? undefined
          : mapSandboxBrowserMessage(extractApiError(err, 'Upload failed')),
      });
      if (!controller.signal.aborted) {
        setMappedError(extractApiError(err, 'Upload failed'));
      }
    } finally {
      controllersRef.current.delete(transferId);
    }
  }, [currentPath, fetchEntries, fetchHistory, requestCredentials, setMappedError]);

  const handleUpload = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      void handleUploadOne(file);
    });
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleUpload(event.target.files);
    event.target.value = '';
  };

  const handleDownload = async (entry: SshFileEntry) => {
    const transferId = `download-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const remotePath = joinSandboxPath(currentPath, entry.name);
    const controller = new AbortController();
    controllersRef.current.set(transferId, controller);

    setTransfers((prev) => [...prev, {
      transferId,
      filename: entry.name,
      direction: 'download',
      totalBytes: entry.size,
      bytesTransferred: 0,
      status: 'active',
      remotePath,
    }]);

    try {
      const blob = await downloadSshFile(
        {
          ...requestCredentials(),
          path: remotePath,
        },
        {
          signal: controller.signal,
          onProgress: (loaded, total) => {
            updateTransfer(setTransfers, transferId, {
              bytesTransferred: loaded,
              totalBytes: total || entry.size,
            });
          },
        },
      );
      triggerBlobDownload(blob, entry.name);
      updateTransfer(setTransfers, transferId, {
        bytesTransferred: entry.size,
        totalBytes: entry.size,
        status: 'complete',
      });
    } catch (err) {
      updateTransfer(setTransfers, transferId, {
        status: controller.signal.aborted ? 'cancelled' : 'error',
        errorMessage: controller.signal.aborted
          ? undefined
          : mapSandboxBrowserMessage(extractApiError(err, 'Download failed')),
      });
      if (!controller.signal.aborted) {
        setMappedError(extractApiError(err, 'Download failed'));
      }
    } finally {
      controllersRef.current.delete(transferId);
    }
  };

  const handleHistoryDownload = async (item: ManagedHistoryEntry) => {
    try {
      const blob = await downloadManagedHistoryItem(sshManagedTransferScope(requestCredentials()), item.id);
      triggerBlobDownload(blob, item.fileName);
    } catch (err) {
      setMappedError(extractApiError(err, 'History download failed'));
    }
  };

  const handleMkdir = async () => {
    if (!mkdirName.trim()) return;
    try {
      await createSshDirectory({
        ...requestCredentials(),
        path: joinSandboxPath(currentPath, mkdirName.trim()),
      });
      await fetchEntries(currentPath);
      setMkdirOpen(false);
      setMkdirName('');
    } catch (err) {
      setMappedError(extractApiError(err, 'Failed to create folder'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSshPath({
        ...requestCredentials(),
        path: joinSandboxPath(currentPath, deleteTarget.name),
      });
      await fetchEntries(currentPath);
      setDeleteTarget(null);
    } catch (err) {
      setMappedError(extractApiError(err, 'Failed to delete path'));
    }
  };

  const handleHistoryDelete = async (item: ManagedHistoryEntry) => {
    try {
      await deleteManagedHistoryItem(sshManagedTransferScope(requestCredentials()), item.id);
      await fetchHistory();
    } catch (err) {
      setMappedError(extractApiError(err, 'Failed to delete history item'));
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    try {
      await renameSshPath({
        ...requestCredentials(),
        oldPath: joinSandboxPath(currentPath, renameTarget.name),
        newPath: joinSandboxPath(currentPath, renameName.trim()),
      });
      await fetchEntries(currentPath);
      setRenameTarget(null);
      setRenameName('');
    } catch (err) {
      setMappedError(extractApiError(err, 'Failed to rename path'));
    }
  };

  const openRestoreDialog = (item: ManagedHistoryEntry) => {
    setRestoreTarget(item);
    setRestorePath(joinSandboxPath(currentPath, item.restoredName || item.fileName));
  };

  const handleHistoryRestore = async () => {
    if (!restoreTarget) return;
    const normalizedPath = normalizeSandboxRelativePath(restorePath);
    if (!normalizedPath || isDisallowedSandboxPath(normalizedPath)) {
      setError(REMOTE_BROWSING_DISABLED_COPY);
      return;
    }
    try {
      await restoreManagedHistoryItem(sshManagedTransferScope(requestCredentials()), restoreTarget.id, normalizedPath);
      await fetchEntries(currentPath);
      await fetchHistory();
      setRestoreTarget(null);
      setRestorePath('');
      setActiveView('workspace');
    } catch (err) {
      setMappedError(extractApiError(err, 'Failed to restore history item'));
    }
  };

  const cancelTransfer = (transferId: string) => {
    controllersRef.current.get(transferId)?.abort();
  };

  const clearCompleted = () => {
    setTransfers((prev) => prev.filter((transfer) => transfer.status === 'active'));
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    handleUpload(event.dataTransfer.files);
  };

  if (!open) return null;

  return (
    <>
      <div className="absolute right-0 top-0 bottom-0 z-10 flex w-[360px] flex-col border-l bg-background">
        <div className="flex items-center justify-between p-3 pl-4">
          <span className="text-sm font-semibold">File Browser</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Separator />

        <div className="px-3 py-3">
          <Alert variant="info">
            <AlertDescription>{SANDBOX_BROWSER_BANNER_TEXT}</AlertDescription>
          </Alert>
        </div>

        <Tabs
          value={activeView}
          onValueChange={(value) => setActiveView(value as 'workspace' | 'history')}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="px-3 pb-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="workspace">Workspace</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          </div>

          {error && (
            <div className="mx-3 mb-2 flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              <span>{error}</span>
              <button onClick={() => setError('')} className="text-red-400 hover:text-red-300" type="button">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <TabsContent value="workspace" className="mt-0 flex min-h-0 flex-1 flex-col outline-none">
            <SftpWorkspacePane
              currentPath={currentPath}
              entries={entries}
              loading={loading}
              disableUpload={disableUpload}
              disableDownload={disableDownload}
              dragOver={dragOver}
              fileInputRef={fileInputRef}
              onNavigateTo={setCurrentPath}
              onRefresh={() => void fetchEntries(currentPath)}
              onFileSelect={handleFileSelect}
              onOpenCreateFolder={() => setMkdirOpen(true)}
              onDownload={(entry) => void handleDownload(entry)}
              onRename={(entry) => {
                setRenameTarget(entry);
                setRenameName(entry.name);
              }}
              onDelete={setDeleteTarget}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            />
          </TabsContent>

          <TabsContent value="history" className="mt-0 flex min-h-0 flex-1 flex-col outline-none">
            <div className="flex items-center justify-between px-3 pb-2 text-xs text-muted-foreground">
              <span>Retained successful uploads stay here and never mix into the active workspace.</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void fetchHistory()} disabled={historyLoading}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <ManagedHistoryList
                items={historyItems}
                loading={historyLoading}
                emptyMessage="No retained uploads yet."
                disableDownload={disableDownload}
                disableRestore={disableUpload}
                onDownload={(item) => void handleHistoryDownload(item)}
                onRestore={openRestoreDialog}
                onDelete={(item) => void handleHistoryDelete(item)}
              />
            </div>
          </TabsContent>
        </Tabs>

        <SftpTransferQueue transfers={transfers} onCancel={cancelTransfer} onClearCompleted={clearCompleted} />
      </div>

      <SftpBrowserDialogs
        currentPath={currentPath || 'Workspace'}
        mkdirOpen={mkdirOpen}
        onMkdirOpenChange={setMkdirOpen}
        mkdirName={mkdirName}
        onMkdirNameChange={setMkdirName}
        onCreateFolder={() => void handleMkdir()}
        deleteTarget={deleteTarget}
        onDeleteTargetChange={setDeleteTarget}
        onDelete={() => void handleDelete()}
        renameTarget={renameTarget}
        onRenameTargetChange={setRenameTarget}
        renameName={renameName}
        onRenameNameChange={setRenameName}
        onRename={() => void handleRename()}
      />

      <Dialog open={!!restoreTarget} onOpenChange={(next) => !next && setRestoreTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Upload</DialogTitle>
            <DialogDescription>
              Restore {restoreTarget?.fileName} into the workspace using a sandbox-relative path.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={restorePath}
            onChange={(event) => setRestorePath(event.target.value)}
            placeholder="docs/restored.txt"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">Remote filesystem browsing is disabled. Use sandbox-relative paths only.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRestoreTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleHistoryRestore()} disabled={!restorePath.trim()}>Restore</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
