package files

import (
	"context"
	"os"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/sessions"
)

func init() {
	sessions.RegisterSandboxCleanupHook(func(ctx context.Context, scope sessions.SandboxCleanupScope) error {
		protocol := normalizeSandboxProtocol(scope.Protocol)
		if protocol != "ssh" && protocol != "rdp" {
			return nil
		}

		store, err := LoadObjectStoreFromEnv(context.WithoutCancel(ctx))
		if err != nil {
			return newSharedFilesStorageUnavailableError(err)
		}

		service := Service{
			Store:         store,
			DriveBasePath: firstNonEmpty(strings.TrimSpace(os.Getenv("DRIVE_BASE_PATH")), defaultDriveBasePath),
		}
		return service.ReconcileManagedSandbox(context.WithoutCancel(ctx), newManagedSandboxScopeWithLabels(protocol, scope.TenantID, scope.UserID, scope.ConnectionID, scope.TenantName, scope.UserEmail, scope.ConnectionName), 0)
	})
}
