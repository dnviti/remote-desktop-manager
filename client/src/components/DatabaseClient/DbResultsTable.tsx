import { useMemo } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Paper,
  useTheme,
} from '@mui/material';

interface DbResultsTableProps {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  truncated?: boolean;
}

export default function DbResultsTable({
  columns,
  rows,
  rowCount,
  durationMs,
  truncated,
}: DbResultsTableProps) {
  const displayRows = useMemo(() => rows.slice(0, 1000), [rows]);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const headerBg = isDark
    ? theme.palette.primary.dark
    : theme.palette.primary.main;
  const headerColor = theme.palette.primary.contrastText;
  // Solid opaque backgrounds — critical for sticky column to not show through
  const paperBg = theme.palette.background.paper;
  const stripeBg = isDark ? '#1e1e1e' : '#f8f8f8';
  const rowNumEvenBg = isDark ? '#252525' : '#f0f0f0';
  const rowNumOddBg = isDark ? '#2a2a2a' : '#eaeaea';
  const nullColor = theme.palette.text.disabled;

  if (columns.length === 0 && rows.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Query executed successfully. {rowCount} row(s) affected in {durationMs}ms.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', p: 1.5 }}>
      <Box sx={{ px: 0.5, py: 0.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          {rowCount} row(s) returned in {durationMs}ms
          {truncated && ' (results truncated by server limit)'}
          {rows.length > 1000 && ' (showing first 1000)'}
        </Typography>
      </Box>
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ flex: 1, overflow: 'auto', minHeight: 0, borderRadius: 1 }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  bgcolor: headerBg,
                  color: headerColor,
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  letterSpacing: '0.02em',
                  borderRight: 1,
                  borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
                  borderBottom: 'none',
                  width: 48,
                  minWidth: 48,
                  position: 'sticky',
                  left: 0,
                  zIndex: 3,
                  py: 0.75,
                }}
              >
                #
              </TableCell>
              {columns.map((col) => (
                <TableCell
                  key={col}
                  sx={{
                    bgcolor: headerBg,
                    color: headerColor,
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    letterSpacing: '0.02em',
                    whiteSpace: 'nowrap',
                    borderBottom: 'none',
                    py: 0.75,
                  }}
                >
                  {col}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {displayRows.map((row, idx) => {
              const isOdd = idx % 2 === 1;
              return (
                <TableRow
                  key={idx}
                  hover
                  sx={{
                    bgcolor: isOdd ? stripeBg : paperBg,
                    '&:last-of-type td': { borderBottom: 0 },
                  }}
                >
                  <TableCell
                    sx={{
                      borderRight: 1,
                      borderColor: 'divider',
                      color: 'text.secondary',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                      position: 'sticky',
                      left: 0,
                      bgcolor: isOdd ? rowNumOddBg : rowNumEvenBg,
                      zIndex: 1,
                      py: 0.5,
                    }}
                  >
                    {idx + 1}
                  </TableCell>
                  {columns.map((col) => {
                    const val = row[col];
                    const isNull = val === null || val === undefined;
                    return (
                      <TableCell
                        key={col}
                        sx={{
                          whiteSpace: 'nowrap',
                          maxWidth: 300,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontSize: '0.8rem',
                          py: 0.5,
                          ...(isNull && {
                            color: nullColor,
                            fontStyle: 'italic',
                          }),
                        }}
                      >
                        {formatCellValue(val)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
