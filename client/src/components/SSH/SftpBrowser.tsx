import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  X,
  Download,
  Trash2,
  Upload,
  Folder,
  FileText,
  Link as LinkIcon,
  FolderPlus,
  RefreshCw,
  ChevronRight,
  Home,
  Loader2,
} from 'lucide-react';
import type { CredentialOverride } from '../../store/tabsStore';
import {
  listSshFiles,
  createSshDirectory,
  deleteSshPath,
  renameSshPath,
  uploadSshFile,
  downloadSshFile,
  type SshFileEntry,
} from '../../api/sshFiles.api';
import type { TransferItem } from '../../hooks/useSftpTransfers';
import { extractApiError } from '../../utils/apiError';
import SftpTransferQueue from './SftpTransferQueue';
import SftpBrowserDialogs from './SftpBrowserDialogs';
import {
  formatDate,
  formatFileSize,
  joinRemotePath,
  normalizeCredentials,
  triggerBlobDownload,
  updateTransfer,
} from './sftpBrowserUtils';

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
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<SshFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SshFileEntry | null>(null);
  const [renameTarget, setRenameTarget] = useState<SshFileEntry | null>(null);
  const [renameName, setRenameName] = useState('');
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());

  const requestCredentials = useCallback(
    () => normalizeCredentials(connectionId, credentials),
    [connectionId, credentials],
  );

  const fetchEntries = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await listSshFiles({ ...requestCredentials(), path: dirPath });
      setEntries(result.entries);
    } catch (err) {
      setError(extractApiError(err, `Failed to list ${dirPath}`));
    } finally {
      setLoading(false);
    }
  }, [requestCredentials]);

  useEffect(() => {
    if (open) {
      void fetchEntries(currentPath);
    }
  }, [open, currentPath, fetchEntries]);

  useEffect(() => () => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
  }, []);

  const navigateTo = (newPath: string) => {
    setCurrentPath(newPath);
  };

  const handleEntryDoubleClick = (entry: SshFileEntry) => {
    if (entry.type === 'directory' || entry.type === 'symlink') {
      navigateTo(joinRemotePath(currentPath, entry.name));
    }
  };

  const handleUploadOne = useCallback(async (file: File) => {
    const transferId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const remotePath = joinRemotePath(currentPath, file.name);
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
    } catch (err) {
      updateTransfer(setTransfers, transferId, {
        status: controller.signal.aborted ? 'cancelled' : 'error',
        errorMessage: controller.signal.aborted ? undefined : extractApiError(err, 'Upload failed'),
      });
      if (!controller.signal.aborted) {
        setError(extractApiError(err, 'Upload failed'));
      }
    } finally {
      controllersRef.current.delete(transferId);
    }
  }, [currentPath, fetchEntries, requestCredentials]);

  const handleUpload = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      void handleUploadOne(file);
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleUpload(e.target.files);
    e.target.value = '';
  };

  const handleDownload = async (entry: SshFileEntry) => {
    const transferId = `download-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const remotePath = joinRemotePath(currentPath, entry.name);
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
        errorMessage: controller.signal.aborted ? undefined : extractApiError(err, 'Download failed'),
      });
      if (!controller.signal.aborted) {
        setError(extractApiError(err, 'Download failed'));
      }
    } finally {
      controllersRef.current.delete(transferId);
    }
  };

  const handleMkdir = async () => {
    if (!mkdirName.trim()) return;
    try {
      await createSshDirectory({
        ...requestCredentials(),
        path: joinRemotePath(currentPath, mkdirName.trim()),
      });
      await fetchEntries(currentPath);
      setMkdirOpen(false);
      setMkdirName('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to create directory'));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSshPath({
        ...requestCredentials(),
        path: joinRemotePath(currentPath, deleteTarget.name),
      });
      await fetchEntries(currentPath);
      setDeleteTarget(null);
    } catch (err) {
      setError(extractApiError(err, 'Failed to delete path'));
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    try {
      await renameSshPath({
        ...requestCredentials(),
        oldPath: joinRemotePath(currentPath, renameTarget.name),
        newPath: joinRemotePath(currentPath, renameName.trim()),
      });
      await fetchEntries(currentPath);
      setRenameTarget(null);
      setRenameName('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to rename path'));
    }
  };

  const cancelTransfer = (transferId: string) => {
    controllersRef.current.get(transferId)?.abort();
  };

  const clearCompleted = () => {
    setTransfers((prev) => prev.filter((transfer) => transfer.status === 'active'));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  const pathSegments = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean);

  const entryIcon = (type: SshFileEntry['type']) => {
    switch (type) {
      case 'directory':
        return <Folder className="h-4 w-4 text-primary" />;
      case 'symlink':
        return <LinkIcon className="h-4 w-4 text-muted-foreground" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="absolute right-0 top-0 bottom-0 w-[360px] border-l bg-background flex flex-col z-10"
        onDragOver={disableUpload ? undefined : handleDragOver}
        onDragLeave={disableUpload ? undefined : handleDragLeave}
        onDrop={disableUpload ? undefined : handleDrop}
      >
        <div className="flex items-center justify-between p-3 pl-4">
          <span className="text-sm font-semibold">SFTP</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Separator />

        <div className="px-3 py-2 overflow-auto">
          <nav className="flex items-center gap-0.5 text-xs">
            <button className="flex items-center hover:underline text-muted-foreground" onClick={() => navigateTo('/')}>
              <Home className="h-3.5 w-3.5" />
            </button>
            {pathSegments.map((segment, idx) => {
              const segPath = `/${pathSegments.slice(0, idx + 1).join('/')}`;
              const isLast = idx === pathSegments.length - 1;
              return (
                <span key={segPath} className="flex items-center gap-0.5">
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  {isLast ? (
                    <span className="text-foreground">{segment}</span>
                  ) : (
                    <button className="hover:underline text-muted-foreground" onClick={() => navigateTo(segPath)}>
                      {segment}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
        </div>

        <Separator />

        <div className="flex gap-1 p-2 px-3">
          {!disableUpload && (
            <>
              <input type="file" multiple ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
              <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5 mr-1" />
                Upload
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => setMkdirOpen(true)}>
            <FolderPlus className="h-3.5 w-3.5 mr-1" />
            New Folder
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void fetchEntries(currentPath)} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {dragOver && !disableUpload && (
          <div className="mx-3 p-3 border-2 border-dashed border-primary rounded text-center bg-muted/50">
            <p className="text-sm text-primary">Drop files here to upload</p>
          </div>
        )}

        {error && (
          <div className="mx-3 mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-300">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex justify-center p-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">
              This directory is empty.
            </p>
          ) : (
            <div>
              {entries.map((entry) => (
                <div
                  key={entry.name}
                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-default"
                  onDoubleClick={() => handleEntryDoubleClick(entry)}
                >
                  {entryIcon(entry.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.85rem] truncate">{entry.name}</p>
                    <p className="text-[0.75rem] text-muted-foreground">
                      {entry.type === 'directory' ? 'Folder' : formatFileSize(entry.size)} • {formatDate(entry.modifiedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    {entry.type === 'file' && !disableDownload && (
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void handleDownload(entry)} title="Download">
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setRenameTarget(entry); setRenameName(entry.name); }} title="Rename">
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setDeleteTarget(entry)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <SftpTransferQueue transfers={transfers} onCancel={cancelTransfer} onClearCompleted={clearCompleted} />
      </div>

      <SftpBrowserDialogs
        currentPath={currentPath}
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
    </>
  );
}
