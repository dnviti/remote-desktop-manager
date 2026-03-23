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
  const children: PlanNode[] = [];

  // Parse top-level table (simple single-table query)
  if (block.table) {
    children.push(parseMysqlTableNode(block.table as Record<string, unknown>));
  }

  // Parse nested_loop (joins)
  if (Array.isArray(block.nested_loop)) {
    for (const item of block.nested_loop as Record<string, unknown>[]) {
      if (item.table) {
        children.push(parseMysqlTableNode(item.table as Record<string, unknown>));
      }
    }
  }

  // Parse ordering_operation (ORDER BY)
  if (block.ordering_operation) {
    children.push(parseMysqlOperationNode('Order', block.ordering_operation as Record<string, unknown>));
  }

  // Parse grouping_operation (GROUP BY)
  if (block.grouping_operation) {
    children.push(parseMysqlOperationNode('Group', block.grouping_operation as Record<string, unknown>));
  }

  // Parse duplicates_removal
  if (block.duplicates_removal) {
    children.push(parseMysqlOperationNode('Distinct', block.duplicates_removal as Record<string, unknown>));
  }

  // Parse materialized_from_subquery
  if (block.materialized_from_subquery) {
    const sub = block.materialized_from_subquery as Record<string, unknown>;
    const subBlock = sub.query_block as Record<string, unknown> | undefined;
    if (subBlock) {
      const subNode = parseMysqlPlanNode(subBlock);
      subNode.operator = 'Materialized Subquery';
      children.push(subNode);
    }
  }

  // Parse attached_subqueries
  if (Array.isArray(block.attached_subqueries)) {
    for (const sub of block.attached_subqueries as Record<string, unknown>[]) {
      const subBlock = sub.query_block as Record<string, unknown> | undefined;
      if (subBlock) {
        const subNode = parseMysqlPlanNode(subBlock);
        subNode.operator = 'Subquery';
        children.push(subNode);
      }
    }
  }

  const costInfo = block.cost_info as Record<string, unknown> | undefined;

  return {
    operator: 'Query Block',
    rows: undefined,
    cost: Number(costInfo?.query_cost ?? 0),
    children: children.length > 0 ? children : undefined,
  };
}

function parseMysqlTableNode(t: Record<string, unknown>): PlanNode {
  const costInfo = t.cost_info as Record<string, unknown> | undefined;
  const readCost = Number(costInfo?.read_cost ?? 0);
  const evalCost = Number(costInfo?.eval_cost ?? 0);

  // Recursively handle materialized subqueries inside table nodes
  const children: PlanNode[] = [];
  if (t.materialized_from_subquery) {
    const sub = t.materialized_from_subquery as Record<string, unknown>;
    const subBlock = sub.query_block as Record<string, unknown> | undefined;
    if (subBlock) {
      const subNode = parseMysqlPlanNode(subBlock);
      subNode.operator = 'Materialized Subquery';
      children.push(subNode);
    }
  }

  return {
    operator: String(t.access_type ?? 'scan').toUpperCase(),
    table: String(t.table_name ?? ''),
    rows: Number(t.rows_examined_per_scan ?? t.rows_produced_per_join ?? 0),
    cost: readCost + evalCost,
    scanType: String(t.access_type ?? ''),
    indexName: t.key as string | undefined,
    filter: t.attached_condition as string | undefined,
    children: children.length > 0 ? children : undefined,
  };
}

function parseMysqlOperationNode(label: string, op: Record<string, unknown>): PlanNode {
  const children: PlanNode[] = [];

  // Operations can contain nested tables, nested_loop, or sub-operations
  if (op.table) {
    children.push(parseMysqlTableNode(op.table as Record<string, unknown>));
  }
  if (Array.isArray(op.nested_loop)) {
    for (const item of op.nested_loop as Record<string, unknown>[]) {
      if (item.table) {
        children.push(parseMysqlTableNode(item.table as Record<string, unknown>));
      }
    }
  }
  if (op.ordering_operation) {
    children.push(parseMysqlOperationNode('Order', op.ordering_operation as Record<string, unknown>));
  }
  if (op.grouping_operation) {
    children.push(parseMysqlOperationNode('Group', op.grouping_operation as Record<string, unknown>));
  }
  if (op.duplicates_removal) {
    children.push(parseMysqlOperationNode('Distinct', op.duplicates_removal as Record<string, unknown>));
  }
  if (op.query_block) {
    children.push(parseMysqlPlanNode(op.query_block as Record<string, unknown>));
  }

  const costInfo = op.cost_info as Record<string, unknown> | undefined;
  return {
    operator: label,
    cost: Number(costInfo?.query_cost ?? 0),
    filter: op.using_filesort === true ? 'Using filesort' : undefined,
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

/**
 * Parse Oracle DBMS_XPLAN text output into a PlanNode tree.
 *
 * Example input:
 *   | Id  | Operation          | Name       | Rows  | Bytes | Cost (%CPU)| Time     |
 *   |   0 | SELECT STATEMENT   |            |     6 |   546 |     3   (0)| 00:00:01 |
 *   |*  1 |  COUNT STOPKEY     |            |       |       |            |          |
 *   |   2 |   TABLE ACCESS FULL| CATEGORIES |     6 |   546 |     3   (0)| 00:00:01 |
 *
 * The indentation of the Operation column encodes parent–child relationships.
 */
function parseTextPlan(raw: string): PlanNode {
  const lines = raw.split('\n');

  // ---- 1. Find the data rows inside the table ----
  // Separator lines look like "---…---" (all dashes + pipes)
  const separatorIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*[-]+\s*$/.test(lines[i].replace(/\|/g, '-'))) {
      separatorIndices.push(i);
    }
  }

  // We need at least a header separator and a footer separator
  if (separatorIndices.length < 2) {
    return { operator: 'Execution Plan', rows: 0, cost: 0, extra: { rawText: raw } };
  }

  // Header row is between the first two separators; data rows start after the header separator
  const headerSep = separatorIndices[0];
  const footerSep = separatorIndices.length >= 3 ? separatorIndices[2] : separatorIndices[1];
  const dataStartIdx = separatorIndices.length >= 3 ? separatorIndices[1] + 1 : headerSep + 2;

  // ---- 2. Parse each data row ----
  interface RawRow {
    id: number;
    operation: string;
    depth: number; // leading spaces in Operation column
    name: string;
    rows: number;
    bytes: number;
    cost: number;
    cpuPct: number;
    time: string;
    hasPredicate: boolean;
  }

  const dataRows: RawRow[] = [];

  for (let i = dataStartIdx; i < footerSep; i++) {
    const line = lines[i];
    if (!line || !line.includes('|')) continue;
    const cells = line.split('|').slice(1); // skip leading empty
    if (cells.length < 2) continue;

    const idStr = (cells[0] ?? '').trim();
    const hasPredicate = idStr.startsWith('*');
    const id = parseInt(idStr.replace(/\*/g, ''), 10);
    if (isNaN(id)) continue;

    const opRaw = cells[1] ?? '';
    const opTrimmed = opRaw.trimEnd();
    const depth = opTrimmed.length - opTrimmed.trimStart().length;
    const operation = opRaw.trim();

    const name = (cells[2] ?? '').trim();
    const rowsVal = parseInt((cells[3] ?? '').trim(), 10) || 0;
    const bytesVal = parseInt((cells[4] ?? '').trim(), 10) || 0;

    // Cost column may look like "3   (0)" — extract numeric cost and CPU %
    const costStr = (cells[5] ?? '').trim();
    const costParts = costStr.split('(');
    const costVal = parseInt(costParts[0], 10) || 0;
    const cpuPct = costParts[1] ? parseInt(costParts[1], 10) || 0 : 0;

    const time = (cells[6] ?? '').trim();

    dataRows.push({ id, operation, depth, name, rows: rowsVal, bytes: bytesVal, cost: costVal, cpuPct, time, hasPredicate });
  }

  if (dataRows.length === 0) {
    return { operator: 'Execution Plan', rows: 0, cost: 0, extra: { rawText: raw } };
  }

  // ---- 3. Parse Predicate Information ----
  const predicates = new Map<number, string>();
  const predIdx = lines.findIndex((l) => /predicate\s+information/i.test(l));
  if (predIdx >= 0) {
    for (let i = predIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^\s*(\d+)\s*-\s*(.+)/);
      if (m) {
        predicates.set(parseInt(m[1], 10), m[2].trim());
      } else if (/^\s*$/.test(lines[i]) && predicates.size > 0) {
        // Stop on second blank line after we've started collecting
        if (i + 1 < lines.length && /^\s*$/.test(lines[i + 1])) break;
      }
    }
  }

  // ---- 4. Parse Note section ----
  let noteText = '';
  const noteIdx = lines.findIndex((l, idx) => idx > predIdx && /^Note\b/i.test(l.trim()));
  if (noteIdx >= 0) {
    const noteLines: string[] = [];
    for (let i = noteIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('---')) continue;
      if (trimmed) noteLines.push(trimmed.replace(/^-\s*/, ''));
    }
    noteText = noteLines.join('; ');
  }

  // ---- 5. Build tree from depth information ----
  function toNode(row: RawRow): PlanNode {
    const filter = predicates.get(row.id);
    return {
      operator: row.operation,
      table: row.name || undefined,
      rows: row.rows || undefined,
      cost: row.cost,
      totalCost: row.cost,
      filter,
      children: undefined,
      extra: {
        ...(row.bytes ? { bytes: row.bytes } : {}),
        ...(row.cpuPct ? { cpuPct: `${row.cpuPct}%` } : {}),
        ...(row.time ? { time: row.time } : {}),
      },
    };
  }

  // Stack-based tree construction: each entry is { node, depth }
  const nodes = dataRows.map(toNode);
  const depths = dataRows.map((r) => r.depth);

  // Build parent–child by depth: a row's parent is the last preceding row with smaller depth
  for (let i = 1; i < nodes.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (depths[j] < depths[i]) {
        const parent = nodes[j];
        if (!parent.children) parent.children = [];
        parent.children.push(nodes[i]);
        break;
      }
    }
  }

  // Root is the first node (SELECT STATEMENT, id=0)
  const root = nodes[0];
  if (noteText) {
    root.extra = { ...root.extra, note: noteText };
  }
  return root;
}

/**
 * Parse MSSQL SHOWPLAN_XML into a PlanNode tree using the browser DOMParser.
 */
function parseXmlPlan(raw: string): PlanNode | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(raw, 'application/xml');
  } catch {
    return null;
  }

  // Check for parse errors
  if (doc.querySelector('parsererror')) return null;

  // MSSQL namespaces the XML — use a local-name() selector helper
  function allByLocal(parent: Element, localName: string): Element[] {
    return Array.from(parent.querySelectorAll('*')).filter(
      (el) => el.localName === localName,
    );
  }

  function firstByLocal(parent: Element, localName: string): Element | null {
    return parent.querySelector(`*|${localName}`)
      ?? Array.from(parent.children).find((el) => el.localName === localName)
      ?? null;
  }

  function parseRelOp(el: Element): PlanNode {
    const physOp = el.getAttribute('PhysicalOp') ?? 'Unknown';
    const logOp = el.getAttribute('LogicalOp') ?? '';
    const estRows = parseFloat(el.getAttribute('EstimateRows') ?? '0');
    const estCPU = parseFloat(el.getAttribute('EstimateCPU') ?? '0');
    const estIO = parseFloat(el.getAttribute('EstimateIO') ?? '0');
    const subtreeCost = parseFloat(el.getAttribute('EstimatedTotalSubtreeCost') ?? '0');
    const avgRowSize = parseInt(el.getAttribute('AvgRowSize') ?? '0', 10);

    // Find table/index references inside this op (not in child RelOps)
    let tableName: string | undefined;
    let indexName: string | undefined;
    let scanType: string | undefined;

    // Look for direct operation child elements (e.g., IndexScan, TableScan, Sort, etc.)
    for (const child of Array.from(el.children)) {
      if (child.localName === 'RelOp') continue;
      // Object reference inside operation elements
      const objRefs = allByLocal(child, 'Object');
      for (const obj of objRefs) {
        // Only take objects that aren't inside nested RelOps
        const parentRelOp = obj.closest('[PhysicalOp]');
        if (parentRelOp !== el) continue;
        tableName = tableName || obj.getAttribute('Table')?.replace(/[\[\]]/g, '');
        indexName = indexName || obj.getAttribute('Index')?.replace(/[\[\]]/g, '');
      }

      // The child element name often IS the scan type (IndexScan, TableScan, etc.)
      if (!scanType && child.localName !== 'OutputList' && child.localName !== 'RunTimeInformation') {
        scanType = child.localName;
      }
    }

    // Collect child RelOp elements (direct children of operation sub-elements, not deeply nested)
    const children: PlanNode[] = [];
    for (const child of Array.from(el.children)) {
      if (child.localName === 'RelOp') {
        children.push(parseRelOp(child));
      } else {
        // RelOps nested inside operation elements (e.g., inside Sort, Hash, NestedLoops)
        for (const nestedRelOp of Array.from(child.children)) {
          if (nestedRelOp.localName === 'RelOp') {
            children.push(parseRelOp(nestedRelOp));
          }
          // One more level — some ops nest RelOp two levels deep
          for (const deepChild of Array.from(nestedRelOp.children)) {
            if (deepChild.localName === 'RelOp') {
              children.push(parseRelOp(deepChild));
            }
          }
        }
      }
    }

    const operator = logOp && logOp !== physOp ? `${physOp} (${logOp})` : physOp;

    return {
      operator,
      table: tableName,
      rows: Math.round(estRows),
      cost: Math.round((estCPU + estIO) * 10000) / 10000,
      totalCost: Math.round(subtreeCost * 10000) / 10000,
      scanType,
      indexName,
      width: avgRowSize || undefined,
      children: children.length > 0 ? children : undefined,
      extra: {
        ...(estCPU ? { estimateCPU: estCPU } : {}),
        ...(estIO ? { estimateIO: estIO } : {}),
      },
    };
  }

  // Navigate: ShowPlanXML > BatchSequence > Batch > Statements > StmtSimple > QueryPlan > RelOp
  const rootEl = doc.documentElement;
  const stmts = allByLocal(rootEl, 'StmtSimple');
  if (stmts.length === 0) return null;

  const stmt = stmts[stmts.length - 1]; // last statement
  const queryPlan = firstByLocal(stmt, 'QueryPlan');
  if (!queryPlan) return null;

  // Find the top-level RelOp (direct child of QueryPlan)
  const topRelOps = Array.from(queryPlan.children).filter((c) => c.localName === 'RelOp');
  if (topRelOps.length === 0) return null;

  if (topRelOps.length === 1) {
    return parseRelOp(topRelOps[0]);
  }

  // Multiple top-level RelOps — wrap in a root node
  return {
    operator: 'Query Plan',
    children: topRelOps.map(parseRelOp),
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
    if (format === 'xml' && raw) return parseXmlPlan(raw);
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
