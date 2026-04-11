import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { SshFileEntry } from '../../api/sshFiles.api';

interface SftpBrowserDialogsProps {
  currentPath: string;
  mkdirOpen: boolean;
  onMkdirOpenChange: (open: boolean) => void;
  mkdirName: string;
  onMkdirNameChange: (value: string) => void;
  onCreateFolder: () => void;
  deleteTarget: SshFileEntry | null;
  onDeleteTargetChange: (target: SshFileEntry | null) => void;
  onDelete: () => void;
  renameTarget: SshFileEntry | null;
  onRenameTargetChange: (target: SshFileEntry | null) => void;
  renameName: string;
  onRenameNameChange: (value: string) => void;
  onRename: () => void;
}

export default function SftpBrowserDialogs({
  currentPath,
  mkdirOpen,
  onMkdirOpenChange,
  mkdirName,
  onMkdirNameChange,
  onCreateFolder,
  deleteTarget,
  onDeleteTargetChange,
  onDelete,
  renameTarget,
  onRenameTargetChange,
  renameName,
  onRenameNameChange,
  onRename,
}: SftpBrowserDialogsProps) {
  return (
    <>
      <Dialog open={mkdirOpen} onOpenChange={onMkdirOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>Create a new folder in {currentPath}</DialogDescription>
          </DialogHeader>
          <Input
            value={mkdirName}
            onChange={(e) => onMkdirNameChange(e.target.value)}
            placeholder="Folder name"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => onMkdirOpenChange(false)}>Cancel</Button>
            <Button onClick={onCreateFolder} disabled={!mkdirName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && onDeleteTargetChange(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.type === 'directory' ? 'Folder' : 'File'}</DialogTitle>
            <DialogDescription>
              Delete {deleteTarget?.name}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onDeleteTargetChange(null)}>Cancel</Button>
            <Button variant="destructive" onClick={onDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && onRenameTargetChange(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>Rename {renameTarget?.name}</DialogDescription>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => onRenameNameChange(e.target.value)}
            placeholder="New name"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => onRenameTargetChange(null)}>Cancel</Button>
            <Button onClick={onRename} disabled={!renameName.trim()}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
