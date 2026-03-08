import { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, CardActions, Button, Stack, Chip, Avatar,
  Grid, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  Alert, CircularProgress, Select, MenuItem, FormControl, InputLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Divider, Typography, IconButton,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Groups as GroupsIcon,
} from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { useTeamStore } from '../../store/teamStore';
import TeamDialog from '../Dialogs/TeamDialog';
import UserPicker from '../UserPicker';
import type { UserSearchResult } from '../../api/user.api';
import type { TeamData } from '../../api/team.api';

const TEAM_ROLES = ['TEAM_ADMIN', 'TEAM_EDITOR', 'TEAM_VIEWER'] as const;

function roleLabel(role: string) {
  return role.replace('TEAM_', '');
}

interface TeamSectionProps {
  onNavigateToTab?: (tabId: string) => void;
}

export default function TeamSection({ onNavigateToTab }: TeamSectionProps) {
  const user = useAuthStore((s) => s.user);
  const teams = useTeamStore((s) => s.teams);
  const loading = useTeamStore((s) => s.loading);
  const selectedTeam = useTeamStore((s) => s.selectedTeam);
  const members = useTeamStore((s) => s.members);
  const membersLoading = useTeamStore((s) => s.membersLoading);
  const fetchTeams = useTeamStore((s) => s.fetchTeams);
  const selectTeam = useTeamStore((s) => s.selectTeam);
  const clearSelectedTeam = useTeamStore((s) => s.clearSelectedTeam);
  const deleteTeam = useTeamStore((s) => s.deleteTeam);
  const addMember = useTeamStore((s) => s.addMember);
  const updateMemberRole = useTeamStore((s) => s.updateMemberRole);
  const removeMember = useTeamStore((s) => s.removeMember);

  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TeamData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ teamId: string; userId: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [addMemberRole, setAddMemberRole] = useState<'TEAM_ADMIN' | 'TEAM_EDITOR' | 'TEAM_VIEWER'>('TEAM_VIEWER');
  const [addingMember, setAddingMember] = useState(false);

  const hasTenant = Boolean(user?.tenantId);

  useEffect(() => {
    if (hasTenant) {
      fetchTeams();
    }
  }, [fetchTeams, hasTenant]);

  const handleSelectTeam = (team: TeamData) => {
    selectTeam(team.id);
  };

  const handleEditTeam = (team: TeamData) => {
    setEditingTeam(team);
    setTeamDialogOpen(true);
  };

  const handleDeleteTeam = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      await deleteTeam(deleteTarget.id);
      if (selectedTeam?.id === deleteTarget.id) {
        clearSelectedTeam();
      }
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to delete team'
      );
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleAddMember = async (selectedUser: UserSearchResult | null) => {
    if (!selectedUser || !selectedTeam) return;
    setAddingMember(true);
    setError('');
    try {
      await addMember(selectedTeam.id, selectedUser.id, addMemberRole);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to add member'
      );
    } finally {
      setAddingMember(false);
    }
  };

  const handleRoleChange = async (teamId: string, userId: string, newRole: string) => {
    setError('');
    try {
      await updateMemberRole(teamId, userId, newRole as 'TEAM_ADMIN' | 'TEAM_EDITOR' | 'TEAM_VIEWER');
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to update role'
      );
    }
  };

  const handleRemoveMember = async () => {
    if (!removeTarget) return;
    setError('');
    try {
      await removeMember(removeTarget.teamId, removeTarget.userId);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to remove member'
      );
    }
    setRemoveTarget(null);
  };

  if (!hasTenant) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography variant="h6" gutterBottom>No Organization</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          You need to create or join an organization before managing teams.
        </Typography>
        <Button variant="contained" onClick={() => onNavigateToTab?.('organization')}>
          Set Up Organization
        </Button>
      </Box>
    );
  }

  const isTeamAdmin = selectedTeam?.myRole === 'TEAM_ADMIN';
  const existingMemberIds = members.map((m) => m.userId);

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>Teams</Typography>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => { setEditingTeam(null); setTeamDialogOpen(true); }}
        >
          New Team
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : teams.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <GroupsIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" gutterBottom>No Teams Yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Create your first team to start collaborating.
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => { setEditingTeam(null); setTeamDialogOpen(true); }}
          >
            Create Team
          </Button>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
          {/* Team list */}
          <Box sx={{ width: { xs: '100%', md: 320 }, flexShrink: 0 }}>
            <Grid container spacing={2}>
              {teams.map((team) => (
                <Grid size={12} key={team.id}>
                  <Card
                    sx={{
                      cursor: 'pointer',
                      ...(selectedTeam?.id === team.id && {
                        borderColor: 'primary.main',
                        borderWidth: 2,
                        borderStyle: 'solid',
                      }),
                    }}
                    onClick={() => handleSelectTeam(team)}
                  >
                    <CardContent sx={{ pb: 1 }}>
                      <Typography variant="subtitle1">{team.name}</Typography>
                      {team.description && (
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {team.description}
                        </Typography>
                      )}
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <Chip label={`${team.memberCount} members`} size="small" />
                        <Chip label={roleLabel(team.myRole)} size="small" variant="outlined" />
                      </Stack>
                    </CardContent>
                    {team.myRole === 'TEAM_ADMIN' && (
                      <CardActions sx={{ pt: 0, justifyContent: 'flex-end' }}>
                        <Button size="small" onClick={(e) => { e.stopPropagation(); handleEditTeam(team); }}>
                          Edit
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(team); }}
                        >
                          Delete
                        </Button>
                      </CardActions>
                    )}
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>

          {/* Team detail */}
          {selectedTeam && (
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>{selectedTeam.name}</Typography>
                  {selectedTeam.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      {selectedTeam.description}
                    </Typography>
                  )}

                  <Divider sx={{ my: 2 }} />

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>Members</Typography>
                  </Box>

                  {/* Add member */}
                  {isTeamAdmin && (
                    <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'flex-start' }}>
                      <Box sx={{ flex: 1 }}>
                        <UserPicker
                          onSelect={handleAddMember}
                          scope="tenant"
                          excludeUserIds={existingMemberIds}
                          placeholder="Add member..."
                        />
                      </Box>
                      <FormControl size="small" sx={{ minWidth: 120 }}>
                        <InputLabel>Role</InputLabel>
                        <Select
                          value={addMemberRole}
                          label="Role"
                          onChange={(e) => setAddMemberRole(e.target.value as typeof addMemberRole)}
                        >
                          {TEAM_ROLES.map((r) => (
                            <MenuItem key={r} value={r}>{roleLabel(r)}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {addingMember && <CircularProgress size={24} sx={{ mt: 1 }} />}
                    </Box>
                  )}

                  {membersLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                      <CircularProgress size={24} />
                    </Box>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>User</TableCell>
                            <TableCell>Role</TableCell>
                            {isTeamAdmin && <TableCell align="right">Actions</TableCell>}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {members.map((m) => (
                            <TableRow key={m.userId}>
                              <TableCell>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Avatar src={m.avatarData || undefined} sx={{ width: 28, height: 28 }}>
                                    {(m.username || m.email).charAt(0).toUpperCase()}
                                  </Avatar>
                                  <Box>
                                    <Typography variant="body2">
                                      {m.username || m.email}
                                      {m.userId === user?.id && (
                                        <Typography component="span" variant="caption" color="text.secondary"> (you)</Typography>
                                      )}
                                    </Typography>
                                    {m.username && (
                                      <Typography variant="caption" color="text.secondary">{m.email}</Typography>
                                    )}
                                  </Box>
                                </Box>
                              </TableCell>
                              <TableCell>
                                {isTeamAdmin && m.userId !== user?.id ? (
                                  <Select
                                    value={m.role}
                                    size="small"
                                    onChange={(e) => handleRoleChange(selectedTeam.id, m.userId, e.target.value)}
                                    sx={{ minWidth: 110 }}
                                  >
                                    {TEAM_ROLES.map((r) => (
                                      <MenuItem key={r} value={r}>{roleLabel(r)}</MenuItem>
                                    ))}
                                  </Select>
                                ) : (
                                  <Chip label={roleLabel(m.role)} size="small" variant="outlined" />
                                )}
                              </TableCell>
                              {isTeamAdmin && (
                                <TableCell align="right">
                                  {m.userId !== user?.id && (
                                    <IconButton
                                      size="small"
                                      color="error"
                                      onClick={() => setRemoveTarget({
                                        teamId: selectedTeam.id,
                                        userId: m.userId,
                                        name: m.username || m.email,
                                      })}
                                    >
                                      <DeleteIcon fontSize="small" />
                                    </IconButton>
                                  )}
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </CardContent>
              </Card>
            </Box>
          )}
        </Box>
      )}

      <TeamDialog
        open={teamDialogOpen}
        onClose={() => { setTeamDialogOpen(false); setEditingTeam(null); }}
        team={editingTeam}
      />

      {/* Delete team confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Team</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
            Team connections and folders will become unassigned.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={handleDeleteTeam} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Remove member confirmation */}
      <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)}>
        <DialogTitle>Remove Member</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to remove <strong>{removeTarget?.name}</strong> from this team?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(null)}>Cancel</Button>
          <Button onClick={handleRemoveMember} color="error" variant="contained">Remove</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
