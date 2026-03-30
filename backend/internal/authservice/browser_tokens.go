package authservice

import (
	"context"
	"time"
)

type BrowserUser struct {
	ID         string  `json:"id"`
	Email      string  `json:"email"`
	Username   *string `json:"username"`
	AvatarData *string `json:"avatarData"`
	TenantID   string  `json:"tenantId,omitempty"`
	TenantRole string  `json:"tenantRole,omitempty"`
}

type BrowserTokens struct {
	AccessToken    string
	RefreshToken   string
	RefreshExpires time.Duration
	User           BrowserUser
}

func (s Service) IssueBrowserTokensForUser(ctx context.Context, userID, ipAddress, userAgent string) (BrowserTokens, error) {
	user, err := s.loadLoginUserByID(ctx, userID)
	if err != nil {
		return BrowserTokens{}, err
	}

	result, err := s.issueTokens(ctx, user, ipAddress, userAgent)
	if err != nil {
		return BrowserTokens{}, err
	}

	return BrowserTokens{
		AccessToken:    result.accessToken,
		RefreshToken:   result.refreshToken,
		RefreshExpires: result.refreshExpires,
		User: BrowserUser{
			ID:         result.user.ID,
			Email:      result.user.Email,
			Username:   result.user.Username,
			AvatarData: result.user.AvatarData,
			TenantID:   result.user.TenantID,
			TenantRole: result.user.TenantRole,
		},
	}, nil
}
