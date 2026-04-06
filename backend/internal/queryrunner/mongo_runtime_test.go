package queryrunner

import (
	"strings"
	"testing"
)

func TestNormalizeMongoReadOnlyQueryTextInfersFindFromCollectionFilterShorthand(t *testing.T) {
	t.Parallel()

	normalized, operation, collection, err := NormalizeMongoReadOnlyQueryText(`{"collection":"demo_customers","filter":{"active":true},"limit":25}`)
	if err != nil {
		t.Fatalf("NormalizeMongoReadOnlyQueryText() error = %v", err)
	}
	if operation != "find" {
		t.Fatalf("operation = %q, want find", operation)
	}
	if collection != "demo_customers" {
		t.Fatalf("collection = %q, want demo_customers", collection)
	}
	if !strings.Contains(normalized, `"operation": "find"`) {
		t.Fatalf("normalized query missing inferred operation: %s", normalized)
	}
}

func TestNormalizeMongoReadOnlyQueryTextAcceptsMongoCommandStyleFind(t *testing.T) {
	t.Parallel()

	normalized, operation, collection, err := NormalizeMongoReadOnlyQueryText(`{"find":"demo_customers","query":{"region":"na"},"limit":10}`)
	if err != nil {
		t.Fatalf("NormalizeMongoReadOnlyQueryText() error = %v", err)
	}
	if operation != "find" {
		t.Fatalf("operation = %q, want find", operation)
	}
	if collection != "demo_customers" {
		t.Fatalf("collection = %q, want demo_customers", collection)
	}
	if !strings.Contains(normalized, `"filter": {`) {
		t.Fatalf("normalized query missing translated query/filter payload: %s", normalized)
	}
}

func TestNormalizeMongoReadOnlyQueryTextUnwrapsQueryEnvelope(t *testing.T) {
	t.Parallel()

	normalized, operation, collection, err := NormalizeMongoReadOnlyQueryText(`{"query":{"collection":"demo_customers","field":"region"},"database":"arsenale_demo"}`)
	if err != nil {
		t.Fatalf("NormalizeMongoReadOnlyQueryText() error = %v", err)
	}
	if operation != "distinct" {
		t.Fatalf("operation = %q, want distinct", operation)
	}
	if collection != "demo_customers" {
		t.Fatalf("collection = %q, want demo_customers", collection)
	}
	if !strings.Contains(normalized, `"database": "arsenale_demo"`) {
		t.Fatalf("normalized query missing outer database: %s", normalized)
	}
}

func TestNormalizeMongoReadOnlyQueryTextSplitsQualifiedCollectionName(t *testing.T) {
	t.Parallel()

	normalized, operation, collection, err := NormalizeMongoReadOnlyQueryText(`{"collection":"arsenale_demo.demo_customers","operation":"find","filter":{"active":true},"limit":5}`)
	if err != nil {
		t.Fatalf("NormalizeMongoReadOnlyQueryText() error = %v", err)
	}
	if operation != "find" {
		t.Fatalf("operation = %q, want find", operation)
	}
	if collection != "demo_customers" {
		t.Fatalf("collection = %q, want demo_customers", collection)
	}
	if !strings.Contains(normalized, `"database": "arsenale_demo"`) {
		t.Fatalf("normalized query missing split database field: %s", normalized)
	}
	if !strings.Contains(normalized, `"collection": "demo_customers"`) {
		t.Fatalf("normalized query missing split collection field: %s", normalized)
	}
}
