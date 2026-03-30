package checkouts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s Service) List(ctx context.Context, userID, role, status string, limit, offset int) (paginatedResponse, error) {
	if s.DB == nil {
		return paginatedResponse{}, errors.New("database is unavailable")
	}

	whereSQL, args, err := s.buildListFilter(ctx, userID, role, status)
	if err != nil {
		return paginatedResponse{}, err
	}
	if whereSQL == "" {
		return paginatedResponse{Data: []checkoutEntry{}, Total: 0}, nil
	}

	countSQL := `SELECT COUNT(*)::int FROM "SecretCheckoutRequest" cr WHERE ` + whereSQL
	var total int
	if err := s.DB.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return paginatedResponse{}, fmt.Errorf("count checkouts: %w", err)
	}

	listArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.DB.Query(ctx, fmt.Sprintf(`
SELECT
	cr.id,
	cr."secretId",
	cr."connectionId",
	cr."requesterId",
	cr."approverId",
	cr.status::text,
	cr."durationMinutes",
	cr.reason,
	cr."expiresAt",
	cr."createdAt",
	cr."updatedAt",
	requester.email,
	requester.username,
	approver.email,
	approver.username
FROM "SecretCheckoutRequest" cr
JOIN "User" requester ON requester.id = cr."requesterId"
LEFT JOIN "User" approver ON approver.id = cr."approverId"
WHERE %s
ORDER BY cr."createdAt" DESC
LIMIT $%d OFFSET $%d
`, whereSQL, len(args)+1, len(args)+2), listArgs...)
	if err != nil {
		return paginatedResponse{}, fmt.Errorf("list checkouts: %w", err)
	}
	defer rows.Close()

	items := make([]checkoutEntry, 0)
	for rows.Next() {
		entry, err := scanCheckout(rows)
		if err != nil {
			return paginatedResponse{}, err
		}
		items = append(items, entry)
	}
	if err := rows.Err(); err != nil {
		return paginatedResponse{}, fmt.Errorf("iterate checkouts: %w", err)
	}

	if err := s.attachResourceNames(ctx, items); err != nil {
		return paginatedResponse{}, err
	}
	return paginatedResponse{Data: items, Total: total}, nil
}

func (s Service) Get(ctx context.Context, checkoutID, userID string) (checkoutEntry, error) {
	if s.DB == nil {
		return checkoutEntry{}, errors.New("database is unavailable")
	}

	entry, err := s.loadByID(ctx, checkoutID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return checkoutEntry{}, &requestError{status: 404, message: "Checkout request not found"}
		}
		return checkoutEntry{}, err
	}

	if entry.RequesterID != userID && (entry.ApproverID == nil || *entry.ApproverID != userID) {
		allowed, err := s.userCanApproveResource(ctx, userID, entry.SecretID, entry.ConnectionID)
		if err != nil {
			return checkoutEntry{}, err
		}
		if !allowed {
			return checkoutEntry{}, &requestError{status: 403, message: "You are not authorized to view this checkout request"}
		}
	}
	return entry, nil
}

func (s Service) loadByID(ctx context.Context, checkoutID string) (checkoutEntry, error) {
	row := s.DB.QueryRow(ctx, `
SELECT
	cr.id,
	cr."secretId",
	cr."connectionId",
	cr."requesterId",
	cr."approverId",
	cr.status::text,
	cr."durationMinutes",
	cr.reason,
	cr."expiresAt",
	cr."createdAt",
	cr."updatedAt",
	requester.email,
	requester.username,
	approver.email,
	approver.username
FROM "SecretCheckoutRequest" cr
JOIN "User" requester ON requester.id = cr."requesterId"
LEFT JOIN "User" approver ON approver.id = cr."approverId"
WHERE cr.id = $1
`, checkoutID)
	entry, err := scanCheckout(row)
	if err != nil {
		return checkoutEntry{}, err
	}
	items := []checkoutEntry{entry}
	if err := s.attachResourceNames(ctx, items); err != nil {
		return checkoutEntry{}, err
	}
	return items[0], nil
}

func (s Service) buildListFilter(ctx context.Context, userID, role, status string) (string, []any, error) {
	args := make([]any, 0)
	addArg := func(value any) string {
		args = append(args, value)
		return fmt.Sprintf("$%d", len(args))
	}

	var whereSQL string
	switch role {
	case "requester":
		whereSQL = `"requesterId" = ` + addArg(userID)
	case "approver":
		secretIDs, connectionIDs, err := s.approvableResourceIDs(ctx, userID)
		if err != nil {
			return "", nil, err
		}
		orConditions := make([]string, 0, 2)
		requesterArg := addArg(userID)
		if len(secretIDs) > 0 {
			orConditions = append(orConditions, fmt.Sprintf(`("secretId" = ANY(%s) AND "requesterId" <> %s)`, addArg(secretIDs), requesterArg))
		}
		if len(connectionIDs) > 0 {
			orConditions = append(orConditions, fmt.Sprintf(`("connectionId" = ANY(%s) AND "requesterId" <> %s)`, addArg(connectionIDs), requesterArg))
		}
		if len(orConditions) == 0 {
			return "", nil, nil
		}
		whereSQL = "(" + strings.Join(orConditions, " OR ") + ")"
	default:
		userArg := addArg(userID)
		whereSQL = fmt.Sprintf(`("requesterId" = %s OR "approverId" = %s)`, userArg, userArg)
	}

	if status != "" {
		whereSQL += ` AND status = ` + addArg(status) + `::"CheckoutStatus"`
	}
	return whereSQL, args, nil
}

func (s Service) approvableResourceIDs(ctx context.Context, userID string) ([]string, []string, error) {
	ownedSecretIDs, err := s.listIDs(ctx, `SELECT id FROM "VaultSecret" WHERE "userId" = $1`, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("list owned secrets: %w", err)
	}

	adminTenantIDs, err := s.listIDs(ctx, `SELECT "tenantId" FROM "TenantMember" WHERE "userId" = $1 AND role IN ('OWNER', 'ADMIN')`, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("list admin tenants: %w", err)
	}
	tenantSecretIDs := make([]string, 0)
	if len(adminTenantIDs) > 0 {
		tenantSecretIDs, err = s.listIDs(ctx, `SELECT id FROM "VaultSecret" WHERE "tenantId" = ANY($1)`, adminTenantIDs)
		if err != nil {
			return nil, nil, fmt.Errorf("list tenant secrets: %w", err)
		}
	}

	ownedConnectionIDs, err := s.listIDs(ctx, `SELECT id FROM "Connection" WHERE "userId" = $1`, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("list owned connections: %w", err)
	}

	adminTeamIDs, err := s.listIDs(ctx, `SELECT "teamId" FROM "TeamMember" WHERE "userId" = $1 AND role = 'TEAM_ADMIN'`, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("list admin teams: %w", err)
	}
	teamConnectionIDs := make([]string, 0)
	if len(adminTeamIDs) > 0 {
		teamConnectionIDs, err = s.listIDs(ctx, `SELECT id FROM "Connection" WHERE "teamId" = ANY($1)`, adminTeamIDs)
		if err != nil {
			return nil, nil, fmt.Errorf("list team connections: %w", err)
		}
	}

	return uniqueStrings(append(ownedSecretIDs, tenantSecretIDs...)), uniqueStrings(append(ownedConnectionIDs, teamConnectionIDs...)), nil
}

func (s Service) attachResourceNames(ctx context.Context, items []checkoutEntry) error {
	secretIDs := make([]string, 0)
	connectionIDs := make([]string, 0)
	for _, item := range items {
		if item.SecretID != nil {
			secretIDs = append(secretIDs, *item.SecretID)
		}
		if item.ConnectionID != nil {
			connectionIDs = append(connectionIDs, *item.ConnectionID)
		}
	}

	secretNames, err := s.loadNameMap(ctx, `SELECT id, name FROM "VaultSecret" WHERE id = ANY($1)`, uniqueStrings(secretIDs))
	if err != nil {
		return fmt.Errorf("load checkout secret names: %w", err)
	}
	connectionNames, err := s.loadNameMap(ctx, `SELECT id, name FROM "Connection" WHERE id = ANY($1)`, uniqueStrings(connectionIDs))
	if err != nil {
		return fmt.Errorf("load checkout connection names: %w", err)
	}

	for i := range items {
		if items[i].SecretID != nil {
			if name, ok := secretNames[*items[i].SecretID]; ok {
				items[i].SecretName = stringPtr(name)
			}
		}
		if items[i].ConnectionID != nil {
			if name, ok := connectionNames[*items[i].ConnectionID]; ok {
				items[i].ConnectionName = stringPtr(name)
			}
		}
	}
	return nil
}

func (s Service) userCanApproveResource(ctx context.Context, userID string, secretID, connectionID *string) (bool, error) {
	if secretID != nil {
		var ownerID string
		var tenantID sql.NullString
		if err := s.DB.QueryRow(ctx, `SELECT "userId", "tenantId" FROM "VaultSecret" WHERE id = $1`, *secretID).Scan(&ownerID, &tenantID); err == nil {
			if ownerID == userID {
				return true, nil
			}
			if tenantID.Valid {
				var exists bool
				if err := s.DB.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM "TenantMember"
  WHERE "tenantId" = $1 AND "userId" = $2 AND role IN ('OWNER', 'ADMIN')
)
`, tenantID.String, userID).Scan(&exists); err != nil {
					return false, fmt.Errorf("check secret approver membership: %w", err)
				}
				if exists {
					return true, nil
				}
			}
		}
	}
	if connectionID != nil {
		var ownerID string
		var teamID sql.NullString
		if err := s.DB.QueryRow(ctx, `SELECT "userId", "teamId" FROM "Connection" WHERE id = $1`, *connectionID).Scan(&ownerID, &teamID); err == nil {
			if ownerID == userID {
				return true, nil
			}
			if teamID.Valid {
				var exists bool
				if err := s.DB.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1 FROM "TeamMember"
  WHERE "teamId" = $1 AND "userId" = $2 AND role = 'TEAM_ADMIN'
)
`, teamID.String, userID).Scan(&exists); err != nil {
					return false, fmt.Errorf("check connection approver membership: %w", err)
				}
				if exists {
					return true, nil
				}
			}
		}
	}
	return false, nil
}

func (s Service) listIDs(ctx context.Context, query string, arg any) ([]string, error) {
	rows, err := s.DB.Query(ctx, query, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		items = append(items, id)
	}
	return items, rows.Err()
}

func (s Service) loadNameMap(ctx context.Context, query string, ids []string) (map[string]string, error) {
	if len(ids) == 0 {
		return map[string]string{}, nil
	}
	rows, err := s.DB.Query(ctx, query, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]string, len(ids))
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		result[id] = name
	}
	return result, rows.Err()
}

type checkoutScanner interface {
	Scan(dest ...any) error
}

func scanCheckout(row checkoutScanner) (checkoutEntry, error) {
	var (
		item              checkoutEntry
		secretID          sql.NullString
		connectionID      sql.NullString
		approverID        sql.NullString
		reason            sql.NullString
		expiresAt         sql.NullTime
		requesterUsername sql.NullString
		approverEmail     sql.NullString
		approverUsername  sql.NullString
	)
	if err := row.Scan(
		&item.ID,
		&secretID,
		&connectionID,
		&item.RequesterID,
		&approverID,
		&item.Status,
		&item.DurationMinutes,
		&reason,
		&expiresAt,
		&item.CreatedAt,
		&item.UpdatedAt,
		&item.Requester.Email,
		&requesterUsername,
		&approverEmail,
		&approverUsername,
	); err != nil {
		return checkoutEntry{}, err
	}

	if secretID.Valid {
		item.SecretID = stringPtr(secretID.String)
	}
	if connectionID.Valid {
		item.ConnectionID = stringPtr(connectionID.String)
	}
	if approverID.Valid {
		item.ApproverID = stringPtr(approverID.String)
	}
	if reason.Valid {
		item.Reason = stringPtr(reason.String)
	}
	if expiresAt.Valid {
		value := expiresAt.Time
		item.ExpiresAt = &value
	}
	if requesterUsername.Valid {
		item.Requester.Username = &requesterUsername.String
	}
	if approverEmail.Valid {
		item.Approver = &userSummary{Email: approverEmail.String}
		if approverUsername.Valid {
			item.Approver.Username = &approverUsername.String
		}
	}
	return item, nil
}
