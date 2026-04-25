import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ChevronRight,
  Command,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useAuthStore } from '../../store/authStore';
import { getProfile } from '../../api/user.api';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { isAdminOrAbove } from '../../utils/roles';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import type { SessionsRouteState } from '@/components/sessions/sessionConsoleRoute';
import {
  buildSettingsConcerns,
  type SettingsConcern,
  type SettingsSection,
} from './settingsConcerns';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  initialTab?: string;
  linkedProvider?: string | null;
  onViewUserProfile?: (userId: string) => void;
  onImport?: () => void;
  onExport?: () => void;
  onOpenSessions?: (initialState?: Partial<SessionsRouteState>) => void;
}

const LEGACY_TAB_TO_CONCERN: Record<string, string> = {
  profile: 'personal',
  appearance: 'personal',
  notifications: 'personal',
  connections: 'personal',
  security: 'security',
  organization: 'organization',
  teams: 'organization',
  gateways: 'infrastructure',
  tunnel: 'infrastructure',
  integrations: 'integrations',
  administration: 'governance',
};

function resolveConcernTarget(target: string) {
  return LEGACY_TAB_TO_CONCERN[target] ?? target;
}

function sectionMatches(section: SettingsSection, query: string) {
  if (!query) return true;
  const haystack = [section.label, section.description, ...section.keywords]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function concernMatches(concern: SettingsConcern, query: string) {
  if (!query) return true;
  const haystack = [concern.label, concern.description, ...concern.keywords]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export default function SettingsDialog({
  open,
  onClose,
  initialTab,
  linkedProvider,
  onViewUserProfile,
  onImport,
  onExport,
  onOpenSessions,
}: SettingsDialogProps) {
  const user = useAuthStore((s) => s.user);
  const connectionsEnabled = useFeatureFlagsStore(
    (s) => s.connectionsEnabled,
  );
  const databaseProxyEnabled = useFeatureFlagsStore(
    (s) => s.databaseProxyEnabled,
  );
  const keychainEnabled = useFeatureFlagsStore((s) => s.keychainEnabled);
  const zeroTrustEnabled = useFeatureFlagsStore((s) => s.zeroTrustEnabled);
  const agenticAIEnabled = useFeatureFlagsStore((s) => s.agenticAIEnabled);
  const enterpriseAuthEnabled = useFeatureFlagsStore(
    (s) => s.enterpriseAuthEnabled,
  );
  const storedConcern = useUiPreferencesStore((s) => s.settingsActiveTab);
  const setPreference = useUiPreferencesStore((s) => s.set);

  const [hasPassword, setHasPassword] = useState(true);
  const [deleteOrgTrigger, setDeleteOrgTriggerState] = useState<
    (() => void) | null
  >(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [selectedConcern, setSelectedConcern] = useState<string | null>(null);
  const [manualExpandedConcerns, setManualExpandedConcerns] = useState<Set<string>>(
    new Set(),
  );
  const [requestedActiveSectionId, setRequestedActiveSectionId] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const activeSectionRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollResetRef = useRef<number | null>(null);

  const registerDeleteOrgTrigger = useCallback(
    (trigger: (() => void) | null) => {
      setDeleteOrgTriggerState(() => trigger);
    },
    [],
  );

  const hasTenant = Boolean(user?.tenantId);
  const isAdmin = isAdminOrAbove(user?.tenantRole);
  const isOwner = user?.tenantRole === 'OWNER';
  const anyConnectionFeature = connectionsEnabled || databaseProxyEnabled;

  const concerns = useMemo(
    () =>
      buildSettingsConcerns({
        hasPassword,
        hasTenant,
        isAdmin,
        isOwner,
        anyConnectionFeature,
        connectionsEnabled,
        databaseProxyEnabled,
        keychainEnabled,
        zeroTrustEnabled,
        agenticAIEnabled,
        enterpriseAuthEnabled,
        linkedProvider,
        tenantId: user?.tenantId ?? null,
        onHasPasswordResolved: setHasPassword,
        onViewUserProfile,
        onImport,
        onExport,
        onOpenSessions,
        deleteOrgTrigger,
        setDeleteOrgTrigger: registerDeleteOrgTrigger,
        navigateToConcern: (target) =>
          setSelectedConcern(resolveConcernTarget(target)),
      }),
    [
      agenticAIEnabled,
      anyConnectionFeature,
      connectionsEnabled,
      databaseProxyEnabled,
      deleteOrgTrigger,
      enterpriseAuthEnabled,
      hasPassword,
      hasTenant,
      isAdmin,
      isOwner,
      keychainEnabled,
      linkedProvider,
      onExport,
      onImport,
      onOpenSessions,
      onViewUserProfile,
      registerDeleteOrgTrigger,
      user?.tenantId,
      zeroTrustEnabled,
    ],
  );

  const concernIds = useMemo(
    () => new Set(concerns.map((concern) => concern.id)),
    [concerns],
  );

  const filteredConcerns = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return concerns
      .map((concern) => {
        const matchingSections = concern.sections.filter((section) =>
          sectionMatches(section, query),
        );
        return concernMatches(concern, query) || matchingSections.length > 0
          ? {
            ...concern,
            sections:
              matchingSections.length > 0 || !query
                ? matchingSections
                : concern.sections,
          }
          : null;
      })
      .filter(
        (concern): concern is SettingsConcern => concern !== null,
      );
  }, [concerns, deferredSearch]);

  const availableConcernIds = useMemo(
    () => new Set(filteredConcerns.map((concern) => concern.id)),
    [filteredConcerns],
  );

  const defaultConcern = useMemo(
    () =>
      (initialTab ? resolveConcernTarget(initialTab) : null) ??
      (storedConcern ? resolveConcernTarget(storedConcern) : null) ??
      concerns[0]?.id ??
      'personal',
    [concerns, initialTab, storedConcern],
  );

  const persistedConcern =
    selectedConcern && concernIds.has(selectedConcern)
      ? selectedConcern
      : concernIds.has(defaultConcern)
        ? defaultConcern
        : concerns[0]?.id ?? 'personal';

  const resolvedConcern = availableConcernIds.has(persistedConcern)
    ? persistedConcern
    : filteredConcerns[0]?.id ?? persistedConcern;

  const effectiveExpandedConcerns = useMemo(() => {
    const next = new Set(manualExpandedConcerns);

    if (resolvedConcern) {
      next.add(resolvedConcern);
    }

    if (deferredSearch.trim()) {
      filteredConcerns.forEach((concern) => next.add(concern.id));
    }

    return next;
  }, [deferredSearch, filteredConcerns, manualExpandedConcerns, resolvedConcern]);

  const currentConcern =
    filteredConcerns.find((concern) => concern.id === resolvedConcern) ??
    filteredConcerns[0];

  useEffect(() => {
    if (!open) return;

    getProfile()
      .then((profile) => setHasPassword(profile.hasPassword))
      .catch(() => { });
  }, [open]);

  useEffect(() => {
    if (!open || !persistedConcern) return;
    setPreference('settingsActiveTab', persistedConcern);
  }, [open, persistedConcern, setPreference]);

  const currentSectionIds = currentConcern?.sections.map((section) => section.id) ?? [];
  const effectiveActiveSectionId =
    requestedActiveSectionId && currentSectionIds.includes(requestedActiveSectionId)
      ? requestedActiveSectionId
      : currentSectionIds[0] ?? null;

  // Single section rendered at a time — sidebar clicks drive navigation.
  const activeSection =
    currentConcern?.sections.find((s) => s.id === effectiveActiveSectionId) ??
    currentConcern?.sections[0];
  const activeSectionLabel = activeSection?.label;

  useEffect(() => {
    if (!open) return;

    const sectionElement = activeSectionRef.current;
    const scrollContainer =
      scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') instanceof HTMLElement
        ? (scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement)
        : scrollAreaRef.current;

    if (!sectionElement || !scrollContainer || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries.find((entry) => entry.isIntersecting);
        if (!visibleEntry || programmaticScrollRef.current) {
          return;
        }

        const nextSectionId = (visibleEntry.target as HTMLElement).id;
        setRequestedActiveSectionId((prev) =>
          prev === nextSectionId ? prev : nextSectionId,
        );
      },
      {
        root: scrollContainer,
        threshold: 0.6,
      },
    );

    observer.observe(sectionElement);
    return () => observer.disconnect();
  }, [activeSection?.id, open]);

  // Keyboard shortcut: "/" to focus search
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        e.preventDefault();
        setSearch('');
        searchInputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const toggleConcernExpanded = (concernId: string) => {
    setManualExpandedConcerns((prev) => {
      const next = new Set(prev);
      if (next.has(concernId)) {
        next.delete(concernId);
      } else {
        next.add(concernId);
      }
      return next;
    });
  };

  const jumpToSection = (sectionId: string) => {
    setRequestedActiveSectionId(sectionId);
    programmaticScrollRef.current = true;
    if (programmaticScrollResetRef.current !== null) {
      window.clearTimeout(programmaticScrollResetRef.current);
    }
    const scrollContainer =
      scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') instanceof HTMLElement
        ? (scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement)
        : scrollAreaRef.current;
    if (scrollContainer instanceof HTMLElement && typeof scrollContainer.scrollTo === 'function') {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    }
    programmaticScrollResetRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollResetRef.current = null;
    }, 250);
  };

  const handleConcernClick = (concernId: string) => {
    setSelectedConcern(concernId);
    setManualExpandedConcerns((prev) => {
      if (prev.has(concernId)) return prev;
      const next = new Set(prev);
      next.add(concernId);
      return next;
    });
    const concern = concerns.find((c) => c.id === concernId);
    const firstSectionId = concern?.sections[0]?.id;
    if (firstSectionId) {
      jumpToSection(firstSectionId);
    }
  };

  const handleDialogOpenChange = (next: boolean) => {
    if (next) return;
    if (programmaticScrollResetRef.current !== null) {
      window.clearTimeout(programmaticScrollResetRef.current);
      programmaticScrollResetRef.current = null;
    }
    programmaticScrollRef.current = false;
    setSearch('');
    setSelectedConcern(null);
    setRequestedActiveSectionId(null);
    setDeleteOrgTriggerState(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="h-[100dvh] w-screen max-w-none gap-0 rounded-none border-0 p-0 sm:h-[94vh] sm:w-[96vw] sm:max-w-[1500px] sm:overflow-hidden sm:rounded-2xl sm:border"
      >
        <div className="flex h-full min-h-0 min-w-0 flex-col bg-background sm:flex-row">
          {/* ── Sidebar ── */}
          <aside className="settings-sidebar flex w-full shrink-0 flex-col border-b bg-card/30 sm:w-[272px] sm:border-b-0 sm:border-r">
            <DialogHeader className="gap-3 px-4 pb-3 pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Settings2 className="size-3.5" />
                  </div>
                  <div>
                    <DialogTitle className="text-sm font-semibold tracking-tight">
                      Settings
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                      Workspace configuration organized by concern.
                    </DialogDescription>
                  </div>
                </div>
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label="Close settings"
                  >
                    <X className="size-3.5" />
                  </Button>
                </DialogClose>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search settings..."
                  className="h-8 pl-8 pr-12 text-xs"
                />
                <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 select-none rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  /
                </kbd>
              </div>
            </DialogHeader>

            <Separator />

            <ScrollArea className="min-h-0 flex-1">
              <nav className="p-2" aria-label="Settings navigation">
                {filteredConcerns.map((concern) => {
                  const isActive = concern.id === resolvedConcern;
                  const isExpanded = effectiveExpandedConcerns.has(concern.id);

                  return (
                    <div key={concern.id} className="mb-0.5">
                      {/* Concern header */}
                      <button
                        type="button"
                        onClick={() => {
                          if (concern.id === resolvedConcern) {
                            toggleConcernExpanded(concern.id);
                            return;
                          }

                          handleConcernClick(concern.id);
                        }}
                        className={cn(
                          'group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                          isActive
                            ? 'bg-primary/8 text-foreground'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            'size-3 shrink-0 text-muted-foreground transition-transform duration-200',
                            isExpanded && 'rotate-90',
                          )}
                        />
                        <span
                          className={cn(
                            'inline-flex size-6 items-center justify-center rounded-md transition-colors',
                            isActive
                              ? 'bg-primary/15 text-primary'
                              : 'bg-muted/60 text-muted-foreground group-hover:text-foreground',
                          )}
                        >
                          {concern.icon}
                        </span>
                        <span className="flex-1 truncate text-xs font-medium">
                          {concern.label}
                        </span>
                        <span
                          className={cn(
                            'font-mono text-[10px] tabular-nums',
                            isActive
                              ? 'text-primary/70'
                              : 'text-muted-foreground/50',
                          )}
                        >
                          {concern.sections.length}
                        </span>
                      </button>

                      {/* Section tree items */}
                      {isExpanded && (
                        <div className="ml-[18px] border-l border-border/50 py-0.5 pl-0">
                          {concern.sections.map((section) => {
                            const isSectionActive =
                              isActive &&
                              effectiveActiveSectionId === section.id;

                            return (
                              <button
                                key={section.id}
                                type="button"
                                onClick={() => {
                                  if (concern.id !== resolvedConcern) {
                                    setSelectedConcern(concern.id);
                                  }
                                  jumpToSection(section.id);
                                }}
                                className={cn(
                                  'relative flex w-full items-center gap-2 py-1.5 pl-4 pr-2 text-left text-xs transition-colors',
                                  isSectionActive
                                    ? 'text-primary font-medium'
                                    : 'text-muted-foreground hover:text-foreground',
                                )}
                              >
                                {/* Active indicator bar */}
                                {isSectionActive && (
                                  <span className="absolute -left-px top-1 bottom-1 w-px bg-primary" />
                                )}
                                <span className="truncate">
                                  {section.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>
            </ScrollArea>

            {/* Sidebar footer with shortcut hints */}
            <Separator />
            <div className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-0.5 font-mono text-[9px]">
                  <Command className="inline size-2.5" />
                </kbd>
                <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-0.5 font-mono text-[9px]">
                  K
                </kbd>
                <span>search</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-0.5 font-mono text-[9px]">
                  Esc
                </kbd>
                <span>close</span>
              </div>
            </div>
          </aside>

          {/* ── Main content ── */}
          <main className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
            {/* Compact header with breadcrumb */}
            <div className="flex items-center justify-between border-b px-5 py-3">
              {currentConcern ? (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                    {currentConcern.icon}
                  </span>
                  <div className="flex items-center gap-1.5 min-w-0 text-sm">
                    <span className="font-semibold text-foreground truncate">
                      {currentConcern.label}
                    </span>
                    {activeSectionLabel && (
                      <>
                        <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" />
                        <span className="truncate text-muted-foreground">
                          {activeSectionLabel}
                        </span>
                      </>
                    )}
                  </div>
                  {deferredSearch && (
                    <Badge
                      variant="outline"
                      className="ml-2 shrink-0 text-[10px] font-mono"
                    >
                      filter: {deferredSearch}
                    </Badge>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No settings matched your search.
                </div>
              )}

              {/* Section quick-jump pills */}
              {currentConcern && currentConcern.sections.length > 1 && (
                <div className="hidden items-center gap-1 lg:flex">
                  {currentConcern.sections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => jumpToSection(section.id)}
                      className={cn(
                        'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                        effectiveActiveSectionId === section.id
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                      )}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Scrollable content — single active section at a time */}
            <div ref={scrollAreaRef} className="min-h-0 min-w-0 w-full flex-1 overflow-y-auto">
              <div className="settings-content min-w-0 w-full px-5 py-5">
                {activeSection && (
                  <section
                    ref={activeSectionRef}
                    key={activeSection.id}
                    id={activeSection.id}
                    className="settings-section min-w-0 w-full"
                  >
                    {/*
                    <div className="mb-4">
                      <h3 className="text-sm font-semibold text-foreground">
                        {activeSection.label}
                      </h3>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        {activeSection.description}
                      </p>
                    </div>
                    */}
                    {activeSection.content}
                  </section>
                )}
              </div>
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
