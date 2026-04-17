package desktopsessions

import (
	"encoding/json"
	"fmt"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	defaultRDPWidth  = 1024
	defaultRDPHeight = 768
	guacdRecordRoot  = "/recordings"
)

var safePathComponentPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

type resolvedDLP struct {
	DisableCopy     bool `json:"disableCopy"`
	DisablePaste    bool `json:"disablePaste"`
	DisableDownload bool `json:"disableDownload"`
	DisableUpload   bool `json:"disableUpload"`
}

type dlpPolicy struct {
	DisableCopy     bool `json:"disableCopy"`
	DisablePaste    bool `json:"disablePaste"`
	DisableDownload bool `json:"disableDownload"`
	DisableUpload   bool `json:"disableUpload"`
}

type rdpSettingsPatch struct {
	ColorDepth               *int    `json:"colorDepth,omitempty"`
	Width                    *int    `json:"width,omitempty"`
	Height                   *int    `json:"height,omitempty"`
	DPI                      *int    `json:"dpi,omitempty"`
	ResizeMethod             *string `json:"resizeMethod,omitempty"`
	QualityPreset            *string `json:"qualityPreset,omitempty"`
	EnableWallpaper          *bool   `json:"enableWallpaper,omitempty"`
	EnableTheming            *bool   `json:"enableTheming,omitempty"`
	EnableFontSmoothing      *bool   `json:"enableFontSmoothing,omitempty"`
	EnableFullWindowDrag     *bool   `json:"enableFullWindowDrag,omitempty"`
	EnableDesktopComposition *bool   `json:"enableDesktopComposition,omitempty"`
	EnableMenuAnimations     *bool   `json:"enableMenuAnimations,omitempty"`
	ForceLossless            *bool   `json:"forceLossless,omitempty"`
	DisableAudio             *bool   `json:"disableAudio,omitempty"`
	EnableAudioInput         *bool   `json:"enableAudioInput,omitempty"`
	Security                 *string `json:"security,omitempty"`
	IgnoreCert               *bool   `json:"ignoreCert,omitempty"`
	ServerLayout             *string `json:"serverLayout,omitempty"`
	Console                  *bool   `json:"console,omitempty"`
	Timezone                 *string `json:"timezone,omitempty"`
}

type mergedRDPSettings struct {
	ColorDepth               *int
	Width                    *int
	Height                   *int
	DPI                      int
	ResizeMethod             string
	QualityPreset            string
	EnableWallpaper          bool
	EnableTheming            bool
	EnableFontSmoothing      bool
	EnableFullWindowDrag     bool
	EnableDesktopComposition bool
	EnableMenuAnimations     bool
	ForceLossless            bool
	DisableAudio             bool
	EnableAudioInput         bool
	Security                 string
	IgnoreCert               bool
	ServerLayout             string
	Console                  bool
	Timezone                 string
}

type vncSettingsPatch struct {
	ColorDepth        *int    `json:"colorDepth,omitempty"`
	Cursor            *string `json:"cursor,omitempty"`
	ReadOnly          *bool   `json:"readOnly,omitempty"`
	ClipboardEncoding *string `json:"clipboardEncoding,omitempty"`
	SwapRedBlue       *bool   `json:"swapRedBlue,omitempty"`
	DisableAudio      *bool   `json:"disableAudio,omitempty"`
}

type mergedVNCSettings struct {
	ColorDepth        *int
	Cursor            string
	ReadOnly          bool
	ClipboardEncoding string
	SwapRedBlue       bool
	DisableAudio      bool
}

type enforcedConnectionSettings struct {
	RDP *rdpSettingsPatch `json:"rdp,omitempty"`
	VNC *vncSettingsPatch `json:"vnc,omitempty"`
}

type recordingSettings struct {
	RecordingPath string
	RecordingName string
}

type recordingPlan struct {
	HostPath   string
	HostDir    string
	GuacdPath  string
	GuacdDir   string
	GuacdName  string
	RecordedAt time.Time
}

func parseJSONPatch[T any](raw json.RawMessage) (*T, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}

	var value T
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return &value, nil
}

func mergeDLPPolicy(tenant resolvedDLP, connection *dlpPolicy) resolvedDLP {
	if connection == nil {
		return tenant
	}
	return resolvedDLP{
		DisableCopy:     tenant.DisableCopy || connection.DisableCopy,
		DisablePaste:    tenant.DisablePaste || connection.DisablePaste,
		DisableDownload: tenant.DisableDownload || connection.DisableDownload,
		DisableUpload:   tenant.DisableUpload || connection.DisableUpload,
	}
}

func mergeRDPSettings(userDefaults, connectionOverrides, tenantEnforced *rdpSettingsPatch) mergedRDPSettings {
	merged := mergedRDPSettings{
		DPI:                      96,
		ResizeMethod:             "display-update",
		QualityPreset:            "balanced",
		EnableWallpaper:          false,
		EnableTheming:            true,
		EnableFontSmoothing:      true,
		EnableFullWindowDrag:     false,
		EnableDesktopComposition: false,
		EnableMenuAnimations:     false,
		ForceLossless:            false,
		DisableAudio:             true,
		EnableAudioInput:         false,
		Security:                 "any",
		IgnoreCert:               false,
		Console:                  false,
	}

	applyRDPSettingsPatch(&merged, userDefaults)
	applyRDPSettingsPatch(&merged, connectionOverrides)
	applyRDPSettingsPatch(&merged, tenantEnforced)

	return merged
}

func applyRDPSettingsPatch(merged *mergedRDPSettings, patch *rdpSettingsPatch) {
	if patch == nil {
		return
	}
	if patch.ColorDepth != nil {
		merged.ColorDepth = cloneIntPtr(patch.ColorDepth)
	}
	if patch.Width != nil {
		merged.Width = cloneIntPtr(patch.Width)
	}
	if patch.Height != nil {
		merged.Height = cloneIntPtr(patch.Height)
	}
	if patch.DPI != nil {
		merged.DPI = *patch.DPI
	}
	if patch.ResizeMethod != nil {
		merged.ResizeMethod = *patch.ResizeMethod
	}
	if patch.QualityPreset != nil {
		merged.QualityPreset = *patch.QualityPreset
	}
	if patch.EnableWallpaper != nil {
		merged.EnableWallpaper = *patch.EnableWallpaper
	}
	if patch.EnableTheming != nil {
		merged.EnableTheming = *patch.EnableTheming
	}
	if patch.EnableFontSmoothing != nil {
		merged.EnableFontSmoothing = *patch.EnableFontSmoothing
	}
	if patch.EnableFullWindowDrag != nil {
		merged.EnableFullWindowDrag = *patch.EnableFullWindowDrag
	}
	if patch.EnableDesktopComposition != nil {
		merged.EnableDesktopComposition = *patch.EnableDesktopComposition
	}
	if patch.EnableMenuAnimations != nil {
		merged.EnableMenuAnimations = *patch.EnableMenuAnimations
	}
	if patch.ForceLossless != nil {
		merged.ForceLossless = *patch.ForceLossless
	}
	if patch.DisableAudio != nil {
		merged.DisableAudio = *patch.DisableAudio
	}
	if patch.EnableAudioInput != nil {
		merged.EnableAudioInput = *patch.EnableAudioInput
	}
	if patch.Security != nil {
		merged.Security = *patch.Security
	}
	if patch.IgnoreCert != nil {
		merged.IgnoreCert = *patch.IgnoreCert
	}
	if patch.ServerLayout != nil {
		merged.ServerLayout = *patch.ServerLayout
	}
	if patch.Console != nil {
		merged.Console = *patch.Console
	}
	if patch.Timezone != nil {
		merged.Timezone = *patch.Timezone
	}
}

func mergeVNCSettings(connectionOverrides, tenantEnforced *vncSettingsPatch) mergedVNCSettings {
	merged := mergedVNCSettings{
		Cursor:            "local",
		ReadOnly:          false,
		ClipboardEncoding: "UTF-8",
		SwapRedBlue:       false,
		DisableAudio:      true,
	}

	applyVNCSettingsPatch(&merged, connectionOverrides)
	applyVNCSettingsPatch(&merged, tenantEnforced)

	return merged
}

func applyVNCSettingsPatch(merged *mergedVNCSettings, patch *vncSettingsPatch) {
	if patch == nil {
		return
	}
	if patch.ColorDepth != nil {
		merged.ColorDepth = cloneIntPtr(patch.ColorDepth)
	}
	if patch.Cursor != nil {
		merged.Cursor = *patch.Cursor
	}
	if patch.ReadOnly != nil {
		merged.ReadOnly = *patch.ReadOnly
	}
	if patch.ClipboardEncoding != nil {
		merged.ClipboardEncoding = *patch.ClipboardEncoding
	}
	if patch.SwapRedBlue != nil {
		merged.SwapRedBlue = *patch.SwapRedBlue
	}
	if patch.DisableAudio != nil {
		merged.DisableAudio = *patch.DisableAudio
	}
}

func buildRDPGuacamoleSettings(host string, port int, username, password, domain string, enableDrive bool, drivePath string, settings mergedRDPSettings, dlp resolvedDLP, recording *recordingSettings) map[string]any {
	result := map[string]any{
		"hostname":                   strings.TrimSpace(host),
		"port":                       fmt.Sprintf("%d", port),
		"username":                   username,
		"password":                   password,
		"security":                   settings.Security,
		"ignore-cert":                boolString(settings.IgnoreCert),
		"enable-wallpaper":           boolString(settings.EnableWallpaper),
		"enable-theming":             boolString(settings.EnableTheming),
		"enable-font-smoothing":      boolString(settings.EnableFontSmoothing),
		"enable-full-window-drag":    boolString(settings.EnableFullWindowDrag),
		"enable-desktop-composition": boolString(settings.EnableDesktopComposition),
		"enable-menu-animations":     boolString(settings.EnableMenuAnimations),
		"force-lossless":             boolString(settings.ForceLossless),
		"resize-method":              settings.ResizeMethod,
		"disable-audio":              boolString(settings.DisableAudio),
		"enable-audio-input":         boolString(settings.EnableAudioInput),
	}

	if strings.TrimSpace(domain) != "" {
		result["domain"] = domain
	}
	if settings.ColorDepth != nil {
		result["color-depth"] = fmt.Sprintf("%d", *settings.ColorDepth)
	}
	if settings.Width != nil {
		result["width"] = fmt.Sprintf("%d", *settings.Width)
	}
	if settings.Height != nil {
		result["height"] = fmt.Sprintf("%d", *settings.Height)
	}
	if settings.DPI > 0 {
		result["dpi"] = fmt.Sprintf("%d", settings.DPI)
	}
	if strings.TrimSpace(settings.ServerLayout) != "" {
		result["server-layout"] = settings.ServerLayout
	}
	if settings.Console {
		result["console"] = "true"
	}
	if strings.TrimSpace(settings.Timezone) != "" {
		result["timezone"] = settings.Timezone
	}

	if recording != nil {
		result["recording-path"] = recording.RecordingPath
		result["recording-name"] = recording.RecordingName
		result["create-recording-path"] = "true"
		result["recording-exclude-output"] = "false"
		result["recording-exclude-mouse"] = "false"
		result["disable-gfx"] = "true"
		result["enable-wallpaper"] = "true"
		result["disable-glyph-caching"] = "true"
		result["disable-bitmap-caching"] = "true"
		result["disable-offscreen-caching"] = "true"
	}

	if enableDrive && strings.TrimSpace(drivePath) != "" {
		result["enable-drive"] = "true"
		result["drive-name"] = "Shared"
		result["drive-path"] = drivePath
		result["create-drive-path"] = "true"
	}

	if dlp.DisableCopy {
		result["disable-copy"] = "true"
	}
	if dlp.DisablePaste {
		result["disable-paste"] = "true"
	}
	if dlp.DisableDownload {
		result["disable-download"] = "true"
	}
	if dlp.DisableUpload {
		result["disable-upload"] = "true"
	}

	return result
}

func buildVNCGuacamoleSettings(host string, port int, password string, settings mergedVNCSettings, dlp resolvedDLP, recording *recordingSettings) map[string]any {
	result := map[string]any{
		"hostname":           strings.TrimSpace(host),
		"port":               fmt.Sprintf("%d", port),
		"password":           password,
		"cursor":             settings.Cursor,
		"clipboard-encoding": settings.ClipboardEncoding,
	}

	if settings.ColorDepth != nil {
		result["color-depth"] = fmt.Sprintf("%d", *settings.ColorDepth)
	}
	if settings.ReadOnly {
		result["read-only"] = "true"
	}
	if settings.SwapRedBlue {
		result["swap-red-blue"] = "true"
	}
	if !settings.DisableAudio {
		result["enable-audio"] = "true"
	}

	if recording != nil {
		result["recording-path"] = recording.RecordingPath
		result["recording-name"] = recording.RecordingName
		result["create-recording-path"] = "true"
		result["recording-exclude-output"] = "false"
		result["recording-exclude-mouse"] = "false"
	}

	if dlp.DisableCopy {
		result["disable-copy"] = "true"
	}
	if dlp.DisablePaste {
		result["disable-paste"] = "true"
	}

	return result
}

func buildDesktopObserveSettings() map[string]any {
	return map[string]any{"read-only": "true"}
}

func prepareRecordedRDPSettings(settings mergedRDPSettings) mergedRDPSettings {
	settings.ResizeMethod = "reconnect"
	if settings.Width == nil {
		settings.Width = intPtr(defaultRDPWidth)
	}
	if settings.Height == nil {
		settings.Height = intPtr(defaultRDPHeight)
	}
	return settings
}

func buildRecordingPlan(recordingRoot, userID, connectionID, protocol, ext, gatewayDir string, now time.Time) (recordingPlan, error) {
	recordingRoot = strings.TrimSpace(recordingRoot)
	if recordingRoot == "" {
		return recordingPlan{}, fmt.Errorf("recording path is not configured")
	}

	subdir := strings.TrimSpace(gatewayDir)
	if subdir == "" {
		subdir = "default"
	}

	components := []struct {
		label string
		value string
	}{
		{label: "userId", value: userID},
		{label: "connectionId", value: connectionID},
		{label: "protocol", value: protocol},
		{label: "ext", value: ext},
		{label: "gatewayDir", value: subdir},
	}
	for _, component := range components {
		if !isSafePathComponent(component.value) {
			return recordingPlan{}, fmt.Errorf("invalid recording path component (%s)", component.label)
		}
	}

	recordingRoot = filepath.Clean(recordingRoot)
	hostPath := filepath.Join(recordingRoot, subdir, userID, fmt.Sprintf("%s-%s-%d.%s", connectionID, strings.ToLower(protocol), now.UTC().UnixMilli(), ext))
	hostPath = filepath.Clean(hostPath)

	relative, err := filepath.Rel(recordingRoot, hostPath)
	if err != nil {
		return recordingPlan{}, fmt.Errorf("compute recording path: %w", err)
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.IsAbs(relative) {
		return recordingPlan{}, fmt.Errorf("recording path escapes allowed directory")
	}

	guacdPath := path.Join(guacdRecordRoot, filepath.ToSlash(relative))
	return recordingPlan{
		HostPath:   hostPath,
		HostDir:    filepath.Dir(hostPath),
		GuacdPath:  guacdPath,
		GuacdDir:   path.Dir(guacdPath),
		GuacdName:  path.Base(guacdPath),
		RecordedAt: now.UTC(),
	}, nil
}

func boolString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func intPtr(value int) *int {
	return &value
}

func cloneIntPtr(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func isSafePathComponent(value string) bool {
	if value == "." || value == ".." {
		return false
	}
	return safePathComponentPattern.MatchString(value)
}
