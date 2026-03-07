import { useState, useMemo } from 'react';
import {
  Box, Typography, List,
  Collapse, Divider, IconButton, TextField, InputAdornment,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button,
  FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import {
  Computer as RdpIcon,
  Terminal as SshIcon,
  ExpandMore,
  ChevronRight,
  Share as ShareIcon,
  CreateNewFolder as CreateNewFolderIcon,
  Add as AddIcon,
  Search as SearchIcon,
  Clear as ClearIcon,
  Star as StarIcon,
  AccessTime as RecentIcon,
  ViewList as ViewListIcon,
  ViewCompact as ViewCompactIcon,
} from '@mui/icons-material';
import { useConnectionsStore, Folder } from '../../store/connectionsStore';
import { useTabsStore } from '../../store/tabsStore';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { ConnectionData, deleteConnection, updateConnection } from '../../api/connections.api';
import { deleteFolder } from '../../api/folders.api';
import { getRecentConnectionIds } from '../../utils/recentConnections';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  useSensor,
  useSensors,
  PointerSensor,
  useDroppable,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import {
  getErrorMessage, matchesSearch, buildFolderTree, pruneFolderTree,
  collectFolderConnections, folderHasSubfolders,
  ConnectionItem, FolderItem,
} from './treeHelpers';
import TeamConnectionSection from './TeamConnectionSection';

// --- ConnectionTree ---

interface ConnectionTreeProps {
  onEditConnection: (conn: ConnectionData) => void;
  onShareConnection: (conn: ConnectionData) => void;
  onConnectAsConnection: (conn: ConnectionData) => void;
  onCreateConnection: (folderId?: string, teamId?: string) => void;
  onCreateFolder: (parentId?: string, teamId?: string) => void;
  onEditFolder: (folder: Folder) => void;
  onShareFolder: (folderId: string, folderName: string) => void;
}

export default function ConnectionTree({ onEditConnection, onShareConnection, onConnectAsConnection, onCreateConnection, onCreateFolder, onEditFolder, onShareFolder }: ConnectionTreeProps) {
  const ownConnections = useConnectionsStore((s) => s.ownConnections);
  const sharedConnections = useConnectionsStore((s) => s.sharedConnections);
  const teamConnections = useConnectionsStore((s) => s.teamConnections);
  const folders = useConnectionsStore((s) => s.folders);
  const teamFolders = useConnectionsStore((s) => s.teamFolders);
  const fetchConnections = useConnectionsStore((s) => s.fetchConnections);
  const toggleFav = useConnectionsStore((s) => s.toggleFavorite);
  const moveConn = useConnectionsStore((s) => s.moveConnection);
  const userId = useAuthStore((s) => s.user?.id);
  const recentTick = useTabsStore((s) => s.recentTick);
  const notify = useNotificationStore((s) => s.notify);

  // Persisted sidebar preferences
  const favoritesOpen = useUiPreferencesStore((s) => s.sidebarFavoritesOpen);
  const recentsOpen = useUiPreferencesStore((s) => s.sidebarRecentsOpen);
  const sharedOpen = useUiPreferencesStore((s) => s.sidebarSharedOpen);
  const compact = useUiPreferencesStore((s) => s.sidebarCompact);
  const togglePref = useUiPreferencesStore((s) => s.toggle);

  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ConnectionData | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<Folder | null>(null);
  const [moveTarget, setMoveTarget] = useState<ConnectionData | null>(null);
  const [moveDestination, setMoveDestination] = useState('');

  // --- Drag and drop ---
  const [activeConnection, setActiveConnection] = useState<ConnectionData | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const { setNodeRef: rootDropRef, isOver: isOverRoot } = useDroppable({
    id: 'root-drop-zone',
    data: { type: 'root', folderId: null },
  });

  const handleDragStart = (event: DragStartEvent) => {
    const conn = event.active.data.current?.connection as ConnectionData | undefined;
    if (conn) setActiveConnection(conn);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveConnection(null);
    const { active, over } = event;
    if (!over) return;

    const connection = active.data.current?.connection as ConnectionData | undefined;
    if (!connection) return;

    const targetFolderId = (over.data.current?.folderId as string | null) ?? null;
    if (targetFolderId === (connection.folderId ?? null)) return;

    try {
      await moveConn(connection.id, targetFolderId);
    } catch (err) {
      notify(getErrorMessage(err, 'Failed to move connection'));
    }
  };

  const handleToggleFavorite = async (conn: ConnectionData) => {
    await toggleFav(conn.id);
  };

  const handleOpenMoveDialog = (conn: ConnectionData) => {
    setMoveTarget(conn);
    setMoveDestination(conn.folderId || '');
  };

  const handleConfirmMove = async () => {
    if (!moveTarget) return;
    const newFolderId = moveDestination || null;
    if (newFolderId === moveTarget.folderId) {
      setMoveTarget(null);
      return;
    }
    try {
      await updateConnection(moveTarget.id, { folderId: newFolderId });
      await fetchConnections();
    } catch (err) {
      notify(getErrorMessage(err, 'Failed to move connection'));
    }
    setMoveTarget(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteConnection(deleteTarget.id);
      await fetchConnections();
    } catch (err) {
      notify(getErrorMessage(err, 'Failed to delete connection'));
    }
    setDeleteTarget(null);
  };

  // --- Bulk Open ---
  const openTab = useTabsStore((s) => s.openTab);
  const [bulkOpenTarget, setBulkOpenTarget] = useState<{ folderId: string; connections: ConnectionData[] } | null>(null);
  const [bulkOpenSubfolderPrompt, setBulkOpenSubfolderPrompt] = useState<{
    folderId: string;
    thisOnly: number;
    withSubs: number;
  } | null>(null);

  const handleBulkOpen = (folderId: string) => {
    const directConns = collectFolderConnections(folderId, filteredFolderMap, folders, false);
    const hasSubs = folderHasSubfolders(folderId, folders);

    if (hasSubs) {
      const allConns = collectFolderConnections(folderId, filteredFolderMap, folders, true);
      setBulkOpenSubfolderPrompt({
        folderId,
        thisOnly: directConns.length,
        withSubs: allConns.length,
      });
    } else if (directConns.length > 5) {
      setBulkOpenTarget({ folderId, connections: directConns });
    } else {
      directConns.forEach((conn) => bulkOpenOne(conn));
    }
  };

  const bulkOpenOne = (conn: ConnectionData) => {
    if (conn.defaultCredentialMode === 'domain') {
      openTab(conn, { username: '', password: '', credentialMode: 'domain' });
    } else {
      openTab(conn);
    }
  };

  const handleBulkOpenChoice = (recursive: boolean) => {
    if (!bulkOpenSubfolderPrompt) return;
    const conns = collectFolderConnections(
      bulkOpenSubfolderPrompt.folderId, filteredFolderMap, folders, recursive
    );
    setBulkOpenSubfolderPrompt(null);
    if (conns.length > 5) {
      setBulkOpenTarget({ folderId: bulkOpenSubfolderPrompt.folderId, connections: conns });
    } else {
      conns.forEach((conn) => bulkOpenOne(conn));
    }
  };

  const handleConfirmBulkOpen = () => {
    if (!bulkOpenTarget) return;
    bulkOpenTarget.connections.forEach((conn) => bulkOpenOne(conn));
    setBulkOpenTarget(null);
  };

  const handleConfirmDeleteFolder = async () => {
    if (!deleteFolderTarget) return;
    try {
      await deleteFolder(deleteFolderTarget.id);
      await fetchConnections();
    } catch (err) {
      notify(getErrorMessage(err, 'Failed to delete folder'));
    }
    setDeleteFolderTarget(null);
  };

  // Filter and group connections by folder
  const { filteredRootConnections, filteredFolderMap, filteredFolderTree, filteredSharedConnections } = useMemo(() => {
    const isSearching = searchQuery.trim().length > 0;
    const filteredOwn = isSearching ? ownConnections.filter((c) => matchesSearch(c, searchQuery)) : ownConnections;
    const filteredShared = isSearching ? sharedConnections.filter((c) => matchesSearch(c, searchQuery)) : sharedConnections;

    const rootConns = filteredOwn.filter((c) => !c.folderId);
    const fMap = new Map<string, ConnectionData[]>();
    filteredOwn.forEach((c) => {
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
      filteredSharedConnections: filteredShared,
    };
  }, [ownConnections, sharedConnections, folders, searchQuery]);

  const favoriteConnections = useMemo(() => {
    return ownConnections.filter((c) => c.isFavorite);
  }, [ownConnections]);

  const recentConnections = useMemo(() => {
    if (!userId) return [];
    const recentIds = getRecentConnectionIds(userId);
    const allConnections = [...ownConnections, ...sharedConnections];
    const connectionMap = new Map(allConnections.map((c) => [c.id, c]));
    return recentIds
      .map((id) => connectionMap.get(id))
      .filter((c): c is ConnectionData => c !== undefined)
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownConnections, sharedConnections, userId, recentTick]);

  // Group team connections/folders by teamId
  const teamGroups = useMemo(() => {
    const groups = new Map<string, {
      teamId: string;
      teamName: string;
      teamRole: string;
      connections: ConnectionData[];
      folders: Folder[];
    }>();

    for (const conn of teamConnections) {
      if (!conn.teamId) continue;
      if (!groups.has(conn.teamId)) {
        groups.set(conn.teamId, {
          teamId: conn.teamId,
          teamName: conn.teamName || 'Unknown Team',
          teamRole: conn.teamRole || 'TEAM_VIEWER',
          connections: [],
          folders: [],
        });
      }
      groups.get(conn.teamId)!.connections.push(conn);
    }

    for (const folder of teamFolders) {
      if (!folder.teamId) continue;
      const group = groups.get(folder.teamId);
      if (group) {
        group.folders.push(folder);
      } else {
        groups.set(folder.teamId, {
          teamId: folder.teamId,
          teamName: folder.teamName || 'Unknown Team',
          teamRole: 'TEAM_VIEWER',
          connections: [],
          folders: [folder],
        });
      }
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.teamName.localeCompare(b.teamName)
    );
  }, [teamConnections, teamFolders]);

  const isSearching = searchQuery.trim().length > 0;
  const isDndEnabled = !isSearching;

  return (
    <Box sx={{ py: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, mb: 1 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          My Connections
        </Typography>
        <IconButton size="small" onClick={() => togglePref('sidebarCompact')} title={compact ? 'Normal view' : 'Compact view'}>
          {compact ? <ViewListIcon fontSize="small" /> : <ViewCompactIcon fontSize="small" />}
        </IconButton>
        <IconButton size="small" onClick={() => onCreateConnection()} title="New Connection">
          <AddIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={() => onCreateFolder()} title="New Folder">
          <CreateNewFolderIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ px: 2, mb: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search connections..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setSearchQuery(''); }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
              endAdornment: searchQuery ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setSearchQuery('')} edge="end">
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            },
          }}
        />
      </Box>

      {/* Favorites section */}
      {!isSearching && favoriteConnections.length > 0 && (
        <>
          <Box
            sx={{ display: 'flex', alignItems: 'center', px: 2, mt: 1, mb: 0.5, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => togglePref('sidebarFavoritesOpen')}
          >
            {favoritesOpen ? <ExpandMore sx={{ fontSize: 18, mr: 0.5 }} /> : <ChevronRight sx={{ fontSize: 18, mr: 0.5 }} />}
            <StarIcon fontSize="small" color="warning" sx={{ mr: 1 }} />
            <Typography variant="subtitle2">Favorites</Typography>
          </Box>
          <Collapse in={favoritesOpen}>
            <List disablePadding>
              {favoriteConnections.map((conn) => (
                <ConnectionItem
                  key={`fav-${conn.id}`}
                  conn={conn}
                  depth={0}
                  compact={compact}
                  onEdit={onEditConnection}
                  onDelete={setDeleteTarget}
                  onMove={handleOpenMoveDialog}
                  onShare={onShareConnection}
                  onConnectAs={onConnectAsConnection}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </List>
          </Collapse>
        </>
      )}

      {/* Recent section */}
      {!isSearching && recentConnections.length > 0 && (
        <>
          <Box
            sx={{ display: 'flex', alignItems: 'center', px: 2, mt: 1, mb: 0.5, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => togglePref('sidebarRecentsOpen')}
          >
            {recentsOpen ? <ExpandMore sx={{ fontSize: 18, mr: 0.5 }} /> : <ChevronRight sx={{ fontSize: 18, mr: 0.5 }} />}
            <RecentIcon fontSize="small" sx={{ mr: 1 }} />
            <Typography variant="subtitle2">Recent</Typography>
          </Box>
          <Collapse in={recentsOpen}>
            <List disablePadding>
              {recentConnections.map((conn) => (
                <ConnectionItem
                  key={`recent-${conn.id}`}
                  conn={conn}
                  depth={0}
                  compact={compact}
                  onEdit={onEditConnection}
                  onDelete={setDeleteTarget}
                  onMove={handleOpenMoveDialog}
                  onShare={onShareConnection}
                  onConnectAs={onConnectAsConnection}
                  onToggleFavorite={conn.isOwner ? handleToggleFavorite : undefined}
                />
              ))}
            </List>
          </Collapse>
        </>
      )}

      {/* Divider between quick-access sections and main tree */}
      {!isSearching && (favoriteConnections.length > 0 || recentConnections.length > 0) && (
        <Divider sx={{ my: 1 }} />
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <Box
          ref={rootDropRef}
          sx={{
            ...(isOverRoot && {
              bgcolor: 'action.hover',
              transition: 'background-color 0.15s ease',
            }),
            minHeight: 40,
          }}
        >
          <List disablePadding>
            {filteredFolderTree.map((node) => (
              <FolderItem
                key={node.folder.id}
                node={node}
                connections={filteredFolderMap.get(node.folder.id) || []}
                folderMap={filteredFolderMap}
                depth={0}
                compact={compact}
                isDndEnabled={isDndEnabled}
                onEditConnection={onEditConnection}
                onDeleteConnection={setDeleteTarget}
                onMoveConnection={handleOpenMoveDialog}
                onShareConnection={onShareConnection}
                onConnectAsConnection={onConnectAsConnection}
                onToggleFavorite={handleToggleFavorite}
                onCreateConnection={onCreateConnection}
                onCreateFolder={onCreateFolder}
                onEditFolder={onEditFolder}
                onDeleteFolder={setDeleteFolderTarget}
                onBulkOpen={handleBulkOpen}
                onShareFolder={onShareFolder}
              />
            ))}
            {filteredRootConnections.map((conn) => (
              <ConnectionItem
                key={conn.id}
                conn={conn}
                depth={0}
                compact={compact}
                draggable={isDndEnabled && conn.isOwner}
                onEdit={onEditConnection}
                onDelete={setDeleteTarget}
                onMove={handleOpenMoveDialog}
                onShare={onShareConnection}
                onConnectAs={onConnectAsConnection}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </List>
          {isOverRoot && (
            <Box sx={{ height: 2, bgcolor: 'primary.main', mx: 2, borderRadius: 1 }} />
          )}
        </Box>

        <DragOverlay dropAnimation={null}>
          {activeConnection && (
            <Box sx={{
              bgcolor: 'background.paper',
              boxShadow: 3,
              borderRadius: 1,
              px: 2,
              py: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              opacity: 0.9,
              pointerEvents: 'none',
              maxWidth: 220,
            }}>
              {activeConnection.type === 'RDP'
                ? <RdpIcon fontSize="small" color="primary" />
                : <SshIcon fontSize="small" color="secondary" />}
              <Typography variant="body2" noWrap>{activeConnection.name}</Typography>
            </Box>
          )}
        </DragOverlay>
      </DndContext>

      {/* Team sections */}
      {teamGroups.length > 0 && <Divider sx={{ my: 1 }} />}
      {teamGroups.map((group) => (
        <TeamConnectionSection
          key={group.teamId}
          teamId={group.teamId}
          teamName={group.teamName}
          teamRole={group.teamRole}
          connections={group.connections}
          folders={group.folders}
          compact={compact}
          searchQuery={searchQuery}
          onEditConnection={onEditConnection}
          onDeleteConnection={setDeleteTarget}
          onMoveConnection={handleOpenMoveDialog}
          onShareConnection={onShareConnection}
          onConnectAsConnection={onConnectAsConnection}
          onToggleFavorite={handleToggleFavorite}
          onCreateConnection={onCreateConnection}
          onCreateFolder={onCreateFolder}
          onEditFolder={onEditFolder}
          onDeleteFolder={setDeleteFolderTarget}
          onBulkOpen={handleBulkOpen}
          onShareFolder={onShareFolder}
        />
      ))}

      {searchQuery.trim() && filteredRootConnections.length === 0 && filteredFolderTree.length === 0 && filteredSharedConnections.length === 0 && teamGroups.every((g) => {
        const filtered = g.connections.filter((c) => matchesSearch(c, searchQuery));
        return filtered.length === 0;
      }) && (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2, textAlign: 'center' }}>
          No connections match your search.
        </Typography>
      )}

      {/* Shared with me section */}
      {filteredSharedConnections.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Box
            sx={{ display: 'flex', alignItems: 'center', px: 2, mt: 1, mb: 0.5, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => togglePref('sidebarSharedOpen')}
          >
            {sharedOpen ? <ExpandMore sx={{ fontSize: 18, mr: 0.5 }} /> : <ChevronRight sx={{ fontSize: 18, mr: 0.5 }} />}
            <ShareIcon fontSize="small" sx={{ mr: 1 }} />
            <Typography variant="subtitle2">Shared with me</Typography>
          </Box>
          <Collapse in={sharedOpen}>
            <List disablePadding>
              {filteredSharedConnections.map((conn) => (
                <ConnectionItem
                  key={conn.id}
                  conn={conn}
                  depth={0}
                  compact={compact}
                  onEdit={onEditConnection}
                  onDelete={setDeleteTarget}
                  onMove={handleOpenMoveDialog}
                  onShare={onShareConnection}
                  onConnectAs={onConnectAsConnection}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </List>
          </Collapse>
        </>
      )}

      {/* Move to Folder dialog */}
      <Dialog open={moveTarget !== null} onClose={() => setMoveTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Move &quot;{moveTarget?.name}&quot;</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Destination Folder</InputLabel>
            <Select
              value={moveDestination}
              label="Destination Folder"
              onChange={(e: SelectChangeEvent) => setMoveDestination(e.target.value)}
            >
              <MenuItem value="">Root (no folder)</MenuItem>
              {folders.map((f) => (
                <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveTarget(null)}>Cancel</Button>
          <Button onClick={handleConfirmMove} variant="contained">Move</Button>
        </DialogActions>
      </Dialog>

      {/* Delete connection confirmation */}
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

      {/* Delete folder confirmation */}
      <Dialog open={deleteFolderTarget !== null} onClose={() => setDeleteFolderTarget(null)}>
        <DialogTitle>Delete Folder</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete &quot;{deleteFolderTarget?.name}&quot;?
            Connections in this folder will be moved to the root level.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteFolderTarget(null)}>Cancel</Button>
          <Button onClick={handleConfirmDeleteFolder} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* Bulk open: subfolder prompt */}
      <Dialog open={bulkOpenSubfolderPrompt !== null} onClose={() => setBulkOpenSubfolderPrompt(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Open All Connections</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This folder contains subfolders. Which connections would you like to open?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkOpenSubfolderPrompt(null)}>Cancel</Button>
          <Button onClick={() => handleBulkOpenChoice(false)}>
            This folder only ({bulkOpenSubfolderPrompt?.thisOnly ?? 0})
          </Button>
          <Button onClick={() => handleBulkOpenChoice(true)} variant="contained">
            Include subfolders ({bulkOpenSubfolderPrompt?.withSubs ?? 0})
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk open: confirmation for >5 connections */}
      <Dialog open={bulkOpenTarget !== null} onClose={() => setBulkOpenTarget(null)}>
        <DialogTitle>Open {bulkOpenTarget?.connections.length} Connections?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will create {bulkOpenTarget?.connections.length} new tabs. Continue?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkOpenTarget(null)}>Cancel</Button>
          <Button onClick={handleConfirmBulkOpen} variant="contained">Open All</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
