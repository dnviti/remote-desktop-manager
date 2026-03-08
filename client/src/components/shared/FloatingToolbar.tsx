import { useState, useRef, useCallback } from 'react';
import { IconButton, Tooltip, Paper } from '@mui/material';
import { Build as BuildIcon } from '@mui/icons-material';

export interface ToolbarAction {
  id: string;
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  active?: boolean;
}

interface FloatingToolbarProps {
  actions: ToolbarAction[];
  /** Bounding container ref — toolbar stays within these bounds */
  containerRef?: React.RefObject<HTMLElement | null>;
}

const STORAGE_KEY = 'arsenale-floating-toolbar-pos';

function loadPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { x, y } = JSON.parse(raw);
      if (typeof x === 'number' && typeof y === 'number') return { x, y };
    }
  } catch { /* ignore */ }
  return { x: 16, y: 16 };
}

function savePosition(pos: { x: number; y: number }) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
}

export default function FloatingToolbar({ actions, containerRef }: FloatingToolbarProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(loadPosition);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const wasDragged = useRef(false);

  const clamp = useCallback((x: number, y: number) => {
    const el = toolbarRef.current;
    const container = containerRef?.current;
    if (!el) return { x, y };
    const maxX = (container ? container.clientWidth : window.innerWidth) - el.offsetWidth;
    const maxY = (container ? container.clientHeight : window.innerHeight) - el.offsetHeight;
    return {
      x: Math.max(0, Math.min(x, maxX)),
      y: Math.max(0, Math.min(y, maxY)),
    };
  }, [containerRef]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag from the main trigger, not from action buttons
    if ((e.target as HTMLElement).closest('[data-toolbar-action]')) return;
    dragging.current = true;
    wasDragged.current = false;
    const el = toolbarRef.current;
    if (el) {
      dragOffset.current = {
        x: e.clientX - el.getBoundingClientRect().left + (containerRef?.current?.getBoundingClientRect().left ?? 0),
        y: e.clientY - el.getBoundingClientRect().top + (containerRef?.current?.getBoundingClientRect().top ?? 0),
      };
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [containerRef]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    wasDragged.current = true;
    const containerRect = containerRef?.current?.getBoundingClientRect();
    const newX = e.clientX - dragOffset.current.x - (containerRect?.left ?? 0) + (containerRef?.current?.getBoundingClientRect().left ?? 0);
    const newY = e.clientY - dragOffset.current.y - (containerRect?.top ?? 0) + (containerRef?.current?.getBoundingClientRect().top ?? 0);
    setPosition(clamp(newX, newY));
  }, [clamp, containerRef]);

  const onPointerUp = useCallback(() => {
    if (dragging.current && wasDragged.current) {
      savePosition(position);
    }
    dragging.current = false;
  }, [position]);

  const handleTriggerClick = useCallback(() => {
    // Don't toggle if this was a drag gesture
    if (wasDragged.current) return;
    setOpen((prev) => !prev);
  }, []);

  if (actions.length === 0) return null;

  return (
    <Paper
      ref={toolbarRef}
      elevation={4}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      sx={{
        position: 'absolute',
        top: position.y,
        left: position.x,
        zIndex: 3,
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        borderRadius: 2,
        p: 0.25,
        // eslint-disable-next-line react-hooks/refs -- drag state must be a ref to avoid re-render churn
        cursor: dragging.current ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
        bgcolor: 'background.paper',
        opacity: 0.85,
        transition: open ? 'none' : 'opacity 0.2s',
        '&:hover': { opacity: 1 },
      }}
    >
      <Tooltip title={open ? '' : 'Tools'}>
        <IconButton
          size="small"
          onClick={handleTriggerClick}
          sx={{
            color: open ? 'primary.main' : 'text.secondary',
          }}
        >
          <BuildIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {open && actions.map((action) => (
        <Tooltip key={action.id} title={action.tooltip}>
          <IconButton
            data-toolbar-action
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              action.onClick();
            }}
            sx={{
              color: action.active ? 'primary.main' : 'text.secondary',
            }}
          >
            {action.icon}
          </IconButton>
        </Tooltip>
      ))}
    </Paper>
  );
}
