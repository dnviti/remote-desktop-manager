package checkouts

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s Service) Create(ctx context.Context, requesterID string, payload createPayload, ipAddress string) (checkoutEntry, error) {
	if s.DB == nil {
		return checkoutEntry{}, errors.New("database is unavailable")
	}
	secretID := normalizeOptionalString(payload.SecretID)
	connectionID := normalizeOptionalString(payload.ConnectionID)
	if (secretID == nil && connectionID == nil) || (secretID != nil && connectionID != nil) {
		return checkoutEntry{}, &requestError{status: http.StatusBadRequest, message: "Provide either secretId or connectionId, not both"}
	}
	if payload.DurationMinutes < 1 || payload.DurationMinutes > 1440 {
		return checkoutEntry{}, &requestError{status: http.StatusBadRequest, message: "Duration must be between 1 and 1440 minutes (24h)"}
	}
	if reason := valueOrEmpty(payload.Reason); len(reason) > 500 {
		return checkoutEntry{}, &requestError{status: http.StatusBadRequest, message: "Reason must be 500 characters or fewer"}
	}

	targetType, targetID, err := s.validateRequestTarget(ctx, requesterID, secretID, connectionID)
	if err != nil {
		return checkoutEntry{}, err
	}

	var duplicateExists bool
	query := `
SELECT EXISTS(
  SELECT 1
  FROM "SecretCheckoutRequest"
  WHERE "requesterId" = $1
    AND status = 'PENDING'
    AND ((COALESCE("secretId", '') = COALESCE($2, '')) AND (COALESCE("connectionId", '') = COALESCE($3, '')))
)
`
	if err := s.DB.QueryRow(ctx, query, requesterID, secretID, connectionID).Scan(&duplicateExists); err != nil {
		return checkoutEntry{}, fmt.Errorf("check duplicate checkout request: %w", err)
	}
	if duplicateExists {
		return checkoutEntry{}, &requestError{status: http.StatusConflict, message: "A pending checkout request already exists for this resource"}
	}

	checkoutID := newID()
	now := time.Now().UTC()
	if _, err := s.DB.Exec(ctx, `
INSERT INTO "SecretCheckoutRequest" (
  id, "secretId", "connectionId", "requesterId", status, "durationMinutes", reason, "createdAt", "updatedAt"
)
VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, $7)
`, checkoutID, secretID, connectionID, requesterID, payload.DurationMinutes, normalizeOptionalString(payload.Reason), now); err != nil {
		return checkoutEntry{}, fmt.Errorf("create checkout request: %w", err)
	}

	if err := s.insertAuditLog(ctx, requesterID, "SECRET_CHECKOUT_REQUESTED", targetType, targetID, map[string]any{
		"checkoutId":      checkoutID,
		"durationMinutes": payload.DurationMinutes,
		"reason":          strings.TrimSpace(valueOrEmpty(payload.Reason)),
	}, ipAddress); err != nil {
		return checkoutEntry{}, fmt.Errorf("insert checkout request audit: %w", err)
	}
	result, err := s.loadByID(ctx, checkoutID)
	if err != nil {
		return checkoutEntry{}, err
	}
	if err := s.notifyApprovers(ctx, requesterID, result); err != nil {
		return checkoutEntry{}, fmt.Errorf("notify checkout approvers: %w", err)
	}
	return result, nil
}

func (s Service) Approve(ctx context.Context, checkoutID, approverID, ipAddress string) (checkoutEntry, error) {
	entry, err := s.loadByID(ctx, checkoutID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return checkoutEntry{}, &requestError{status: http.StatusNotFound, message: "Checkout request not found"}
		}
		return checkoutEntry{}, err
	}
	if entry.Status != "PENDING" {
		return checkoutEntry{}, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("Request is already %s", strings.ToLower(entry.Status))}
	}
	allowed, err := s.userCanApproveResource(ctx, approverID, entry.SecretID, entry.ConnectionID)
	if err != nil {
		return checkoutEntry{}, err
	}
	if !allowed {
		return checkoutEntry{}, &requestError{status: http.StatusForbidden, message: "You are not authorized to approve this request"}
	}

	expiresAt := time.Now().UTC().Add(time.Duration(entry.DurationMinutes) * time.Minute)
	commandTag, err := s.DB.Exec(ctx, `
UPDATE "SecretCheckoutRequest"
SET status = 'APPROVED', "approverId" = $2, "expiresAt" = $3, "updatedAt" = NOW()
WHERE id = $1 AND status = 'PENDING'
`, checkoutID, approverID, expiresAt)
	if err != nil {
		return checkoutEntry{}, fmt.Errorf("approve checkout request: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return checkoutEntry{}, &requestError{status: http.StatusConflict, message: "Request was already processed by another user"}
	}

	if err := s.insertAuditLog(ctx, approverID, "SECRET_CHECKOUT_APPROVED", targetType(entry.SecretID, entry.ConnectionID), targetID(entry.SecretID, entry.ConnectionID), map[string]any{
		"checkoutId":      checkoutID,
		"requesterId":     entry.RequesterID,
		"durationMinutes": entry.DurationMinutes,
		"expiresAt":       expiresAt.Format(time.RFC3339),
	}, ipAddress); err != nil {
		return checkoutEntry{}, fmt.Errorf("insert checkout approve audit: %w", err)
	}
	result, err := s.loadByID(ctx, checkoutID)
	if err != nil {
		return checkoutEntry{}, err
	}
	message, err := s.checkoutApprovalMessage(ctx, result, approverID)
	if err != nil {
		return checkoutEntry{}, err
	}
	if err := s.notifyRequester(ctx, result.RequesterID, "SECRET_CHECKOUT_APPROVED", checkoutID, message); err != nil {
		return checkoutEntry{}, fmt.Errorf("notify checkout approval: %w", err)
	}
	return result, nil
}

func (s Service) Reject(ctx context.Context, checkoutID, approverID, ipAddress string) (checkoutEntry, error) {
	entry, err := s.loadByID(ctx, checkoutID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return checkoutEntry{}, &requestError{status: http.StatusNotFound, message: "Checkout request not found"}
		}
		return checkoutEntry{}, err
	}
	if entry.Status != "PENDING" {
		return checkoutEntry{}, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("Request is already %s", strings.ToLower(entry.Status))}
	}
	allowed, err := s.userCanApproveResource(ctx, approverID, entry.SecretID, entry.ConnectionID)
	if err != nil {
		return checkoutEntry{}, err
	}
	if !allowed {
		return checkoutEntry{}, &requestError{status: http.StatusForbidden, message: "You are not authorized to reject this request"}
	}

	commandTag, err := s.DB.Exec(ctx, `
UPDATE "SecretCheckoutRequest"
SET status = 'REJECTED', "approverId" = $2, "updatedAt" = NOW()
WHERE id = $1 AND status = 'PENDING'
`, checkoutID, approverID)
	if err != nil {
		return checkoutEntry{}, fmt.Errorf("reject checkout request: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return checkoutEntry{}, &requestError{status: http.StatusConflict, message: "Request was already processed by another user"}
	}

	if err := s.insertAuditLog(ctx, approverID, "SECRET_CHECKOUT_DENIED", targetType(entry.SecretID, entry.ConnectionID), targetID(entry.SecretID, entry.ConnectionID), map[string]any{
		"checkoutId":  checkoutID,
		"requesterId": entry.RequesterID,
	}, ipAddress); err != nil {
		return checkoutEntry{}, fmt.Errorf("insert checkout reject audit: %w", err)
	}
	result, err := s.loadByID(ctx, checkoutID)
	if err != nil {
		return checkoutEntry{}, err
	}
	message, err := s.checkoutRejectionMessage(ctx, result, approverID)
	if err != nil {
		return checkoutEntry{}, err
	}
	if err := s.notifyRequester(ctx, result.RequesterID, "SECRET_CHECKOUT_DENIED", checkoutID, message); err != nil {
		return checkoutEntry{}, fmt.Errorf("notify checkout rejection: %w", err)
	}
	return result, nil
}

func (s Service) Checkin(ctx context.Context, checkoutID, userID, ipAddress string) (checkoutEntry, error) {
	entry, err := s.loadByID(ctx, checkoutID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return checkoutEntry{}, &requestError{status: http.StatusNotFound, message: "Checkout request not found"}
		}
		return checkoutEntry{}, err
	}
	if entry.Status != "APPROVED" {
		return checkoutEntry{}, &requestError{status: http.StatusBadRequest, message: "Only approved checkouts can be checked in"}
	}
	if entry.RequesterID != userID {
		allowed, err := s.userCanApproveResource(ctx, userID, entry.SecretID, entry.ConnectionID)
		if err != nil {
			return checkoutEntry{}, err
		}
		if !allowed {
			return checkoutEntry{}, &requestError{status: http.StatusForbidden, message: "You are not authorized to check in this request"}
		}
	}

	if _, err := s.DB.Exec(ctx, `
UPDATE "SecretCheckoutRequest"
SET status = 'CHECKED_IN', "updatedAt" = NOW()
WHERE id = $1
`, checkoutID); err != nil {
		return checkoutEntry{}, fmt.Errorf("check in checkout request: %w", err)
	}
	if err := s.insertAuditLog(ctx, userID, "SECRET_CHECKOUT_CHECKED_IN", targetType(entry.SecretID, entry.ConnectionID), targetID(entry.SecretID, entry.ConnectionID), map[string]any{
		"checkoutId": checkoutID,
	}, ipAddress); err != nil {
		return checkoutEntry{}, fmt.Errorf("insert checkout checkin audit: %w", err)
	}
	return s.loadByID(ctx, checkoutID)
}
