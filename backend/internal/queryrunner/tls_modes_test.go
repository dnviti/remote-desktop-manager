package queryrunner

import (
	"crypto/tls"
	"net/url"
	"testing"

	mysqlDriver "github.com/go-sql-driver/mysql"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func TestBuildPostgresDSNNormalizesSSLMode(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name    string
		rawMode string
		want    string
	}{
		{name: "unset", rawMode: "", want: ""},
		{name: "prefer alias", rawMode: "preferred", want: "prefer"},
		{name: "require alias", rawMode: "true", want: "require"},
		{name: "verify ca alias", rawMode: "verifyca", want: "verify-ca"},
		{name: "verify full alias", rawMode: "strict", want: "verify-full"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			dsn, err := buildPostgresDSN(&contracts.DatabaseTarget{
				Protocol: "postgresql",
				Host:     "db.example.com",
				Port:     5432,
				Username: "arsenale",
				Password: "secret",
				Database: "demo",
				SSLMode:  tc.rawMode,
			})
			if err != nil {
				t.Fatalf("buildPostgresDSN() error = %v", err)
			}

			parsed, err := url.Parse(dsn)
			if err != nil {
				t.Fatalf("url.Parse() error = %v", err)
			}

			got := parsed.Query().Get("sslmode")
			if got != tc.want {
				t.Fatalf("sslmode = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestBuildMySQLDSNNormalizesTLSMode(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name    string
		rawMode string
		want    string
	}{
		{name: "default remains disabled", rawMode: "", want: "false"},
		{name: "prefer alias", rawMode: "prefer", want: "preferred"},
		{name: "required alias", rawMode: "require", want: "true"},
		{name: "verify skip alias", rawMode: "insecure", want: "skip-verify"},
		{name: "legacy postgres mode falls back to preferred", rawMode: "verify-full", want: "preferred"},
		{name: "unknown typo falls back to preferred", rawMode: "requierd", want: "preferred"},
		{name: "custom tls profile", rawMode: "cloudsql", want: "cloudsql"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.rawMode == "cloudsql" {
				if err := mysqlDriver.RegisterTLSConfig("cloudsql", &tls.Config{MinVersion: tls.VersionTLS12}); err != nil {
					t.Fatalf("RegisterTLSConfig() error = %v", err)
				}
				defer mysqlDriver.DeregisterTLSConfig("cloudsql")
			}

			dsn, err := buildMySQLDSN(&contracts.DatabaseTarget{
				Protocol: "mysql",
				Host:     "db.example.com",
				Port:     3306,
				Username: "arsenale",
				Password: "secret",
				Database: "demo",
				SSLMode:  tc.rawMode,
			})
			if err != nil {
				t.Fatalf("buildMySQLDSN() error = %v", err)
			}

			cfg, err := mysqlDriver.ParseDSN(dsn)
			if err != nil {
				t.Fatalf("mysql.ParseDSN() error = %v", err)
			}

			if cfg.TLSConfig != tc.want {
				t.Fatalf("TLSConfig = %q, want %q", cfg.TLSConfig, tc.want)
			}
		})
	}
}
