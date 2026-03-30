package sshsessions

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type policySnapshot struct {
	DLPPolicy           resolvedDLP
	EnforcedSSHSettings map[string]any
}

func (s Service) loadPolicySnapshot(ctx context.Context, tenantID string, connectionDLP json.RawMessage) (policySnapshot, error) {
	var (
		tenantDlpDisableCopy     bool
		tenantDlpDisablePaste    bool
		tenantDlpDisableDownload bool
		tenantDlpDisableUpload   bool
		enforcedSettings         []byte
	)
	if strings.TrimSpace(tenantID) != "" {
		if err := s.DB.QueryRow(ctx, `
SELECT "dlpDisableCopy", "dlpDisablePaste", "dlpDisableDownload", "dlpDisableUpload", "enforcedConnectionSettings"
FROM "Tenant"
WHERE id = $1
`, tenantID).Scan(
			&tenantDlpDisableCopy,
			&tenantDlpDisablePaste,
			&tenantDlpDisableDownload,
			&tenantDlpDisableUpload,
			&enforcedSettings,
		); err != nil {
			return policySnapshot{}, fmt.Errorf("load tenant SSH policy: %w", err)
		}
	}

	var conn dlpPolicy
	if len(connectionDLP) > 0 {
		_ = json.Unmarshal(connectionDLP, &conn)
	}

	snapshot := policySnapshot{
		DLPPolicy: resolvedDLP{
			DisableCopy:     tenantDlpDisableCopy || conn.DisableCopy,
			DisablePaste:    tenantDlpDisablePaste || conn.DisablePaste,
			DisableDownload: tenantDlpDisableDownload || conn.DisableDownload,
			DisableUpload:   tenantDlpDisableUpload || conn.DisableUpload,
		},
	}

	if len(enforcedSettings) > 0 && string(enforcedSettings) != "null" {
		var parsed struct {
			SSH map[string]any `json:"ssh"`
		}
		if err := json.Unmarshal(enforcedSettings, &parsed); err == nil && len(parsed.SSH) > 0 {
			snapshot.EnforcedSSHSettings = parsed.SSH
		}
	}

	return snapshot, nil
}
