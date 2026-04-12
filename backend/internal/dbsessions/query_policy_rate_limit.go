package dbsessions

import (
	"context"
	"math"
	"strings"
	"time"
)

func (s Service) evaluateRateLimit(ctx context.Context, userID, tenantID string, queryType dbQueryType, tenantRole, database, table string) rateLimitEvaluation {
	return s.evaluateRateLimitWithSettings(ctx, userID, tenantID, "", databaseSettings{}, queryType, tenantRole, database, table)
}

func (s Service) evaluateRateLimitWithSettings(ctx context.Context, userID, tenantID, connectionID string, settings databaseSettings, queryType dbQueryType, tenantRole, database, table string) rateLimitEvaluation {
	if !settingBoolOrDefault(settings.RateLimitEnabled, true) {
		return rateLimitEvaluation{Allowed: true, Remaining: -1}
	}
	if strings.TrimSpace(userID) == "" {
		return rateLimitEvaluation{Allowed: true, Remaining: -1}
	}

	database = strings.ToLower(strings.TrimSpace(database))
	table = strings.ToLower(strings.TrimSpace(table))
	tenantRole = strings.ToUpper(strings.TrimSpace(tenantRole))
	tenantKey := strings.TrimSpace(tenantID)
	if tenantKey == "" {
		tenantKey = "no-tenant"
	}

	now := time.Now()
	policies := resolveRateLimitPolicies(s.loadTenantRateLimitPolicies(ctx, tenantID), connectionID, settings)

	for _, policy := range policies {
		if policy.QueryType.Valid && !strings.EqualFold(policy.QueryType.String, string(queryType)) {
			continue
		}
		scope := strings.ToLower(strings.TrimSpace(policy.Scope.String))
		if scope != "" && scope != database && scope != table {
			continue
		}
		if roleExempt(policy.ExemptRoles, tenantRole) {
			continue
		}

		keyType := "ALL"
		if policy.QueryType.Valid && strings.TrimSpace(policy.QueryType.String) != "" {
			keyType = strings.ToUpper(strings.TrimSpace(policy.QueryType.String))
		}
		bucketKey := strings.Join([]string{
			strings.TrimSpace(userID),
			tenantKey,
			keyType,
			strings.TrimSpace(policy.ID),
		}, ":")

		dbRateLimitBucketsMu.Lock()
		cleanupExpiredBucketsLocked(now)
		bucket := getOrCreateBucketLocked(bucketKey, policy, now)
		if bucket.Tokens >= 1 {
			bucket.Tokens -= 1
			remaining := int(math.Max(0, math.Floor(bucket.Tokens)))
			dbRateLimitBucketsMu.Unlock()
			return rateLimitEvaluation{
				Allowed:    true,
				PolicyName: policy.Name,
				Action:     strings.ToUpper(strings.TrimSpace(policy.Action)),
				Remaining:  remaining,
				Matched:    true,
			}
		}

		retryAfterMS := 0
		if bucket.RefillRate > 0 {
			retryAfterMS = int(math.Ceil((1 - bucket.Tokens) / bucket.RefillRate))
		}
		remaining := int(math.Max(0, math.Floor(bucket.Tokens)))
		dbRateLimitBucketsMu.Unlock()

		action := strings.ToUpper(strings.TrimSpace(policy.Action))
		return rateLimitEvaluation{
			Allowed:      action == "LOG_ONLY",
			PolicyName:   policy.Name,
			Action:       action,
			Remaining:    remaining,
			RetryAfterMS: retryAfterMS,
			Matched:      true,
		}
	}

	return rateLimitEvaluation{Allowed: true, Remaining: -1}
}

func (s Service) loadTenantRateLimitPolicies(ctx context.Context, tenantID string) []rateLimitPolicyRecord {
	if s.DB == nil || strings.TrimSpace(tenantID) == "" {
		return nil
	}

	rows, err := s.DB.Query(ctx, `
SELECT id, name, "queryType"::text, "windowMs", "maxQueries", "burstMax", "exemptRoles", scope, action::text, priority
FROM "DbRateLimitPolicy"
WHERE "tenantId" = $1 AND enabled = true
ORDER BY priority DESC, "createdAt" DESC
`, tenantID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	policies := make([]rateLimitPolicyRecord, 0)
	for rows.Next() {
		var policy rateLimitPolicyRecord
		if scanErr := rows.Scan(&policy.ID, &policy.Name, &policy.QueryType, &policy.WindowMS, &policy.MaxQueries, &policy.BurstMax, &policy.ExemptRoles, &policy.Scope, &policy.Action, &policy.Priority); scanErr != nil {
			return nil
		}
		policies = append(policies, policy)
	}
	return policies
}

func cleanupExpiredBucketsLocked(now time.Time) {
	nowUnix := now.UnixMilli()
	for key, bucket := range dbRateLimitBuckets {
		if nowUnix-bucket.LastSeenUnix > int64(bucket.WindowMS*2) {
			delete(dbRateLimitBuckets, key)
		}
	}
}

func getOrCreateBucketLocked(key string, policy rateLimitPolicyRecord, now time.Time) *tokenBucket {
	nowUnix := now.UnixMilli()
	if bucket, ok := dbRateLimitBuckets[key]; ok {
		elapsed := float64(nowUnix-bucket.LastRefillUnix) * bucket.RefillRate
		bucket.Tokens = math.Min(float64(bucket.MaxTokens), bucket.Tokens+elapsed)
		bucket.LastRefillUnix = nowUnix
		bucket.LastSeenUnix = nowUnix
		bucket.WindowMS = policy.WindowMS
		bucket.MaxTokens = policy.BurstMax
		bucket.RefillRate = float64(policy.MaxQueries) / float64(policy.WindowMS)
		if bucket.Tokens > float64(bucket.MaxTokens) {
			bucket.Tokens = float64(bucket.MaxTokens)
		}
		return bucket
	}

	bucket := &tokenBucket{
		Tokens:         float64(policy.BurstMax),
		LastRefillUnix: nowUnix,
		LastSeenUnix:   nowUnix,
		WindowMS:       policy.WindowMS,
		MaxTokens:      policy.BurstMax,
		RefillRate:     float64(policy.MaxQueries) / float64(policy.WindowMS),
	}
	dbRateLimitBuckets[key] = bucket
	return bucket
}
