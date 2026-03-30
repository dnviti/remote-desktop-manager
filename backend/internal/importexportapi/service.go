package importexportapi

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/connections"
	"github.com/dnviti/arsenale/backend/internal/rediscompat"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

var ErrLegacyImportExportFlow = errors.New("legacy import/export flow required")

type Service struct {
	DB                  *pgxpool.Pool
	Redis               *redis.Client
	ServerEncryptionKey []byte
	Connections         *connections.Service
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type exportPayload struct {
	Format             string   `json:"format"`
	IncludeCredentials bool     `json:"includeCredentials"`
	ConnectionIDs      []string `json:"connectionIds"`
	FolderID           *string  `json:"folderId"`
}

type encryptedField struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Tag        string `json:"tag"`
}

type exportConnection struct {
	ID                    string          `json:"id"`
	Name                  string          `json:"name"`
	Type                  string          `json:"type"`
	Host                  string          `json:"host"`
	Port                  int             `json:"port"`
	Description           *string         `json:"description"`
	IsFavorite            bool            `json:"isFavorite"`
	EnableDrive           bool            `json:"enableDrive"`
	FolderName            *string         `json:"folderName"`
	SSHTerminalConfig     json.RawMessage `json:"sshTerminalConfig,omitempty"`
	RDPSettings           json.RawMessage `json:"rdpSettings,omitempty"`
	VNCSettings           json.RawMessage `json:"vncSettings,omitempty"`
	DefaultCredentialMode *string         `json:"defaultCredentialMode"`
	CreatedAt             time.Time       `json:"createdAt"`
	UpdatedAt             time.Time       `json:"updatedAt"`
	Username              *string         `json:"username,omitempty"`
	Password              *string         `json:"password,omitempty"`
	Domain                *string         `json:"domain,omitempty"`
}

type importResult struct {
	Imported int                 `json:"imported"`
	Skipped  int                 `json:"skipped"`
	Failed   int                 `json:"failed"`
	Errors   []importResultError `json:"errors"`
}

type importResultError struct {
	Row      *int   `json:"row,omitempty"`
	Filename string `json:"filename"`
	Error    string `json:"error"`
}

type importRecord struct {
	Name        string
	Type        string
	Host        string
	Port        int
	Username    string
	Password    string
	Domain      *string
	FolderName  *string
	Description *string
}

func (s Service) HandleExport(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	var payload exportPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	filename, contentType, body, err := s.ExportConnections(r.Context(), claims, payload, requestIP(r))
	if err != nil {
		writeError(w, err)
		return nil
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	if _, err := w.Write(body); err != nil {
		return fmt.Errorf("write export response: %w", err)
	}
	return nil
}

func (s Service) HandleImport(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	result, err := s.ImportConnections(r.Context(), r, claims)
	if err != nil {
		if errors.Is(err, ErrLegacyImportExportFlow) {
			return err
		}
		writeError(w, err)
		return nil
	}
	app.WriteJSON(w, http.StatusOK, result)
	return nil
}

func (s Service) ExportConnections(ctx context.Context, claims authn.Claims, payload exportPayload, ip *string) (string, string, []byte, error) {
	format := strings.ToUpper(strings.TrimSpace(payload.Format))
	if format != "CSV" && format != "JSON" {
		return "", "", nil, &requestError{status: http.StatusBadRequest, message: "format must be CSV or JSON"}
	}

	items, err := s.loadExportConnections(ctx, claims.UserID, payload.ConnectionIDs, normalizeStringPtr(payload.FolderID))
	if err != nil {
		return "", "", nil, err
	}

	if payload.IncludeCredentials {
		key, err := s.getVaultKey(ctx, claims.UserID)
		if err != nil {
			return "", "", nil, err
		}
		if len(key) == 0 {
			return "", "", nil, &requestError{status: http.StatusForbidden, message: "Vault is locked. Cannot export credentials."}
		}
		defer zeroBytes(key)
		for i := range items {
			items[i].Username = decryptNullableField(key, items[i].EncryptedUsername)
			items[i].Password = decryptNullableField(key, items[i].EncryptedPassword)
			items[i].Domain = decryptNullableField(key, items[i].EncryptedDomain)
		}
	} else {
		for i := range items {
			items[i].Username = nil
			items[i].Password = nil
			items[i].Domain = nil
		}
	}

	if err := s.insertAuditLog(ctx, claims.UserID, "EXPORT_CONNECTIONS", "", map[string]any{
		"format":             format,
		"includeCredentials": payload.IncludeCredentials,
		"connectionCount":    len(items),
	}, ip); err != nil {
		return "", "", nil, err
	}

	switch format {
	case "JSON":
		body, err := json.MarshalIndent(map[string]any{
			"version":    "1.0",
			"exportedAt": time.Now().UTC().Format(time.RFC3339),
			"count":      len(items),
			"connections": func() []exportConnection {
				exported := make([]exportConnection, len(items))
				for i, item := range items {
					exported[i] = item.toExportConnection()
				}
				return exported
			}(),
		}, "", "  ")
		if err != nil {
			return "", "", nil, fmt.Errorf("marshal json export: %w", err)
		}
		filename := fmt.Sprintf("arsenale-connections-%s.json", time.Now().UTC().Format("2006-01-02"))
		return filename, "application/json", body, nil
	default:
		body, err := buildCSV(items)
		if err != nil {
			return "", "", nil, err
		}
		filename := fmt.Sprintf("connections-export-%s.csv", time.Now().UTC().Format("2006-01-02T15-04-05Z"))
		return filename, "text/csv", body, nil
	}
}

func (s Service) ImportConnections(ctx context.Context, r *http.Request, claims authn.Claims) (importResult, error) {
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		return importResult{}, &requestError{status: http.StatusBadRequest, message: "invalid multipart form"}
	}
	if strings.TrimSpace(r.FormValue("columnMapping")) != "" {
		return importResult{}, ErrLegacyImportExportFlow
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		return importResult{}, &requestError{status: http.StatusBadRequest, message: "No file uploaded"}
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		return importResult{}, fmt.Errorf("read import file: %w", err)
	}

	format := detectFormat(header, r.FormValue("format"))
	switch format {
	case "CSV":
		return s.importCSV(ctx, claims, header.Filename, content, normalizeDuplicateStrategy(r.FormValue("duplicateStrategy")), requestIP(r))
	case "JSON":
		return s.importJSON(ctx, claims, header.Filename, content, normalizeDuplicateStrategy(r.FormValue("duplicateStrategy")), requestIP(r))
	case "MREMOTENG", "RDP":
		return importResult{}, ErrLegacyImportExportFlow
	default:
		return importResult{}, &requestError{status: http.StatusBadRequest, message: "Unsupported format"}
	}
}

type rawConnectionRow struct {
	exportConnection
	EncryptedUsername *encryptedField
	EncryptedPassword *encryptedField
	EncryptedDomain   *encryptedField
}

func (s Service) loadExportConnections(ctx context.Context, userID string, connectionIDs []string, folderID *string) ([]rawConnectionRow, error) {
	args := []any{userID}
	conditions := []string{`c."userId" = $1`}
	if folderID != nil {
		args = append(args, *folderID)
		conditions = append(conditions, fmt.Sprintf(`c."folderId" = $%d`, len(args)))
	}
	if len(connectionIDs) > 0 {
		args = append(args, connectionIDs)
		conditions = append(conditions, fmt.Sprintf(`c.id = ANY($%d)`, len(args)))
	}

	query := fmt.Sprintf(`
SELECT
	c.id,
	c.name,
	c.type::text,
	c.host,
	c.port,
	c.description,
	c."isFavorite",
	c."enableDrive",
	c."folderId",
	f.name,
	c."sshTerminalConfig",
	c."rdpSettings",
	c."vncSettings",
	c."defaultCredentialMode",
	c."createdAt",
	c."updatedAt",
	c."encryptedUsername",
	c."usernameIV",
	c."usernameTag",
	c."encryptedPassword",
	c."passwordIV",
	c."passwordTag",
	c."encryptedDomain",
	c."domainIV",
	c."domainTag"
FROM "Connection" c
LEFT JOIN "Folder" f ON f.id = c."folderId"
WHERE %s
ORDER BY c.name ASC
`, strings.Join(conditions, " AND "))

	rows, err := s.DB.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query export connections: %w", err)
	}
	defer rows.Close()

	result := make([]rawConnectionRow, 0)
	for rows.Next() {
		item, err := scanExportRow(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate export connections: %w", err)
	}
	return result, nil
}

func (s Service) importJSON(ctx context.Context, claims authn.Claims, filename string, content []byte, duplicateStrategy string, ip *string) (importResult, error) {
	var payload any
	if err := json.Unmarshal(content, &payload); err != nil {
		return importResult{}, &requestError{status: http.StatusBadRequest, message: "Invalid JSON format"}
	}

	var connectionsToImport []map[string]any
	switch value := payload.(type) {
	case []any:
		for _, item := range value {
			if mapped, ok := item.(map[string]any); ok {
				connectionsToImport = append(connectionsToImport, mapped)
			}
		}
	case map[string]any:
		if rawConnections, ok := value["connections"].([]any); ok {
			for _, item := range rawConnections {
				if mapped, ok := item.(map[string]any); ok {
					connectionsToImport = append(connectionsToImport, mapped)
				}
			}
		}
	}

	result := importResult{Errors: make([]importResultError, 0)}
	for idx, item := range connectionsToImport {
		record, err := normalizeJSONRecord(item)
		if err != nil {
			row := idx + 1
			result.Failed++
			result.Errors = append(result.Errors, importResultError{Row: &row, Filename: filename, Error: err.Error()})
			continue
		}
		if err := s.importOne(ctx, claims, record, duplicateStrategy, ip); err != nil {
			if errors.Is(err, ErrLegacyImportExportFlow) {
				return importResult{}, err
			}
			if reqErr, ok := err.(*requestError); ok {
				row := idx + 1
				if reqErr.status == http.StatusConflict {
					result.Skipped++
				} else {
					result.Failed++
					result.Errors = append(result.Errors, importResultError{Row: &row, Filename: filename, Error: reqErr.message})
				}
				continue
			}
			row := idx + 1
			result.Failed++
			result.Errors = append(result.Errors, importResultError{Row: &row, Filename: filename, Error: err.Error()})
			continue
		}
		result.Imported++
	}

	if err := s.insertAuditLog(ctx, claims.UserID, "IMPORT_CONNECTIONS", "", map[string]any{
		"format":   "JSON",
		"imported": result.Imported,
		"skipped":  result.Skipped,
		"failed":   result.Failed,
	}, ip); err != nil {
		return importResult{}, err
	}
	return result, nil
}

func (s Service) importCSV(ctx context.Context, claims authn.Claims, filename string, content []byte, duplicateStrategy string, ip *string) (importResult, error) {
	reader := csv.NewReader(bytes.NewReader(content))
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err != nil {
		return importResult{}, &requestError{status: http.StatusBadRequest, message: "Invalid CSV format"}
	}
	if len(rows) == 0 {
		return importResult{Errors: []importResultError{}}, nil
	}

	headers := rows[0]
	normalized := make([]string, len(headers))
	for i, header := range headers {
		normalized[i] = strings.ToLower(strings.TrimSpace(header))
	}

	result := importResult{Errors: make([]importResultError, 0)}
	for idx, row := range rows[1:] {
		record, err := normalizeCSVRecord(normalized, row)
		if err != nil {
			line := idx + 2
			result.Failed++
			result.Errors = append(result.Errors, importResultError{Row: &line, Filename: filename, Error: err.Error()})
			continue
		}
		if err := s.importOne(ctx, claims, record, duplicateStrategy, ip); err != nil {
			if errors.Is(err, ErrLegacyImportExportFlow) {
				return importResult{}, err
			}
			line := idx + 2
			var reqErr *requestError
			if errors.As(err, &reqErr) && reqErr.status == http.StatusConflict {
				result.Skipped++
			} else {
				result.Failed++
				result.Errors = append(result.Errors, importResultError{Row: &line, Filename: filename, Error: err.Error()})
			}
			continue
		}
		result.Imported++
	}

	if err := s.insertAuditLog(ctx, claims.UserID, "IMPORT_CONNECTIONS", "", map[string]any{
		"format":   "CSV",
		"imported": result.Imported,
		"skipped":  result.Skipped,
		"failed":   result.Failed,
	}, ip); err != nil {
		return importResult{}, err
	}
	return result, nil
}

func (s Service) importOne(ctx context.Context, claims authn.Claims, record importRecord, duplicateStrategy string, ip *string) error {
	if record.FolderName != nil && strings.TrimSpace(*record.FolderName) != "" {
		return ErrLegacyImportExportFlow
	}

	if duplicateStrategy == "SKIP" {
		exists, err := s.checkDuplicate(ctx, claims.UserID, record.Host, record.Port, record.Type)
		if err != nil {
			return err
		}
		if exists {
			return &requestError{status: http.StatusConflict, message: "duplicate skipped"}
		}
	}

	if duplicateStrategy == "RENAME" {
		exists, err := s.checkDuplicate(ctx, claims.UserID, record.Host, record.Port, record.Type)
		if err != nil {
			return err
		}
		if exists {
			base := record.Name
			counter := 1
			for {
				nextName := fmt.Sprintf("%s (%d)", base, counter)
				used, err := s.checkDuplicateByName(ctx, claims.UserID, nextName)
				if err != nil {
					return err
				}
				if !used {
					record.Name = nextName
					break
				}
				counter++
			}
		}
	}

	if strings.TrimSpace(record.Username) == "" || record.Password == "" {
		return &requestError{status: http.StatusBadRequest, message: "username and password are required"}
	}

	if s.Connections == nil {
		return fmt.Errorf("connections service is not configured")
	}

	_, err := s.Connections.ImportSimpleConnection(ctx, claims, connections.ImportPayload{
		Name:        record.Name,
		Type:        record.Type,
		Host:        record.Host,
		Port:        record.Port,
		Username:    record.Username,
		Password:    record.Password,
		Domain:      record.Domain,
		Description: record.Description,
	}, ip)
	return err
}

func (s Service) checkDuplicate(ctx context.Context, userID, host string, port int, connectionType string) (bool, error) {
	var exists bool
	if err := s.DB.QueryRow(ctx, `
SELECT EXISTS(
	SELECT 1 FROM "Connection"
	WHERE "userId" = $1
	  AND host = $2
	  AND port = $3
	  AND type = $4::"ConnectionType"
)`, userID, host, port, strings.ToUpper(connectionType)).Scan(&exists); err != nil {
		return false, fmt.Errorf("check duplicate connection: %w", err)
	}
	return exists, nil
}

func (s Service) checkDuplicateByName(ctx context.Context, userID, name string) (bool, error) {
	var exists bool
	if err := s.DB.QueryRow(ctx, `
SELECT EXISTS(
	SELECT 1 FROM "Connection"
	WHERE "userId" = $1
	  AND name = $2
)`, userID, name).Scan(&exists); err != nil {
		return false, fmt.Errorf("check duplicate connection name: %w", err)
	}
	return exists, nil
}

func buildCSV(items []rawConnectionRow) ([]byte, error) {
	buffer := &bytes.Buffer{}
	writer := csv.NewWriter(buffer)
	headers := []string{"Name", "Type", "Host", "Port", "Description", "Folder", "Username", "Password", "Domain", "IsFavorite", "EnableDrive", "CreatedAt", "UpdatedAt"}
	if err := writer.Write(headers); err != nil {
		return nil, fmt.Errorf("write csv header: %w", err)
	}
	for _, item := range items {
		record := []string{
			item.Name,
			item.Type,
			item.Host,
			strconv.Itoa(item.Port),
			stringOrEmpty(item.Description),
			stringOrEmpty(item.FolderName),
			stringOrEmpty(item.Username),
			stringOrEmpty(item.Password),
			stringOrEmpty(item.Domain),
			strconv.FormatBool(item.IsFavorite),
			strconv.FormatBool(item.EnableDrive),
			item.CreatedAt.Format(time.RFC3339),
			item.UpdatedAt.Format(time.RFC3339),
		}
		if err := writer.Write(record); err != nil {
			return nil, fmt.Errorf("write csv row: %w", err)
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, fmt.Errorf("flush csv: %w", err)
	}
	return buffer.Bytes(), nil
}

func scanExportRow(row interface{ Scan(...any) error }) (rawConnectionRow, error) {
	var (
		item                rawConnectionRow
		description, folder sql.NullString
		defaultCredential   sql.NullString
		encUser, userIV     sql.NullString
		userTag             sql.NullString
		encPassword, passIV sql.NullString
		passTag             sql.NullString
		encDomain, domainIV sql.NullString
		domainTag           sql.NullString
	)
	if err := row.Scan(
		&item.ID,
		&item.Name,
		&item.Type,
		&item.Host,
		&item.Port,
		&description,
		&item.IsFavorite,
		&item.EnableDrive,
		new(sql.NullString),
		&folder,
		&item.SSHTerminalConfig,
		&item.RDPSettings,
		&item.VNCSettings,
		&defaultCredential,
		&item.CreatedAt,
		&item.UpdatedAt,
		&encUser,
		&userIV,
		&userTag,
		&encPassword,
		&passIV,
		&passTag,
		&encDomain,
		&domainIV,
		&domainTag,
	); err != nil {
		return rawConnectionRow{}, fmt.Errorf("scan export connection: %w", err)
	}
	if description.Valid {
		item.Description = &description.String
	}
	if folder.Valid {
		item.FolderName = &folder.String
	}
	if defaultCredential.Valid {
		item.DefaultCredentialMode = &defaultCredential.String
	}
	item.EncryptedUsername = nullableEncryptedField(encUser, userIV, userTag)
	item.EncryptedPassword = nullableEncryptedField(encPassword, passIV, passTag)
	item.EncryptedDomain = nullableEncryptedField(encDomain, domainIV, domainTag)
	return item, nil
}

func nullableEncryptedField(ciphertext, iv, tag sql.NullString) *encryptedField {
	if !ciphertext.Valid || !iv.Valid || !tag.Valid {
		return nil
	}
	return &encryptedField{Ciphertext: ciphertext.String, IV: iv.String, Tag: tag.String}
}

func decryptNullableField(key []byte, field *encryptedField) *string {
	if field == nil {
		return nil
	}
	value, err := decryptEncryptedField(key, *field)
	if err != nil {
		return nil
	}
	return &value
}

func decryptEncryptedField(key []byte, field encryptedField) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return "", fmt.Errorf("create gcm: %w", err)
	}
	nonce, err := hex.DecodeString(field.IV)
	if err != nil {
		return "", fmt.Errorf("decode nonce: %w", err)
	}
	ciphertext, err := hex.DecodeString(field.Ciphertext)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	tag, err := hex.DecodeString(field.Tag)
	if err != nil {
		return "", fmt.Errorf("decode tag: %w", err)
	}
	plaintext, err := gcm.Open(nil, nonce, append(ciphertext, tag...), nil)
	if err != nil {
		return "", fmt.Errorf("decrypt value: %w", err)
	}
	return string(plaintext), nil
}

func (s Service) getVaultKey(ctx context.Context, userID string) ([]byte, error) {
	if s.Redis == nil || len(s.ServerEncryptionKey) == 0 {
		return nil, nil
	}
	key := "vault:user:" + userID
	payload, err := s.Redis.Get(ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, fmt.Errorf("load vault session: %w", err)
	}

	var field encryptedField
	raw, err := rediscompat.DecodeJSONPayload(payload, &field)
	if err != nil {
		return nil, fmt.Errorf("decode vault session payload: %w", err)
	}

	hexKey, err := decryptEncryptedField(s.ServerEncryptionKey, field)
	if err != nil {
		return nil, fmt.Errorf("decrypt vault session: %w", err)
	}
	masterKey, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("decode vault master key: %w", err)
	}
	if ttl, ttlErr := s.Redis.PTTL(ctx, key).Result(); ttlErr == nil && ttl > 0 {
		_ = s.Redis.Set(ctx, key, raw, ttl).Err()
	}
	return masterKey, nil
}

func normalizeJSONRecord(item map[string]any) (importRecord, error) {
	record := importRecord{
		Name: strings.TrimSpace(asString(item["name"])),
		Type: strings.TrimSpace(asString(item["type"])),
		Host: strings.TrimSpace(asString(item["host"])),
		Port: intFromAny(item["port"], 22),
	}
	if description := strings.TrimSpace(asString(item["description"])); description != "" {
		record.Description = &description
	}
	if folderName := strings.TrimSpace(asString(item["folderName"])); folderName != "" {
		record.FolderName = &folderName
	}
	record.Username = asString(item["username"])
	record.Password = asString(item["password"])
	if domain := strings.TrimSpace(asString(item["domain"])); domain != "" {
		record.Domain = &domain
	}
	return validateImportRecord(record)
}

func normalizeCSVRecord(headers, row []string) (importRecord, error) {
	values := make(map[string]string, len(headers))
	for idx, header := range headers {
		if idx < len(row) {
			values[header] = strings.TrimSpace(row[idx])
		}
	}
	record := importRecord{
		Name:     values["name"],
		Type:     values["type"],
		Host:     values["host"],
		Port:     parsePort(values["port"], 22),
		Username: values["username"],
		Password: values["password"],
	}
	if description := values["description"]; description != "" {
		record.Description = &description
	}
	if folderName := values["folder"]; folderName != "" {
		record.FolderName = &folderName
	}
	if domain := values["domain"]; domain != "" {
		record.Domain = &domain
	}
	return validateImportRecord(record)
}

func validateImportRecord(record importRecord) (importRecord, error) {
	record.Name = strings.TrimSpace(record.Name)
	record.Type = normalizeConnectionType(record.Type)
	record.Host = strings.TrimSpace(record.Host)
	if record.Name == "" || record.Host == "" {
		return importRecord{}, fmt.Errorf("Name and host are required")
	}
	if record.Port < 1 || record.Port > 65535 {
		return importRecord{}, fmt.Errorf("Invalid port number")
	}
	if !slices.Contains([]string{"SSH", "RDP", "VNC"}, record.Type) {
		return importRecord{}, fmt.Errorf("Invalid connection type: %s", record.Type)
	}
	return record, nil
}

func normalizeConnectionType(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "SSH", "SFTP", "TELNET":
		return "SSH"
	case "RDP":
		return "RDP"
	case "VNC":
		return "VNC"
	default:
		return strings.ToUpper(strings.TrimSpace(value))
	}
}

func detectFormat(header *multipart.FileHeader, explicit string) string {
	if value := strings.ToUpper(strings.TrimSpace(explicit)); value != "" {
		return value
	}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	switch ext {
	case ".csv":
		return "CSV"
	case ".json":
		return "JSON"
	case ".xml":
		return "MREMOTENG"
	case ".rdp":
		return "RDP"
	default:
		return "CSV"
	}
}

func normalizeDuplicateStrategy(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "RENAME":
		return "RENAME"
	case "OVERWRITE":
		return "OVERWRITE"
	default:
		return "SKIP"
	}
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetID string, details map[string]any, ip *string) error {
	var payload any
	if details != nil {
		payload = details
	}
	_, err := s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress")
VALUES ($1, $2, $3::"AuditAction", 'Connection', NULLIF($4, ''), $5, $6)
`, uuid.NewString(), userID, action, targetID, payload, ip)
	if err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func (r rawConnectionRow) toExportConnection() exportConnection {
	return exportConnection{
		ID:                    r.ID,
		Name:                  r.Name,
		Type:                  r.Type,
		Host:                  r.Host,
		Port:                  r.Port,
		Description:           r.Description,
		IsFavorite:            r.IsFavorite,
		EnableDrive:           r.EnableDrive,
		FolderName:            r.FolderName,
		SSHTerminalConfig:     r.SSHTerminalConfig,
		RDPSettings:           r.RDPSettings,
		VNCSettings:           r.VNCSettings,
		DefaultCredentialMode: r.DefaultCredentialMode,
		CreatedAt:             r.CreatedAt,
		UpdatedAt:             r.UpdatedAt,
		Username:              r.Username,
		Password:              r.Password,
		Domain:                r.Domain,
	}
}

func writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}

func stringOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func asString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatInt(int64(typed), 10)
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

func intFromAny(value any, fallback int) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case json.Number:
		if parsed, err := typed.Int64(); err == nil {
			return int(parsed)
		}
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(typed)); err == nil {
			return parsed
		}
	}
	return fallback
}

func parsePort(value string, fallback int) int {
	if parsed, err := strconv.Atoi(strings.TrimSpace(value)); err == nil {
		return parsed
	}
	return fallback
}

func normalizeStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func zeroBytes(value []byte) {
	for idx := range value {
		value[idx] = 0
	}
}

func requestIP(r *http.Request) *string {
	if r == nil {
		return nil
	}
	candidates := []string{
		r.Header.Get("X-Real-IP"),
		firstForwardedFor(r.Header.Get("X-Forwarded-For")),
		stripPort(r.RemoteAddr),
	}
	for _, candidate := range candidates {
		value := strings.TrimSpace(candidate)
		if value != "" {
			return &value
		}
	}
	return nil
}

func firstForwardedFor(value string) string {
	for _, item := range strings.Split(value, ",") {
		trimmed := strings.TrimSpace(item)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func stripPort(value string) string {
	if host, _, err := net.SplitHostPort(strings.TrimSpace(value)); err == nil {
		return host
	}
	return strings.TrimSpace(value)
}
