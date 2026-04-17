package sshsessions

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

func (s Service) openDBTunnel(ctx context.Context, claims authn.Claims, payload dbTunnelRequest, ipAddress string) (dbTunnelResponse, error) {
	if s.DB == nil || s.SessionStore == nil {
		return dbTunnelResponse{}, fmt.Errorf("database session dependencies are unavailable")
	}

	connectionID := strings.TrimSpace(payload.ConnectionID)
	if connectionID == "" {
		return dbTunnelResponse{}, &requestError{status: http.StatusBadRequest, message: "connectionId is required"}
	}

	if claims.TenantID != "" {
		membership, err := s.TenantAuth.ResolveMembership(ctx, claims.UserID, claims.TenantID)
		if err != nil {
			return dbTunnelResponse{}, fmt.Errorf("resolve tenant membership: %w", err)
		}
		if membership == nil || !membership.Permissions[tenantauth.CanConnect] {
			return dbTunnelResponse{}, &requestError{status: http.StatusForbidden, message: "Not allowed to start sessions in this tenant"}
		}
	}

	access, err := s.loadAccess(ctx, claims.UserID, claims.TenantID, connectionID)
	if err != nil {
		return dbTunnelResponse{}, err
	}
	if !strings.EqualFold(access.Connection.Type, "DB_TUNNEL") {
		return dbTunnelResponse{}, &requestError{status: http.StatusBadRequest, message: "Not a DB_TUNNEL connection"}
	}
	if access.Connection.TargetDBHost == nil || strings.TrimSpace(*access.Connection.TargetDBHost) == "" || access.Connection.TargetDBPort == nil || *access.Connection.TargetDBPort <= 0 {
		return dbTunnelResponse{}, &requestError{status: http.StatusBadRequest, message: "Target database host and port are required"}
	}

	credentials, err := s.resolveCredentials(ctx, claims.UserID, claims.TenantID, createRequest{}, access)
	if err != nil {
		return dbTunnelResponse{}, err
	}
	if strings.TrimSpace(credentials.Username) == "" {
		return dbTunnelResponse{}, &requestError{status: http.StatusBadRequest, message: "Connection has no credentials configured"}
	}

	dbType := firstNonEmptyString(access.Connection.DBType, stringPtr(payload.DBType))
	dbUsername := strings.TrimSpace(payload.DBUsername)
	dbPassword := strings.TrimSpace(payload.DBPassword)
	dbName := strings.TrimSpace(payload.DBName)
	targetDBHost := strings.TrimSpace(*access.Connection.TargetDBHost)
	targetDBPort := *access.Connection.TargetDBPort

	tunnel, err := startDBTunnel(credentials, dbTunnelStartOptions{
		UserID:       claims.UserID,
		ConnectionID: access.Connection.ID,
		BastionHost:  strings.TrimSpace(access.Connection.Host),
		BastionPort:  access.Connection.Port,
		TargetDBHost: targetDBHost,
		TargetDBPort: targetDBPort,
		DBType:       dbType,
	})
	if err != nil {
		return dbTunnelResponse{}, &requestError{status: http.StatusBadGateway, message: fmt.Sprintf("SSH tunnel failed: %v", err)}
	}
	tunnel.ConnectionString = buildDBTunnelConnectionString(dbType, "127.0.0.1", tunnel.LocalPort, dbUsername, dbPassword, dbName)

	sessionID, err := s.startDBTunnelSession(ctx, claims, access, ipAddress, tunnel, credentials, targetDBHost, targetDBPort, dbType)
	if err != nil {
		tunnel.close()
		return dbTunnelResponse{}, err
	}

	tunnel.SessionID = sessionID
	activeDBTunnels.add(tunnel)
	_ = s.insertAuditLog(ctx, claims.UserID, "DB_TUNNEL_OPEN", "Connection", access.Connection.ID, ipAddress, map[string]any{
		"tunnelId":     tunnel.ID,
		"sessionId":    sessionID,
		"localPort":    tunnel.LocalPort,
		"targetDbHost": targetDBHost,
		"targetDbPort": targetDBPort,
		"bastionHost":  strings.TrimSpace(access.Connection.Host),
		"dbType":       valueOrEmpty(dbType),
		"connectionId": access.Connection.ID,
	})
	go tunnel.serve()

	return dbTunnelResponse{
		TunnelID:         tunnel.ID,
		SessionID:        sessionID,
		LocalHost:        "127.0.0.1",
		LocalPort:        tunnel.LocalPort,
		ConnectionString: cloneStringPtr(tunnel.ConnectionString),
		TargetDBHost:     targetDBHost,
		TargetDBPort:     targetDBPort,
		DBType:           cloneStringPtr(dbType),
	}, nil
}

func (s Service) startDBTunnelSession(ctx context.Context, claims authn.Claims, access connectionAccess, ipAddress string, tunnel *activeDBTunnel, credentials resolvedCredentials, targetDBHost string, targetDBPort int, dbType *string) (string, error) {
	sessionID, err := s.SessionStore.StartSession(ctx, sessions.StartSessionParams{
		TenantID:     claims.TenantID,
		UserID:       claims.UserID,
		ConnectionID: access.Connection.ID,
		Protocol:     "DB_TUNNEL",
		IPAddress:    ipAddress,
		Metadata: map[string]any{
			"tunnelId":          tunnel.ID,
			"localHost":         "127.0.0.1",
			"localPort":         tunnel.LocalPort,
			"targetDbHost":      targetDBHost,
			"targetDbPort":      targetDBPort,
			"dbType":            valueOrEmpty(dbType),
			"transport":         "db-tunnel",
			"credentialSource":  credentials.CredentialSource,
			"connectionString":  valueOrEmpty(tunnel.ConnectionString),
			"bastionHost":       strings.TrimSpace(access.Connection.Host),
			"bastionPort":       access.Connection.Port,
			"bastionCredential": credentials.CredentialSource,
		},
	})
	if err != nil {
		return "", fmt.Errorf("start DB tunnel session: %w", err)
	}
	return sessionID, nil
}

func startDBTunnel(credentials resolvedCredentials, options dbTunnelStartOptions) (*activeDBTunnel, error) {
	config, err := dbTunnelSSHClientConfig(credentials)
	if err != nil {
		return nil, err
	}

	bastionAddr := net.JoinHostPort(options.BastionHost, strconv.Itoa(options.BastionPort))
	client, err := ssh.Dial("tcp", bastionAddr, config)
	if err != nil {
		return nil, err
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		_ = client.Close()
		return nil, err
	}

	addr, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		_ = listener.Close()
		_ = client.Close()
		return nil, errors.New("failed to allocate local tunnel port")
	}

	return &activeDBTunnel{
		ID:           "dbt-" + uuid.NewString(),
		UserID:       options.UserID,
		ConnectionID: options.ConnectionID,
		LocalPort:    addr.Port,
		TargetDBHost: options.TargetDBHost,
		TargetDBPort: options.TargetDBPort,
		DBType:       cloneStringPtr(options.DBType),
		CreatedAt:    time.Now().UTC(),
		listener:     listener,
		sshClient:    client,
		healthy:      true,
	}, nil
}
