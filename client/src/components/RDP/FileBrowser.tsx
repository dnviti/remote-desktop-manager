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
import {
  X,
  Download,
  Trash2,
  Upload,
  FileText,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { deleteFile, downloadFile, listFiles, uploadFile, type FileInfo } from '../../api/files.api';
import {
  deleteManagedHistoryItem,
  downloadManagedHistoryItem,
  listManagedHistory,
  rdpManagedTransferScope,
  restoreManagedHistoryItem,
  type ManagedHistoryEntry,
} from '../../api/managedTransfer.api';
import ManagedHistoryList from '../shared/ManagedHistoryList';
import {
  formatManagedFileSize,
  isDisallowedSandboxPath,
  mapSandboxBrowserMessage,
  normalizeSandboxRelativePath,
  REMOTE_BROWSING_DISABLED_COPY,
  SANDBOX_BROWSER_BANNER_TEXT,
  triggerBlobDownload,
} from '../shared/managedSandboxUi';
import { extractApiError } from '../../utils/apiError';

interface FileBrowserProps {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  disableDownload?: boolean;
  disableUpload?: boolean;
}

export default function FileBrowser({ open, onClose, connectionId, disableDownload, disableUpload }: FileBrowserProps) {
  const [activeView, setActiveView] = useState<'workspace' | 'history'>('workspace');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [historyItems, setHistoryItems] = useState<ManagedHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<ManagedHistoryEntry | null>(null);
  const [restoreName, setRestoreName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setMappedError = useCallback((message: string) => {
    setError(mapSandboxBrowserMessage(message));
  }, []);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listFiles(connectionId);
      setFiles(result);
    } catch (err: unknown) {
      setMappedError(extractApiError(err, 'Failed to load workspace files'));
    } finally {
      setLoading(false);
    }
  }, [connectionId, setMappedError]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    setError('');
    try {
      const result = await listManagedHistory(rdpManagedTransferScope(connectionId));
      setHistoryItems(result);
    } catch (err: unknown) {
      setMappedError(extractApiError(err, 'Failed to load upload history'));
    } finally {
      setHistoryLoading(false);
    }
  }, [connectionId, setMappedError]);

  useEffect(() => {
    if (!open) return;
    if (activeView === 'workspace') {
      void fetchFiles();
      return;
    }
    void fetchHistory();
  }, [activeView, fetchFiles, fetchHistory, open]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const result = await uploadFile(connectionId, file);
      setFiles(result);
      await fetchHistory();
    } catch (err: unknown) {
      setMappedError(extractApiError(err, 'Failed to upload file'));
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleUpload(file);
    }
    event.target.value = '';
  };

  const handleDownload = async (name: string) => {
    try {
      await downloadFile(connectionId, name);
    } catch (err: unknown) {
      setMappedError(extractApiError(err, 'Failed to download file'));
    }
  };

  const handleDelete = async (name: string) => {
    setError('');
    try {
      await deleteFile(connectionId, name);
      setFiles((prev) => prev.filter((file) => file.name !== name));
    } catch (err: unknown) {
      setMappedError(extractApiError(err, 'Failed to delete file'));
    }
  };

  const handleHistoryDownload = async (item: ManagedHistoryEntry) => {
    try {
      const blob = await downloadManagedHistoryItem(rdpManagedTransferScope(connectionId), item.id);
      triggerBlobDownload(blob, item.fileName);
    } catch (err: unknown) {
      setMappedError(extractApiError(err, 'History download failed'));
    }
  };

  const handleHistoryDelete = async (item: ManagedHistoryEntry) => {
    try {
      await deleteManagedHistoryItem(rdpManagedTransferScope(connectionId), item.id);
      await fetchHistory();
    } catch (err: unknown) {
      setMappedError(extractApiError(err, 'Failed to delete history item'));
    }
  };

  const openRestoreDialog = (item: ManagedHistoryEntry) => {
    setRestoreTarget(item);
    setRestoreName(item.restoredName || item.fileName);
  };

  const handleHistoryRestore = async () => {
    if (!restoreTarget) return;
    const normalizedName = normalizeSandboxRelativePath(restoreName);
    if (!normalizedName || isDisallowedSandboxPath(normalizedName)) {
      setError(REMOTE_BROWSING_DISABLED_COPY);
      return;
    }
    try {
      const result = await restoreManagedHistoryItem(rdpManagedTransferScope(connectionId), restoreTarget.id, normalizedName);
      if (result.files) {
        setFiles(result.files);
      } else {
        await fetchFiles();
      }
      await fetchHistory();
      setRestoreTarget(null);
      setRestoreName('');
      setActiveView('workspace');
    } catch (err: unknown) {
      setMappedError(extractApiError(err, 'Failed to restore history item'));
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      void handleUpload(file);
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="absolute right-0 top-0 bottom-0 z-10 flex w-[320px] flex-col border-l bg-background"
        onDragOver={activeView === 'workspace' && !disableUpload ? handleDragOver : undefined}
        onDragLeave={activeView === 'workspace' && !disableUpload ? handleDragLeave : undefined}
        onDrop={activeView === 'workspace' && !disableUpload ? handleDrop : undefined}
      >
        <div className="flex items-center justify-between p-3 pl-4">
          <span className="text-sm font-semibold">Shared Drive</span>
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
            {!disableUpload && (
              <div className="p-3 pt-0">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
                  {uploading ? 'Uploading...' : 'Upload File'}
                </Button>
              </div>
            )}

            {dragOver && !disableUpload && (
              <div className="mx-3 rounded border-2 border-dashed border-primary bg-muted/50 p-3 text-center">
                <p className="text-sm text-primary">Drop file here</p>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto">
              {loading ? (
                <div className="flex justify-center p-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : files.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  This workspace is empty.
                </p>
              ) : (
                <div>
                  {files.map((file) => (
                    <div key={file.name} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50">
                      <FileText className="h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.85rem]">{file.name}</p>
                        <p className="text-[0.75rem] text-muted-foreground">
                          {formatManagedFileSize(file.size)} - {new Date(file.modifiedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {!disableDownload && (
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void handleDownload(file.name)} title="Download">
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void handleDelete(file.name)} title="Delete">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />
            <div className="p-2 text-center">
              <Button variant="ghost" size="sm" onClick={() => void fetchFiles()} disabled={loading}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="history" className="mt-0 flex min-h-0 flex-1 flex-col outline-none">
            <div className="flex items-center justify-between px-3 pb-2 text-xs text-muted-foreground">
              <span>Retained successful uploads stay here and remain separate from the active workspace.</span>
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
      </div>

      <Dialog open={!!restoreTarget} onOpenChange={(next) => !next && setRestoreTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Upload</DialogTitle>
            <DialogDescription>
              Restore {restoreTarget?.fileName} into the workspace using a sandbox-relative name.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={restoreName}
            onChange={(event) => setRestoreName(event.target.value)}
            placeholder="restored-report.txt"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">Remote filesystem browsing is disabled. Use sandbox-relative paths only.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRestoreTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleHistoryRestore()} disabled={!restoreName.trim()}>Restore</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
