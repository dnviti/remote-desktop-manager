package main

import "testing"

func TestParseTarget(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		host string
		port int
		ok   bool
	}{
		{name: "host port", raw: "localhost:4822", host: "localhost", port: 4822, ok: true},
		{name: "ipv6 shorthand", raw: "::1:5900", host: "::1", port: 5900, ok: true},
		{name: "bracketed ipv6", raw: "[::1]:5900", host: "::1", port: 5900, ok: true},
		{name: "missing colon", raw: "localhost", ok: false},
		{name: "bad port", raw: "localhost:abc", host: "localhost", ok: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			host, port, ok := parseTarget(tt.raw)
			if ok != tt.ok || host != tt.host || port != tt.port {
				t.Fatalf("parseTarget = (%q, %d, %v), want (%q, %d, %v)", host, port, ok, tt.host, tt.port, tt.ok)
			}
		})
	}
}

func TestIsAllowedLocalHost(t *testing.T) {
	for _, host := range []string{"localhost", "127.0.0.1", "::1"} {
		if !isAllowedLocalHost(host) {
			t.Fatalf("%s should be allowed", host)
		}
	}
	for _, host := range []string{"LOCALHOST", "Localhost", "192.168.1.1", "0.0.0.0", "[::1]"} {
		if isAllowedLocalHost(host) {
			t.Fatalf("%s should be rejected", host)
		}
	}
}
