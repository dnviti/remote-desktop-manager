import { useState, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Alert,
  Box,
  Stepper,
  Step,
  StepLabel,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
} from '@mui/icons-material';
import { importConnections, type ImportResult, type ImportOptions } from '../../api/importExport.api';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useNotificationStore } from '../../store/notificationStore';

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ConnectionPreview {
  name: string;
  host: string;
  port: number;
  type: string;
  username?: string;
  folder?: string;
}

const STEPS = ['Upload', 'Preview', 'Options', 'Results'];

export default function ImportDialog({ open, onClose }: ImportDialogProps) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<'CSV' | 'JSON' | 'MREMOTENG' | 'RDP' | null>(null);
  const [preview, setPreview] = useState<ConnectionPreview[]>([]);
  const [duplicateStrategy, setDuplicateStrategy] = useState<'SKIP' | 'OVERWRITE' | 'RENAME'>('SKIP');
  const { loading, error, setError, clearError, run } = useAsyncAction();
  const [result, setResult] = useState<ImportResult | null>(null);
  const notify = useNotificationStore((s) => s.notify);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    const detectedFormat = detectFormat(selected.name);
    if (!detectedFormat) {
      setError('Unsupported file format. Please upload CSV, JSON, XML (mRemoteNG), or RDP files.');
      return;
    }

    setFile(selected);
    setFormat(detectedFormat);
    clearError();
    parseFilePreview(selected, detectedFormat);
  };

  const detectFormat = (filename: string): 'CSV' | 'JSON' | 'MREMOTENG' | 'RDP' | null => {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.csv')) return 'CSV';
    if (lower.endsWith('.json')) return 'JSON';
    if (lower.endsWith('.xml')) return 'MREMOTENG';
    if (lower.endsWith('.rdp')) return 'RDP';
    return null;
  };

  const parseFilePreview = async (file: File, fileFormat: string) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        if (fileFormat === 'JSON') {
          const data = JSON.parse(content);
          const connections = Array.isArray(data) ? data : data.connections || [];
          setPreview(connections.slice(0, 5).map((c: Record<string, unknown>) => ({
            name: String(c.name || 'Unnamed'),
            host: String(c.host || ''),
            port: Number(c.port || 22),
            type: String(c.type || 'SSH'),
            username: c.username as string | undefined,
            folder: c.folderName as string | undefined,
          })));
        } else if (fileFormat === 'CSV') {
          const lines = content.split(/\r?\n/).filter(l => l.trim());
          if (lines.length > 1) {
            const sampleRows = lines.slice(1, 6);
            setPreview(sampleRows.map(row => {
              const values = row.split(',');
              return {
                name: values[0] || 'Unnamed',
                host: values[1] || '',
                port: parseInt(values[2] || '22', 10),
                type: values[3] || 'SSH',
              };
            }));
          }
        } else if (fileFormat === 'RDP') {
          const fullAddressMatch = content.match(/full address:s:(.+)/);
          const hostname = fullAddressMatch ? fullAddressMatch[1].trim() : 'Unknown';
          setPreview([{ name: hostname, host: hostname, port: 3389, type: 'RDP' }]);
        } else {
          setPreview([{ name: 'mRemoteNG import', host: 'Multiple', port: 0, type: 'Mixed' }]);
        }
        setStep(1);
      } catch {
        setError('Failed to parse file. Please check the format.');
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!file) return;

    await run(async () => {
      const options: ImportOptions = {
        duplicateStrategy,
        format: format || undefined,
      };

      const res = await importConnections(file, options);
      setResult(res);
      setStep(3);
      notify(`Import complete: ${res.imported} imported, ${res.skipped} skipped, ${res.failed} failed`, 'success');
    }, 'Import failed');
  };

  const handleClose = () => {
    setStep(0);
    setFile(null);
    setFormat(null);
    setPreview([]);
    setResult(null);
    clearError();
    onClose();
  };

  const handleNext = () => {
    if (step === 1 && format === 'CSV') {
      setStep(2);
    } else if (step === 1) {
      setStep(2);
    } else if (step === 2) {
      handleImport();
    }
  };

  const handleBack = () => {
    setStep((prev) => prev - 1);
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Import Connections</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {step === 0 && (
          <Box
            sx={{
              border: 2,
              borderStyle: 'dashed',
              borderColor: 'divider',
              p: 4,
              textAlign: 'center',
              cursor: 'pointer',
              '&:hover': { borderColor: 'primary.main' },
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,.xml,.rdp"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <UploadIcon sx={{ fontSize: 64, mb: 2, color: 'text.secondary' }} />
            <Typography variant="h6">Drag & drop or click to browse</Typography>
            <Typography variant="caption" color="text.secondary">
              Supported: CSV, JSON, mRemoteNG XML, RDP
            </Typography>
          </Box>
        )}

        {step === 1 && (
          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Preview
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Detected format: {format}
            </Typography>
            {preview.length > 0 && (
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Host</TableCell>
                      <TableCell>Port</TableCell>
                      <TableCell>Type</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.map((conn, i) => (
                      <TableRow key={i}>
                        <TableCell>{conn.name}</TableCell>
                        <TableCell>{conn.host}</TableCell>
                        <TableCell>{conn.port}</TableCell>
                        <TableCell>{conn.type}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            {preview.length === 0 && format === 'RDP' && (
              <Typography variant="body2">Single RDP connection detected</Typography>
            )}
          </Box>
        )}

        {step === 2 && (
          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Import Options
            </Typography>

            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel>Duplicate Handling</InputLabel>
              <Select
                value={duplicateStrategy}
                label="Duplicate Handling"
                onChange={(e) => setDuplicateStrategy(e.target.value as 'SKIP' | 'OVERWRITE' | 'RENAME')}
              >
                <MenuItem value="SKIP">Skip duplicates (keep existing)</MenuItem>
                <MenuItem value="OVERWRITE">Overwrite existing connections</MenuItem>
                <MenuItem value="RENAME">Rename new connections (add suffix)</MenuItem>
              </Select>
            </FormControl>

            <Alert severity="info">
              {preview.length} connection(s) will be imported. Folders will be created automatically.
            </Alert>
          </Box>
        )}

        {step === 3 && result && (
          <Box>
            {loading ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <CircularProgress />
                <Typography sx={{ mt: 2 }}>Importing connections...</Typography>
              </Box>
            ) : (
              <>
                <Typography variant="body1" sx={{ mb: 2 }}>
                  {result.imported} imported, {result.skipped} skipped, {result.failed} failed
                </Typography>
                {result.errors.length > 0 && (
                  <TableContainer component={Paper}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Row</TableCell>
                          <TableCell>Error</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {result.errors.slice(0, 10).map((err, i) => (
                          <TableRow key={i}>
                            <TableCell>{err.row || 'N/A'}</TableCell>
                            <TableCell>{err.error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {step > 0 && step < 3 && (
          <Button onClick={handleBack} disabled={loading}>
            Back
          </Button>
        )}
        {step === 0 && (
          <Button onClick={handleClose}>Cancel</Button>
        )}
        {step === 1 && (
          <Button onClick={handleNext} variant="contained">
            Next
          </Button>
        )}
        {step === 2 && (
          <Button onClick={handleNext} variant="contained" disabled={loading}>
            {loading ? 'Importing...' : 'Import'}
          </Button>
        )}
        {step === 3 && (
          <Button onClick={handleClose} variant="contained">
            Close
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
