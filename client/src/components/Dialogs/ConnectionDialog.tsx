import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, Box, Alert,
} from '@mui/material';
import { createConnection, updateConnection, ConnectionInput, ConnectionData } from '../../api/connections.api';
import { useConnectionsStore } from '../../store/connectionsStore';

interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  connection?: ConnectionData | null;
}

export default function ConnectionDialog({ open, onClose, connection }: ConnectionDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'SSH' | 'RDP'>('SSH');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fetchConnections = useConnectionsStore((s) => s.fetchConnections);

  const isEditMode = Boolean(connection);

  useEffect(() => {
    if (open && connection) {
      setName(connection.name);
      setType(connection.type);
      setHost(connection.host);
      setPort(String(connection.port));
      setUsername('');
      setPassword('');
      setDescription(connection.description || '');
    } else if (open && !connection) {
      setName('');
      setType('SSH');
      setHost('');
      setPort('22');
      setUsername('');
      setPassword('');
      setDescription('');
    }
  }, [open, connection]);

  const handleTypeChange = (newType: 'SSH' | 'RDP') => {
    setType(newType);
    if (newType === 'SSH' && port === '3389') setPort('22');
    if (newType === 'RDP' && port === '22') setPort('3389');
  };

  const handleSubmit = async () => {
    setError('');
    if (!name || !host) {
      setError('Name and host are required');
      return;
    }
    if (!isEditMode && !username) {
      setError('Username is required for new connections');
      return;
    }

    setLoading(true);
    try {
      if (isEditMode && connection) {
        const data: Partial<ConnectionInput> = {
          name,
          type,
          host,
          port: parseInt(port, 10),
          description: description || undefined,
        };
        if (username) data.username = username;
        if (password) data.password = password;
        await updateConnection(connection.id, data);
      } else {
        const data: ConnectionInput = {
          name,
          type,
          host,
          port: parseInt(port, 10),
          username,
          password,
          description: description || undefined,
        };
        await createConnection(data);
      }
      await fetchConnections();
      handleClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (isEditMode ? 'Failed to update connection' : 'Failed to create connection');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setType('SSH');
    setHost('');
    setPort('22');
    setUsername('');
    setPassword('');
    setDescription('');
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditMode ? 'Edit Connection' : 'New Connection'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
          <FormControl fullWidth>
            <InputLabel>Type</InputLabel>
            <Select
              value={type}
              label="Type"
              onChange={(e) => handleTypeChange(e.target.value as 'SSH' | 'RDP')}
              disabled={isEditMode}
            >
              <MenuItem value="SSH">SSH</MenuItem>
              <MenuItem value="RDP">RDP</MenuItem>
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              type="number"
              sx={{ width: 120 }}
            />
          </Box>
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            fullWidth
            required={!isEditMode}
            placeholder={isEditMode ? 'Leave blank to keep unchanged' : undefined}
          />
          <TextField
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            fullWidth
            placeholder={isEditMode ? 'Leave blank to keep unchanged' : undefined}
          />
          <TextField
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          {loading
            ? (isEditMode ? 'Saving...' : 'Creating...')
            : (isEditMode ? 'Save' : 'Create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
