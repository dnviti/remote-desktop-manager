package cmd

import (
	"errors"
	"reflect"
	"testing"
)

func TestApprovedObjectNamesUsesQualifiedNamesWhenSchemaPresent(t *testing.T) {
	t.Parallel()

	got := approvedObjectNames([]aiObjectRequest{
		{Name: "demo_customers", Schema: "public"},
		{Name: "demo_invoices", Schema: ""},
		{Name: "  ", Schema: "public"},
	})

	want := []string{"public.demo_customers", "demo_invoices"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("approvedObjectNames() = %#v, want %#v", got, want)
	}
}

func TestBuildApprovedOptimizationDataUsesTypeTargetKeys(t *testing.T) {
	t.Parallel()

	got := buildApprovedOptimizationData([]aiDataRequest{
		{Type: "indexes", Target: "public.demo_invoices"},
		{Type: "statistics", Target: "public.demo_invoices"},
		{Type: "custom_query", Target: "ignored"},
	}, func(req aiDataRequest) (any, error) {
		return map[string]any{"target": req.Target, "type": req.Type}, nil
	})

	want := map[string]any{
		"indexes_public.demo_invoices": map[string]any{"target": "public.demo_invoices", "type": "indexes"},
		"statistics_public.demo_invoices": map[string]any{"target": "public.demo_invoices", "type": "statistics"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("buildApprovedOptimizationData() = %#v, want %#v", got, want)
	}
}

func TestBuildApprovedOptimizationDataMarksFetchFailures(t *testing.T) {
	t.Parallel()

	got := buildApprovedOptimizationData([]aiDataRequest{
		{Type: "indexes", Target: "public.demo_customers"},
	}, func(req aiDataRequest) (any, error) {
		return nil, errors.New("boom")
	})

	want := map[string]any{
		"indexes_public.demo_customers": map[string]any{"error": "fetch_failed"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("buildApprovedOptimizationData() = %#v, want %#v", got, want)
	}
}

func TestReadAITextInputRejectsConflictingInputs(t *testing.T) {
	t.Parallel()

	if _, err := readAITextInput("inline", "prompt.txt", "prompt"); err == nil {
		t.Fatal("expected conflict error when both inline and file inputs are provided")
	}
}
