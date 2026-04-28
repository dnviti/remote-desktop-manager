package egresspolicy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

const (
	ProtocolSSH      = "SSH"
	ProtocolRDP      = "RDP"
	ProtocolVNC      = "VNC"
	ProtocolDatabase = "DATABASE"
)

type Policy struct {
	Rules []Rule `json:"rules"`
}

type Rule struct {
	Description string   `json:"description,omitempty"`
	Protocols   []string `json:"protocols"`
	Hosts       []string `json:"hosts,omitempty"`
	CIDRs       []string `json:"cidrs,omitempty"`
	Ports       []int    `json:"ports"`
}

func Empty() Policy {
	return Policy{Rules: []Rule{}}
}

func EmptyJSON() json.RawMessage {
	return json.RawMessage(`{"rules":[]}`)
}

func NormalizeRaw(raw json.RawMessage) (json.RawMessage, Policy, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		policy := Empty()
		return EmptyJSON(), policy, nil
	}

	decoder := json.NewDecoder(bytes.NewReader(trimmed))
	decoder.DisallowUnknownFields()

	var policy Policy
	if err := decoder.Decode(&policy); err != nil {
		return nil, Policy{}, fmt.Errorf("parse egressPolicy: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err == nil {
		return nil, Policy{}, fmt.Errorf("parse egressPolicy: trailing JSON value")
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
		rule.Description = strings.TrimSpace(rule.Description)
		rule.Protocols = normalizeProtocols(rule.Protocols)
		rule.Hosts = normalizeHosts(rule.Hosts)
		rule.CIDRs = normalizeStrings(rule.CIDRs)
		rule.Ports = normalizePorts(rule.Ports)

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
