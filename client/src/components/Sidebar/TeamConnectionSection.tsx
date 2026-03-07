import { useState, useMemo } from 'react';
import {
  Box, Typography, List, Collapse, IconButton, Menu, MenuItem,
  ListItemIcon, ListItemText,
} from '@mui/material';
import {
  ExpandMore, ChevronRight, Groups as GroupsIcon,
  Add as AddIcon, CreateNewFolder as CreateNewFolderIcon,
} from '@mui/icons-material';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { ConnectionData } from '../../api/connections.api';
import type { Folder } from '../../store/connectionsStore';
import {
  matchesSearch, buildFolderTree, pruneFolderTree,
  ConnectionItem, FolderItem,
} from './treeHelpers';

interface TeamConnectionSectionProps {
  teamId: string;
  teamName: string;
  teamRole: string;
  connections: ConnectionData[];
  folders: Folder[];
  compact: boolean;
  searchQuery: string;
  onEditConnection: (conn: ConnectionData) => void;
  onDeleteConnection: (conn: ConnectionData) => void;
  onMoveConnection: (conn: ConnectionData) => void;
  onShareConnection: (conn: ConnectionData) => void;
  onConnectAsConnection: (conn: ConnectionData) => void;
  onToggleFavorite: (conn: ConnectionData) => void;
  onViewAuditLog?: (conn: ConnectionData) => void;
  onCreateConnection: (folderId?: string, teamId?: string) => void;
  onCreateFolder: (parentId?: string, teamId?: string) => void;
  onEditFolder: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onBulkOpen?: (folderId: string) => void;
  onShareFolder?: (folderId: string, folderName: string) => void;
}

export default function TeamConnectionSection({
  teamId, teamName, teamRole, connections, folders, compact, searchQuery,
  onEditConnection, onDeleteConnection, onMoveConnection, onShareConnection,
  onConnectAsConnection, onToggleFavorite, onViewAuditLog, onCreateConnection, onCreateFolder,
  onEditFolder, onDeleteFolder, onBulkOpen, onShareFolder,
}: TeamConnectionSectionProps) {
  const sidebarTeamSections = useUiPreferencesStore((s) => s.sidebarTeamSections);
  const toggleTeamSection = useUiPreferencesStore((s) => s.toggleTeamSection);
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);

  const isOpen = sidebarTeamSections[teamId] ?? true;
  const isSearching = searchQuery.trim().length > 0;
  const canCreate = teamRole === 'TEAM_ADMIN' || teamRole === 'TEAM_EDITOR';

  const { filteredRootConnections, filteredFolderMap, filteredFolderTree } = useMemo(() => {
    const filtered = isSearching
      ? connections.filter((c) => matchesSearch(c, searchQuery))
      : connections;

    const rootConns = filtered.filter((c) => !c.folderId);
    const fMap = new Map<string, ConnectionData[]>();
    filtered.forEach((c) => {
      if (c.folderId) {
        const list = fMap.get(c.folderId) || [];
        list.push(c);
        fMap.set(c.folderId, list);
      }
    });

    const fullTree = buildFolderTree(folders);
    const prunedTree = isSearching ? pruneFolderTree(fullTree, fMap) : fullTree;

    return {
      filteredRootConnections: rootConns,
      filteredFolderMap: fMap,
      filteredFolderTree: prunedTree,
    };
  }, [connections, folders, searchQuery, isSearching]);

  // Hide section entirely if no matches during search
  if (isSearching && filteredRootConnections.length === 0 && filteredFolderTree.length === 0) {
    return null;
  }

  return (
    <>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', px: 2, mt: 1, mb: 0.5,
          cursor: 'pointer', userSelect: 'none',
        }}
        onClick={() => toggleTeamSection(teamId)}
      >
        {isOpen
          ? <ExpandMore sx={{ fontSize: 18, mr: 0.5 }} />
          : <ChevronRight sx={{ fontSize: 18, mr: 0.5 }} />}
        <GroupsIcon fontSize="small" sx={{ mr: 1 }} />
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }} noWrap>{teamName}</Typography>
        {canCreate && (
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); setAddMenuAnchor(e.currentTarget); }}
            title={`Add to ${teamName}`}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Menu
        anchorEl={addMenuAnchor}
        open={Boolean(addMenuAnchor)}
        onClose={() => setAddMenuAnchor(null)}
      >
        <MenuItem onClick={() => { setAddMenuAnchor(null); onCreateConnection(undefined, teamId); }}>
          <ListItemIcon><AddIcon fontSize="small" /></ListItemIcon>
          <ListItemText>New Connection</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { setAddMenuAnchor(null); onCreateFolder(undefined, teamId); }}>
          <ListItemIcon><CreateNewFolderIcon fontSize="small" /></ListItemIcon>
          <ListItemText>New Folder</ListItemText>
        </MenuItem>
      </Menu>

      <Collapse in={isOpen}>
        <List disablePadding>
          {filteredFolderTree.map((node) => (
            <FolderItem
              key={node.folder.id}
              node={node}
              connections={filteredFolderMap.get(node.folder.id) || []}
              folderMap={filteredFolderMap}
              depth={0}
              compact={compact}
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
          {filteredRootConnections.map((conn) => (
            <ConnectionItem
              key={conn.id}
              conn={conn}
              depth={0}
              compact={compact}
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
