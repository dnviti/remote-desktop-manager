import { useState, useCallback } from 'react';
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
  Menu,
  MenuItem,
  ListItemIcon as MenuItemIcon,
} from '@mui/material';
import {
  TableChart as TableIcon,
  ViewColumn as ColumnIcon,
  Key as KeyIcon,
  ExpandLess,
  ExpandMore,
  Refresh as RefreshIcon,
  ChevronLeft as CollapseIcon,
  PlayArrow as SelectIcon,
  ViewList as SelectAllIcon,
  Functions as CountIcon,
  Add as InsertIcon,
  Edit as UpdateIcon,
  DeleteOutline as DeleteIcon,
  LayersClear as DropIcon,
  ContentCopy as CopyIcon,
  FilterList as WhereIcon,
  Sort as OrderIcon,
  GroupWork as GroupIcon,
} from '@mui/icons-material';
import type { DbTableInfo, DbColumnInfo } from '../../api/database.api';

type DbProtocolHint = 'postgresql' | 'mysql' | 'mongodb' | 'oracle' | 'mssql' | 'db2' | string;

interface DbSchemaBrowserProps {
  tables: DbTableInfo[];
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onTableClick?: (tableName: string, schemaName: string) => void;
  onInsertSql?: (sql: string) => void;
  dbProtocol?: DbProtocolHint;
  loading?: boolean;
}

interface MenuState {
  anchor: HTMLElement;
  table: DbTableInfo;
  column?: DbColumnInfo;
  schema: string;
}

function qualifiedName(schema: string, table: string): string {
  return (schema === 'public' || schema === 'dbo') ? table : `${schema}.${table}`;
}

function copyToClipboard(text: string) {
  try { navigator?.clipboard?.writeText(text); } catch { /* ignore */ }
}

/** Protocol-aware row limit clause. */
function rowLimit(protocol: DbProtocolHint | undefined, n = 100): string {
  switch (protocol) {
    case 'oracle':
      return `FETCH FIRST ${n} ROWS ONLY`;
    case 'mssql':
      return `-- TOP ${n} (add to SELECT)`;
    default:
      return `LIMIT ${n}`;
  }
}

export default function DbSchemaBrowser({
  tables,
  open,
  onClose,
  onRefresh,
  onTableClick,
  onInsertSql,
  dbProtocol,
  loading = false,
}: DbSchemaBrowserProps) {
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const insertSql = useCallback((sql: string) => {
    onInsertSql?.(sql);
    setMenu(null);
  }, [onInsertSql]);

  const handleContextMenu = useCallback((
    e: React.MouseEvent<HTMLElement>,
    table: DbTableInfo,
    schema: string,
    column?: DbColumnInfo,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ anchor: e.currentTarget, table, schema, column });
  }, []);

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

  // --- Context menu SQL generators ---
  const qn = menu ? qualifiedName(menu.schema, menu.table.name) : '';
  const cols = menu?.table.columns ?? [];
  const colNames = cols.map((c) => c.name).join(', ');
  const colPlaceholders = cols.map(() => '?').join(', ');
  const colSetters = cols.map((c) => `${c.name} = ?`).join(', ');
  const limit = rowLimit(dbProtocol);
  const selectPrefix = dbProtocol === 'mssql' ? 'SELECT TOP 100' : 'SELECT';

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
                      onContextMenu={(e) => handleContextMenu(e, table, schemaName)}
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
                          <ListItemButton
                            key={col.name}
                            sx={{ py: 0, pl: 5 }}
                            onContextMenu={(e) => handleContextMenu(e, table, schemaName, col)}
                          >
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

      {/* Context menu */}
      <Menu
        open={Boolean(menu)}
        anchorEl={menu?.anchor}
        onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { minWidth: 220, maxWidth: 320 } } }}
      >
        {/* Column-specific options (shown first when a column is right-clicked) */}
        {menu?.column && [
          <MenuItem key="copy-col" onClick={() => { copyToClipboard(menu.column!.name); closeMenu(); }}>
            <MenuItemIcon><CopyIcon fontSize="small" /></MenuItemIcon>
            <ListItemText>Copy column name</ListItemText>
          </MenuItem>,
          <MenuItem key="select-distinct" onClick={() => insertSql(`SELECT DISTINCT ${menu.column!.name}\nFROM ${qn};`)}>
            <MenuItemIcon><SelectIcon fontSize="small" /></MenuItemIcon>
            <ListItemText>SELECT DISTINCT</ListItemText>
          </MenuItem>,
          <MenuItem key="where" onClick={() => { copyToClipboard(`WHERE ${menu.column!.name} = ?`); closeMenu(); }}>
            <MenuItemIcon><WhereIcon fontSize="small" /></MenuItemIcon>
            <ListItemText>Copy WHERE clause</ListItemText>
          </MenuItem>,
          <MenuItem key="order-by" onClick={() => { copyToClipboard(`ORDER BY ${menu.column!.name} ASC`); closeMenu(); }}>
            <MenuItemIcon><OrderIcon fontSize="small" /></MenuItemIcon>
            <ListItemText>Copy ORDER BY</ListItemText>
          </MenuItem>,
          <MenuItem key="group-count" onClick={() => insertSql(`SELECT ${menu.column!.name}, COUNT(*)\nFROM ${qn}\nGROUP BY ${menu.column!.name}\nORDER BY COUNT(*) DESC;`)}>
            <MenuItemIcon><GroupIcon fontSize="small" /></MenuItemIcon>
            <ListItemText>GROUP BY + COUNT</ListItemText>
          </MenuItem>,
          <Divider key="col-divider" />,
        ]}

        {/* Table-level options */}
        <MenuItem onClick={() => insertSql(`${selectPrefix} *\nFROM ${qn}\n${limit};`)}>
          <MenuItemIcon><SelectAllIcon fontSize="small" /></MenuItemIcon>
          <ListItemText>SELECT *</ListItemText>
        </MenuItem>
        {cols.length > 0 && (
          <MenuItem onClick={() => insertSql(`${selectPrefix} ${colNames}\nFROM ${qn}\n${limit};`)}>
            <MenuItemIcon><SelectIcon fontSize="small" /></MenuItemIcon>
            <ListItemText>SELECT columns</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => insertSql(`SELECT COUNT(*)\nFROM ${qn};`)}>
          <MenuItemIcon><CountIcon fontSize="small" /></MenuItemIcon>
          <ListItemText>COUNT(*)</ListItemText>
        </MenuItem>

        <Divider />

        {cols.length > 0 && (
          <MenuItem onClick={() => insertSql(`INSERT INTO ${qn} (${colNames})\nVALUES (${colPlaceholders});`)}>
            <MenuItemIcon><InsertIcon fontSize="small" /></MenuItemIcon>
            <ListItemText>INSERT template</ListItemText>
          </MenuItem>
        )}
        {cols.length > 0 && (
          <MenuItem onClick={() => insertSql(`UPDATE ${qn}\nSET ${colSetters}\nWHERE ...;`)}>
            <MenuItemIcon><UpdateIcon fontSize="small" /></MenuItemIcon>
            <ListItemText>UPDATE template</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => insertSql(`DELETE FROM ${qn}\nWHERE ...;`)}>
          <MenuItemIcon><DeleteIcon fontSize="small" /></MenuItemIcon>
          <ListItemText>DELETE template</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => insertSql(`DROP TABLE ${qn};`)}>
          <MenuItemIcon><DropIcon fontSize="small" /></MenuItemIcon>
          <ListItemText>DROP TABLE</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem onClick={() => { copyToClipboard(qn); closeMenu(); }}>
          <MenuItemIcon><CopyIcon fontSize="small" /></MenuItemIcon>
          <ListItemText>Copy table name</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}
