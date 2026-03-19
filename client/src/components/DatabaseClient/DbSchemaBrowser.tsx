import { useState } from 'react';
import {
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  IconButton,
  Tooltip,
  Divider,
} from '@mui/material';
import {
  TableChart as TableIcon,
  ViewColumn as ColumnIcon,
  Key as KeyIcon,
  ExpandLess,
  ExpandMore,
  Refresh as RefreshIcon,
  ChevronLeft as CollapseIcon,
} from '@mui/icons-material';
import type { DbTableInfo } from '../../api/database.api';

interface DbSchemaBrowserProps {
  tables: DbTableInfo[];
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onTableClick?: (tableName: string, schemaName: string) => void;
  loading?: boolean;
}

export default function DbSchemaBrowser({
  tables,
  open,
  onClose,
  onRefresh,
  onTableClick,
  loading = false,
}: DbSchemaBrowserProps) {
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

  if (!open) return null;

  const toggleTable = (tableName: string) => {
    setExpandedTables((prev) => ({ ...prev, [tableName]: !prev[tableName] }));
  };

  // Group tables by schema
  const schemaGroups = tables.reduce<Record<string, DbTableInfo[]>>((acc, table) => {
    const schema = table.schema || 'public';
    if (!acc[schema]) acc[schema] = [];
    acc[schema].push(table);
    return acc;
  }, {});

  return (
    <Box
      sx={{
        width: 260,
        minWidth: 260,
        borderLeft: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Schema
        </Typography>
        <Box>
          <Tooltip title="Refresh schema">
            <IconButton size="small" onClick={onRefresh} disabled={loading}>
              <RefreshIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Close schema browser">
            <IconButton size="small" onClick={onClose}>
              <CollapseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {tables.length === 0 && !loading && (
          <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block' }}>
            No tables found. Connect to a database to browse its schema.
          </Typography>
        )}

        {loading && (
          <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block' }}>
            Loading schema...
          </Typography>
        )}

        {Object.entries(schemaGroups).map(([schemaName, schemaTables]) => (
          <Box key={schemaName}>
            <Typography
              variant="overline"
              sx={{ px: 2, pt: 1, display: 'block', color: 'text.secondary' }}
            >
              {schemaName}
            </Typography>
            <Divider />
            <List dense disablePadding>
              {schemaTables.map((table) => {
                const tableKey = `${schemaName}.${table.name}`;
                const isExpanded = expandedTables[tableKey] ?? false;

                return (
                  <Box key={tableKey}>
                    <ListItemButton
                      onClick={() => toggleTable(tableKey)}
                      onDoubleClick={() => onTableClick?.(table.name, schemaName)}
                      sx={{ py: 0.25, pl: 2 }}
                    >
                      <ListItemIcon sx={{ minWidth: 28 }}>
                        <TableIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                      </ListItemIcon>
                      <ListItemText
                        primary={table.name}
                        primaryTypographyProps={{
                          variant: 'body2',
                          noWrap: true,
                          sx: { fontSize: '0.8rem' },
                        }}
                      />
                      {isExpanded ? (
                        <ExpandLess sx={{ fontSize: 16 }} />
                      ) : (
                        <ExpandMore sx={{ fontSize: 16 }} />
                      )}
                    </ListItemButton>

                    <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                      <List dense disablePadding>
                        {table.columns.map((col) => (
                          <ListItemButton key={col.name} sx={{ py: 0, pl: 5 }}>
                            <ListItemIcon sx={{ minWidth: 24 }}>
                              {col.isPrimaryKey ? (
                                <KeyIcon sx={{ fontSize: 12, color: 'warning.main' }} />
                              ) : (
                                <ColumnIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
                              )}
                            </ListItemIcon>
                            <ListItemText
                              primary={col.name}
                              secondary={`${col.dataType}${col.nullable ? ' (nullable)' : ''}`}
                              primaryTypographyProps={{
                                variant: 'caption',
                                noWrap: true,
                              }}
                              secondaryTypographyProps={{
                                variant: 'caption',
                                sx: { fontSize: '0.65rem' },
                              }}
                            />
                          </ListItemButton>
                        ))}
                      </List>
                    </Collapse>
                  </Box>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
