package egresspolicy

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"os"
	"strconv"
	"strings"
)

type Request struct {
	Protocol string
	Host     string
	Port     int
	UserID   string
	TeamIDs  []string
}

type Decision struct {
	Allowed     bool
	Reason      string
	Rule        string
	RuleIndex   int
	RuleAction  string
	DefaultDeny bool
}

type Resolver interface {
	LookupIPAddr(context.Context, string) ([]net.IPAddr, error)
}

type Options struct {
	Resolver          Resolver
	AllowLoopback     bool
	AllowLocalNetwork bool
	LocalAddrs        map[string]struct{}
}

func DefaultOptions() Options {
	return Options{
		Resolver:          net.DefaultResolver,
		AllowLoopback:     readBoolEnv("ALLOW_LOOPBACK", false),
		AllowLocalNetwork: readBoolEnv("ALLOW_LOCAL_NETWORK", true),
		LocalAddrs:        loadLocalInterfaceAddresses(),
	}
}

func AuthorizeRaw(ctx context.Context, raw json.RawMessage, req Request, opts Options) Decision {
	_, policy, err := NormalizeRaw(raw)
	if err != nil {
		return Decision{Allowed: false, Reason: "invalid gateway egress policy: " + err.Error()}
	}
	return Authorize(ctx, policy, req, opts)
}

func Authorize(ctx context.Context, policy Policy, req Request, opts Options) Decision {
	protocol := strings.ToUpper(strings.TrimSpace(req.Protocol))
	host := normalizeHost(req.Host)
	if !validProtocol(protocol) {
		return Decision{Reason: "unsupported protocol"}
	}
	if host == "" {
		return Decision{Reason: "target host is required"}
	}
	if req.Port < 1 || req.Port > 65535 {
		return Decision{Reason: "target port must be between 1 and 65535"}
	}
	if len(policy.Rules) == 0 {
		return Decision{Reason: "gateway egress policy has no matching rule", DefaultDeny: true}
	}

	addrs, reason := resolveTargetAddrs(ctx, host, opts)
	if reason != "" {
		return Decision{Reason: reason}
	}
	for _, addr := range addrs {
		if forbiddenAddress(addr, opts.LocalAddrs, opts.AllowLoopback, opts.AllowLocalNetwork) {
			return Decision{Reason: "target resolves to a forbidden address"}
		}
	}

	for index, rule := range policy.Rules {
		if !ruleEnabled(rule) {
			continue
		}
		action := normalizedAction(rule.Action)
		if action != ActionAllow && action != ActionDisallow {
			continue
		}
		if !ruleMatchesPrincipal(rule, strings.TrimSpace(req.UserID), req.TeamIDs) {
			continue
		}
		if !containsString(rule.Protocols, protocol) || !containsPort(rule.Ports, req.Port) {
			continue
		}
		if !ruleMatchesDestination(rule, host, addrs) {
			continue
		}
		decision := Decision{
			Allowed:    action == ActionAllow,
			Rule:       rule.Description,
			RuleIndex:  index + 1,
			RuleAction: action,
		}
		if !decision.Allowed {
			decision.Reason = "blocked by gateway egress policy rule"
		}
		return decision
	}
	return Decision{Reason: fmt.Sprintf("target %s:%d is not allowed by gateway egress policy", host, req.Port), DefaultDeny: true}
}

func ruleMatchesPrincipal(rule Rule, userID string, teamIDs []string) bool {
	if len(rule.UserIDs) == 0 && len(rule.TeamIDs) == 0 {
		return true
	}
	if userID != "" && containsString(rule.UserIDs, userID) {
		return true
	}
	if len(rule.TeamIDs) == 0 || len(teamIDs) == 0 {
		return false
	}
	teamSet := make(map[string]struct{}, len(teamIDs))
	for _, teamID := range teamIDs {
		teamID = strings.TrimSpace(teamID)
		if teamID != "" {
			teamSet[teamID] = struct{}{}
		}
	}
	for _, teamID := range rule.TeamIDs {
		if _, ok := teamSet[strings.TrimSpace(teamID)]; ok {
			return true
		}
	}
	return false
}

func ruleMatchesDestination(rule Rule, host string, addrs []netip.Addr) bool {
	if len(rule.Hosts) > 0 && ruleMatchesHost(rule, host) {
		return true
	}
	if len(rule.CIDRs) > 0 && ruleMatchesCIDR(rule, addrs) {
		return true
	}
	return false
}

func resolveTargetAddrs(ctx context.Context, host string, opts Options) ([]netip.Addr, string) {
	if addr, err := netip.ParseAddr(host); err == nil {
		return []netip.Addr{addr.Unmap()}, ""
	}
	resolver := opts.Resolver
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	values, err := resolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, "target host did not resolve"
	}
	addrs := make([]netip.Addr, 0, len(values))
	for _, value := range values {
		if addr, ok := netip.AddrFromSlice(value.IP); ok {
			addrs = append(addrs, addr.Unmap())
		}
	}
	if len(addrs) == 0 {
		return nil, "target host did not resolve"
	}
	return addrs, ""
}

func ruleMatchesHost(rule Rule, host string) bool {
	for _, pattern := range rule.Hosts {
		if hostMatchesPattern(host, pattern) {
			return true
		}
	}
	return false
}

func ruleMatchesCIDR(rule Rule, addrs []netip.Addr) bool {
	for _, cidr := range rule.CIDRs {
		prefix, err := netip.ParsePrefix(cidr)
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			if prefix.Contains(addr.Unmap()) {
				return true
			}
		}
	}
	return false
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), needle) {
			return true
		}
	}
	return false
}

func containsPort(values []int, needle int) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func readBoolEnv(name string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func loadLocalInterfaceAddresses() map[string]struct{} {
	result := map[string]struct{}{}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return result
	}
	for _, item := range addrs {
		switch value := item.(type) {
		case *net.IPNet:
			if addr, ok := netip.AddrFromSlice(value.IP); ok {
				result[addr.Unmap().String()] = struct{}{}
			}
		case *net.IPAddr:
			if addr, ok := netip.AddrFromSlice(value.IP); ok {
				result[addr.Unmap().String()] = struct{}{}
			}
		}
	}
	return result
}

func forbiddenAddress(addr netip.Addr, localAddrs map[string]struct{}, allowLoopback, allowLocalNetwork bool) bool {
	addr = addr.Unmap()
	if !addr.IsValid() {
		return false
	}
	if addr.IsUnspecified() {
		return true
	}
	if addr.IsLoopback() {
		return !allowLoopback
	}
	if addr.Is4() {
		value := addr.As4()
		if value[0] == 169 && value[1] == 254 {
			return true
		}
		if !allowLocalNetwork {
			if value[0] == 10 || (value[0] == 172 && value[1] >= 16 && value[1] <= 31) || (value[0] == 192 && value[1] == 168) {
				return true
			}
		}
	}
	if addr.Is6() {
		if addr.IsLinkLocalUnicast() {
			return true
		}
		if !allowLocalNetwork {
			value := addr.As16()
			if value[0]&0xfe == 0xfc {
				return true
			}
		}
	}
	if _, ok := localAddrs[addr.String()]; ok {
		return !(allowLoopback && addr.IsLoopback())
	}
	return false
}
