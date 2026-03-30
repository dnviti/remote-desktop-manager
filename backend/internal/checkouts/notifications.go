package checkouts

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Service) validateRequestTarget(ctx context.Context, requesterID string, secretID, connectionID *string) (string, string, error) {
	if secretID != nil {
		var ownerID string
		if err := s.DB.QueryRow(ctx, `SELECT "userId" FROM "VaultSecret" WHERE id = $1`, *secretID).Scan(&ownerID); err != nil {
			if err == pgx.ErrNoRows {
				return "", "", &requestError{status: 404, message: "Secret not found"}
			}
			return "", "", fmt.Errorf("load checkout secret: %w", err)
		}
		if ownerID == requesterID {
			return "", "", &requestError{status: 400, message: "Cannot check out your own secret"}
		}
		return "VaultSecret", *secretID, nil
	}
	var ownerID string
	if err := s.DB.QueryRow(ctx, `SELECT "userId" FROM "Connection" WHERE id = $1`, *connectionID).Scan(&ownerID); err != nil {
		if err == pgx.ErrNoRows {
			return "", "", &requestError{status: 404, message: "Connection not found"}
		}
		return "", "", fmt.Errorf("load checkout connection: %w", err)
	}
	if ownerID == requesterID {
		return "", "", &requestError{status: 400, message: "Cannot check out your own connection"}
	}
	return "Connection", *connectionID, nil
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetType, targetID string, details map[string]any, ipAddress string) error {
	var payload any
	if details != nil {
		rawDetails, err := json.Marshal(details)
		if err != nil {
			return fmt.Errorf("marshal audit details: %w", err)
		}
		payload = string(rawDetails)
	}
	_, err := s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress")
VALUES ($1, $2, $3::"AuditAction", NULLIF($4, ''), NULLIF($5, ''), $6::jsonb, NULLIF($7, ''))
`, newID(), userID, action, targetType, targetID, payload, ipAddress)
	return err
}

func (s Service) notifyApprovers(ctx context.Context, requesterID string, entry checkoutEntry) error {
	approverIDs, err := s.findApproverIDs(ctx, entry.SecretID, entry.ConnectionID)
	if err != nil {
		return err
	}
	if len(approverIDs) == 0 {
		return nil
	}
	targetLabel := checkoutTargetLabel(entry)
	message := fmt.Sprintf("%s requests temporary access to %s for %d minutes", displayUserSummary(entry.Requester), targetLabel, entry.DurationMinutes)
	for _, approverID := range approverIDs {
		if approverID == requesterID {
			continue
		}
		if err := s.insertNotification(ctx, approverID, "SECRET_CHECKOUT_REQUESTED", message, entry.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s Service) notifyRequester(ctx context.Context, requesterID, notificationType, relatedID, message string) error {
	return s.insertNotification(ctx, requesterID, notificationType, message, relatedID)
}

func (s Service) checkoutApprovalMessage(ctx context.Context, entry checkoutEntry, approverID string) (string, error) {
	approver, err := s.loadUserSummary(ctx, approverID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s approved your checkout of %s for %d minutes", displayUserSummary(approver), checkoutTargetLabel(entry), entry.DurationMinutes), nil
}

func (s Service) checkoutRejectionMessage(ctx context.Context, entry checkoutEntry, approverID string) (string, error) {
	approver, err := s.loadUserSummary(ctx, approverID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s denied your checkout of %s", displayUserSummary(approver), checkoutTargetLabel(entry)), nil
}

func (s Service) findApproverIDs(ctx context.Context, secretID, connectionID *string) ([]string, error) {
	ids := make([]string, 0, 4)
	appendUnique := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		for _, existing := range ids {
			if existing == value {
				return
			}
		}
		ids = append(ids, value)
	}

	if secretID != nil {
		var ownerID string
		var tenantID sql.NullString
		if err := s.DB.QueryRow(ctx, `SELECT "userId", "tenantId" FROM "VaultSecret" WHERE id = $1`, *secretID).Scan(&ownerID, &tenantID); err != nil {
			return nil, fmt.Errorf("load checkout secret approvers: %w", err)
		}
		appendUnique(ownerID)
		if tenantID.Valid {
			rows, err := s.DB.Query(ctx, `
SELECT "userId"
FROM "TenantMember"
WHERE "tenantId" = $1 AND role IN ('OWNER', 'ADMIN')
`, tenantID.String)
			if err != nil {
				return nil, fmt.Errorf("list tenant checkout approvers: %w", err)
			}
			defer rows.Close()
			for rows.Next() {
				var userID string
				if err := rows.Scan(&userID); err != nil {
					return nil, fmt.Errorf("scan tenant checkout approver: %w", err)
				}
				appendUnique(userID)
			}
			if err := rows.Err(); err != nil {
				return nil, fmt.Errorf("iterate tenant checkout approvers: %w", err)
			}
		}
		return ids, nil
	}

	if connectionID != nil {
		var ownerID string
		var teamID sql.NullString
		if err := s.DB.QueryRow(ctx, `SELECT "userId", "teamId" FROM "Connection" WHERE id = $1`, *connectionID).Scan(&ownerID, &teamID); err != nil {
			return nil, fmt.Errorf("load checkout connection approvers: %w", err)
		}
		appendUnique(ownerID)
		if teamID.Valid {
			rows, err := s.DB.Query(ctx, `
SELECT "userId"
FROM "TeamMember"
WHERE "teamId" = $1 AND role = 'TEAM_ADMIN'
`, teamID.String)
			if err != nil {
				return nil, fmt.Errorf("list team checkout approvers: %w", err)
			}
			defer rows.Close()
			for rows.Next() {
				var userID string
				if err := rows.Scan(&userID); err != nil {
					return nil, fmt.Errorf("scan team checkout approver: %w", err)
				}
				appendUnique(userID)
			}
			if err := rows.Err(); err != nil {
				return nil, fmt.Errorf("iterate team checkout approvers: %w", err)
			}
		}
	}
	return ids, nil
}

func (s Service) insertNotification(ctx context.Context, userID, notificationType, message, relatedID string) error {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(message) == "" {
		return nil
	}
	_, err := s.DB.Exec(ctx, `
INSERT INTO "Notification" (id, "userId", type, message, read, "relatedId", "createdAt")
VALUES ($1, $2, $3::"NotificationType", $4, false, NULLIF($5, ''), NOW())
`, uuid.NewString(), userID, notificationType, message, relatedID)
	if err != nil {
		return fmt.Errorf("insert notification: %w", err)
	}
	return nil
}

func (s Service) loadUserSummary(ctx context.Context, userID string) (userSummary, error) {
	var result userSummary
	var username sql.NullString
	if err := s.DB.QueryRow(ctx, `SELECT email, username FROM "User" WHERE id = $1`, userID).Scan(&result.Email, &username); err != nil {
		if err == pgx.ErrNoRows {
			return userSummary{Email: "An administrator"}, nil
		}
		return userSummary{}, fmt.Errorf("load user summary: %w", err)
	}
	if username.Valid {
		result.Username = &username.String
	}
	return result, nil
}
