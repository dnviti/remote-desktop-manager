import { useState, useCallback, useMemo } from 'react';
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
  Functions as FunctionIcon,
  Add as InsertIcon,
  Edit as UpdateIcon,
  DeleteOutline as DeleteIcon,
  LayersClear as DropIcon,
  ContentCopy as CopyIcon,
  FilterList as WhereIcon,
  Sort as OrderIcon,
  GroupWork as GroupIcon,
  Visibility as ViewIcon,
  FlashOn as TriggerIcon,
  FormatListNumbered as SequenceIcon,
  SettingsEthernet as ProcedureIcon,
  Inventory2 as PackageIcon,
  Category as TypeIcon,
} from '@mui/icons-material';
import type {
  DbSchemaInfo,
  DbTableInfo,
  DbColumnInfo,
  DbViewInfo,
  DbRoutineInfo,
  DbTriggerInfo,
  DbSequenceInfo,
  DbPackageInfo,
  DbTypeInfo,
} from '../../api/database.api';

type DbProtocolHint = 'postgresql' | 'mysql' | 'mongodb' | 'oracle' | 'mssql' | 'db2' | string;

type BrowsableObjectType = 'table' | 'view' | 'function' | 'procedure' | 'trigger' | 'sequence' | 'package' | 'type';

interface DbSchemaBrowserProps {
  schema: DbSchemaInfo;
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
  objectType: BrowsableObjectType;
  objectName: string;
  schema: string;
  table?: DbTableInfo;
  column?: DbColumnInfo;
}

interface SchemaGroup {
  tables: DbTableInfo[];
  views: DbViewInfo[];
  functions: DbRoutineInfo[];
  procedures: DbRoutineInfo[];
  triggers: DbTriggerInfo[];
  sequences: DbSequenceInfo[];
  packages: DbPackageInfo[];
  types: DbTypeInfo[];
}

type SectionType = keyof SchemaGroup;

interface SectionConfig {
  key: SectionType;
  label: string;
  icon: React.ReactNode;
}

const SECTION_CONFIGS: SectionConfig[] = [
  { key: 'tables', label: 'Tables', icon: <TableIcon sx={{ fontSize: 16, color: 'primary.main' }} /> },
  { key: 'views', label: 'Views', icon: <ViewIcon sx={{ fontSize: 16, color: 'info.main' }} /> },
  { key: 'functions', label: 'Functions', icon: <FunctionIcon sx={{ fontSize: 16, color: 'secondary.main' }} /> },
  { key: 'procedures', label: 'Procedures', icon: <ProcedureIcon sx={{ fontSize: 16, color: 'secondary.main' }} /> },
  { key: 'triggers', label: 'Triggers', icon: <TriggerIcon sx={{ fontSize: 16, color: 'warning.main' }} /> },
  { key: 'sequences', label: 'Sequences', icon: <SequenceIcon sx={{ fontSize: 16, color: 'text.secondary' }} /> },
  { key: 'packages', label: 'Packages', icon: <PackageIcon sx={{ fontSize: 16, color: 'text.secondary' }} /> },
  { key: 'types', label: 'Types', icon: <TypeIcon sx={{ fontSize: 16, color: 'text.secondary' }} /> },
];

function emptyGroup(): SchemaGroup {
  return { tables: [], views: [], functions: [], procedures: [], triggers: [], sequences: [], packages: [], types: [] };
}

function qualifiedName(schema: string, name: string): string {
  return (schema === 'public' || schema === 'dbo') ? name : `${schema}.${name}`;
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
  schema,
  open,
  onClose,
  onRefresh,
  onTableClick,
  onInsertSql,
  dbProtocol,
  loading = false,
}: DbSchemaBrowserProps) {
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const insertSql = useCallback((sql: string) => {
    onInsertSql?.(sql);
    setMenu(null);
  }, [onInsertSql]);

  // Build grouped schema map
  const schemaGroups = useMemo(() => {
    const groups: Record<string, SchemaGroup> = {};

    const ensure = (s: string) => {
      if (!groups[s]) groups[s] = emptyGroup();
      return groups[s];
    };

    for (const t of schema.tables) ensure(t.schema || 'public').tables.push(t);
    for (const v of schema.views ?? []) ensure(v.schema || 'public').views.push(v);
    for (const f of schema.functions ?? []) ensure(f.schema || 'public').functions.push(f);
    for (const p of schema.procedures ?? []) ensure(p.schema || 'public').procedures.push(p);
    for (const tr of schema.triggers ?? []) ensure(tr.schema || 'public').triggers.push(tr);
    for (const sq of schema.sequences ?? []) ensure(sq.schema || 'public').sequences.push(sq);
    for (const pk of schema.packages ?? []) ensure(pk.schema || 'public').packages.push(pk);
    for (const tp of schema.types ?? []) ensure(tp.schema || 'public').types.push(tp);

    return groups;
  }, [schema]);

  const totalObjects = useMemo(() => {
    return schema.tables.length
      + (schema.views?.length ?? 0)
      + (schema.functions?.length ?? 0)
      + (schema.procedures?.length ?? 0)
      + (schema.triggers?.length ?? 0)
      + (schema.sequences?.length ?? 0)
      + (schema.packages?.length ?? 0)
      + (schema.types?.length ?? 0);
  }, [schema]);

  const handleContextMenu = useCallback((
    e: React.MouseEvent<HTMLElement>,
    objectType: BrowsableObjectType,
    objectName: string,
    schemaName: string,
    table?: DbTableInfo,
    column?: DbColumnInfo,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ anchor: e.currentTarget, objectType, objectName, schema: schemaName, table, column });
  }, []);

  if (!open) return null;

  const toggleTable = (tableKey: string) => {
    setExpandedTables((prev) => ({ ...prev, [tableKey]: !prev[tableKey] }));
  };

  const toggleSection = (sectionKey: string) => {
    setExpandedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const isSectionExpanded = (schemaName: string, section: SectionType): boolean => {
    const key = `${schemaName}:${section}`;
    // Tables default to expanded, everything else collapsed
    return expandedSections[key] ?? (section === 'tables');
  };

  // --- Context menu helpers ---
  const menuQn = menu ? qualifiedName(menu.schema, menu.objectName) : '';
  const limit = rowLimit(dbProtocol);
  const selectPrefix = dbProtocol === 'mssql' ? 'SELECT TOP 100' : 'SELECT';

  // Table-specific helpers (only valid when menu.table is present)
  const cols = menu?.table?.columns ?? [];
  const colNames = cols.map((c) => c.name).join(', ');
  const colPlaceholders = cols.map(() => '?').join(', ');
  const colSetters = cols.map((c) => `${c.name} = ?`).join(', ');

  // --- Context menu renderers per object type ---
  const renderTableMenuItems = () => [
    <MenuItem key="select-all" onClick={() => insertSql(`${selectPrefix} *\nFROM ${menuQn}\n${limit};`)}>
      <MenuItemIcon><SelectAllIcon fontSize="small" /></MenuItemIcon>
      <ListItemText>SELECT *</ListItemText>
    </MenuItem>,
    cols.length > 0 && (
      <MenuItem key="select-cols" onClick={() => insertSql(`${selectPrefix} ${colNames}\nFROM ${menuQn}\n${limit};`)}>
        <MenuItemIcon><SelectIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>SELECT columns</ListItemText>
      </MenuItem>
    ),
    <MenuItem key="count" onClick={() => insertSql(`SELECT COUNT(*)\nFROM ${menuQn};`)}>
      <MenuItemIcon><FunctionIcon fontSize="small" /></MenuItemIcon>
      <ListItemText>COUNT(*)</ListItemText>
    </MenuItem>,
    <Divider key="d1" />,
    cols.length > 0 && (
      <MenuItem key="insert" onClick={() => insertSql(`INSERT INTO ${menuQn} (${colNames})\nVALUES (${colPlaceholders});`)}>
        <MenuItemIcon><InsertIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>INSERT template</ListItemText>
      </MenuItem>
    ),
    cols.length > 0 && (
      <MenuItem key="update" onClick={() => insertSql(`UPDATE ${menuQn}\nSET ${colSetters}\nWHERE ...;`)}>
        <MenuItemIcon><UpdateIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>UPDATE template</ListItemText>
      </MenuItem>
    ),
    <MenuItem key="delete" onClick={() => insertSql(`DELETE FROM ${menuQn}\nWHERE ...;`)}>
      <MenuItemIcon><DeleteIcon fontSize="small" /></MenuItemIcon>
      <ListItemText>DELETE template</ListItemText>
    </MenuItem>,
    <MenuItem key="drop" onClick={() => insertSql(`DROP TABLE ${menuQn};`)}>
      <MenuItemIcon><DropIcon fontSize="small" /></MenuItemIcon>
      <ListItemText>DROP TABLE</ListItemText>
    </MenuItem>,
    <Divider key="d2" />,
    <MenuItem key="copy" onClick={() => { copyToClipboard(menuQn); closeMenu(); }}>
      <MenuItemIcon><CopyIcon fontSize="small" /></MenuItemIcon>
      <ListItemText>Copy table name</ListItemText>
    </MenuItem>,
  ];

  const renderColumnMenuItems = () => {
    if (!menu?.column) return null;
    const colName = menu.column.name;
    return [
      <MenuItem key="copy-col" onClick={() => { copyToClipboard(colName); closeMenu(); }}>
        <MenuItemIcon><CopyIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>Copy column name</ListItemText>
      </MenuItem>,
      <MenuItem key="select-distinct" onClick={() => insertSql(`SELECT DISTINCT ${colName}\nFROM ${menuQn};`)}>
        <MenuItemIcon><SelectIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>SELECT DISTINCT</ListItemText>
      </MenuItem>,
      <MenuItem key="where" onClick={() => { copyToClipboard(`WHERE ${colName} = ?`); closeMenu(); }}>
        <MenuItemIcon><WhereIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>Copy WHERE clause</ListItemText>
      </MenuItem>,
      <MenuItem key="order-by" onClick={() => { copyToClipboard(`ORDER BY ${colName} ASC`); closeMenu(); }}>
        <MenuItemIcon><OrderIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>Copy ORDER BY</ListItemText>
      </MenuItem>,
      <MenuItem key="group-count" onClick={() => insertSql(`SELECT ${colName}, COUNT(*)\nFROM ${menuQn}\nGROUP BY ${colName}\nORDER BY COUNT(*) DESC;`)}>
        <MenuItemIcon><GroupIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>GROUP BY + COUNT</ListItemText>
      </MenuItem>,
      <Divider key="col-divider" />,
    ];
  };

  const renderViewMenuItems = () => {
    // Check if view is materialized (look it up from schema data)
    const viewObj = (schema.views ?? []).find((v) => v.name === menu?.objectName && v.schema === menu?.schema);
    const isMaterialized = viewObj?.materialized;

    return [
      <MenuItem key="select-all" onClick={() => insertSql(`${selectPrefix} *\nFROM ${menuQn}\n${limit};`)}>
        <MenuItemIcon><SelectAllIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>SELECT *</ListItemText>
      </MenuItem>,
      <MenuItem key="count" onClick={() => insertSql(`SELECT COUNT(*)\nFROM ${menuQn};`)}>
        <MenuItemIcon><FunctionIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>COUNT(*)</ListItemText>
      </MenuItem>,
      isMaterialized && dbProtocol === 'postgresql' && (
        <MenuItem key="refresh-mat" onClick={() => insertSql(`REFRESH MATERIALIZED VIEW ${menuQn};`)}>
          <MenuItemIcon><RefreshIcon fontSize="small" /></MenuItemIcon>
          <ListItemText>REFRESH MATERIALIZED VIEW</ListItemText>
        </MenuItem>
      ),
      <MenuItem key="drop" onClick={() => insertSql(`DROP VIEW ${menuQn};`)}>
        <MenuItemIcon><DropIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>DROP VIEW</ListItemText>
      </MenuItem>,
      <Divider key="d1" />,
      <MenuItem key="copy" onClick={() => { copyToClipboard(menuQn); closeMenu(); }}>
        <MenuItemIcon><CopyIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>Copy name</ListItemText>
      </MenuItem>,
    ];
  };

  const renderFunctionMenuItems = () => {
    const callSyntax = (dbProtocol === 'oracle' || dbProtocol === 'mssql')
      ? `SELECT ${menuQn}()`
      : `SELECT ${menuQn}();`;

    return [
      <MenuItem key="call" onClick={() => insertSql(callSyntax)}>
        <MenuItemIcon><SelectIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>Call function</ListItemText>
      </MenuItem>,
      <MenuItem key="drop" onClick={() => insertSql(`DROP FUNCTION ${menuQn};`)}>
        <MenuItemIcon><DropIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>DROP FUNCTION</ListItemText>
      </MenuItem>,
      <Divider key="d1" />,
      <MenuItem key="copy" onClick={() => { copyToClipboard(menuQn); closeMenu(); }}>
        <MenuItemIcon><CopyIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>Copy name</ListItemText>
      </MenuItem>,
    ];
  };

  const renderProcedureMenuItems = () => {
    const callSyntax = (dbProtocol === 'mssql' || dbProtocol === 'oracle')
      ? `EXEC ${menuQn};`
      : `CALL ${menuQn}();`;

    return [
      <MenuItem key="call" onClick={() => insertSql(callSyntax)}>
        <MenuItemIcon><SelectIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>Call procedure</ListItemText>
      </MenuItem>,
      <MenuItem key="drop" onClick={() => insertSql(`DROP PROCEDURE ${menuQn};`)}>
        <MenuItemIcon><DropIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>DROP PROCEDURE</ListItemText>
      </MenuItem>,
      <Divider key="d1" />,
      <MenuItem key="copy" onClick={() => { copyToClipboard(menuQn); closeMenu(); }}>
        <MenuItemIcon><CopyIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>Copy name</ListItemText>
      </MenuItem>,
    ];
  };

  const renderTriggerMenuItems = () => [
    <MenuItem key="drop" onClick={() => insertSql(`DROP TRIGGER ${menuQn};`)}>
      <MenuItemIcon><DropIcon fontSize="small" /></MenuItemIcon>
      <ListItemText>DROP TRIGGER</ListItemText>
    </MenuItem>,
    <Divider key="d1" />,
    <MenuItem key="copy" onClick={() => { copyToClipboard(menuQn); closeMenu(); }}>
      <MenuItemIcon><CopyIcon fontSize="small" /></MenuItemIcon>
      <ListItemText>Copy name</ListItemText>
    </MenuItem>,
  ];

  const renderSequenceMenuItems = () => {
    let nextvalSql: string;
    switch (dbProtocol) {
      case 'oracle':
        nextvalSql = `SELECT ${menuQn}.NEXTVAL FROM DUAL;`;
        break;
      case 'mssql':
      case 'db2':
        nextvalSql = `SELECT NEXT VALUE FOR ${menuQn};`;
        break;
      default:
        nextvalSql = `SELECT nextval('${menuQn}');`;
        break;
    }

    return [
      <MenuItem key="nextval" onClick={() => insertSql(nextvalSql)}>
        <MenuItemIcon><SelectIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>NEXTVAL</ListItemText>
      </MenuItem>,
      <MenuItem key="drop" onClick={() => insertSql(`DROP SEQUENCE ${menuQn};`)}>
        <MenuItemIcon><DropIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>DROP SEQUENCE</ListItemText>
      </MenuItem>,
      <Divider key="d1" />,
      <MenuItem key="copy" onClick={() => { copyToClipboard(menuQn); closeMenu(); }}>
        <MenuItemIcon><CopyIcon fontSize="small" /></MenuItemIcon>
        <ListItemText>Copy name</ListItemText>
      </MenuItem>,
    ];
  };

  const renderPackageMenuItems = () => [
    <MenuItem key="drop" onClick={() => insertSql(`DROP PACKAGE ${menuQn};`)}>
      <MenuItemIcon><DropIcon fontSize="small" /></MenuItemIcon>
      <ListItemText>DROP PACKAGE</ListItemText>
    </MenuItem>,
    <Divider key="d1" />,
    <MenuItem key="copy" onClick={() => { copyToClipboard(menuQn); closeMenu(); }}>
      <MenuItemIcon><CopyIcon fontSize="small" /></MenuItemIcon>
      <ListItemText>Copy name</ListItemText>
    </MenuItem>,
  ];

  const renderTypeMenuItems = () => [
    <MenuItem key="drop" onClick={() => insertSql(`DROP TYPE ${menuQn};`)}>
      <MenuItemIcon><DropIcon fontSize="small" /></MenuItemIcon>
      <ListItemText>DROP TYPE</ListItemText>
    </MenuItem>,
    <Divider key="d1" />,
    <MenuItem key="copy" onClick={() => { copyToClipboard(menuQn); closeMenu(); }}>
      <MenuItemIcon><CopyIcon fontSize="small" /></MenuItemIcon>
      <ListItemText>Copy name</ListItemText>
    </MenuItem>,
  ];

  const renderMenuContent = () => {
    if (!menu) return null;

    switch (menu.objectType) {
      case 'table':
        return (
          <>
            {menu.column && renderColumnMenuItems()}
            {renderTableMenuItems()}
          </>
        );
      case 'view':
        return <>{renderViewMenuItems()}</>;
      case 'function':
        return <>{renderFunctionMenuItems()}</>;
      case 'procedure':
        return <>{renderProcedureMenuItems()}</>;
      case 'trigger':
        return <>{renderTriggerMenuItems()}</>;
      case 'sequence':
        return <>{renderSequenceMenuItems()}</>;
      case 'package':
        return <>{renderPackageMenuItems()}</>;
      case 'type':
        return <>{renderTypeMenuItems()}</>;
      default:
        return null;
    }
  };

  // --- Section item renderers ---
  const renderTableItem = (table: DbTableInfo, schemaName: string) => {
    const tableKey = `${schemaName}.${table.name}`;
    const isExpanded = expandedTables[tableKey] ?? false;

    return (
      <Box key={tableKey}>
        <ListItemButton
          onClick={() => toggleTable(tableKey)}
          onDoubleClick={() => onTableClick?.(table.name, schemaName)}
          onContextMenu={(e) => handleContextMenu(e, 'table', table.name, schemaName, table)}
          sx={{ py: 0.25, pl: 4 }}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <TableIcon sx={{ fontSize: 14, color: 'primary.main' }} />
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
            <ExpandLess sx={{ fontSize: 14 }} />
          ) : (
            <ExpandMore sx={{ fontSize: 14 }} />
          )}
        </ListItemButton>

        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
          <List dense disablePadding>
            {table.columns.map((col) => (
              <ListItemButton
                key={col.name}
                sx={{ py: 0, pl: 7 }}
                onContextMenu={(e) => handleContextMenu(e, 'table', table.name, schemaName, table, col)}
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
  };

  const renderViewItem = (view: DbViewInfo, schemaName: string) => (
    <ListItemButton
      key={`${schemaName}.${view.name}`}
      sx={{ py: 0.25, pl: 4 }}
      onContextMenu={(e) => handleContextMenu(e, 'view', view.name, schemaName)}
    >
      <ListItemIcon sx={{ minWidth: 28 }}>
        <ViewIcon sx={{ fontSize: 14, color: 'info.main' }} />
      </ListItemIcon>
      <ListItemText
        primary={view.name}
        secondary={view.materialized ? 'materialized' : undefined}
        primaryTypographyProps={{ variant: 'body2', noWrap: true, sx: { fontSize: '0.8rem' } }}
        secondaryTypographyProps={{ variant: 'caption', sx: { fontSize: '0.65rem' } }}
      />
    </ListItemButton>
  );

  const renderRoutineItem = (routine: DbRoutineInfo, schemaName: string, type: 'function' | 'procedure') => {
    const Icon = type === 'function' ? FunctionIcon : ProcedureIcon;
    return (
      <ListItemButton
        key={`${schemaName}.${routine.name}`}
        sx={{ py: 0.25, pl: 4 }}
        onContextMenu={(e) => handleContextMenu(e, type, routine.name, schemaName)}
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          <Icon sx={{ fontSize: 14, color: 'secondary.main' }} />
        </ListItemIcon>
        <ListItemText
          primary={routine.name}
          secondary={type === 'function' && routine.returnType ? `\u2192 ${routine.returnType}` : undefined}
          primaryTypographyProps={{ variant: 'body2', noWrap: true, sx: { fontSize: '0.8rem' } }}
          secondaryTypographyProps={{ variant: 'caption', sx: { fontSize: '0.65rem' } }}
        />
      </ListItemButton>
    );
  };

  const renderTriggerItem = (trigger: DbTriggerInfo, schemaName: string) => (
    <ListItemButton
      key={`${schemaName}.${trigger.name}`}
      sx={{ py: 0.25, pl: 4 }}
      onContextMenu={(e) => handleContextMenu(e, 'trigger', trigger.name, schemaName)}
    >
      <ListItemIcon sx={{ minWidth: 28 }}>
        <TriggerIcon sx={{ fontSize: 14, color: 'warning.main' }} />
      </ListItemIcon>
      <ListItemText
        primary={trigger.name}
        secondary={`on ${trigger.tableName}`}
        primaryTypographyProps={{ variant: 'body2', noWrap: true, sx: { fontSize: '0.8rem' } }}
        secondaryTypographyProps={{ variant: 'caption', sx: { fontSize: '0.65rem' } }}
      />
    </ListItemButton>
  );

  const renderSequenceItem = (seq: DbSequenceInfo, schemaName: string) => (
    <ListItemButton
      key={`${schemaName}.${seq.name}`}
      sx={{ py: 0.25, pl: 4 }}
      onContextMenu={(e) => handleContextMenu(e, 'sequence', seq.name, schemaName)}
    >
      <ListItemIcon sx={{ minWidth: 28 }}>
        <SequenceIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
      </ListItemIcon>
      <ListItemText
        primary={seq.name}
        primaryTypographyProps={{ variant: 'body2', noWrap: true, sx: { fontSize: '0.8rem' } }}
      />
    </ListItemButton>
  );

  const renderPackageItem = (pkg: DbPackageInfo, schemaName: string) => (
    <ListItemButton
      key={`${schemaName}.${pkg.name}`}
      sx={{ py: 0.25, pl: 4 }}
      onContextMenu={(e) => handleContextMenu(e, 'package', pkg.name, schemaName)}
    >
      <ListItemIcon sx={{ minWidth: 28 }}>
        <PackageIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
      </ListItemIcon>
      <ListItemText
        primary={pkg.name}
        secondary={pkg.hasBody ? 'body' : undefined}
        primaryTypographyProps={{ variant: 'body2', noWrap: true, sx: { fontSize: '0.8rem' } }}
        secondaryTypographyProps={{ variant: 'caption', sx: { fontSize: '0.65rem' } }}
      />
    </ListItemButton>
  );

  const renderTypeItem = (typeObj: DbTypeInfo, schemaName: string) => (
    <ListItemButton
      key={`${schemaName}.${typeObj.name}`}
      sx={{ py: 0.25, pl: 4 }}
      onContextMenu={(e) => handleContextMenu(e, 'type', typeObj.name, schemaName)}
    >
      <ListItemIcon sx={{ minWidth: 28 }}>
        <TypeIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
      </ListItemIcon>
      <ListItemText
        primary={typeObj.name}
        secondary={typeObj.kind}
        primaryTypographyProps={{ variant: 'body2', noWrap: true, sx: { fontSize: '0.8rem' } }}
        secondaryTypographyProps={{ variant: 'caption', sx: { fontSize: '0.65rem' } }}
      />
    </ListItemButton>
  );

  const renderSectionItems = (sectionKey: SectionType, items: SchemaGroup[SectionType], schemaName: string) => {
    switch (sectionKey) {
      case 'tables':
        return (items as DbTableInfo[]).map((t) => renderTableItem(t, schemaName));
      case 'views':
        return (items as DbViewInfo[]).map((v) => renderViewItem(v, schemaName));
      case 'functions':
        return (items as DbRoutineInfo[]).map((f) => renderRoutineItem(f, schemaName, 'function'));
      case 'procedures':
        return (items as DbRoutineInfo[]).map((p) => renderRoutineItem(p, schemaName, 'procedure'));
      case 'triggers':
        return (items as DbTriggerInfo[]).map((tr) => renderTriggerItem(tr, schemaName));
      case 'sequences':
        return (items as DbSequenceInfo[]).map((sq) => renderSequenceItem(sq, schemaName));
      case 'packages':
        return (items as DbPackageInfo[]).map((pk) => renderPackageItem(pk, schemaName));
      case 'types':
        return (items as DbTypeInfo[]).map((tp) => renderTypeItem(tp, schemaName));
      default:
        return null;
    }
  };

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
        {totalObjects === 0 && !loading && (
          <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block' }}>
            No objects found. Connect to a database to browse its schema.
          </Typography>
        )}

        {loading && (
          <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block' }}>
            Loading schema...
          </Typography>
        )}

        {Object.entries(schemaGroups).map(([schemaName, group]) => (
          <Box key={schemaName}>
            <Typography
              variant="overline"
              sx={{ px: 2, pt: 1, display: 'block', color: 'text.secondary' }}
            >
              {schemaName}
            </Typography>
            <Divider />

            {SECTION_CONFIGS.map(({ key, label, icon }) => {
              const items = group[key];
              if (items.length === 0) return null;

              const sectionKey = `${schemaName}:${key}`;
              const expanded = isSectionExpanded(schemaName, key);

              return (
                <Box key={sectionKey}>
                  <ListItemButton
                    onClick={() => toggleSection(sectionKey)}
                    sx={{ py: 0.25, pl: 2 }}
                  >
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      {icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={`${label} (${items.length})`}
                      primaryTypographyProps={{
                        variant: 'body2',
                        noWrap: true,
                        sx: { fontSize: '0.8rem', fontWeight: 500 },
                      }}
                    />
                    {expanded ? (
                      <ExpandLess sx={{ fontSize: 14 }} />
                    ) : (
                      <ExpandMore sx={{ fontSize: 14 }} />
                    )}
                  </ListItemButton>

                  <Collapse in={expanded} timeout="auto" unmountOnExit>
                    <List dense disablePadding>
                      {renderSectionItems(key, items, schemaName)}
                    </List>
                  </Collapse>
                </Box>
              );
            })}
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
        {renderMenuContent()}
      </Menu>
    </Box>
  );
}
