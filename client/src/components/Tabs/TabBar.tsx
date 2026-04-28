import { forwardRef } from 'react';
import { DatabaseZap, Monitor, TerminalSquare, X } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useTabsStore } from '@/store/tabsStore';
import type { Tab } from '@/store/tabsStore';
import { cn } from '@/lib/utils';

function tabIcon(type: string) {
  switch (type) {
    case 'SSH':
      return <TerminalSquare className="size-4" />;
    case 'VNC':
      return <Monitor className="size-4" />;
    case 'DATABASE':
      return <DatabaseZap className="size-4" />;
    default:
      return <Monitor className="size-4" />;
  }
}

interface DraggableTabProps {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
}

const DraggableTab = forwardRef<HTMLDivElement, DraggableTabProps>(function DraggableTab({
  tab,
  isActive,
  onActivate,
  onClose,
}, forwardedRef) {
  const { setNodeRef: setDraggableNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id: tab.id });
  const { setNodeRef: setDroppableNodeRef, isOver } = useDroppable({ id: tab.id });
  const setNodeRef = (node: HTMLDivElement | null) => {
    setDraggableNodeRef(node);
    setDroppableNodeRef(node);
    if (typeof forwardedRef === 'function') {
      forwardedRef(node);
    } else if (forwardedRef) {
      forwardedRef.current = node;
    }
  };
  const style = {
    transform: CSS.Translate.toString(transform),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group inline-flex shrink-0 touch-none items-center gap-1 rounded-lg border px-1.5 py-1 text-sm transition-colors',
        isActive
          ? 'border-primary/40 bg-primary/10 text-foreground'
          : 'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground',
        isDragging && 'opacity-70',
        isOver && !isDragging && 'border-primary/40',
      )}
      {...attributes}
      aria-label={`Drag ${tab.connection.name}`}
      {...listeners}
    >
      <button
        type="button"
        className="inline-flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={(event) => {
          event.currentTarget.blur();
          onActivate();
        }}
      >
        <span className={cn(isActive ? 'text-primary' : 'text-muted-foreground')}>
          {tabIcon(tab.connection.type)}
        </span>
        <span className="max-w-44 truncate">{tab.connection.name}</span>
      </button>
      <button
        type="button"
        aria-label={`Close ${tab.connection.name}`}
        className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <X className="size-3" />
      </button>
    </div>
  );
});

export default function TabBar() {
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);
  const setActiveTab = useTabsStore((state) => state.setActiveTab);
  const closeTab = useTabsStore((state) => state.closeTab);
  const moveTab = useTabsStore((state) => state.moveTab);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  if (tabs.length === 0) {
    return null;
  }

  const handleCloseOthers = (keepId: string) => {
    tabs.forEach((t) => { if (t.id !== keepId) closeTab(t.id); });
  };

  const handleCloseAll = () => {
    tabs.forEach((t) => closeTab(t.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : '';
    if (!overId || activeId === overId) return;
    const targetIndex = tabs.findIndex((tab) => tab.id === overId);
    if (targetIndex >= 0) {
      moveTab(activeId, targetIndex);
    }
  };

  return (
    <div className="border-b bg-background/70 px-2 py-1.5 backdrop-blur">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;

            return (
              <ContextMenu key={tab.id}>
                <ContextMenuTrigger asChild>
                  <DraggableTab
                    tab={tab}
                    isActive={isActive}
                    onActivate={() => setActiveTab(tab.id)}
                    onClose={() => closeTab(tab.id)}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem onSelect={() => closeTab(tab.id)}>
                    Close
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => handleCloseOthers(tab.id)} disabled={tabs.length <= 1}>
                    Close Others
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onSelect={handleCloseAll}>
                    Close All
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      </DndContext>
    </div>
  );
}
