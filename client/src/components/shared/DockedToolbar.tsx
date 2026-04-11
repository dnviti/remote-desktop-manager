import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';

export interface ToolbarAction {
  id: string;
  icon: React.ReactNode;
  tooltip: string;
  onClick: (event?: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  subActions?: Omit<ToolbarAction, 'subActions'>[];
  color?: string;
  hidden?: boolean;
  disabled?: boolean;
  badge?: string;
}

interface DockedToolbarProps {
  actions: ToolbarAction[];
  containerRef?: React.RefObject<HTMLElement | null>;
}

export default function DockedToolbar({ actions }: DockedToolbarProps) {
  const dockedSide = useUiPreferencesStore((s) => s.toolbarDockedSide);
  const setPref = useUiPreferencesStore((s) => s.set);
  const [collapsed, setCollapsed] = useState(false);

  const visibleActions = actions.filter((a) => !a.hidden);
  const isLeft = dockedSide === 'left';

  if (visibleActions.length === 0) return null;

  const toggleCollapse = () => setCollapsed((v) => !v);
  const flipSide = () => {
    const next = isLeft ? 'right' : 'left';
    setPref('toolbarDockedSide', next);
  };

  return (
    <div
      className={cn(
        'flex h-full shrink-0 border-border bg-card transition-[width] duration-150',
        isLeft ? 'border-r' : 'border-l',
        isLeft ? 'order-first' : 'order-last',
        collapsed ? 'w-5' : 'w-10',
      )}
    >
      <div
        className={cn(
          'flex h-full flex-col',
          isLeft ? 'items-center' : 'items-center',
          collapsed ? 'w-5' : 'w-10',
        )}
      >
        {/* Toggle button at top */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleCollapse}
              className="flex h-7 w-full shrink-0 items-center justify-center border-b text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={collapsed ? 'Expand toolbar' : 'Collapse toolbar'}
              aria-expanded={!collapsed}
            >
              {collapsed
                ? (isLeft ? <ChevronRight className="size-3" /> : <ChevronLeft className="size-3" />)
                : (isLeft ? <ChevronLeft className="size-3" /> : <ChevronRight className="size-3" />)}
            </button>
          </TooltipTrigger>
          <TooltipContent side={isLeft ? 'right' : 'left'}>
            {collapsed ? 'Expand toolbar' : 'Collapse toolbar'}
          </TooltipContent>
        </Tooltip>

        {/* Actions — hidden when collapsed */}
        {!collapsed ? (
          <div className="flex flex-1 flex-col items-center gap-0.5 overflow-y-auto py-1">
            {visibleActions.map((action) => {
              if (action.subActions && action.subActions.length > 0) {
                return (
                  <DropdownMenu key={action.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={action.disabled}
                            aria-label={action.tooltip}
                            className={cn(
                              action.active && 'text-primary',
                              action.color === 'error.main' && 'text-destructive',
                            )}
                          >
                            {action.icon}
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side={isLeft ? 'right' : 'left'}>{action.tooltip}</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent side={isLeft ? 'right' : 'left'}>
                      {action.subActions.map((sub) => (
                        <DropdownMenuItem key={sub.id} disabled={sub.disabled} onClick={() => sub.onClick()}>
                          {sub.icon && <span className="mr-2">{sub.icon}</span>}
                          {sub.tooltip}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              }

              return (
                <Tooltip key={action.id}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      disabled={action.disabled}
                      aria-label={action.tooltip}
                      onClick={(event) => action.onClick(event)}
                      className={cn(
                        action.active && 'text-primary',
                        action.color === 'error.main' && 'text-destructive',
                      )}
                    >
                      {action.icon}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side={isLeft ? 'right' : 'left'}>{action.tooltip}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ) : null}

        {/* Flip side button at bottom — only when expanded */}
        {!collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={flipSide}
                className="flex h-7 w-full shrink-0 items-center justify-center border-t text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Switch side"
              >
                {isLeft ? <ChevronRight className="size-3" /> : <ChevronLeft className="size-3" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side={isLeft ? 'right' : 'left'}>Switch side</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
