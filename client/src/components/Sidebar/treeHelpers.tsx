import { useState, useRef, useEffect } from 'react';
import {
  ListItemButton, ListItemIcon, ListItemText,
  Collapse, Menu, MenuItem, Divider, IconButton, List,
} from '@mui/material';
import {
  Computer as RdpIcon,
  Terminal as SshIcon,
  DesktopWindows as VncIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ExpandMore,
  ChevronRight,
  Share as ShareIcon,
  PlayArrow as ConnectIcon,
  OpenInNew as OpenInNewIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CreateNewFolder as CreateNewFolderIcon,
  Add as AddIcon,
  SwitchAccount as SwitchAccountIcon,
  DriveFileMove as MoveIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  FolderShared as FolderSharedIcon,
  PlaylistPlay as PlaylistPlayIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import { useTabsStore } from '../../store/tabsStore';
import { ConnectionData } from '../../api/connections.api';
import type { Folder } from '../../store/connectionsStore';
import { openConnectionWindow } from '../../utils/openConnectionWindow';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

// eslint-disable-next-line react-refresh/only-export-components
export function getErrorMessage(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

export const BASE_PL = 2;
export const INDENT = 2;
// eslint-disable-next-line react-refresh/only-export-components
export function depthPl(depth: number) { return BASE_PL + depth * INDENT; }

export interface FolderNode {
  folder: Folder;
  children: FolderNode[];
}

// eslint-disable-next-line react-refresh/only-export-components
export function matchesSearch(conn: ConnectionData, query: string): boolean {
  const q = query.toLowerCase();
  return conn.name.toLowerCase().includes(q)
    || conn.host.toLowerCase().includes(q)
    || conn.type.toLowerCase().includes(q)
    || (conn.description?.toLowerCase().includes(q) ?? false);
}

// eslint-disable-next-line react-refresh/only-export-components
export function pruneFolderTree(nodes: FolderNode[], folderMap: Map<string, ConnectionData[]>): FolderNode[] {
  return nodes.reduce<FolderNode[]>((acc, node) => {
    const prunedChildren = pruneFolderTree(node.children, folderMap);
    const hasConnections = (folderMap.get(node.folder.id) || []).length > 0;
    if (hasConnections || prunedChildren.length > 0) {
      acc.push({ ...node, children: prunedChildren });
    }
    return acc;
  }, []);
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildFolderTree(folders: Folder[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  for (const f of folders) {
    map.set(f.id, { folder: f, children: [] });
  }
  const roots: FolderNode[] = [];
  for (const node of map.values()) {
    const pid = node.folder.parentId;
    if (pid && map.has(pid)) {
      map.get(pid)?.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

// eslint-disable-next-line react-refresh/only-export-components
export function collectFolderConnections(
  folderId: string,
  folderMap: Map<string, ConnectionData[]>,
  folders: Folder[],
  recursive: boolean
): ConnectionData[] {
  const direct = folderMap.get(folderId) || [];
  if (!recursive) return [...direct];

  const result = [...direct];
  const childFolders = folders.filter((f) => f.parentId === folderId);
  for (const child of childFolders) {
    result.push(...collectFolderConnections(child.id, folderMap, folders, true));
  }
  return result;
}

// eslint-disable-next-line react-refresh/only-export-components
export function folderHasSubfolders(folderId: string, folders: Folder[]): boolean {
  return folders.some((f) => f.parentId === folderId);
}

// --- ConnectionItem ---

export interface ConnectionItemProps {
  conn: ConnectionData;
  depth: number;
  compact?: boolean;
  draggable?: boolean;
  onEdit: (conn: ConnectionData) => void;
  onDelete: (conn: ConnectionData) => void;
  onMove: (conn: ConnectionData) => void;
  onShare: (conn: ConnectionData) => void;
  onConnectAs: (conn: ConnectionData) => void;
  onToggleFavorite?: (conn: ConnectionData) => void;
  onViewAuditLog?: (conn: ConnectionData) => void;
}

export function ConnectionItem({ conn, depth, compact, draggable = false, onEdit, onDelete, onMove, onShare, onConnectAs, onToggleFavorite, onViewAuditLog }: ConnectionItemProps) {
  const openTab = useTabsStore((s) => s.openTab);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `connection-${conn.id}`,
    data: { type: 'connection', connection: conn },
    disabled: !draggable,
  });

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ mouseX: event.clientX - 2, mouseY: event.clientY - 4 });
  };

  const handleCloseMenu = () => setContextMenu(null);

  const quickConnect = () => {
    if (conn.defaultCredentialMode === 'domain') {
      openTab(conn, { username: '', password: '', credentialMode: 'domain' });
    } else if (conn.defaultCredentialMode === 'prompt') {
      onConnectAs(conn);
    } else {
      openTab(conn);
    }
  };

  const handleConnect = () => {
    handleCloseMenu();
    quickConnect();
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

  const handleMove = () => {
    handleCloseMenu();
    onMove(conn);
  };

  const handleShare = () => {
    handleCloseMenu();
    onShare(conn);
  };

  const handleConnectAs = () => {
    handleCloseMenu();
    onConnectAs(conn);
  };

  const handleViewAuditLog = () => {
    handleCloseMenu();
    onViewAuditLog?.(conn);
  };

  return (
    <>
      <ListItemButton
        ref={setNodeRef}
        dense
        onDoubleClick={() => quickConnect()}
        onContextMenu={handleContextMenu}
        sx={{
          pl: depthPl(depth),
          ...(compact && { py: 0.125 }),
          ...(draggable && { cursor: 'grab' }),
          ...(isDragging && { opacity: 0.4 }),
          ...(transform && { transform: CSS.Translate.toString(transform) }),
        }}
        {...(draggable ? { ...listeners, ...attributes } : {})}
      >
        <ListItemIcon sx={{ minWidth: compact ? 24 : 32 }}>
          {conn.type === 'SSH' ? (
            <SshIcon fontSize="small" color="secondary" />
          ) : conn.type === 'VNC' ? (
            <VncIcon fontSize="small" color="info" />
          ) : (
            <RdpIcon fontSize="small" color="primary" />
          )}
        </ListItemIcon>
        <ListItemText
          primary={conn.name}
          secondary={compact ? undefined : `${conn.host}:${conn.port}`}
          primaryTypographyProps={{ variant: 'body2', noWrap: true }}
          secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
        />
        {conn.isOwner && onToggleFavorite && (
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(conn); }}
            sx={{ p: 0.25 }}
          >
            {conn.isFavorite
              ? <StarIcon fontSize="small" color="warning" />
              : <StarBorderIcon fontSize="small" sx={{ opacity: 0.3 }} />}
          </IconButton>
        )}
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
        <MenuItem onClick={handleConnectAs}>
          <ListItemIcon><SwitchAccountIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Connect As...</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleOpenInNewWindow}>
          <ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Open in New Window</ListItemText>
        </MenuItem>
        {conn.isOwner && onToggleFavorite && (
          <MenuItem onClick={() => { handleCloseMenu(); onToggleFavorite(conn); }}>
            <ListItemIcon>
              {conn.isFavorite
                ? <StarBorderIcon fontSize="small" />
                : <StarIcon fontSize="small" color="warning" />}
            </ListItemIcon>
            <ListItemText>{conn.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}</ListItemText>
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={handleMove} disabled={!conn.isOwner}>
          <ListItemIcon><MoveIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Move to Folder</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleEdit} disabled={!conn.isOwner}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleShare} disabled={!conn.isOwner}>
          <ListItemIcon><ShareIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Share</ListItemText>
        </MenuItem>
        {onViewAuditLog && (
          <MenuItem onClick={handleViewAuditLog}>
            <ListItemIcon><HistoryIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Activity Log</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={handleDelete} disabled={!conn.isOwner}>
          <ListItemIcon><DeleteIcon fontSize="small" color={conn.isOwner ? 'error' : undefined} /></ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

// --- FolderItem ---

export interface FolderItemProps {
  node: FolderNode;
  connections: ConnectionData[];
  folderMap: Map<string, ConnectionData[]>;
  depth: number;
  compact?: boolean;
  isDndEnabled?: boolean;
  teamId?: string;
  onEditConnection: (conn: ConnectionData) => void;
  onDeleteConnection: (conn: ConnectionData) => void;
  onMoveConnection: (conn: ConnectionData) => void;
  onShareConnection: (conn: ConnectionData) => void;
  onConnectAsConnection: (conn: ConnectionData) => void;
  onToggleFavorite: (conn: ConnectionData) => void;
  onViewAuditLog?: (conn: ConnectionData) => void;
  onCreateConnection: (folderId: string, teamId?: string) => void;
  onCreateFolder: (parentId?: string, teamId?: string) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onBulkOpen?: (folderId: string) => void;
  onShareFolder?: (folderId: string, folderName: string) => void;
}

export function FolderItem({
  node, connections, folderMap, depth, compact, isDndEnabled = false, teamId,
  onEditConnection, onDeleteConnection, onMoveConnection, onShareConnection, onConnectAsConnection, onToggleFavorite,
  onViewAuditLog, onCreateConnection, onCreateFolder, onEditFolder, onDeleteFolder,
  onBulkOpen, onShareFolder,
}: FolderItemProps) {
  const [open, setOpen] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);

  const { setNodeRef, isOver } = useDroppable({
    id: `folder-${node.folder.id}`,
    data: { type: 'folder', folderId: node.folder.id },
  });

  // Auto-expand collapsed folders on drag hover after 500ms
  const dragOverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isOver && !open) {
      dragOverTimerRef.current = setTimeout(() => setOpen(true), 500);
    }
    return () => {
      if (dragOverTimerRef.current) clearTimeout(dragOverTimerRef.current);
    };
  }, [isOver, open]);

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ mouseX: event.clientX - 2, mouseY: event.clientY - 4 });
  };

  const handleCloseMenu = () => setContextMenu(null);

  return (
    <>
      <ListItemButton
        ref={setNodeRef}
        dense
        onClick={() => setOpen(!open)}
        onContextMenu={handleContextMenu}
        sx={{
          pl: isOver ? depthPl(depth) - 0.375 : depthPl(depth),
          ...(compact && { py: 0.125 }),
          ...(isOver && {
            bgcolor: 'action.hover',
            borderLeft: '3px solid',
            borderColor: 'primary.main',
          }),
          transition: 'background-color 0.15s ease',
        }}
      >
        <ListItemIcon sx={{ minWidth: compact ? 24 : 32 }}>
          {open ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />}
        </ListItemIcon>
        <ListItemText
          primary={node.folder.name}
          primaryTypographyProps={{ variant: 'body2' }}
        />
        {open ? <ExpandMore fontSize="small" /> : <ChevronRight fontSize="small" />}
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
        <MenuItem onClick={() => { handleCloseMenu(); onCreateConnection(node.folder.id, teamId); }}>
          <ListItemIcon><AddIcon fontSize="small" /></ListItemIcon>
          <ListItemText>New Connection</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { handleCloseMenu(); onCreateFolder(node.folder.id, teamId); }}>
          <ListItemIcon><CreateNewFolderIcon fontSize="small" /></ListItemIcon>
          <ListItemText>New Subfolder</ListItemText>
        </MenuItem>
        {onBulkOpen && (
          <MenuItem onClick={() => { handleCloseMenu(); onBulkOpen(node.folder.id); }}>
            <ListItemIcon><PlaylistPlayIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Open All</ListItemText>
          </MenuItem>
        )}
        {onShareFolder && (
          <MenuItem onClick={() => { handleCloseMenu(); onShareFolder(node.folder.id, node.folder.name); }}>
            <ListItemIcon><FolderSharedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Share Folder</ListItemText>
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={() => { handleCloseMenu(); onEditFolder(node.folder); }}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Rename</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { handleCloseMenu(); onDeleteFolder(node.folder); }}>
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      <Collapse in={open}>
        <List disablePadding>
          {node.children.map((child) => (
            <FolderItem
              key={child.folder.id}
              node={child}
              connections={folderMap.get(child.folder.id) || []}
              folderMap={folderMap}
              depth={depth + 1}
              compact={compact}
              isDndEnabled={isDndEnabled}
              teamId={teamId}
              onEditConnection={onEditConnection}
              onDeleteConnection={onDeleteConnection}
              onMoveConnection={onMoveConnection}
              onShareConnection={onShareConnection}
              onConnectAsConnection={onConnectAsConnection}
              onToggleFavorite={onToggleFavorite}
              onViewAuditLog={onViewAuditLog}
              onCreateConnection={onCreateConnection}
              onCreateFolder={onCreateFolder}
              onEditFolder={onEditFolder}
              onDeleteFolder={onDeleteFolder}
              onBulkOpen={onBulkOpen}
              onShareFolder={onShareFolder}
            />
          ))}
          {connections.map((conn) => (
            <ConnectionItem
              key={conn.id}
              conn={conn}
              depth={depth + 1}
              compact={compact}
              draggable={isDndEnabled && conn.isOwner}
              onEdit={onEditConnection}
              onDelete={onDeleteConnection}
              onMove={onMoveConnection}
              onShare={onShareConnection}
              onConnectAs={onConnectAsConnection}
              onToggleFavorite={onToggleFavorite}
              onViewAuditLog={onViewAuditLog}
            />
          ))}
        </List>
      </Collapse>
    </>
  );
}
