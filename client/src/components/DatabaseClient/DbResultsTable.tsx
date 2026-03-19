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
} from '@mui/material';

interface DbResultsTableProps {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  maxHeight?: number | string;
}

export default function DbResultsTable({
  columns,
  rows,
  rowCount,
  durationMs,
  maxHeight = 400,
}: DbResultsTableProps) {
  const displayRows = useMemo(() => rows.slice(0, 1000), [rows]);

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
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ px: 1, py: 0.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          {rowCount} row(s) returned in {durationMs}ms
          {rows.length > 1000 && ` (showing first 1000)`}
        </Typography>
      </Box>
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ flex: 1, maxHeight, overflow: 'auto' }}
      >
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  bgcolor: 'background.paper',
                  fontWeight: 'bold',
                  borderRight: 1,
                  borderColor: 'divider',
                  width: 48,
                  minWidth: 48,
                  position: 'sticky',
                  left: 0,
                  zIndex: 3,
                }}
              >
                #
              </TableCell>
              {columns.map((col) => (
                <TableCell
                  key={col}
                  sx={{
                    bgcolor: 'background.paper',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {displayRows.map((row, idx) => (
              <TableRow key={idx} hover>
                <TableCell
                  sx={{
                    borderRight: 1,
                    borderColor: 'divider',
                    color: 'text.secondary',
                    position: 'sticky',
                    left: 0,
                    bgcolor: 'background.paper',
                    zIndex: 1,
                  }}
                >
                  {idx + 1}
                </TableCell>
                {columns.map((col) => (
                  <TableCell key={col} sx={{ whiteSpace: 'nowrap', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {formatCellValue(row[col])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
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
