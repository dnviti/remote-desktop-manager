package files

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (s Service) loadTenantPolicy(ctx context.Context, tenantID string) (tenantFilePolicy, error) {
	if tenantID == "" || s.DB == nil {
		return tenantFilePolicy{}, nil
	}

	row := s.DB.QueryRow(ctx, `
SELECT
  "dlpDisableDownload",
  "dlpDisableUpload",
  "fileUploadMaxSizeBytes",
  "userDriveQuotaBytes"
FROM "Tenant"
WHERE id = $1
`, tenantID)

	var (
		policy             tenantFilePolicy
		fileUploadMaxBytes sql.NullInt32
		userDriveQuota     sql.NullInt32
	)
	if err := row.Scan(&policy.DLPDisableDownload, &policy.DLPDisableUpload, &fileUploadMaxBytes, &userDriveQuota); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantFilePolicy{}, nil
		}
		return tenantFilePolicy{}, fmt.Errorf("load tenant file policy: %w", err)
	}
	if fileUploadMaxBytes.Valid {
		value := int64(fileUploadMaxBytes.Int32)
		policy.FileUploadMaxBytes = &value
	}
	if userDriveQuota.Valid {
		value := int64(userDriveQuota.Int32)
		policy.UserDriveQuota = &value
	}
	return policy, nil
}

func (s Service) maxUploadBytes() int64 {
	if s.FileUploadMaxSize > 0 {
		return s.FileUploadMaxSize
	}
	return defaultMaxUploadBytes
}

func effectiveUploadLimit(limit *int64, fallback int64) int64 {
	if limit != nil && *limit > 0 {
		return *limit
	}
	return fallback
}

func (s Service) effectiveQuota(policy tenantFilePolicy) int64 {
	if policy.UserDriveQuota != nil {
		return *policy.UserDriveQuota
	}
	if s.UserDriveQuota > 0 {
		return s.UserDriveQuota
	}
	return defaultUserQuotaBytes
}

func quotaExceededMessage(currentUsage, quota int64) string {
	return fmt.Sprintf(
		"Drive quota exceeded. Current usage: %dMB, limit: %dMB",
		bytesToMB(currentUsage),
		bytesToMB(quota),
	)
}

func bytesToMB(value int64) int64 {
	if value <= 0 {
		return 0
	}
	return value / 1024 / 1024
}

func max(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
