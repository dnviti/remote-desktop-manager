package gateways

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

type gatewayKeyPushResponse struct {
	OK        bool                    `json:"ok"`
	Instances []pushKeyInstanceResult `json:"instances"`
}

type pushKeyInstanceResult struct {
	InstanceID string `json:"instanceId"`
	OK         bool   `json:"ok"`
	Error      string `json:"error,omitempty"`
}

type sshKeyGatewayPushResult struct {
	GatewayID string `json:"gatewayId"`
	Name      string `json:"name"`
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
}

type rotateSSHKeyPairResponse struct {
	sshKeyPairResponse
	PushResults []sshKeyGatewayPushResult `json:"pushResults,omitempty"`
}

type gatewayKeyPushRequest struct {
	PublicKey string `json:"public_key"`
}

type gatewayKeyPushWireResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

type gatewayKeyTarget struct {
	InstanceID string
	Host       string
	Port       int
}

type jsonGRPCCodec struct{}

func (jsonGRPCCodec) Marshal(v any) ([]byte, error) {
	return json.Marshal(v)
}

func (jsonGRPCCodec) Unmarshal(data []byte, v any) error {
	return json.Unmarshal(data, v)
}

func (jsonGRPCCodec) Name() string {
	return "proto"
}

func (s Service) PushSSHKeyToGateway(ctx context.Context, tenantID, gatewayID string) (gatewayKeyPushResponse, error) {
	results, err := s.pushSSHKeyToGateway(ctx, tenantID, gatewayID)
	if err != nil {
		return gatewayKeyPushResponse{}, err
	}
	return gatewayKeyPushResponse{
		OK:        countFailedPushKeyResults(results) == 0,
		Instances: results,
	}, nil
}

func (s Service) PushSSHKeyToAllManagedGateways(ctx context.Context, tenantID string) ([]sshKeyGatewayPushResult, error) {
	if s.DB == nil {
		return nil, fmt.Errorf("database is unavailable")
	}

	rows, err := s.DB.Query(ctx, `
SELECT id, name
FROM "Gateway"
WHERE "tenantId" = $1
  AND type = 'MANAGED_SSH'::"GatewayType"
ORDER BY name ASC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list managed SSH gateways for key push: %w", err)
	}
	defer rows.Close()

	result := make([]sshKeyGatewayPushResult, 0)
	for rows.Next() {
		var item sshKeyGatewayPushResult
		if err := rows.Scan(&item.GatewayID, &item.Name); err != nil {
			return nil, fmt.Errorf("scan managed SSH gateway for key push: %w", err)
		}

		response, err := s.PushSSHKeyToGateway(ctx, tenantID, item.GatewayID)
		if err != nil {
			item.OK = false
			item.Error = err.Error()
		} else {
			item.OK = response.OK
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate managed SSH gateways for key push: %w", err)
	}

	return result, nil
}

func (s Service) pushSSHKeyToGateway(ctx context.Context, tenantID, gatewayID string) ([]pushKeyInstanceResult, error) {
	if s.DB == nil {
		return nil, fmt.Errorf("database is unavailable")
	}

	gateway, err := s.loadGateway(ctx, tenantID, gatewayID)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(gateway.Type, "MANAGED_SSH") {
		return nil, &requestError{status: http.StatusBadRequest, message: "Push key is only supported for MANAGED_SSH gateways"}
	}

	keyPair, err := s.loadSSHKeyPair(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	targets, err := s.listGatewayKeyTargets(ctx, gateway.ID, gateway.Host, gateway.APIPort)
	if err != nil {
		return nil, err
	}

	results := executePushKeyTargets(ctx, targets, keyPair.PublicKey, s.pushGatewayKey)
	if len(results) == 0 {
		return nil, &requestError{status: http.StatusBadRequest, message: "No running instances and no host configured for this gateway"}
	}
	if countFailedPushKeyResults(results) == len(results) {
		if len(results) == 1 && results[0].InstanceID == "direct" && results[0].Error != "" {
			message := results[0].Error
			if strings.HasPrefix(message, "Key push failed: ") {
				return nil, &requestError{status: http.StatusBadGateway, message: message}
			}
			return nil, &requestError{status: http.StatusBadGateway, message: fmt.Sprintf("Key push to %s:%d failed: %s", targets[0].Host, targets[0].Port, message)}
		}
		return nil, &requestError{status: http.StatusBadGateway, message: fmt.Sprintf("SSH key push failed for all %d instance(s)", len(results))}
	}

	return results, nil
}

func (s Service) listGatewayKeyTargets(ctx context.Context, gatewayID, directHost string, directPort *int) ([]gatewayKeyTarget, error) {
	rows, err := s.DB.Query(ctx, `
SELECT id, COALESCE(NULLIF("containerName", ''), host) AS host
FROM "ManagedGatewayInstance"
WHERE "gatewayId" = $1
  AND status = 'RUNNING'::"ManagedInstanceStatus"
ORDER BY "createdAt" ASC
`, gatewayID)
	if err != nil {
		return nil, fmt.Errorf("list managed gateway instances for key push: %w", err)
	}
	defer rows.Close()

	targets := make([]gatewayKeyTarget, 0)
	for rows.Next() {
		var item gatewayKeyTarget
		item.Port = s.DefaultGRPCPort
		if err := rows.Scan(&item.InstanceID, &item.Host); err != nil {
			return nil, fmt.Errorf("scan managed gateway instance for key push: %w", err)
		}
		targets = append(targets, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate managed gateway instances for key push: %w", err)
	}
	if len(targets) > 0 {
		return targets, nil
	}

	host := strings.TrimSpace(directHost)
	if host == "" {
		return nil, nil
	}
	port := s.DefaultGRPCPort
	if directPort != nil {
		port = *directPort
	}
	return []gatewayKeyTarget{{
		InstanceID: "direct",
		Host:       host,
		Port:       port,
	}}, nil
}

func executePushKeyTargets(ctx context.Context, targets []gatewayKeyTarget, publicKey string, push func(context.Context, string, int, string) (gatewayKeyPushWireResponse, error)) []pushKeyInstanceResult {
	results := make([]pushKeyInstanceResult, 0, len(targets))
	for _, target := range targets {
		result := pushKeyInstanceResult{InstanceID: target.InstanceID}

		response, err := push(ctx, target.Host, target.Port, publicKey)
		if err != nil {
			result.OK = false
			result.Error = err.Error()
		} else if response.OK {
			result.OK = true
		} else {
			result.OK = false
			result.Error = strings.TrimSpace(response.Message)
			if result.InstanceID == "direct" && result.Error != "" {
				result.Error = "Key push failed: " + result.Error
			}
		}

		results = append(results, result)
	}
	return results
}

func countFailedPushKeyResults(results []pushKeyInstanceResult) int {
	failed := 0
	for _, item := range results {
		if !item.OK {
			failed++
		}
	}
	return failed
}

func summarizePushKeyResults(results []pushKeyInstanceResult) (succeeded int, failed int) {
	for _, item := range results {
		if item.OK {
			succeeded++
		} else {
			failed++
		}
	}
	return succeeded, failed
}

func (s Service) pushGatewayKey(ctx context.Context, host string, port int, publicKey string) (gatewayKeyPushWireResponse, error) {
	if strings.TrimSpace(s.GatewayGRPCTLSCA) == "" || strings.TrimSpace(s.GatewayGRPCTLSCert) == "" || strings.TrimSpace(s.GatewayGRPCTLSKey) == "" {
		return gatewayKeyPushWireResponse{}, fmt.Errorf("gateway key client requires GATEWAY_GRPC_TLS_CA/CERT/KEY for %s:%d", host, port)
	}

	transportCredentials, err := s.gatewayKeyTransportCredentials()
	if err != nil {
		return gatewayKeyPushWireResponse{}, err
	}

	callCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(
		callCtx,
		net.JoinHostPort(host, strconv.Itoa(port)),
		grpc.WithBlock(),
		grpc.WithTransportCredentials(transportCredentials),
		grpc.WithDefaultCallOptions(grpc.ForceCodec(jsonGRPCCodec{})),
	)
	if err != nil {
		return gatewayKeyPushWireResponse{}, err
	}
	defer conn.Close()

	var response gatewayKeyPushWireResponse
	if err := conn.Invoke(callCtx, "/keymanagement.KeyManagement/PushKey", &gatewayKeyPushRequest{PublicKey: publicKey}, &response); err != nil {
		return gatewayKeyPushWireResponse{}, err
	}
	return response, nil
}

func (s Service) gatewayKeyTransportCredentials() (credentials.TransportCredentials, error) {
	rootCertPEM, err := os.ReadFile(s.GatewayGRPCTLSCA)
	if err != nil {
		return nil, fmt.Errorf("read gateway gRPC CA: %w", err)
	}
	clientCert, err := tls.LoadX509KeyPair(s.GatewayGRPCTLSCert, s.GatewayGRPCTLSKey)
	if err != nil {
		return nil, fmt.Errorf("load gateway gRPC client certificate: %w", err)
	}

	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(rootCertPEM) {
		return nil, fmt.Errorf("parse gateway gRPC CA certificate")
	}

	tlsConfig := &tls.Config{
		RootCAs:            roots,
		Certificates:       []tls.Certificate{clientCert},
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: true, // Managed SSH gateways currently receive shared mTLS cert material rather than per-host DNS SANs.
	}
	tlsConfig.VerifyPeerCertificate = func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
		if len(rawCerts) == 0 {
			return fmt.Errorf("no server certificate presented")
		}

		certs := make([]*x509.Certificate, 0, len(rawCerts))
		for _, rawCert := range rawCerts {
			cert, err := x509.ParseCertificate(rawCert)
			if err != nil {
				return fmt.Errorf("parse server certificate: %w", err)
			}
			certs = append(certs, cert)
		}

		verifyOptions := x509.VerifyOptions{
			Roots:     roots,
			KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
		}
		if len(certs) > 1 {
			verifyOptions.Intermediates = x509.NewCertPool()
			for _, intermediate := range certs[1:] {
				verifyOptions.Intermediates.AddCert(intermediate)
			}
		}
		if _, err := certs[0].Verify(verifyOptions); err != nil {
			return fmt.Errorf("verify gateway server certificate: %w", err)
		}
		return nil
	}

	return credentials.NewTLS(tlsConfig), nil
}

func (s Service) insertGatewayAuditLog(ctx context.Context, userID, action, targetID string, details map[string]any, ipAddress string) error {
	if s.DB == nil {
		return fmt.Errorf("database is unavailable")
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin gateway audit transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := s.insertAuditLogTx(ctx, tx, userID, action, targetID, details, ipAddress); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit gateway audit transaction: %w", err)
	}
	return nil
}
