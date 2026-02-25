import { useState } from 'react';
import {
  Box, Typography, List, ListItemButton, ListItemIcon, ListItemText,
  Collapse, Menu, MenuItem, Divider,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button,
} from '@mui/material';
import {
  Computer as RdpIcon,
  Terminal as SshIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ExpandMore,
  ChevronRight,
  Share as ShareIcon,
  PlayArrow as ConnectIcon,
  OpenInNew as OpenInNewIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useConnectionsStore } from '../../store/connectionsStore';
import { useTabsStore } from '../../store/tabsStore';
import { ConnectionData, deleteConnection } from '../../api/connections.api';
import { openConnectionWindow } from '../../utils/openConnectionWindow';

interface ConnectionItemProps {
  conn: ConnectionData;
  onEdit: (conn: ConnectionData) => void;
  onDelete: (conn: ConnectionData) => void;
}

function ConnectionItem({ conn, onEdit, onDelete }: ConnectionItemProps) {
  const openTab = useTabsStore((s) => s.openTab);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ mouseX: event.clientX - 2, mouseY: event.clientY - 4 });
  };

  const handleCloseMenu = () => setContextMenu(null);

  const handleConnect = () => {
    handleCloseMenu();
    openTab(conn);
  };

  const handleOpenInNewWindow = () => {
    handleCloseMenu();
    openConnectionWindow(conn.id);
  };

  const handleEdit = () => {
    handleCloseMenu();
    onEdit(conn);
  };

  const handleDelete = () => {
    handleCloseMenu();
    onDelete(conn);
  };

  return (
    <>
      <ListItemButton
        dense
        onDoubleClick={() => openTab(conn)}
        onContextMenu={handleContextMenu}
        sx={{ pl: 4 }}
      >
        <ListItemIcon sx={{ minWidth: 32 }}>
          {conn.type === 'RDP' ? (
            <RdpIcon fontSize="small" color="primary" />
          ) : (
            <SshIcon fontSize="small" color="secondary" />
          )}
        </ListItemIcon>
        <ListItemText
          primary={conn.name}
          secondary={`${conn.host}:${conn.port}`}
          primaryTypographyProps={{ variant: 'body2', noWrap: true }}
          secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
        />
      </ListItemButton>

      <Menu
        open={contextMenu !== null}
        onClose={handleCloseMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        <MenuItem onClick={handleConnect}>
          <ListItemIcon><ConnectIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Connect</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleOpenInNewWindow}>
          <ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Open in New Window</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleEdit} disabled={!conn.isOwner}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleDelete} disabled={!conn.isOwner}>
          <ListItemIcon><DeleteIcon fontSize="small" color={conn.isOwner ? 'error' : undefined} /></ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

function FolderItem({
  folderId,
  folderName,
  connections,
  onEdit,
  onDelete,
}: {
  folderId: string;
  folderName: string;
  connections: ConnectionData[];
  onEdit: (conn: ConnectionData) => void;
  onDelete: (conn: ConnectionData) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <ListItemButton dense onClick={() => setOpen(!open)} sx={{ pl: 2 }}>
        <ListItemIcon sx={{ minWidth: 32 }}>
          {open ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />}
        </ListItemIcon>
        <ListItemText
          primary={folderName}
          primaryTypographyProps={{ variant: 'body2' }}
        />
        {open ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
      </ListItemButton>
      <Collapse in={open}>
        <List disablePadding>
          {connections.map((conn) => (
            <ConnectionItem key={conn.id} conn={conn} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </List>
      </Collapse>
    </>
  );
}

interface ConnectionTreeProps {
  onEditConnection: (conn: ConnectionData) => void;
}

export default function ConnectionTree({ onEditConnection }: ConnectionTreeProps) {
  const ownConnections = useConnectionsStore((s) => s.ownConnections);
  const sharedConnections = useConnectionsStore((s) => s.sharedConnections);
  const folders = useConnectionsStore((s) => s.folders);
  const fetchConnections = useConnectionsStore((s) => s.fetchConnections);
  const [deleteTarget, setDeleteTarget] = useState<ConnectionData | null>(null);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteConnection(deleteTarget.id);
      await fetchConnections();
    } catch {}
    setDeleteTarget(null);
  };

  // Group own connections by folder
  const rootConnections = ownConnections.filter((c) => !c.folderId);
  const folderMap = new Map<string, ConnectionData[]>();
  ownConnections.forEach((c) => {
    if (c.folderId) {
      const list = folderMap.get(c.folderId) || [];
      list.push(c);
      folderMap.set(c.folderId, list);
    }
  });

  return (
    <Box sx={{ py: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, mb: 1 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          My Connections
        </Typography>
      </Box>
      <List disablePadding>
        {folders.map((folder) => (
          <FolderItem
            key={folder.id}
            folderId={folder.id}
            folderName={folder.name}
            connections={folderMap.get(folder.id) || []}
            onEdit={onEditConnection}
            onDelete={setDeleteTarget}
          />
        ))}
        {rootConnections.map((conn) => (
          <ConnectionItem key={conn.id} conn={conn} onEdit={onEditConnection} onDelete={setDeleteTarget} />
        ))}
      </List>

      {sharedConnections.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', px: 2, mt: 2, mb: 1 }}>
            <ShareIcon fontSize="small" sx={{ mr: 1 }} />
            <Typography variant="subtitle2">Shared with me</Typography>
          </Box>
          <List disablePadding>
            {sharedConnections.map((conn) => (
              <ConnectionItem key={conn.id} conn={conn} onEdit={onEditConnection} onDelete={setDeleteTarget} />
            ))}
          </List>
        </>
      )}

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Connection</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
