package connections

import (
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/google/uuid"
)

type shareTarget struct {
	Email  *string `json:"email"`
	UserID *string `json:"userId"`
}

type sharePayload struct {
	Email      *string `json:"email"`
	UserID     *string `json:"userId"`
	Permission string  `json:"permission"`
}

type batchSharePayload struct {
	ConnectionIDs []string    `json:"connectionIds"`
	Target        shareTarget `json:"target"`
	Permission    string      `json:"permission"`
	FolderName    *string     `json:"folderName"`
}

type updateSharePermissionPayload struct {
	Permission string `json:"permission"`
}

type shareMutationResponse struct {
	ID         string `json:"id"`
	Permission string `json:"permission"`
	SharedWith string `json:"sharedWith"`
}

type batchShareResponse struct {
	Shared        int                      `json:"shared"`
	Failed        int                      `json:"failed"`
	AlreadyShared int                      `json:"alreadyShared"`
	Errors        []batchShareResultReason `json:"errors"`
}

type batchShareResultReason struct {
	ConnectionID string `json:"connectionId"`
	Reason       string `json:"reason"`
}

type shareListEntry struct {
	ID         string    `json:"id"`
	UserID     string    `json:"userId"`
	Email      string    `json:"email"`
	Permission string    `json:"permission"`
	CreatedAt  time.Time `json:"createdAt"`
}

func parseSharePayload(r *http.Request) (sharePayload, error) {
	var payload sharePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		return sharePayload{}, err
	}
	payload.Email = normalizeOptionalStringPtrValue(payload.Email)
	payload.UserID = normalizeOptionalStringPtrValue(payload.UserID)
	payload.Permission = normalizePermission(payload.Permission)
	if err := validateShareTarget(shareTarget{Email: payload.Email, UserID: payload.UserID}); err != nil {
		return sharePayload{}, err
	}
	if payload.Permission == "" {
		return sharePayload{}, &requestError{status: http.StatusBadRequest, message: "permission must be READ_ONLY or FULL_ACCESS"}
	}
	return payload, nil
}

func parseBatchSharePayload(r *http.Request) (batchSharePayload, error) {
	var payload batchSharePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		return batchSharePayload{}, err
	}
	payload.Permission = normalizePermission(payload.Permission)
	payload.Target.Email = normalizeOptionalStringPtrValue(payload.Target.Email)
	payload.Target.UserID = normalizeOptionalStringPtrValue(payload.Target.UserID)
	if payload.Permission == "" {
		return batchSharePayload{}, &requestError{status: http.StatusBadRequest, message: "permission must be READ_ONLY or FULL_ACCESS"}
	}
	if len(payload.ConnectionIDs) == 0 || len(payload.ConnectionIDs) > 50 {
		return batchSharePayload{}, &requestError{status: http.StatusBadRequest, message: "connectionIds must contain between 1 and 50 entries"}
	}
	for _, connectionID := range payload.ConnectionIDs {
		if _, err := uuid.Parse(strings.TrimSpace(connectionID)); err != nil {
			return batchSharePayload{}, &requestError{status: http.StatusBadRequest, message: "connectionIds must contain valid UUIDs"}
		}
	}
	if err := validateShareTarget(payload.Target); err != nil {
		return batchSharePayload{}, err
	}
	return payload, nil
}

func parseUpdateSharePermissionPayload(r *http.Request) (updateSharePermissionPayload, error) {
	var payload updateSharePermissionPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		return updateSharePermissionPayload{}, err
	}
	payload.Permission = normalizePermission(payload.Permission)
	if payload.Permission == "" {
		return updateSharePermissionPayload{}, &requestError{status: http.StatusBadRequest, message: "permission must be READ_ONLY or FULL_ACCESS"}
	}
	return payload, nil
}

func validateShareTarget(target shareTarget) error {
	if target.Email == nil && target.UserID == nil {
		return &requestError{status: http.StatusBadRequest, message: "either email or userId is required"}
	}
	if target.UserID != nil {
		if _, err := uuid.Parse(strings.TrimSpace(*target.UserID)); err != nil {
			return &requestError{status: http.StatusBadRequest, message: "userId must be a valid UUID"}
		}
	}
	return nil
}

func normalizePermission(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "READ_ONLY":
		return "READ_ONLY"
	case "FULL_ACCESS":
		return "FULL_ACCESS"
	default:
		return ""
	}
}
