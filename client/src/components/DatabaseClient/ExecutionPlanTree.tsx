import { useState, useMemo, Fragment } from 'react';
import {
  Box, Typography, Chip, Tooltip, IconButton, Collapse, Paper,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  TableChart as TableIcon,
  Speed as SpeedIcon,
} from '@mui/icons-material';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlanNode {
  operator: string;
  table?: string;
  rows?: number;
  cost?: number;
  startupCost?: number;
  totalCost?: number;
  actualRows?: number;
  scanType?: string;
  filter?: string;
  indexName?: string;
  width?: number;
  children?: PlanNode[];
  extra?: Record<string, unknown>;
}

interface ExecutionPlanTreeProps {
  plan: unknown;
  format: 'json' | 'xml' | 'text';
  raw?: string;
}

// ---------------------------------------------------------------------------
// Plan parser — converts various EXPLAIN formats into a uniform PlanNode tree
// ---------------------------------------------------------------------------

function parseJsonPlan(plan: unknown): PlanNode | null {
  if (!plan) return null;

  // PostgreSQL EXPLAIN JSON wraps the plan in an array
  const planArray = Array.isArray(plan) ? plan : [plan];
  const root = planArray[0];

  if (!root) return null;

  // PostgreSQL format: { Plan: { ... } }
  const pgPlan = (root as Record<string, unknown>).Plan ?? root;
  return parsePgPlanNode(pgPlan as Record<string, unknown>);
}

function parsePgPlanNode(node: Record<string, unknown>): PlanNode {
  const children: PlanNode[] = [];
  const plans = node.Plans as Record<string, unknown>[] | undefined;
  if (Array.isArray(plans)) {
    for (const child of plans) {
      children.push(parsePgPlanNode(child));
    }
  }

  // MySQL EXPLAIN JSON format
  if (node.query_block) {
    return parseMysqlPlanNode(node.query_block as Record<string, unknown>);
  }

  return {
    operator: String(node['Node Type'] ?? node.node_type ?? node.type ?? 'Unknown'),
    table: (node['Relation Name'] ?? node.table_name ?? node.table) as string | undefined,
    rows: Number(node['Plan Rows'] ?? node.rows ?? 0),
    cost: Number(node['Total Cost'] ?? node.cost ?? 0),
    startupCost: Number(node['Startup Cost'] ?? 0),
    totalCost: Number(node['Total Cost'] ?? 0),
    actualRows: node['Actual Rows'] != null ? Number(node['Actual Rows']) : undefined,
    scanType: (node['Scan Direction'] ?? node.access_type) as string | undefined,
    filter: (node.Filter ?? node['Index Cond'] ?? node.attached_condition) as string | undefined,
    indexName: (node['Index Name'] ?? node.key) as string | undefined,
    width: node['Plan Width'] != null ? Number(node['Plan Width']) : undefined,
    children: children.length > 0 ? children : undefined,
    extra: extractExtra(node),
  };
}

function parseMysqlPlanNode(block: Record<string, unknown>): PlanNode {
  const table = block.table as Record<string, unknown> | undefined;
  const nestedLoop = block.nested_loop as Record<string, unknown>[] | undefined;

  const children: PlanNode[] = [];
  if (Array.isArray(nestedLoop)) {
    for (const item of nestedLoop) {
      const t = item.table as Record<string, unknown> | undefined;
      if (t) {
        children.push({
          operator: String(t.access_type ?? 'scan'),
          table: String(t.table_name ?? ''),
          rows: Number(t.rows_examined_per_scan ?? t.rows_produced_per_join ?? 0),
          cost: Number(t.read_cost ?? t.eval_cost ?? 0),
          scanType: String(t.access_type ?? ''),
          indexName: t.key as string | undefined,
          filter: t.attached_condition as string | undefined,
          children: undefined,
        });
      }
    }
  }

  return {
    operator: 'Query Block',
    table: table ? String(table.table_name ?? '') : undefined,
    rows: Number(block.select_id ?? 0),
    cost: Number((block.cost_info as Record<string, unknown>)?.query_cost ?? 0),
    children: children.length > 0 ? children : undefined,
  };
}

function extractExtra(node: Record<string, unknown>): Record<string, unknown> {
  const skip = new Set([
    'Node Type', 'Relation Name', 'Plan Rows', 'Total Cost', 'Startup Cost',
    'Actual Rows', 'Plan Width', 'Plans', 'Filter', 'Index Cond', 'Index Name',
    'Scan Direction', 'node_type', 'table_name', 'rows', 'cost', 'table',
    'type', 'key', 'access_type', 'attached_condition',
  ]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (!skip.has(k) && v != null) {
      extra[k] = v;
    }
  }
  return Object.keys(extra).length > 0 ? extra : {};
}

function parseTextPlan(raw: string): PlanNode {
  // Oracle DBMS_XPLAN text format — parse into a simple tree
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  return {
    operator: 'Execution Plan',
    rows: 0,
    cost: 0,
    extra: { rawText: lines.join('\n') },
  };
}

// ---------------------------------------------------------------------------
// Cost color coding
// ---------------------------------------------------------------------------

function getCostColor(cost: number, maxCost: number): string {
  if (maxCost === 0) return '#4caf50';
  const ratio = cost / maxCost;
  if (ratio < 0.25) return '#4caf50'; // green
  if (ratio < 0.5) return '#ff9800'; // orange
  if (ratio < 0.75) return '#f44336'; // red
  return '#d32f2f'; // dark red
}

function findMaxCost(node: PlanNode): number {
  let max = node.totalCost ?? node.cost ?? 0;
  if (node.children) {
    for (const child of node.children) {
      max = Math.max(max, findMaxCost(child));
    }
  }
  return max;
}

// ---------------------------------------------------------------------------
// Tree node component
// ---------------------------------------------------------------------------

function PlanTreeNode({ node, maxCost, depth }: { node: PlanNode; maxCost: number; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 3);
  const hasChildren = node.children && node.children.length > 0;
  const cost = node.totalCost ?? node.cost ?? 0;
  const costColor = getCostColor(cost, maxCost);

  return (
    <Box sx={{ ml: depth > 0 ? 3 : 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          py: 0.5,
          px: 1,
          borderRadius: 1,
          '&:hover': { bgcolor: 'action.hover' },
          cursor: hasChildren ? 'pointer' : 'default',
        }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          <IconButton size="small" sx={{ p: 0 }}>
            {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        ) : (
          <Box sx={{ width: 24 }} />
        )}

        <Tooltip title={`Cost: ${cost.toFixed(2)}`} placement="top">
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: costColor,
              flexShrink: 0,
            }}
          />
        </Tooltip>

        <Typography variant="body2" fontWeight={600} sx={{ minWidth: 100 }}>
          {node.operator}
        </Typography>

        {node.table && (
          <Chip
            icon={<TableIcon />}
            label={node.table}
            size="small"
            variant="outlined"
            sx={{ height: 22 }}
          />
        )}

        {node.rows != null && node.rows > 0 && (
          <Chip
            label={`${node.rows.toLocaleString()} rows`}
            size="small"
            variant="outlined"
            color="info"
            sx={{ height: 22 }}
          />
        )}

        {cost > 0 && (
          <Chip
            icon={<SpeedIcon />}
            label={cost.toFixed(2)}
            size="small"
            variant="outlined"
            sx={{ height: 22, borderColor: costColor, color: costColor }}
          />
        )}

        {node.scanType && (
          <Typography variant="caption" color="text.secondary">
            {node.scanType}
          </Typography>
        )}

        {node.indexName && (
          <Typography variant="caption" color="primary.main" sx={{ fontStyle: 'italic' }}>
            idx: {node.indexName}
          </Typography>
        )}
      </Box>

      {node.filter && (
        <Box sx={{ ml: depth > 0 ? 6 : 3, mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
            Filter: {node.filter}
          </Typography>
        </Box>
      )}

      {hasChildren && (
        <Collapse in={expanded}>
          {(node.children ?? []).map((child, i) => (
            <PlanTreeNode key={i} node={child} maxCost={maxCost} depth={depth + 1} />
          ))}
        </Collapse>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ExecutionPlanTree({ plan, format, raw }: ExecutionPlanTreeProps) {
  const rootNode = useMemo(() => {
    if (format === 'json') return parseJsonPlan(plan);
    if (format === 'text' && raw) return parseTextPlan(raw);
    if (format === 'xml' && raw) {
      // MSSQL XML plan — show raw for now
      return { operator: 'MSSQL Execution Plan', rows: 0, cost: 0, extra: { rawXml: raw } } as PlanNode;
    }
    return null;
  }, [plan, format, raw]);

  const maxCost = useMemo(() => rootNode ? findMaxCost(rootNode) : 0, [rootNode]);

  if (!rootNode) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography color="text.secondary">Unable to parse execution plan</Typography>
        {raw && (
          <Box
            component="pre"
            sx={{ mt: 1, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, fontSize: '0.8rem', overflow: 'auto', maxHeight: 400 }}
          >
            {raw}
          </Box>
        )}
      </Box>
    );
  }

  // If the plan is just raw text/XML, display it directly
  const rawContent = rootNode.extra?.rawText ?? rootNode.extra?.rawXml;
  if (rawContent && !rootNode.children) {
    return (
      <Paper variant="outlined" sx={{ p: 2, overflow: 'auto', maxHeight: 500 }}>
        <Typography variant="subtitle2" gutterBottom>{rootNode.operator}</Typography>
        <Box
          component="pre"
          sx={{ fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', m: 0 }}
        >
          {String(rawContent)}
        </Box>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.5, overflow: 'auto', maxHeight: 500 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle2">Execution Plan Tree</Typography>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', ml: 'auto' }}>
          {[
            { color: '#4caf50', label: 'Low' },
            { color: '#ff9800', label: 'Med' },
            { color: '#f44336', label: 'High' },
          ].map(({ color, label }) => (
            <Fragment key={label}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
              <Typography variant="caption" color="text.secondary">{label}</Typography>
            </Fragment>
          ))}
        </Box>
      </Box>
      <PlanTreeNode node={rootNode} maxCost={maxCost} depth={0} />
    </Paper>
  );
}
