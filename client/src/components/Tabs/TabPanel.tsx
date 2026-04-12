import { lazy, Suspense } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useTabsStore } from '@/store/tabsStore';

const SshTerminal = lazy(() => import('../Terminal/SshTerminal'));
const RdpViewer = lazy(() => import('../RDP/RdpViewer'));
const VncViewer = lazy(() => import('../VNC/VncViewer'));
const DbEditor = lazy(() => import('../DatabaseClient/DbEditor'));

function TabPanelFallback() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <LoaderCircle className="size-6 animate-spin text-primary" />
    </div>
  );
}

export default function TabPanel() {
  const tabs = useTabsStore((state) => state.tabs);
  const activeTabId = useTabsStore((state) => state.activeTabId);

  if (tabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-center">
        <p className="text-lg text-muted-foreground">
          Double-click a connection to open it
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`absolute inset-0 ${tab.id === activeTabId ? 'flex' : 'hidden'}`}
        >
          <Suspense fallback={<TabPanelFallback />}>
            {tab.connection.type === 'SSH' ? (
              <SshTerminal
                connectionId={tab.connection.id}
                tabId={tab.id}
                isActive={tab.id === activeTabId}
                credentials={tab.credentials}
                sshTerminalConfig={tab.connection.sshTerminalConfig}
              />
            ) : tab.connection.type === 'VNC' ? (
              <VncViewer
                connectionId={tab.connection.id}
                tabId={tab.id}
                isActive={tab.id === activeTabId}
                credentials={tab.credentials}
              />
            ) : tab.connection.type === 'DATABASE' ? (
              <DbEditor
                connectionId={tab.connection.id}
                tabId={tab.id}
                isActive={tab.id === activeTabId}
                credentials={tab.credentials}
                initialProtocol={tab.connection.dbSettings?.protocol}
                dbSettings={tab.connection.dbSettings}
              />
            ) : (
              <RdpViewer
                connectionId={tab.connection.id}
                tabId={tab.id}
                isActive={tab.id === activeTabId}
                enableDrive={tab.connection.enableDrive}
                credentials={tab.credentials}
              />
            )}
          </Suspense>
        </div>
      ))}
    </div>
  );
}
