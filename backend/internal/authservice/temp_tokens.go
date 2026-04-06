package authservice

import (
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func (s Service) issueTempToken(userID, purpose string, ttl time.Duration) (string, error) {
	return s.issueTempTokenWithClaims(map[string]any{
		"userId":  userID,
		"purpose": purpose,
	}, ttl)
}

func (s Service) issueTempTokenWithClaims(extraClaims map[string]any, ttl time.Duration) (string, error) {
	if len(s.JWTSecret) == 0 {
		return "", fmt.Errorf("JWT secret is not configured")
	}
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}

	claims := jwt.MapClaims{
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(ttl).Unix(),
	}
	for key, value := range extraClaims {
		claims[key] = value
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.JWTSecret)
}

func (s Service) parseTempTokenClaims(tempToken string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tempToken, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return s.JWTSecret, nil
	})
	if err != nil || !token.Valid {
		return nil, &requestError{status: 401, message: "Invalid or expired temporary token"}
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, &requestError{status: 401, message: "Invalid or expired temporary token"}
	}
	return claims, nil
}

func stringClaim(claims jwt.MapClaims, key string) string {
	value, _ := claims[key].(string)
	return strings.TrimSpace(value)
}
