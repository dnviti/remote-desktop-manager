package dbsessions

import "testing"

func TestClassifyDBQuery(t *testing.T) {
	tests := []struct {
		name string
		sql  string
		want dbQueryType
	}{
		{name: "select", sql: "select * from users", want: dbQueryTypeSelect},
		{name: "insert", sql: "insert into users(id) values (1)", want: dbQueryTypeInsert},
		{name: "update", sql: "update users set name = 'a'", want: dbQueryTypeUpdate},
		{name: "delete", sql: "delete from users", want: dbQueryTypeDelete},
		{name: "ddl", sql: "drop table users", want: dbQueryTypeDDL},
		{name: "cte", sql: "with q as (select 1) select * from q", want: dbQueryTypeSelect},
		{name: "mongo shorthand find", sql: `{"collection":"demo_customers","filter":{"active":true},"limit":25}`, want: dbQueryTypeSelect},
	}

	for _, tt := range tests {
		if got := classifyDBQuery(tt.sql); got != tt.want {
			t.Fatalf("%s: classifyDBQuery(%q) = %q, want %q", tt.name, tt.sql, got, tt.want)
		}
	}
}

func TestExtractTablesAccessed(t *testing.T) {
	got := extractTablesAccessed(`select * from public.users u join "orders" o on o.user_id = u.id`)
	if len(got) != 2 {
		t.Fatalf("extractTablesAccessed() returned %d tables, want 2: %#v", len(got), got)
	}
	if got[0] != "public.users" {
		t.Fatalf("first table = %q, want public.users", got[0])
	}
	if got[1] != "orders" {
		t.Fatalf("second table = %q, want orders", got[1])
	}
}

func TestExtractTablesAccessedMongoShorthand(t *testing.T) {
	got := extractTablesAccessed(`{"find":"demo_customers","query":{"active":true},"limit":10}`)
	if len(got) != 1 {
		t.Fatalf("extractTablesAccessed() returned %d collections, want 1: %#v", len(got), got)
	}
	if got[0] != "demo_customers" {
		t.Fatalf("first collection = %q, want demo_customers", got[0])
	}
}

func TestMaskValue(t *testing.T) {
	if got := maskValue("sensitive@example.com", "REDACT"); got != "***REDACTED***" {
		t.Fatalf("REDACT mask = %q", got)
	}
	if got := maskValue("abcdef123456", "PARTIAL"); got != "abc*********" {
		t.Fatalf("PARTIAL mask = %q", got)
	}
	if got := maskValue("abcdef123456", "HASH"); len(got) != 16 {
		t.Fatalf("HASH mask length = %d, want 16", len(got))
	}
}

func TestValidateWritableQueryAccess(t *testing.T) {
	if err := validateWritableQueryAccess(dbQueryTypeUpdate, "MEMBER", false); err == nil {
		t.Fatal("validateWritableQueryAccess() unexpectedly allowed MEMBER write query")
	}
	if err := validateWritableQueryAccess(dbQueryTypeUpdate, "OPERATOR", false); err != nil {
		t.Fatalf("validateWritableQueryAccess() returned error for OPERATOR: %v", err)
	}
}
