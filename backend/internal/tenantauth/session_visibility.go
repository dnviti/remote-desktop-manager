package tenantauth

import (
	"context"
	"strings"
)

type SessionVisibilityScope string

const (
	SessionVisibilityScopeOwn    SessionVisibilityScope = "own"
	SessionVisibilityScopeTenant SessionVisibilityScope = "tenant"
)

type SessionVisibility struct {
	Membership *Membership
	Scope      SessionVisibilityScope
}

func sessionVisibilityFromMembership(membership *Membership) *SessionVisibility {
	if membership == nil {
		return nil
	}
	scope := SessionVisibilityScopeOwn
	if membership.Permissions[CanViewSessions] {
		scope = SessionVisibilityScopeTenant
	}
	return &SessionVisibility{
		Membership: membership,
		Scope:      scope,
	}
}

func (v SessionVisibility) RequiresOwnerFilter() bool {
	return v.Scope == SessionVisibilityScopeOwn
}

func (v SessionVisibility) CanObserve() bool {
	return v.Membership != nil && v.Membership.Permissions[CanObserveSessions]
}

func (v SessionVisibility) CanControl() bool {
	return v.Membership != nil && v.Membership.Permissions[CanControlSessions]
}

func (s Service) ResolveSessionVisibility(ctx context.Context, userID, tenantID string) (*SessionVisibility, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, nil
	}

	membership, err := s.ResolveMembership(ctx, userID, tenantID)
	if err != nil {
		return nil, err
	}
	return sessionVisibilityFromMembership(membership), nil
}
