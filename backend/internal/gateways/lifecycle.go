package gateways

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
)

const (
	maxManagedGatewayReplicas  = 20
	defaultGatewayLogTailLines = 200
	maxGatewayLogTailLines     = 5000
	unavailableOrchestratorMsg = "Container orchestration not available. Configure Docker socket, Podman socket, or Kubernetes credentials."
	managedGatewayReadyTimeout = 20 * time.Second
	managedGatewayReadyPoll    = 250 * time.Millisecond
)

type scalePayload struct {
	Replicas int `json:"replicas"`
}

type scaleResult struct {
	Deployed int `json:"deployed"`
	Removed  int `json:"removed"`
}

type restartResult struct {
	Restarted bool `json:"restarted"`
}

type undeployResult struct {
	Undeployed bool `json:"undeployed"`
}

type instanceLogsResponse struct {
	Logs          string `json:"logs"`
	ContainerID   string `json:"containerId"`
	ContainerName string `json:"containerName"`
	Timestamp     string `json:"timestamp"`
}

func isManagedLifecycleGatewayType(gatewayType string) bool {
	switch strings.ToUpper(strings.TrimSpace(gatewayType)) {
	case "MANAGED_SSH", "GUACD", "DB_PROXY":
		return true
	default:
		return false
	}
}

func parseGatewayLogTail(raw string) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value == 0 {
		return defaultGatewayLogTailLines
	}
	if value < 1 {
		return 1
	}
	if value > maxGatewayLogTailLines {
		return maxGatewayLogTailLines
	}
	return value
}

func (s Service) DeployGatewayInstance(ctx context.Context, claims authn.Claims, gatewayID string) (managedGatewayInstanceResponse, error) {
	if s.DB == nil {
		return managedGatewayInstanceResponse{}, fmt.Errorf("database is unavailable")
	}

	record, err := s.loadGateway(ctx, claims.TenantID, gatewayID)
	if err != nil {
		return managedGatewayInstanceResponse{}, err
	}
	if !isManagedLifecycleGatewayType(record.Type) {
		return managedGatewayInstanceResponse{}, &requestError{status: http.StatusBadRequest, message: "Only MANAGED_SSH, GUACD, and DB_PROXY gateways can be deployed as managed containers"}
	}
	if !deploymentModeIsGroup(record.DeploymentMode) {
		return managedGatewayInstanceResponse{}, &requestError{status: http.StatusBadRequest, message: "Only MANAGED_GROUP gateways can be deployed as managed containers"}
	}
	if err := s.ensureManagedGatewayDeployable(ctx, record); err != nil {
		return managedGatewayInstanceResponse{}, err
	}

	currentCount, err := s.countManagedGatewayActiveInstances(ctx, record.ID)
	if err != nil {
		return managedGatewayInstanceResponse{}, err
	}
	if record.TunnelEnabled && currentCount >= 1 {
		return managedGatewayInstanceResponse{}, &requestError{status: http.StatusBadRequest, message: "Tunnel-enabled managed gateways currently support a single replica"}
	}

	runtimeClient, orchestratorType, err := s.managedGatewayRuntime(ctx)
	if err != nil {
		return managedGatewayInstanceResponse{}, err
	}

	return s.deployManagedGatewayInstance(ctx, record, runtimeClient, orchestratorType, claims.UserID, "", true)
}

func (s Service) UndeployGateway(ctx context.Context, claims authn.Claims, gatewayID, ipAddress string) (undeployResult, error) {
	if _, err := s.ScaleGateway(ctx, claims, gatewayID, 0, ipAddress); err != nil {
		return undeployResult{}, err
	}
	return undeployResult{Undeployed: true}, nil
}

func (s Service) ScaleGateway(ctx context.Context, claims authn.Claims, gatewayID string, replicas int, ipAddress string) (scaleResult, error) {
	if s.DB == nil {
		return scaleResult{}, fmt.Errorf("database is unavailable")
	}
	if replicas < 0 || replicas > maxManagedGatewayReplicas {
		return scaleResult{}, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("Replicas must be between 0 and %d", maxManagedGatewayReplicas)}
	}

	record, err := s.loadGateway(ctx, claims.TenantID, gatewayID)
	if err != nil {
		return scaleResult{}, err
	}
	if !isManagedLifecycleGatewayType(record.Type) {
		return scaleResult{}, &requestError{status: http.StatusBadRequest, message: "Only MANAGED_SSH, GUACD, and DB_PROXY gateways can be scaled"}
	}
	if !deploymentModeIsGroup(record.DeploymentMode) {
		return scaleResult{}, &requestError{status: http.StatusBadRequest, message: "Only MANAGED_GROUP gateways can be scaled"}
	}
	if err := s.ensureManagedGatewayDeployable(ctx, record); err != nil {
		return scaleResult{}, err
	}
	if record.TunnelEnabled && replicas > 1 {
		return scaleResult{}, &requestError{status: http.StatusBadRequest, message: "Tunnel-enabled managed gateways currently support a single replica"}
	}

	currentInstances, err := s.listManagedGatewayInstancesForScale(ctx, gatewayID)
	if err != nil {
		return scaleResult{}, err
	}
	currentCount := len(currentInstances)

	var (
		runtimeClient    *dockerSocketClient
		orchestratorType string
	)
	if replicas != currentCount {
		runtimeClient, orchestratorType, err = s.managedGatewayRuntime(ctx)
		if err != nil {
			return scaleResult{}, err
		}
	}

	var (
		deployed int
		removed  int
		firstErr error
	)
	if replicas > currentCount {
		toCreate := replicas - currentCount
		for i := 0; i < toCreate; i++ {
			if _, err := s.deployManagedGatewayInstance(ctx, record, runtimeClient, orchestratorType, "", "", false); err != nil {
				if firstErr == nil {
					firstErr = err
				}
				continue
			}
			deployed++
		}
	} else if replicas < currentCount {
		toRemove := currentCount - replicas
		for i := 0; i < toRemove && i < len(currentInstances); i++ {
			if err := s.removeManagedGatewayInstance(ctx, runtimeClient, gatewayID, currentInstances[i]); err != nil {
				if firstErr == nil {
					firstErr = err
				}
				continue
			}
			removed++
		}
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return scaleResult{}, fmt.Errorf("begin gateway scale transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
UPDATE "Gateway"
   SET "desiredReplicas" = $2,
       "lastScaleAction" = NOW(),
       "updatedAt" = NOW()
 WHERE id = $1
`, gatewayID, replicas); err != nil {
		return scaleResult{}, fmt.Errorf("update gateway scale state: %w", err)
	}

	if err := s.insertAuditLogTx(ctx, tx, claims.UserID, "GATEWAY_SCALE", gatewayID, map[string]any{
		"from":     currentCount,
		"to":       replicas,
		"deployed": deployed,
		"removed":  removed,
	}, ipAddress); err != nil {
		return scaleResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return scaleResult{}, fmt.Errorf("commit gateway scale transaction: %w", err)
	}

	if firstErr != nil && deployed == 0 && removed == 0 {
		return scaleResult{}, firstErr
	}

	return scaleResult{Deployed: deployed, Removed: removed}, nil
}

func (s Service) RestartGatewayInstance(ctx context.Context, claims authn.Claims, gatewayID, instanceID string) (restartResult, error) {
	if s.DB == nil {
		return restartResult{}, fmt.Errorf("database is unavailable")
	}
	if _, err := s.loadGateway(ctx, claims.TenantID, gatewayID); err != nil {
		return restartResult{}, err
	}
	instance, err := s.loadManagedGatewayInstance(ctx, gatewayID, instanceID)
	if err != nil {
		return restartResult{}, err
	}

	runtimeClient, _, err := s.managedGatewayRuntime(ctx)
	if err != nil {
		return restartResult{}, err
	}
	if err := runtimeClient.restartContainer(ctx, instance.ContainerID); err != nil {
		return restartResult{}, &requestError{status: http.StatusServiceUnavailable, message: fmt.Sprintf("Gateway restart failed: %v", err)}
	}

	info, err := runtimeClient.inspectContainer(ctx, instance.ContainerID)
	if err != nil {
		return restartResult{}, fmt.Errorf("inspect restarted gateway instance: %w", err)
	}
	status := inferInstanceStatus(info.Status)
	healthStatus := inferInstanceHealth(info.Status, info.Health)
	if _, err := s.DB.Exec(ctx, `
UPDATE "ManagedGatewayInstance"
   SET status = $2::"ManagedInstanceStatus",
       "healthStatus" = NULLIF($3, ''),
       "lastHealthCheck" = NOW(),
       "consecutiveFailures" = 0,
       "errorMessage" = NULL,
       "updatedAt" = NOW()
 WHERE id = $1
`, instanceID, status, healthStatus); err != nil {
		return restartResult{}, fmt.Errorf("update restarted gateway instance: %w", err)
	}
	if err := s.insertGatewayAuditLog(ctx, claims.UserID, "GATEWAY_RESTART", gatewayID, map[string]any{
		"instanceId":    instanceID,
		"containerId":   instance.ContainerID,
		"containerName": instance.ContainerName,
	}, ""); err != nil {
		return restartResult{}, err
	}

	return restartResult{Restarted: true}, nil
}

func (s Service) GetGatewayInstanceLogs(ctx context.Context, claims authn.Claims, gatewayID, instanceID string, tail int) (instanceLogsResponse, error) {
	if s.DB == nil {
		return instanceLogsResponse{}, fmt.Errorf("database is unavailable")
	}
	if _, err := s.loadGateway(ctx, claims.TenantID, gatewayID); err != nil {
		return instanceLogsResponse{}, err
	}
	instance, err := s.loadManagedGatewayInstance(ctx, gatewayID, instanceID)
	if err != nil {
		return instanceLogsResponse{}, err
	}
	runtimeClient, _, err := s.managedGatewayRuntime(ctx)
	if err != nil {
		return instanceLogsResponse{}, err
	}
	logs, err := runtimeClient.getContainerLogs(ctx, instance.ContainerID, tail)
	if err != nil {
		return instanceLogsResponse{}, &requestError{status: http.StatusServiceUnavailable, message: fmt.Sprintf("Gateway log retrieval failed: %v", err)}
	}

	return instanceLogsResponse{
		Logs:          logs,
		ContainerID:   instance.ContainerID,
		ContainerName: instance.ContainerName,
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (s Service) loadManagedGatewayInstance(ctx context.Context, gatewayID, instanceID string) (managedGatewayInstanceResponse, error) {
	if s.DB == nil {
		return managedGatewayInstanceResponse{}, fmt.Errorf("database is unavailable")
	}

	row := s.DB.QueryRow(ctx, `
SELECT
	id,
	"gatewayId",
	"containerId",
	"containerName",
	host,
	port,
	"apiPort",
	status::text,
	"orchestratorType",
	"healthStatus",
	"lastHealthCheck",
	"errorMessage",
	"consecutiveFailures",
	"tunnelProxyHost",
	"tunnelProxyPort",
	"createdAt",
	"updatedAt"
FROM "ManagedGatewayInstance"
WHERE id = $1
  AND "gatewayId" = $2
`, instanceID, gatewayID)

	item, err := scanManagedGatewayInstance(row)
	if err != nil {
		return managedGatewayInstanceResponse{}, &requestError{status: http.StatusNotFound, message: "Instance not found"}
	}
	return item, nil
}

func (s Service) ensureManagedGatewayDeployable(ctx context.Context, record gatewayRecord) error {
	if !strings.EqualFold(record.Type, "MANAGED_SSH") {
		return nil
	}

	var exists bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM "SshKeyPair" WHERE "tenantId" = $1)`, record.TenantID).Scan(&exists); err != nil {
		return fmt.Errorf("check ssh key pair: %w", err)
	}
	if !exists {
		return &requestError{status: http.StatusBadRequest, message: "SSH key pair not found for this tenant. Generate one first."}
	}
	return nil
}

func (s Service) countManagedGatewayInstanceRecords(ctx context.Context, gatewayID string) (int, error) {
	var count int
	if err := s.DB.QueryRow(ctx, `
SELECT COUNT(*)::int
FROM "ManagedGatewayInstance"
WHERE "gatewayId" = $1
`, gatewayID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count managed gateway instances: %w", err)
	}
	return count, nil
}

func (s Service) countManagedGatewayActiveInstances(ctx context.Context, gatewayID string) (int, error) {
	var count int
	if err := s.DB.QueryRow(ctx, `
SELECT COUNT(*)::int
FROM "ManagedGatewayInstance"
WHERE "gatewayId" = $1
  AND status NOT IN ('ERROR'::"ManagedInstanceStatus", 'REMOVING'::"ManagedInstanceStatus")
`, gatewayID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count active managed gateway instances: %w", err)
	}
	return count, nil
}

func (s Service) listManagedGatewayInstancesForScale(ctx context.Context, gatewayID string) ([]managedGatewayInstanceResponse, error) {
	rows, err := s.DB.Query(ctx, `
SELECT
	id,
	"gatewayId",
	"containerId",
	"containerName",
	host,
	port,
	"apiPort",
	status::text,
	"orchestratorType",
	"healthStatus",
	"lastHealthCheck",
	"errorMessage",
	"consecutiveFailures",
	"tunnelProxyHost",
	"tunnelProxyPort",
	"createdAt",
	"updatedAt"
FROM "ManagedGatewayInstance"
WHERE "gatewayId" = $1
  AND status NOT IN ('ERROR'::"ManagedInstanceStatus", 'REMOVING'::"ManagedInstanceStatus")
ORDER BY "createdAt" DESC
`, gatewayID)
	if err != nil {
		return nil, fmt.Errorf("list managed gateway instances: %w", err)
	}
	defer rows.Close()

	result := make([]managedGatewayInstanceResponse, 0)
	for rows.Next() {
		item, err := scanManagedGatewayInstance(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate managed gateway instances: %w", err)
	}
	return result, nil
}

func (s Service) deployManagedGatewayInstance(ctx context.Context, record gatewayRecord, runtimeClient *dockerSocketClient, orchestratorType, auditUserID, ipAddress string, updateDesired bool) (managedGatewayInstanceResponse, error) {
	instanceIndex, err := s.countManagedGatewayInstanceRecords(ctx, record.ID)
	if err != nil {
		return managedGatewayInstanceResponse{}, err
	}

	configs, err := s.buildManagedGatewayContainerConfig(ctx, record, instanceIndex+1)
	if err != nil {
		return managedGatewayInstanceResponse{}, err
	}
	if len(configs) == 0 {
		return managedGatewayInstanceResponse{}, &requestError{status: http.StatusInternalServerError, message: "No managed container configuration was generated for this gateway"}
	}

	var (
		containerInfo managedContainerInfo
		deployErr     error
		containerName = configs[0].Name
	)
	for _, cfg := range configs {
		containerName = cfg.Name
		containerInfo, deployErr = runtimeClient.deployContainer(ctx, cfg)
		if deployErr == nil {
			break
		}
	}
	if deployErr != nil {
		_ = s.recordManagedGatewayDeploymentFailure(ctx, record, orchestratorType, containerName, deployErr)
		return managedGatewayInstanceResponse{}, &requestError{status: http.StatusServiceUnavailable, message: fmt.Sprintf("Gateway deployment failed: %v", deployErr)}
	}

	instanceID := uuid.NewString()
	instanceHost, instancePort := managedGatewayInstanceAddress(record, containerInfo, s.managedGatewayPrimaryPort(record.Type))
	apiPort := managedGatewayAPIPort(record, s.DefaultGRPCPort)

	if err := s.waitForManagedGatewayReady(ctx, record, containerInfo.Name, instanceHost, instancePort, apiPort); err != nil {
		_ = runtimeClient.removeContainer(ctx, containerInfo.ID)
		_ = s.recordManagedGatewayDeploymentFailure(ctx, record, orchestratorType, containerInfo.Name, err)
		return managedGatewayInstanceResponse{}, &requestError{status: http.StatusServiceUnavailable, message: fmt.Sprintf("Gateway deployment failed: %v", err)}
	}

	inspectedInfo, err := runtimeClient.inspectContainer(ctx, containerInfo.ID)
	if err == nil {
		containerInfo = inspectedInfo
	}
	status := inferInstanceStatus(containerInfo.Status)
	healthStatus := inferInstanceHealth(containerInfo.Status, containerInfo.Health)
	if status == "RUNNING" {
		healthStatus = "healthy"
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		_ = runtimeClient.removeContainer(ctx, containerInfo.ID)
		return managedGatewayInstanceResponse{}, fmt.Errorf("begin managed gateway deploy transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
INSERT INTO "ManagedGatewayInstance" (
	id,
	"gatewayId",
	"containerId",
	"containerName",
	host,
	port,
	"apiPort",
	status,
	"orchestratorType",
	"healthStatus",
	"lastHealthCheck",
	"consecutiveFailures",
	"createdAt",
	"updatedAt"
)
VALUES (
	$1,
	$2,
	$3,
	$4,
	$5,
	$6,
	$7,
	$8::"ManagedInstanceStatus",
	$9,
	NULLIF($10, ''),
	NOW(),
	0,
	NOW(),
	NOW()
)
`, instanceID, record.ID, containerInfo.ID, containerInfo.Name, instanceHost, instancePort, apiPort, status, orchestratorType, healthStatus); err != nil {
		_ = runtimeClient.removeContainer(ctx, containerInfo.ID)
		return managedGatewayInstanceResponse{}, fmt.Errorf("insert managed gateway instance: %w", err)
	}

	if updateDesired {
		activeCount, err := s.countManagedGatewayActiveInstances(ctx, record.ID)
		if err != nil {
			_ = runtimeClient.removeContainer(ctx, containerInfo.ID)
			return managedGatewayInstanceResponse{}, err
		}
		desiredReplicas := record.DesiredReplicas
		if desiredReplicas < activeCount+1 {
			desiredReplicas = activeCount + 1
		}

		if _, err := tx.Exec(ctx, `
UPDATE "Gateway"
   SET "desiredReplicas" = $2,
       "lastScaleAction" = NOW(),
       "updatedAt" = NOW()
 WHERE id = $1
`, record.ID, desiredReplicas); err != nil {
			_ = runtimeClient.removeContainer(ctx, containerInfo.ID)
			return managedGatewayInstanceResponse{}, fmt.Errorf("update gateway deploy state: %w", err)
		}
	}

	if auditUserID != "" {
		if err := s.insertAuditLogTx(ctx, tx, auditUserID, "GATEWAY_DEPLOY", record.ID, map[string]any{
			"instanceId":       instanceID,
			"containerId":      containerInfo.ID,
			"containerName":    containerInfo.Name,
			"orchestratorType": orchestratorType,
			"host":             instanceHost,
			"port":             instancePort,
			"healthStatus":     healthStatus,
			"instanceStatus":   status,
			"publishedToHost":  record.PublishPorts && !record.TunnelEnabled,
			"tunnelEnabled":    record.TunnelEnabled,
			"gatewayType":      record.Type,
		}, ipAddress); err != nil {
			_ = runtimeClient.removeContainer(ctx, containerInfo.ID)
			return managedGatewayInstanceResponse{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		_ = runtimeClient.removeContainer(ctx, containerInfo.ID)
		return managedGatewayInstanceResponse{}, fmt.Errorf("commit managed gateway deploy transaction: %w", err)
	}

	return s.loadManagedGatewayInstance(ctx, record.ID, instanceID)
}

func (s Service) removeManagedGatewayInstance(ctx context.Context, runtimeClient *dockerSocketClient, gatewayID string, instance managedGatewayInstanceResponse) error {
	if _, err := s.DB.Exec(ctx, `
UPDATE "ManagedGatewayInstance"
   SET status = 'REMOVING'::"ManagedInstanceStatus",
       "updatedAt" = NOW()
 WHERE id = $1
`, instance.ID); err != nil {
		return fmt.Errorf("mark managed gateway instance removing: %w", err)
	}

	if err := runtimeClient.removeContainer(ctx, instance.ContainerID); err != nil {
		if _, updateErr := s.DB.Exec(ctx, `
UPDATE "ManagedGatewayInstance"
   SET status = 'ERROR'::"ManagedInstanceStatus",
       "healthStatus" = 'unhealthy',
       "errorMessage" = $2,
       "updatedAt" = NOW()
 WHERE id = $1
`, instance.ID, err.Error()); updateErr != nil {
			return fmt.Errorf("remove managed gateway container: %v (also failed to persist error: %w)", err, updateErr)
		}
		return &requestError{status: http.StatusServiceUnavailable, message: fmt.Sprintf("Gateway undeploy failed: %v", err)}
	}

	if _, err := s.DB.Exec(ctx, `DELETE FROM "ManagedGatewayInstance" WHERE id = $1`, instance.ID); err != nil {
		return fmt.Errorf("delete managed gateway instance: %w", err)
	}
	return nil
}

func (s Service) recordManagedGatewayDeploymentFailure(ctx context.Context, record gatewayRecord, orchestratorType, containerName string, deploymentErr error) error {
	if s.DB == nil || deploymentErr == nil {
		return nil
	}

	message := strings.TrimSpace(deploymentErr.Error())
	if message == "" {
		message = "container deployment failed"
	}
	_, err := s.DB.Exec(ctx, `
INSERT INTO "ManagedGatewayInstance" (
	id,
	"gatewayId",
	"containerId",
	"containerName",
	host,
	port,
	status,
	"orchestratorType",
	"healthStatus",
	"errorMessage",
	"consecutiveFailures",
	"createdAt",
	"updatedAt"
)
VALUES (
	$1,
	$2,
	$3,
	$4,
	'unknown',
	0,
	'ERROR'::"ManagedInstanceStatus",
	NULLIF($5, ''),
	'unhealthy',
	$6,
	1,
	NOW(),
	NOW()
)
`, uuid.NewString(), record.ID, fmt.Sprintf("failed-%d", time.Now().UTC().UnixNano()), containerName, orchestratorType, message)
	if err != nil {
		return fmt.Errorf("record managed gateway deployment failure: %w", err)
	}
	return nil
}

func (s Service) waitForManagedGatewayReady(ctx context.Context, record gatewayRecord, containerName, instanceHost string, instancePort int, apiPort *int) error {
	probeHost := strings.TrimSpace(containerName)
	if probeHost == "" {
		probeHost = strings.TrimSpace(instanceHost)
	}
	if probeHost == "" || instancePort <= 0 {
		return fmt.Errorf("managed gateway %q has no routable readiness target", record.Name)
	}

	deadlineCtx, cancel := context.WithTimeout(ctx, managedGatewayReadyTimeout)
	defer cancel()

	probes := []struct {
		name string
		host string
		port int
	}{
		{name: "service", host: probeHost, port: instancePort},
	}
	if strings.EqualFold(record.Type, "MANAGED_SSH") && apiPort != nil && *apiPort > 0 {
		probes = append(probes, struct {
			name string
			host string
			port int
		}{
			name: "grpc",
			host: probeHost,
			port: *apiPort,
		})
	}

	var lastErr string
	for {
		allReady := true
		for _, probe := range probes {
			result := tcpProbe(deadlineCtx, probe.host, probe.port, time.Second)
			if result.Reachable {
				continue
			}
			allReady = false
			if result.Error != nil {
				lastErr = fmt.Sprintf("%s endpoint %s:%d not ready: %s", probe.name, probe.host, probe.port, strings.TrimSpace(*result.Error))
			} else {
				lastErr = fmt.Sprintf("%s endpoint %s:%d not ready", probe.name, probe.host, probe.port)
			}
			break
		}
		if allReady {
			return nil
		}

		timer := time.NewTimer(managedGatewayReadyPoll)
		select {
		case <-deadlineCtx.Done():
			timer.Stop()
			if lastErr == "" {
				lastErr = fmt.Sprintf("managed gateway %q did not become ready before timeout", record.Name)
			}
			return fmt.Errorf("%s", lastErr)
		case <-timer.C:
		}
	}
}

func managedGatewayInstanceAddress(record gatewayRecord, info managedContainerInfo, fallbackPort int) (string, int) {
	port := fallbackPort
	if publishedPort, ok := info.PublishedPorts[fallbackPort]; ok && publishedPort > 0 {
		host := strings.TrimSpace(record.Host)
		if host == "" {
			host = "127.0.0.1"
		}
		return host, publishedPort
	}

	if containerPort, ok := info.ContainerPorts[fallbackPort]; ok && containerPort > 0 {
		port = containerPort
	}
	return inferPrimaryInstanceHost(record, info.Name), port
}
