package queryrunner

import (
	"reflect"
	"testing"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func TestBuildSessionInitStatements(t *testing.T) {
	t.Parallel()

	statements := buildSessionInitStatements(&contracts.DatabaseSessionConfig{
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

	statements := buildSessionInitStatements(&contracts.DatabaseSessionConfig{
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
