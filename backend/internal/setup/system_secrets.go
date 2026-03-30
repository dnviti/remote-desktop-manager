package setup

import (
	"context"
	"fmt"
	"os"
	"strings"
)

type systemSecretResponse struct {
	Name        string `json:"name"`
	Value       string `json:"value"`
	Description string `json:"description"`
}

type systemSecretDef struct {
	dbName      string
	envName     string
	envFileName string
	description string
}

var systemSecretDefs = []systemSecretDef{
	{
		dbName:      "jwt_secret",
		envName:     "JWT_SECRET",
		envFileName: "JWT_SECRET_FILE",
		description: "JWT signing secret for authentication tokens",
	},
	{
		dbName:      "guacamole_secret",
		envName:     "GUACAMOLE_SECRET",
		envFileName: "GUACAMOLE_SECRET_FILE",
		description: "Encryption key for RDP/VNC session tokens",
	},
	{
		dbName:      "guacenc_auth_token",
		envName:     "GUACENC_AUTH_TOKEN",
		envFileName: "GUACENC_AUTH_TOKEN_FILE",
		description: "Bearer auth token for the video conversion service",
	},
}

func (s Service) listSystemSecretsForDisplay(ctx context.Context) ([]systemSecretResponse, error) {
	if s.DB == nil {
		return nil, nil
	}

	results := make([]systemSecretResponse, 0, len(systemSecretDefs))
	for _, def := range systemSecretDefs {
		value, err := s.loadSystemSecretValue(ctx, def)
		if err != nil {
			return nil, err
		}
		if value == "" {
			continue
		}
		results = append(results, systemSecretResponse{
			Name:        def.envName,
			Value:       value,
			Description: def.description,
		})
	}
	return results, nil
}

func (s Service) loadSystemSecretValue(ctx context.Context, def systemSecretDef) (string, error) {
	if value := strings.TrimSpace(os.Getenv(def.envName)); value != "" {
		return value, nil
	}
	if path := strings.TrimSpace(os.Getenv(def.envFileName)); path != "" {
		content, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("read %s: %w", def.envFileName, err)
		}
		if value := strings.TrimSpace(string(content)); value != "" {
			return value, nil
		}
	}
	if len(s.ServerKey) != 32 {
		return "", nil
	}

	var field encryptedField
	err := s.DB.QueryRow(
		ctx,
		`SELECT "encryptedValue", "valueIV", "valueTag"
		   FROM "SystemSecret"
		  WHERE name = $1`,
		def.dbName,
	).Scan(&field.Ciphertext, &field.IV, &field.Tag)
	if err != nil {
		return "", nil
	}
	value, err := decryptValue(s.ServerKey, field)
	if err != nil {
		return "", fmt.Errorf("decrypt system secret %s: %w", def.dbName, err)
	}
	return value, nil
}
