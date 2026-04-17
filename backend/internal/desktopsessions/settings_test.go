package desktopsessions

import (
	"path"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestMergeRDPSettingsAppliesUserConnectionAndTenantOrder(t *testing.T) {
	userWidth := 1280
	connectionWidth := 1600
	userWallpaper := true
	connectionSecurity := "tls"
	tenantSecurity := "nla-ext"
	tenantDisableAudio := false

	merged := mergeRDPSettings(
		&rdpSettingsPatch{
			Width:           &userWidth,
			EnableWallpaper: &userWallpaper,
		},
		&rdpSettingsPatch{
			Width:    &connectionWidth,
			Security: &connectionSecurity,
		},
		&rdpSettingsPatch{
			Security:     &tenantSecurity,
			DisableAudio: &tenantDisableAudio,
		},
	)

	if merged.Width == nil || *merged.Width != connectionWidth {
		t.Fatalf("expected connection width override, got %#v", merged.Width)
	}
	if !merged.EnableWallpaper {
		t.Fatalf("expected user wallpaper preference to apply")
	}
	if merged.Security != tenantSecurity {
		t.Fatalf("expected tenant security override %q, got %q", tenantSecurity, merged.Security)
	}
	if merged.DisableAudio {
		t.Fatalf("expected tenant disableAudio override to set false")
	}
	if merged.ResizeMethod != "display-update" {
		t.Fatalf("expected default resize method, got %q", merged.ResizeMethod)
	}
}

func TestMergeRDPSettingsDefaultsToAutoNegotiatedSecurity(t *testing.T) {
	merged := mergeRDPSettings(nil, nil, nil)

	if merged.Security != "any" {
		t.Fatalf("expected default security any, got %q", merged.Security)
	}
}

func TestPrepareRecordedRDPSettingsForcesReconnectAndDefaultSize(t *testing.T) {
	prepared := prepareRecordedRDPSettings(mergedRDPSettings{
		ResizeMethod: "display-update",
	})

	if prepared.ResizeMethod != "reconnect" {
		t.Fatalf("expected reconnect resize method, got %q", prepared.ResizeMethod)
	}
	if prepared.Width == nil || *prepared.Width != defaultRDPWidth {
		t.Fatalf("expected default width %d, got %#v", defaultRDPWidth, prepared.Width)
	}
	if prepared.Height == nil || *prepared.Height != defaultRDPHeight {
		t.Fatalf("expected default height %d, got %#v", defaultRDPHeight, prepared.Height)
	}
}

func TestBuildRDPGuacamoleSettingsIncludesRecordingDriveAndDLP(t *testing.T) {
	colorDepth := 24
	width := 1920
	height := 1080
	settings := buildRDPGuacamoleSettings(
		"rdp.internal",
		3389,
		"alice",
		"secret",
		"CORP",
		true,
		"/guacd-drive/tenants/tenant-1/users/user-1/connections/conn-1",
		mergedRDPSettings{
			ColorDepth:          &colorDepth,
			Width:               &width,
			Height:              &height,
			DPI:                 120,
			ResizeMethod:        "reconnect",
			EnableWallpaper:     false,
			EnableTheming:       true,
			EnableFontSmoothing: true,
			DisableAudio:        true,
			EnableAudioInput:    false,
			Security:            "nla",
		},
		resolvedDLP{
			DisableCopy:     true,
			DisablePaste:    true,
			DisableDownload: true,
			DisableUpload:   true,
		},
		&recordingSettings{
			RecordingPath: "/recordings/default/user-1",
			RecordingName: "session.guac",
		},
	)

	assertSettingEquals(t, settings, "hostname", "rdp.internal")
	assertSettingEquals(t, settings, "port", "3389")
	assertSettingEquals(t, settings, "domain", "CORP")
	assertSettingEquals(t, settings, "recording-name", "session.guac")
	assertSettingEquals(t, settings, "drive-path", "/guacd-drive/tenants/tenant-1/users/user-1/connections/conn-1")
	assertSettingEquals(t, settings, "disable-copy", "true")
	assertSettingEquals(t, settings, "disable-upload", "true")
	assertSettingEquals(t, settings, "disable-gfx", "true")
	assertSettingEquals(t, settings, "enable-wallpaper", "true")
}

func TestBuildRDPGuacamoleSettingsHidesDriveWhenTransfersAreDisabled(t *testing.T) {
	settings := buildRDPGuacamoleSettings(
		"rdp.internal",
		3389,
		"alice",
		"secret",
		"CORP",
		false,
		"",
		mergedRDPSettings{},
		resolvedDLP{DisableDownload: true, DisableUpload: true},
		nil,
	)

	if _, ok := settings["enable-drive"]; ok {
		t.Fatal("enable-drive should be omitted when managed drive is hidden")
	}
	if _, ok := settings["drive-path"]; ok {
		t.Fatal("drive-path should be omitted when managed drive is hidden")
	}
}

func TestBuildRecordingPlanMapsWithinGuacdRoot(t *testing.T) {
	now := time.Date(2026, 3, 31, 12, 0, 0, 0, time.UTC)
	plan, err := buildRecordingPlan("/var/lib/arsenale/recordings", "user-1", "conn-1", "RDP", "guac", "gateway-a", now)
	if err != nil {
		t.Fatalf("expected valid plan, got %v", err)
	}

	timestamp := now.UTC().UnixMilli()
	expectedHostSuffix := "gateway-a/user-1/conn-1-rdp-" + strconv.FormatInt(timestamp, 10) + ".guac"
	if !strings.HasSuffix(plan.HostPath, expectedHostSuffix) {
		t.Fatalf("expected host path suffix %q, got %q", expectedHostSuffix, plan.HostPath)
	}
	expectedName := "conn-1-rdp-" + strconv.FormatInt(timestamp, 10) + ".guac"
	if plan.GuacdPath != path.Join(guacdRecordRoot, "gateway-a", "user-1", expectedName) {
		t.Fatalf("unexpected guacd path %q", plan.GuacdPath)
	}
	if plan.GuacdDir != path.Join(guacdRecordRoot, "gateway-a", "user-1") {
		t.Fatalf("unexpected guacd dir %q", plan.GuacdDir)
	}
	if plan.GuacdName != expectedName {
		t.Fatalf("unexpected guacd name %q", plan.GuacdName)
	}
}

func TestBuildRecordingPlanRejectsInvalidComponents(t *testing.T) {
	_, err := buildRecordingPlan("/recordings", "../user", "conn-1", "RDP", "guac", "default", time.Now().UTC())
	if err == nil {
		t.Fatalf("expected invalid path component error")
	}
}

func assertSettingEquals(t *testing.T, settings map[string]any, key, want string) {
	t.Helper()
	got, ok := settings[key]
	if !ok {
		t.Fatalf("missing setting %q", key)
	}
	if got != want {
		t.Fatalf("setting %q = %v, want %q", key, got, want)
	}
}
