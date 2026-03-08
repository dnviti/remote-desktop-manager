import { useState, useEffect } from 'react';
import {
  Box, Button, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, Chip, Alert, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon,
  RocketLaunch as DeployIcon, Description as TemplateIcon,
} from '@mui/icons-material';
import { useGatewayStore } from '../../store/gatewayStore';
import type { GatewayTemplateData } from '../../api/gateway.api';
import GatewayTemplateDialog from './GatewayTemplateDialog';

export default function GatewayTemplateSection() {
  const templates = useGatewayStore((s) => s.templates);
  const templatesLoading = useGatewayStore((s) => s.templatesLoading);
  const fetchTemplates = useGatewayStore((s) => s.fetchTemplates);
  const deleteTemplateAction = useGatewayStore((s) => s.deleteTemplate);
  const deployFromTemplateAction = useGatewayStore((s) => s.deployFromTemplate);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<GatewayTemplateData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GatewayTemplateData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleEdit = (tpl: GatewayTemplateData) => {
    setEditingTemplate(tpl);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      await deleteTemplateAction(deleteTarget.id);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to delete template'
      );
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleDeploy = async (tpl: GatewayTemplateData) => {
    setDeployingId(tpl.id);
    setError('');
    setSuccess('');
    try {
      const gateway = await deployFromTemplateAction(tpl.id);
      setSuccess(`Gateway "${gateway.name}" created and deployment started.`);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to deploy from template'
      );
    } finally {
      setDeployingId(null);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>Gateway Templates</Typography>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => { setEditingTemplate(null); setDialogOpen(true); }}
        >
          New Template
        </Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {templatesLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : templates.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <TemplateIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" gutterBottom>No Templates Yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Create a template to quickly deploy pre-configured gateways.
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => { setEditingTemplate(null); setDialogOpen(true); }}
          >
            Create Template
          </Button>
        </Box>
      ) : (
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Host</TableCell>
                <TableCell>Auto-Scale</TableCell>
                <TableCell>Deployed</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {templates.map((tpl) => (
                <TableRow key={tpl.id}>
                  <TableCell>
                    <Typography variant="body2">{tpl.name}</Typography>
                    {tpl.description && (
                      <Typography variant="caption" color="text.secondary">
                        {tpl.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={tpl.type === 'GUACD' ? 'GUACD' : tpl.type === 'MANAGED_SSH' ? 'Managed SSH' : 'SSH Bastion'}
                      size="small"
                      color={tpl.type === 'GUACD' ? 'info' : tpl.type === 'MANAGED_SSH' ? 'success' : 'warning'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{tpl.host}:{tpl.port}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={tpl.autoScale ? 'Enabled' : 'Disabled'}
                      size="small"
                      color={tpl.autoScale ? 'success' : 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{tpl._count.gateways}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      color="primary"
                      onClick={() => handleDeploy(tpl)}
                      disabled={deployingId === tpl.id}
                      title="Deploy from template"
                    >
                      {deployingId === tpl.id ? <CircularProgress size={16} /> : <DeployIcon fontSize="small" />}
                    </IconButton>
                    <IconButton size="small" onClick={() => handleEdit(tpl)} title="Edit">
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => setDeleteTarget(tpl)} title="Delete">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <GatewayTemplateDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingTemplate(null); }}
        template={editingTemplate}
      />

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Template</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete template <strong>{deleteTarget?.name}</strong>?
            Existing gateways created from this template will not be affected.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
