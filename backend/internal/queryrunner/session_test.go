package queryrunner

import (
	"reflect"
	"testing"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func TestBuildSessionInitStatements(t *testing.T) {
	t.Parallel()

	statements := buildSessionInitStatements(protocolPostgreSQL, &contracts.DatabaseSessionConfig{
		Timezone:     "Europe/Rome",
		SearchPath:   "public",
		Encoding:     "UTF8",
		InitCommands: []string{"SET statement_timeout = '5s'", "  "},
	})

	expected := []string{
		"SET timezone TO 'Europe/Rome'",
		"SET search_path TO public",
		"SET client_encoding TO 'UTF8'",
		"SET statement_timeout = '5s'",
	}

	if !reflect.DeepEqual(statements, expected) {
		t.Fatalf("unexpected statements: %#v", statements)
	}
}

func TestBuildSessionInitStatementsEscapesLiterals(t *testing.T) {
	t.Parallel()

	statements := buildSessionInitStatements(protocolPostgreSQL, &contracts.DatabaseSessionConfig{
		Timezone: "Europe/Ro'me",
		Encoding: "UTF'8",
	})

	expected := []string{
		"SET timezone TO 'Europe/Ro''me'",
		"SET client_encoding TO 'UTF''8'",
	}

	if !reflect.DeepEqual(statements, expected) {
		t.Fatalf("unexpected escaped statements: %#v", statements)
	}
}

func TestBuildTargetSessionInitStatementsSkipsOracleServiceNameAsCurrentSchema(t *testing.T) {
	t.Parallel()

	statements := buildTargetSessionInitStatements(&contracts.DatabaseTarget{
		Protocol:          protocolOracle,
		Database:          "FREEPDB1",
		OracleServiceName: "FREEPDB1",
		SessionConfig: &contracts.DatabaseSessionConfig{
			Timezone:   "UTC",
			SearchPath: "FREEPDB1",
		},
	})

	expected := []string{
		"ALTER SESSION SET TIME_ZONE = 'UTC'",
	}

	if !reflect.DeepEqual(statements, expected) {
		t.Fatalf("unexpected oracle statements: %#v", statements)
	}
}

func TestBuildTargetSessionInitStatementsKeepsOracleSchemaSearchPath(t *testing.T) {
	t.Parallel()

	statements := buildTargetSessionInitStatements(&contracts.DatabaseTarget{
		Protocol:          protocolOracle,
		Database:          "FREEPDB1",
		OracleServiceName: "FREEPDB1",
		SessionConfig: &contracts.DatabaseSessionConfig{
			Timezone:   "UTC",
			SearchPath: "demo_oracle_user",
		},
	})

	expected := []string{
		"ALTER SESSION SET TIME_ZONE = 'UTC'",
		"ALTER SESSION SET CURRENT_SCHEMA = DEMO_ORACLE_USER",
	}

	if !reflect.DeepEqual(statements, expected) {
		t.Fatalf("unexpected oracle statements: %#v", statements)
	}
}
