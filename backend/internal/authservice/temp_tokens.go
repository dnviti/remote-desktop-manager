package authservice

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func (s Service) issueTempToken(userID, purpose string, ttl time.Duration) (string, error) {
	if len(s.JWTSecret) == 0 {
		return "", fmt.Errorf("JWT secret is not configured")
	}
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}

	claims := jwt.MapClaims{
		"userId":  userID,
		"purpose": purpose,
		"iat":     time.Now().Unix(),
		"exp":     time.Now().Add(ttl).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.JWTSecret)
}
