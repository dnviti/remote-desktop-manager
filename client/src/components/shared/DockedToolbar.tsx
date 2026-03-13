import { useState, useRef, useCallback, useEffect } from 'react';
import {
  IconButton,
  Tooltip,
  Paper,
  Box,
  Popover,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  DragIndicator as DragIcon,
  SwapHoriz as FlipIcon,
} from '@mui/icons-material';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';

export interface ToolbarAction {
  id: string;
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  active?: boolean;
  /** If present, clicking opens a Popover with these sub-actions instead of calling onClick */
  subActions?: Omit<ToolbarAction, 'subActions'>[];
  /** Color override (e.g., 'error.main' for disconnect) */
  color?: string;
  /** Hide this action (useful for DLP-gated items) */
  hidden?: boolean;
  /** Disable this action */
  disabled?: boolean;
}

interface DockedToolbarProps {
  actions: ToolbarAction[];
  /** Bounding container ref — toolbar stays within these bounds */
  containerRef?: React.RefObject<HTMLElement | null>;
}

/** Threshold in px past container center before side flips during drag */
const FLIP_THRESHOLD = 30;

export default function DockedToolbar({ actions, containerRef }: DockedToolbarProps) {
  const dockedSide = useUiPreferencesStore((s) => s.toolbarDockedSide);
  const dockedY = useUiPreferencesStore((s) => s.toolbarDockedY);
  const setPref = useUiPreferencesStore((s) => s.set);

  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [localY, setLocalY] = useState(dockedY);
  const [localSide, setLocalSide] = useState(dockedSide);
  const [fullscreenContainer, setFullscreenContainer] = useState<HTMLElement | null>(null);

  // Sync store → local when prefs change externally
  useEffect(() => { setLocalY(dockedY); }, [dockedY]);
  useEffect(() => { setLocalSide(dockedSide); }, [dockedSide]);

  // Track fullscreen state for Popover container — store the element in state
  useEffect(() => {
    const onFsChange = () => {
      const el = containerRef?.current;
      if (el && document.fullscreenElement === el) {
        setFullscreenContainer(el);
      } else {
        setFullscreenContainer(null);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [containerRef]);

  // Submenu popover state
  const [subMenuAnchor, setSubMenuAnchor] = useState<HTMLElement | null>(null);
  const [subMenuActions, setSubMenuActions] = useState<Omit<ToolbarAction, 'subActions'>[]>([]);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const wasDragged = useRef(false);
  const dragStartClientY = useRef(0);
  const dragStartPercent = useRef(0);

  // Clean up legacy localStorage
  useEffect(() => {
    try { localStorage.removeItem('arsenale-floating-toolbar-pos'); } catch { /* ignore */ }
  }, []);

  const visibleActions = actions.filter((a) => !a.hidden);

  const clampY = useCallback((percent: number, containerHeight?: number) => {
    const toolbar = toolbarRef.current;
    const h = containerHeight && toolbar ? toolbar.offsetHeight : 0;
    const ch = containerHeight ?? window.innerHeight;
    if (ch > 0 && h > 0) {
      const minPercent = (h / 2 / ch) * 100;
      const maxPercent = ((ch - h / 2) / ch) * 100;
      return Math.max(minPercent, Math.min(maxPercent, percent));
    }
    return Math.max(5, Math.min(95, percent));
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only drag from the handle, not from action buttons
    if ((e.target as HTMLElement).closest('[data-toolbar-action]')) return;
    draggingRef.current = true;
    wasDragged.current = false;
    setIsDragging(true);
    dragStartClientY.current = e.clientY;
    dragStartPercent.current = localY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [localY]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    wasDragged.current = true;

    const container = containerRef?.current;
    const containerHeight = container ? container.clientHeight : window.innerHeight;
    if (!containerHeight) return;
    const deltaPixels = e.clientY - dragStartClientY.current;
    const deltaPercent = (deltaPixels / containerHeight) * 100;
    setLocalY(clampY(dragStartPercent.current + deltaPercent, containerHeight));

    // Side-switching: check if pointer crossed container center
    if (container) {
      const rect = container.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      if (localSide === 'left' && e.clientX > centerX + FLIP_THRESHOLD) {
        setLocalSide('right');
      } else if (localSide === 'right' && e.clientX < centerX - FLIP_THRESHOLD) {
        setLocalSide('left');
      }
    }
  }, [containerRef, clampY, localSide]);

  const onPointerUp = useCallback(() => {
    if (draggingRef.current && wasDragged.current) {
      setPref('toolbarDockedY', localY);
      setPref('toolbarDockedSide', localSide);
    }
    draggingRef.current = false;
    setIsDragging(false);
  }, [localY, localSide, setPref]);

  const handleTriggerClick = useCallback(() => {
    if (wasDragged.current) return;
    setOpen((prev) => {
      if (prev) {
        // Closing: clear submenu too
        setSubMenuAnchor(null);
        setSubMenuActions([]);
      }
      return !prev;
    });
  }, []);

  const handleFlipSide = useCallback(() => {
    const newSide = localSide === 'left' ? 'right' : 'left';
    setLocalSide(newSide);
    setPref('toolbarDockedSide', newSide);
  }, [localSide, setPref]);

  const handleActionClick = useCallback((e: React.MouseEvent<HTMLButtonElement>, action: ToolbarAction) => {
    e.stopPropagation();
    if (action.subActions && action.subActions.length > 0) {
      setSubMenuAnchor(e.currentTarget);
      setSubMenuActions(action.subActions);
    } else {
      action.onClick();
    }
  }, []);

  const handleSubMenuClose = useCallback(() => {
    setSubMenuAnchor(null);
    setSubMenuActions([]);
  }, []);

  const handleSubAction = useCallback((action: Omit<ToolbarAction, 'subActions'>) => {
    action.onClick();
    handleSubMenuClose();
  }, [handleSubMenuClose]);

  if (visibleActions.length === 0) return null;

  const isLeft = localSide === 'left';

  return (
    <>
      <Box
        ref={toolbarRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        sx={{
          position: 'absolute',
          top: `${localY}%`,
          transform: 'translateY(-50%)',
          ...(isLeft ? { left: 0 } : { right: 0 }),
          zIndex: 3,
          display: 'flex',
          flexDirection: isLeft ? 'row' : 'row-reverse',
          alignItems: 'stretch',
          userSelect: 'none',
          touchAction: 'none',
          transition: isDragging ? 'none' : 'top 0.15s ease-out',
        }}
      >
        {/* Handle / pull-tab */}
        <Paper
          elevation={2}
          onClick={handleTriggerClick}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            minHeight: 48,
            cursor: isDragging ? 'grabbing' : 'grab',
            bgcolor: 'background.paper',
            opacity: hovered || open ? 0.9 : 0.4,
            transition: 'opacity 0.2s',
            borderRadius: isLeft ? '0 6px 6px 0' : '6px 0 0 6px',
            '&:hover': { opacity: 1 },
          }}
        >
          <DragIcon sx={{ fontSize: 14, color: 'text.secondary', transform: 'rotate(90deg)' }} />
        </Paper>

        {/* Expandable action panel */}
        <Paper
          elevation={4}
          aria-hidden={!open}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.25,
            py: 0.5,
            px: 0.25,
            overflow: 'hidden',
            maxWidth: open ? 48 : 0,
            opacity: open ? 1 : 0,
            visibility: open ? 'visible' : 'hidden',
            pointerEvents: open ? 'auto' : 'none',
            transition: 'max-width 0.2s ease-in-out, opacity 0.15s ease-in-out',
            borderRadius: isLeft ? '0 8px 8px 0' : '8px 0 0 8px',
            bgcolor: 'background.paper',
          }}
        >
          {visibleActions.map((action) => (
            <Tooltip
              key={action.id}
              title={action.tooltip}
              placement={isLeft ? 'right' : 'left'}
            >
              <span>
                <IconButton
                  data-toolbar-action
                  size="small"
                  disabled={action.disabled}
                  onClick={(e) => handleActionClick(e, action)}
                  sx={{
                    color: action.color
                      ? action.color
                      : action.active
                        ? 'primary.main'
                        : 'text.secondary',
                  }}
                >
                  {action.icon}
                </IconButton>
              </span>
            </Tooltip>
          ))}

          {/* Flip side button */}
          <Tooltip title="Switch side" placement={isLeft ? 'right' : 'left'}>
            <IconButton
              data-toolbar-action
              size="small"
              onClick={handleFlipSide}
              sx={{ color: 'text.disabled', mt: 0.5 }}
            >
              <FlipIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Paper>
      </Box>

      {/* Sub-actions popover (for Send Keys etc.) */}
      <Popover
        open={!!subMenuAnchor}
        anchorEl={subMenuAnchor}
        onClose={handleSubMenuClose}
        anchorOrigin={{
          vertical: 'center',
          horizontal: isLeft ? 'right' : 'left',
        }}
        transformOrigin={{
          vertical: 'center',
          horizontal: isLeft ? 'left' : 'right',
        }}
        slotProps={{
          paper: { sx: { minWidth: 140 } },
        }}
        {...(fullscreenContainer
          ? { container: fullscreenContainer, disablePortal: true }
          : {}
        )}
      >
        {subMenuActions.map((sub) => (
          <MenuItem
            key={sub.id}
            disabled={sub.disabled}
            onClick={() => handleSubAction(sub)}
          >
            {sub.icon && <ListItemIcon>{sub.icon}</ListItemIcon>}
            <ListItemText>{sub.tooltip}</ListItemText>
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}
