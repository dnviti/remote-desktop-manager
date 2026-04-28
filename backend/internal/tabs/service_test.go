package tabs

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestNormalizeIncomingTabGeneratesMissingID(t *testing.T) {
	tab, ok := normalizeIncomingTab(persistedTab{
		ConnectionID: " connection-1 ",
		SortOrder:    4,
		IsActive:     true,
	})
	if !ok {
		t.Fatal("expected tab to be accepted")
	}
	if tab.ConnectionID != "connection-1" {
		t.Fatalf("expected trimmed connection id, got %q", tab.ConnectionID)
	}
	if !strings.HasPrefix(tab.ID, "tab-") {
		t.Fatalf("expected generated tab id prefix, got %q", tab.ID)
	}
	if _, err := uuid.Parse(strings.TrimPrefix(tab.ID, "tab-")); err != nil {
		t.Fatalf("expected generated tab id to contain uuid: %v", err)
	}
}

func TestNormalizeIncomingTabRejectsMissingConnectionID(t *testing.T) {
	if _, ok := normalizeIncomingTab(persistedTab{ID: "tab-1"}); ok {
		t.Fatal("expected tab without connection id to be rejected")
	}
}

func TestNormalizeIncomingTabPreservesProvidedID(t *testing.T) {
	tab, ok := normalizeIncomingTab(persistedTab{ID: " tab-1 ", ConnectionID: "connection-1"})
	if !ok {
		t.Fatal("expected tab to be accepted")
	}
	if tab.ID != "tab-1" {
		t.Fatalf("expected trimmed provided id, got %q", tab.ID)
	}
}
