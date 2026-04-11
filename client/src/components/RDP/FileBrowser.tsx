import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  X,
  Download,
  Trash2,
  Upload,
  FileText,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { listFiles, uploadFile, downloadFile, deleteFile, FileInfo } from '../../api/files.api';
import { extractApiError } from '../../utils/apiError';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileBrowserProps {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  disableDownload?: boolean;
  disableUpload?: boolean;
}

export default function FileBrowser({ open, onClose, connectionId, disableDownload, disableUpload }: FileBrowserProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listFiles(connectionId);
      setFiles(result);
    } catch {
      setError('Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    if (open) fetchFiles();
  }, [open, fetchFiles]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const result = await uploadFile(connectionId, file);
      setFiles(result);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to upload file'));
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = '';
  };

  const handleDownload = async (name: string) => {
    try {
      await downloadFile(connectionId, name);
    } catch {
      setError('Failed to download file');
    }
  };

  const handleDelete = async (name: string) => {
    setError('');
    try {
      await deleteFile(connectionId, name);
      setFiles((prev) => prev.filter((f) => f.name !== name));
    } catch {
      setError('Failed to delete file');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  if (!open) return null;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-[320px] border-l bg-background flex flex-col z-10"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between p-3 pl-4">
        <span className="text-sm font-semibold">Shared Drive</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Separator />

      {!disableUpload && (
        <div className="p-3">
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
            {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
            {uploading ? 'Uploading...' : 'Upload File'}
          </Button>
        </div>
      )}

      {dragOver && !disableUpload && (
        <div className="mx-3 p-3 border-2 border-dashed border-primary rounded text-center bg-muted/50">
          <p className="text-sm text-primary">Drop file here</p>
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
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4 text-center">
            No files yet. Upload a file or copy files to the Shared drive from inside the RDP session.
          </p>
        ) : (
          <div>
            {files.map((file) => (
              <div key={file.name} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50">
                <FileText className="h-4 w-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[0.85rem] truncate">{file.name}</p>
                  <p className="text-[0.75rem] text-muted-foreground">
                    {formatFileSize(file.size)} - {new Date(file.modifiedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {!disableDownload && (
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDownload(file.name)} title="Download">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDelete(file.name)} title="Delete">
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
        <Button variant="ghost" size="sm" onClick={fetchFiles} disabled={loading}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
      </div>
    </div>
  );
}
