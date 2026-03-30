import { useState, useCallback, useEffect, useRef } from 'react';

export interface SftpSocket {
  connected: boolean;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  emit(event: string, payload?: unknown, callback?: (...args: any[]) => void): void;
}

export interface TransferItem {
  transferId: string;
  filename: string;
  direction: 'upload' | 'download';
  totalBytes: number;
  bytesTransferred: number;
  status: 'active' | 'complete' | 'error' | 'cancelled';
  errorMessage?: string;
  remotePath: string;
  file?: File;
}

const CHUNK_SIZE = 64 * 1024; // 64KB — matches server config default

function updateTransfer(
  setter: React.Dispatch<React.SetStateAction<TransferItem[]>>,
  transferId: string,
  patch: Partial<TransferItem>,
) {
  setter((prev) => prev.map((t) => (t.transferId === transferId ? { ...t, ...patch } : t)));
}

export function useSftpTransfers(socket: SftpSocket | null) {
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const downloadBuffers = useRef<Map<string, ArrayBuffer[]>>(new Map());

  // Subscribe to server events
  useEffect(() => {
    if (!socket) return;

    const onProgress = (data: { transferId: string; bytesTransferred: number; totalBytes: number }) => {
      updateTransfer(setTransfers, data.transferId, {
        bytesTransferred: data.bytesTransferred,
        totalBytes: data.totalBytes,
      });
    };

    const onComplete = (data: { transferId: string }) => {
      updateTransfer(setTransfers, data.transferId, { status: 'complete' });

      // If this was a download, assemble and trigger browser download
      const chunks = downloadBuffers.current.get(data.transferId);
      if (chunks) {
        setTransfers((prev) => {
          const transfer = prev.find((t) => t.transferId === data.transferId);
          if (transfer && transfer.direction === 'download') {
            const blob = new Blob(chunks);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = transfer.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }
          return prev;
        });
        downloadBuffers.current.delete(data.transferId);
      }
    };

    const onError = (data: { transferId: string; message: string }) => {
      updateTransfer(setTransfers, data.transferId, { status: 'error', errorMessage: data.message });
      downloadBuffers.current.delete(data.transferId);
    };

    const onCancelled = (data: { transferId: string }) => {
      updateTransfer(setTransfers, data.transferId, { status: 'cancelled' });
      downloadBuffers.current.delete(data.transferId);
    };

    const onDownloadChunk = (data: { transferId: string; chunk: ArrayBuffer | Uint8Array | number[] }) => {
      let chunks = downloadBuffers.current.get(data.transferId);
      if (!chunks) {
        chunks = [];
        downloadBuffers.current.set(data.transferId, chunks);
      }
      const buf = data.chunk instanceof ArrayBuffer
        ? data.chunk
        : new Uint8Array(data.chunk as number[]).buffer as ArrayBuffer;
      chunks.push(buf);
    };

    socket.on('sftp:progress', onProgress);
    socket.on('sftp:transfer:complete', onComplete);
    socket.on('sftp:transfer:error', onError);
    socket.on('sftp:transfer:cancelled', onCancelled);
    socket.on('sftp:download:chunk', onDownloadChunk);

    return () => {
      socket.off('sftp:progress', onProgress);
      socket.off('sftp:transfer:complete', onComplete);
      socket.off('sftp:transfer:error', onError);
      socket.off('sftp:transfer:cancelled', onCancelled);
      socket.off('sftp:download:chunk', onDownloadChunk);
    };
  }, [socket]);

  const uploadFile = useCallback(async (file: File, remotePath: string) => {
    if (!socket) return;

    const fullPath = remotePath.endsWith('/') ? remotePath + file.name : remotePath + '/' + file.name;

    // Start upload — get transferId from server
    const res = await new Promise<{ transferId?: string; error?: string }>((resolve) => {
      socket.emit('sftp:upload:start', { remotePath: fullPath, fileSize: file.size, filename: file.name }, resolve);
    });

    if (res.error || !res.transferId) {
      setTransfers((prev) => [...prev, {
        transferId: 'err-' + Date.now(),
        filename: file.name,
        direction: 'upload',
        totalBytes: file.size,
        bytesTransferred: 0,
        status: 'error',
        errorMessage: res.error || 'Upload failed to start',
        remotePath: fullPath,
        file,
      }]);
      return;
    }

    const transferId = res.transferId;
    setTransfers((prev) => [...prev, {
      transferId,
      filename: file.name,
      direction: 'upload',
      totalBytes: file.size,
      bytesTransferred: 0,
      status: 'active',
      remotePath: fullPath,
      file,
    }]);

    // Read and send in chunks
    let offset = 0;
    const reader = new FileReader();

    const sendNextChunk = () => {
      if (offset >= file.size) {
        socket.emit('sftp:upload:end', { transferId }, (endRes: { error?: string }) => {
          if (endRes?.error) {
            updateTransfer(setTransfers, transferId, { status: 'error', errorMessage: endRes.error });
          }
        });
        return;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.onload = () => {
        if (!reader.result) return;
        const chunk = new Uint8Array(reader.result as ArrayBuffer);
        socket.emit('sftp:upload:chunk', { transferId, chunk: Array.from(chunk) }, (chunkRes: { error?: string }) => {
          if (chunkRes?.error) {
            updateTransfer(setTransfers, transferId, { status: 'error', errorMessage: chunkRes.error });
            return;
          }
          offset += chunk.length;
          sendNextChunk();
        });
      };
      reader.readAsArrayBuffer(slice);
    };

    sendNextChunk();
  }, [socket]);

  const downloadFile = useCallback(async (remotePath: string) => {
    if (!socket) return;

    const res = await new Promise<{ transferId?: string; totalBytes?: number; filename?: string; error?: string }>((resolve) => {
      socket.emit('sftp:download:start', { remotePath }, resolve);
    });

    if (res.error || !res.transferId) {
      setTransfers((prev) => [...prev, {
        transferId: 'err-' + Date.now(),
        filename: remotePath.split('/').pop() || 'file',
        direction: 'download',
        totalBytes: 0,
        bytesTransferred: 0,
        status: 'error',
        errorMessage: res.error || 'Download failed to start',
        remotePath,
      }]);
      return;
    }

    setTransfers((prev) => [...prev, {
      transferId: res.transferId ?? '',
      filename: res.filename || remotePath.split('/').pop() || 'file',
      direction: 'download',
      totalBytes: res.totalBytes || 0,
      bytesTransferred: 0,
      status: 'active',
      remotePath,
    }]);
  }, [socket]);

  const cancelTransfer = useCallback((transferId: string) => {
    socket?.emit('sftp:cancel', { transferId });
  }, [socket]);

  const clearCompleted = useCallback(() => {
    setTransfers((prev) => prev.filter((t) => t.status === 'active'));
  }, []);

  return { transfers, uploadFile, downloadFile, cancelTransfer, clearCompleted };
}
