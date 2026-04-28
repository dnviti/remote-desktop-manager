package egresspolicy

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
)

const (
	ProtocolSSH      = "SSH"
	ProtocolRDP      = "RDP"
	ProtocolVNC      = "VNC"
	ProtocolDatabase = "DATABASE"

	ActionAllow    = "ALLOW"
	ActionDisallow = "DISALLOW"
)

type Policy struct {
	Rules []Rule `json:"rules"`
}

type Rule struct {
	raw         json.RawMessage
	Description string   `json:"description,omitempty"`
	Enabled     *bool    `json:"enabled,omitempty"`
	Action      string   `json:"action,omitempty"`
	Protocols   []string `json:"protocols"`
	Hosts       []string `json:"hosts,omitempty"`
	CIDRs       []string `json:"cidrs,omitempty"`
	Ports       []int    `json:"ports"`
	UserIDs     []string `json:"userIds,omitempty"`
	TeamIDs     []string `json:"teamIds,omitempty"`
}

func Empty() Policy {
	return Policy{Rules: []Rule{}}
}

func EmptyJSON() json.RawMessage {
	return json.RawMessage(`{"rules":[]}`)
}

func (r Rule) MarshalJSON() ([]byte, error) {
	if len(r.raw) > 0 {
		return r.raw, nil
	}
	type ruleJSON struct {
		Description string   `json:"description,omitempty"`
		Enabled     bool     `json:"enabled"`
		Action      string   `json:"action"`
		Protocols   []string `json:"protocols,omitempty"`
		Hosts       []string `json:"hosts,omitempty"`
		CIDRs       []string `json:"cidrs,omitempty"`
		Ports       []int    `json:"ports,omitempty"`
		UserIDs     []string `json:"userIds,omitempty"`
		TeamIDs     []string `json:"teamIds,omitempty"`
	}
	return json.Marshal(ruleJSON{
		Description: r.Description,
		Enabled:     ruleEnabled(r),
		Action:      normalizedAction(r.Action),
		Protocols:   r.Protocols,
		Hosts:       r.Hosts,
		CIDRs:       r.CIDRs,
		Ports:       r.Ports,
		UserIDs:     r.UserIDs,
		TeamIDs:     r.TeamIDs,
	})
}

func NormalizeRaw(raw json.RawMessage) (json.RawMessage, Policy, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		policy := Empty()
		return EmptyJSON(), policy, nil
	}

	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.DisallowUnknownFields()

	var rawPolicy struct {
		Rules []json.RawMessage `json:"rules"`
	}
	if err := decoder.Decode(&rawPolicy); err != nil {
		return nil, Policy{}, fmt.Errorf("parse egressPolicy: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err == nil {
		return nil, Policy{}, fmt.Errorf("parse egressPolicy: trailing JSON value")
	}

	policy := Policy{Rules: make([]Rule, 0, len(rawPolicy.Rules))}
	for i, rawRule := range rawPolicy.Rules {
		rule, err := normalizeRawRule(i, rawRule)
		if err != nil {
			return nil, Policy{}, err
		}
		policy.Rules = append(policy.Rules, rule)
	}

	normalized, err := Normalize(policy)
	if err != nil {
		return nil, Policy{}, err
	}
	canonical, err := json.Marshal(normalized)
	if err != nil {
		return nil, Policy{}, fmt.Errorf("encode egressPolicy: %w", err)
	}
	return canonical, normalized, nil
}

func Normalize(policy Policy) (Policy, error) {
	if policy.Rules == nil {
		policy.Rules = []Rule{}
	}
	for i := range policy.Rules {
		rule := &policy.Rules[i]
		if len(rule.raw) > 0 {
			continue
		}
		if rule.Enabled == nil {
			enabled := true
			rule.Enabled = &enabled
		}
		rule.Action = normalizedAction(rule.Action)
		rule.Description = strings.TrimSpace(rule.Description)
		rule.Protocols = normalizeProtocols(rule.Protocols)
		rule.Hosts = normalizeHosts(rule.Hosts)
		rule.CIDRs = normalizeStrings(rule.CIDRs)
		rule.Ports = normalizePorts(rule.Ports)
		rule.UserIDs = normalizeStrings(rule.UserIDs)
		rule.TeamIDs = normalizeStrings(rule.TeamIDs)

		if !*rule.Enabled {
			continue
		}

		switch rule.Action {
		case ActionAllow, ActionDisallow:
		default:
			return Policy{}, fmt.Errorf("egressPolicy.rules[%d].action must be ALLOW or DISALLOW", i)
		}
		for _, userID := range rule.UserIDs {
			if _, err := uuid.Parse(userID); err != nil {
				return Policy{}, fmt.Errorf("egressPolicy.rules[%d].userIds contains invalid UUID %q", i, userID)
			}
		}
		for _, teamID := range rule.TeamIDs {
			if _, err := uuid.Parse(teamID); err != nil {
				return Policy{}, fmt.Errorf("egressPolicy.rules[%d].teamIds contains invalid UUID %q", i, teamID)
			}
		}

		if len(rule.Protocols) == 0 {
			return Policy{}, fmt.Errorf("egressPolicy.rules[%d].protocols must include at least one protocol", i)
		}
		for _, protocol := range rule.Protocols {
			if !validProtocol(protocol) {
				return Policy{}, fmt.Errorf("egressPolicy.rules[%d].protocols contains unsupported protocol %q", i, protocol)
			}
		}
		if len(rule.Hosts) == 0 && len(rule.CIDRs) == 0 {
			return Policy{}, fmt.Errorf("egressPolicy.rules[%d] must include hosts or cidrs", i)
		}
		for _, host := range rule.Hosts {
			if err := validateHostPattern(host); err != nil {
				return Policy{}, fmt.Errorf("egressPolicy.rules[%d].hosts contains invalid pattern %q: %w", i, host, err)
			}
		}
		for _, cidr := range rule.CIDRs {
			if err := validateCIDR(cidr); err != nil {
				return Policy{}, fmt.Errorf("egressPolicy.rules[%d].cidrs contains invalid CIDR %q: %w", i, cidr, err)
			}
		}
		if len(rule.Ports) == 0 {
			return Policy{}, fmt.Errorf("egressPolicy.rules[%d].ports must include at least one port", i)
		}
		for _, port := range rule.Ports {
			if port < 1 || port > 65535 {
				return Policy{}, fmt.Errorf("egressPolicy.rules[%d].ports contains invalid port %d", i, port)
			}
		}
	}
	return policy, nil
}

func normalizeRawRule(index int, raw json.RawMessage) (Rule, error) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return Rule{}, fmt.Errorf("egressPolicy.rules[%d] must be an object", index)
	}

	enabled := true
	if rawEnabled, ok := object["enabled"]; ok {
		if err := json.Unmarshal(rawEnabled, &enabled); err != nil {
			return Rule{}, fmt.Errorf("egressPolicy.rules[%d].enabled must be a boolean", index)
		}
	}
	if !enabled {
		var draft map[string]any
		if err := json.Unmarshal(raw, &draft); err != nil || draft == nil {
			return Rule{}, fmt.Errorf("egressPolicy.rules[%d] must be an object", index)
		}
		draft["enabled"] = false
		normalized, err := json.Marshal(draft)
		if err != nil {
			return Rule{}, fmt.Errorf("encode disabled egressPolicy.rules[%d]: %w", index, err)
		}
		return Rule{raw: normalized}, nil
	}

	type typedRule struct {
		Description string   `json:"description,omitempty"`
		Enabled     *bool    `json:"enabled,omitempty"`
		Action      string   `json:"action,omitempty"`
		Protocols   []string `json:"protocols"`
		Hosts       []string `json:"hosts,omitempty"`
		CIDRs       []string `json:"cidrs,omitempty"`
		Ports       []int    `json:"ports"`
		UserIDs     []string `json:"userIds,omitempty"`
		TeamIDs     []string `json:"teamIds,omitempty"`
	}
	decoder := json.NewDecoder(bytes.NewReader(bytes.TrimSpace(raw)))
	decoder.DisallowUnknownFields()
	var typed typedRule
	if err := decoder.Decode(&typed); err != nil {
		return Rule{}, fmt.Errorf("parse egressPolicy.rules[%d]: %w", index, err)
	}
	if typed.Enabled == nil {
		typed.Enabled = &enabled
	}
	return Rule{
		Description: typed.Description,
		Enabled:     typed.Enabled,
		Action:      typed.Action,
		Protocols:   typed.Protocols,
		Hosts:       typed.Hosts,
		CIDRs:       typed.CIDRs,
		Ports:       typed.Ports,
		UserIDs:     typed.UserIDs,
		TeamIDs:     typed.TeamIDs,
	}, nil
}

func ruleEnabled(rule Rule) bool {
	if len(rule.raw) > 0 {
		return false
	}
	if rule.Enabled == nil {
		return true
	}
	return *rule.Enabled
}

func normalizedAction(action string) string {
	action = strings.ToUpper(strings.TrimSpace(action))
	if action == "" {
		return ActionAllow
	}
	return action
}

func normalizeProtocols(values []string) []string {
	result := normalizeStrings(values)
	for i := range result {
		result[i] = strings.ToUpper(result[i])
	}
	return result
}

func normalizeHosts(values []string) []string {
	result := normalizeStrings(values)
	for i := range result {
		result[i] = normalizeHost(result[i])
	}
	return result
}

func normalizeStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	sort.Strings(result)
	return result
}

func normalizePorts(values []int) []int {
	seen := map[int]struct{}{}
	result := make([]int, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Ints(result)
	return result
}

func validProtocol(protocol string) bool {
	switch strings.ToUpper(strings.TrimSpace(protocol)) {
	case ProtocolSSH, ProtocolRDP, ProtocolVNC, ProtocolDatabase:
		return true
	default:
		return false
	}
}

func SignPrincipalContext(secret, userID string, teamIDs []string) string {
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(secret)))
	mac.Write([]byte(strings.TrimSpace(userID)))
	mac.Write([]byte{0})
	for _, teamID := range normalizeStrings(teamIDs) {
		mac.Write([]byte(teamID))
		mac.Write([]byte{0})
	}
	return hex.EncodeToString(mac.Sum(nil))
}

func VerifyPrincipalContextSignature(secret, userID string, teamIDs []string, signature string) bool {
	expected := SignPrincipalContext(secret, userID, teamIDs)
	provided, err := hex.DecodeString(strings.TrimSpace(signature))
	if err != nil {
		return false
	}
	expectedBytes, err := hex.DecodeString(expected)
	if err != nil {
		return false
	}
	return hmac.Equal(provided, expectedBytes)
}

func RequiresPrincipalRaw(raw json.RawMessage) bool {
	_, policy, err := NormalizeRaw(raw)
	if err != nil {
		return false
	}
	for _, rule := range policy.Rules {
		if !ruleEnabled(rule) {
			continue
		}
		if len(rule.UserIDs) > 0 || len(rule.TeamIDs) > 0 {
			return true
		}
	}
	return false
}
