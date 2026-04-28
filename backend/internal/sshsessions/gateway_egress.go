package sshsessions

import (
	"context"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/tunnelegress"
)

func (s Service) enforceTunnelEgress(ctx context.Context, userID string, gateway gatewayRecord, connectionID, targetHost string, targetPort int, protocol, ipAddress string) error {
	decision := tunnelegress.Authorize(ctx, tunnelegress.Check{
		Policy:       gateway.EgressPolicy,
		Protocol:     protocol,
		TargetHost:   targetHost,
		TargetPort:   targetPort,
		UserID:       userID,
		GatewayID:    gateway.ID,
		ConnectionID: connectionID,
		IPAddress:    ipAddress,
	})
	if decision.Allowed {
		return nil
	}
	tunnelegress.InsertDeniedAudit(ctx, s.DB, tunnelegress.DeniedAudit{
		UserID:       userID,
		GatewayID:    gateway.ID,
		ConnectionID: connectionID,
		Protocol:     protocol,
		TargetHost:   targetHost,
		TargetPort:   targetPort,
		Reason:       decision.Reason,
		IPAddress:    ipAddress,
	})
	return &requestError{status: http.StatusForbidden, message: "Tunnel egress denied: " + decision.Reason}
}
