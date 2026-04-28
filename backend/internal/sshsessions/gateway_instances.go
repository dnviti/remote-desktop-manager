package sshsessions

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"time"
)

type managedGatewayInstance struct {
	ID             string
	Host           string
	Port           int
	CreatedAt      time.Time
	ActiveSessions int
}

func (s Service) selectManagedGatewayInstance(ctx context.Context, gatewayID, strategy string) (*managedGatewayInstance, error) {
	rows, err := s.DB.Query(ctx, `
SELECT
	i.id,
	COALESCE(NULLIF(i.host, ''), NULLIF(i."containerName", '')) AS host,
	COALESCE(NULLIF(i.port, 0), g.port) AS port,
	i."createdAt",
	COUNT(sess.id)::int AS active_sessions
FROM "ManagedGatewayInstance" i
JOIN "Gateway" g
	ON g.id = i."gatewayId"
LEFT JOIN "ActiveSession" sess
	ON sess."instanceId" = i.id
	AND sess.status <> 'CLOSED'::"SessionStatus"
WHERE i."gatewayId" = $1
  AND i.status = 'RUNNING'::"ManagedInstanceStatus"
  AND COALESCE(i."healthStatus", '') = 'healthy'
GROUP BY i.id, i.host, i.port, i."containerName", i."createdAt", g.port
ORDER BY i."createdAt" ASC
`, gatewayID)
	if err != nil {
		return nil, fmt.Errorf("load managed ssh gateway instances: %w", err)
	}
	defer rows.Close()

	instances := make([]managedGatewayInstance, 0)
	for rows.Next() {
		var item managedGatewayInstance
		if err := rows.Scan(&item.ID, &item.Host, &item.Port, &item.CreatedAt, &item.ActiveSessions); err != nil {
			return nil, fmt.Errorf("scan managed ssh gateway instance: %w", err)
		}
		instances = append(instances, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate managed ssh gateway instances: %w", err)
	}
	if len(instances) == 0 {
		return nil, nil
	}

	selected := instances[0]
	if strings.EqualFold(strings.TrimSpace(strategy), "LEAST_CONNECTIONS") {
		for _, instance := range instances[1:] {
			if instance.ActiveSessions < selected.ActiveSessions {
				selected = instance
			}
		}
		return &selected, nil
	}

	minSessions := selected.ActiveSessions
	for _, instance := range instances[1:] {
		if instance.ActiveSessions < minSessions {
			minSessions = instance.ActiveSessions
		}
	}
	candidates := make([]managedGatewayInstance, 0, len(instances))
	for _, instance := range instances {
		if instance.ActiveSessions == minSessions {
			candidates = append(candidates, instance)
		}
	}
	if len(candidates) == 1 {
		return &candidates[0], nil
	}

	picker := rand.New(rand.NewSource(time.Now().UnixNano()))
	chosen := candidates[picker.Intn(len(candidates))]
	return &chosen, nil
}
