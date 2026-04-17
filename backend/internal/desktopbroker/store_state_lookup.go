package desktopbroker

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresSessionStore) GetDesktopSessionStateBySessionID(ctx context.Context, sessionID string) (DesktopSessionState, error) {
	if sessionID == "" {
		return DesktopSessionState{}, nil
	}

	row := s.db.QueryRow(
		ctx,
		`SELECT id, status::text
		 FROM "ActiveSession"
		 WHERE id = $1
		 LIMIT 1`,
		sessionID,
	)

	return s.loadDesktopSessionState(ctx, row)
}

func (s *PostgresSessionStore) loadDesktopSessionState(ctx context.Context, row pgx.Row) (DesktopSessionState, error) {
	var (
		sessionID string
		status    string
	)
	if err := row.Scan(&sessionID, &status); err != nil {
		if err == pgx.ErrNoRows {
			return DesktopSessionState{}, nil
		}
		return DesktopSessionState{}, fmt.Errorf("load desktop session state: %w", err)
	}

	state := DesktopSessionState{Exists: true, Closed: status == "CLOSED", Paused: status == "PAUSED"}
	if !state.Closed {
		return state, nil
	}

	reason, err := loadDesktopSessionCloseReason(ctx, s.db, sessionID)
	if err != nil && err != pgx.ErrNoRows {
		return DesktopSessionState{}, fmt.Errorf("load desktop session close reason: %w", err)
	}
	state.Reason = reason
	return state, nil
}
