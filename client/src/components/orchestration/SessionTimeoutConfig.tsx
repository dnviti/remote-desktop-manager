import { TextField } from '@mui/material';

interface SessionTimeoutConfigProps {
  value: string;
  onChange: (value: string) => void;
}

export default function SessionTimeoutConfig({ value, onChange }: SessionTimeoutConfigProps) {
  return (
    <TextField
      label="Session Inactivity Timeout (minutes)"
      type="number"
      size="small"
      fullWidth
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputProps={{ min: 1, max: 1440 }}
      helperText="Idle sessions will be automatically closed after this period (1-1440 minutes)"
    />
  );
}
