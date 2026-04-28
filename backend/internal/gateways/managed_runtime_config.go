package gateways

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/dnviti/arsenale/backend/pkg/egresspolicy"
)

func (s Service) buildManagedGatewayContainerConfig(ctx context.Context, record gatewayRecord, instanceIndex int) ([]managedContainerConfig, error) {
	env := map[string]string{}
	env["ARSENALE_EGRESS_POLICY_JSON"] = string(normalizeGatewayEgressPolicyForResponse(record.EgressPolicy))

	switch strings.ToUpper(strings.TrimSpace(record.Type)) {
	case "MANAGED_SSH":
		keyPair, err := s.loadSSHKeyPair(ctx, record.TenantID)
		if err != nil {
			return nil, err
		}
		env["SSH_AUTHORIZED_KEYS"] = keyPair.PublicKey

		grpcEnv, err := s.buildManagedSSHGRPCEnv()
		if err != nil {
			return nil, err
		}
		for key, value := range grpcEnv {
			env[key] = value
		}

	case "GUACD":
		guacdEnv, err := s.buildManagedGuacdTLSEnv()
		if err != nil {
			return nil, err
		}
		for key, value := range guacdEnv {
			env[key] = value
		}
	case "DB_PROXY":
		env["DB_LISTEN_PORT"] = "5432"
		if egresspolicy.RequiresPrincipalRaw(record.EgressPolicy) {
			if strings.TrimSpace(s.RuntimePrincipalKey) == "" {
				return nil, &requestError{status: http.StatusInternalServerError, message: "Runtime egress principal signing key is required for scoped gateway egress rules"}
			}
			env["RUNTIME_EGRESS_PRINCIPAL_SIGNING_KEY"] = strings.TrimSpace(s.RuntimePrincipalKey)
		}
	default:
		return nil, &requestError{status: http.StatusBadRequest, message: "Only MANAGED_SSH, GUACD, and DB_PROXY gateways can be deployed as managed containers"}
	}

	tunnelEnv, err := s.buildManagedGatewayTunnelEnv(ctx, record)
	if err != nil {
		return nil, err
	}
	for key, value := range tunnelEnv {
		env[key] = value
	}

	labels := map[string]string{
		"arsenale.managed":      "true",
		"arsenale.gateway-id":   record.ID,
		"arsenale.tenant-id":    record.TenantID,
		"arsenale.gateway-type": strings.ToUpper(strings.TrimSpace(record.Type)),
	}

	networks := s.managedGatewayAttachNetworks(record)
	ports, err := s.managedGatewayPublishedPorts(record)
	if err != nil {
		return nil, err
	}

	baseConfig := managedContainerConfig{
		Name:          buildManagedGatewayContainerName(record, instanceIndex),
		Env:           env,
		Ports:         ports,
		Labels:        labels,
		Networks:      networks,
		DNSServers:    normalizedStrings(s.DNSServers),
		ResolvConf:    strings.TrimSpace(s.ResolvConfPath),
		RestartPolicy: "always",
	}
	if baseConfig.ResolvConf != "" {
		baseConfig.Binds = append(baseConfig.Binds, fmt.Sprintf("%s:/etc/resolv.conf:ro", baseConfig.ResolvConf))
	}

	switch strings.ToUpper(strings.TrimSpace(record.Type)) {
	case "GUACD":
		baseConfig.Healthcheck = &managedContainerHealthcheck{
			Test:        []string{"NONE"},
			IntervalSec: 0,
			TimeoutSec:  0,
			Retries:     0,
			StartPeriod: 0,
		}
	case "DB_PROXY":
	}

	configs := make([]managedContainerConfig, 0)
	for _, image := range s.managedGatewayImageCandidates(record.Type) {
		cfg := baseConfig
		cfg.Image = image
		configs = append(configs, cfg)
	}
	return configs, nil
}

func (s Service) buildManagedSSHGRPCEnv() (map[string]string, error) {
	if strings.TrimSpace(s.GatewayGRPCTLSCA) == "" || strings.TrimSpace(s.GatewayGRPCServerCert) == "" || strings.TrimSpace(s.GatewayGRPCServerKey) == "" {
		return nil, &requestError{status: http.StatusInternalServerError, message: "Managed SSH gateways require GATEWAY_GRPC_TLS_CA plus GATEWAY_GRPC_SERVER_CERT/KEY to enable gRPC key management"}
	}

	caPEM, err := os.ReadFile(s.GatewayGRPCTLSCA)
	if err != nil {
		return nil, fmt.Errorf("read gateway gRPC CA: %w", err)
	}
	certPEM, err := os.ReadFile(s.GatewayGRPCServerCert)
	if err != nil {
		return nil, fmt.Errorf("read gateway gRPC server certificate: %w", err)
	}
	keyPEM, err := os.ReadFile(s.GatewayGRPCServerKey)
	if err != nil {
		return nil, fmt.Errorf("read gateway gRPC server key: %w", err)
	}

	clientCAPEM := caPEM
	clientCAPath := strings.TrimSpace(s.GatewayGRPCClientCA)
	if clientCAPath != "" {
		clientCAPEM, err = os.ReadFile(clientCAPath)
		if err != nil {
			return nil, fmt.Errorf("read gateway gRPC client CA: %w", err)
		}
	}

	return map[string]string{
		"SPIFFE_TRUST_DOMAIN":             firstNonEmpty(s.TunnelTrustDomain, defaultTunnelTrustDomain),
		"GATEWAY_GRPC_TLS_CA_PEM":         strings.TrimSpace(string(caPEM)),
		"GATEWAY_GRPC_TLS_CERT_PEM":       strings.TrimSpace(string(certPEM)),
		"GATEWAY_GRPC_TLS_KEY_PEM":        strings.TrimSpace(string(keyPEM)),
		"GATEWAY_GRPC_CLIENT_CA_PEM":      strings.TrimSpace(string(clientCAPEM)),
		"GATEWAY_GRPC_EXPECTED_SPIFFE_ID": buildServiceSPIFFEID(firstNonEmpty(s.TunnelTrustDomain, defaultTunnelTrustDomain), "control-plane-api"),
	}, nil
}

func (s Service) buildManagedGuacdTLSEnv() (map[string]string, error) {
	if strings.TrimSpace(s.GuacdTLSCert) == "" || strings.TrimSpace(s.GuacdTLSKey) == "" {
		return nil, &requestError{status: http.StatusInternalServerError, message: "Managed GUACD gateways require ORCHESTRATOR_GUACD_TLS_CERT/KEY so desktop-broker TLS can reach guacd"}
	}

	certPEM, err := os.ReadFile(s.GuacdTLSCert)
	if err != nil {
		return nil, fmt.Errorf("read managed guacd certificate: %w", err)
	}
	keyPEM, err := os.ReadFile(s.GuacdTLSKey)
	if err != nil {
		return nil, fmt.Errorf("read managed guacd private key: %w", err)
	}

	return map[string]string{
		"GUACD_SSL":          "true",
		"GUACD_SSL_CERT_PEM": strings.TrimSpace(string(certPEM)),
		"GUACD_SSL_KEY_PEM":  strings.TrimSpace(string(keyPEM)),
	}, nil
}
