package desktopbroker

import (
	"fmt"
	"strconv"
	"strings"
)

type CompiledSettings struct {
	Selector string
	Protocol string
	Values   map[string]string
	Width    string
	Height   string
	DPI      string
	Audio    []string
	Video    []string
	Image    []string
	Timezone []string
}

func CompileSettings(token ConnectionToken) (CompiledSettings, error) {
	settingsType := strings.ToLower(token.Connection.Type)
	if settingsType != "rdp" && settingsType != "vnc" {
		return CompiledSettings{}, fmt.Errorf("unsupported connection type %q", token.Connection.Type)
	}

	selector := settingsType
	if joinID := strings.TrimSpace(token.Connection.Join); joinID != "" {
		selector = joinID
	}

	compiled := CompiledSettings{
		Selector: selector,
		Protocol: settingsType,
		Values:   make(map[string]string),
		Width:    "1024",
		Height:   "768",
		DPI:      "96",
		Audio:    []string{"audio/L16"},
		Image:    []string{"image/png", "image/jpeg"},
	}

	for key, value := range token.Connection.Settings {
		switch typed := value.(type) {
		case nil:
			continue
		case string:
			compiled.Values[key] = typed
		case bool:
			if typed {
				compiled.Values[key] = "true"
			} else {
				compiled.Values[key] = "false"
			}
		case float64:
			compiled.Values[key] = strconv.FormatInt(int64(typed), 10)
		case int:
			compiled.Values[key] = strconv.Itoa(typed)
		case []any:
			values := make([]string, 0, len(typed))
			for _, item := range typed {
				values = append(values, fmt.Sprint(item))
			}
			switch key {
			case "audio":
				compiled.Audio = values
			case "video":
				compiled.Video = values
			case "image":
				compiled.Image = values
			case "timezone":
				compiled.Timezone = values
			}
		default:
			compiled.Values[key] = fmt.Sprint(typed)
		}
	}

	if value, ok := compiled.Values["width"]; ok && value != "" {
		compiled.Width = value
	}
	if value, ok := compiled.Values["height"]; ok && value != "" {
		compiled.Height = value
	}
	if value, ok := compiled.Values["dpi"]; ok && value != "" {
		compiled.DPI = value
	}

	return compiled, nil
}

func BuildHandshakeMessages(settings CompiledSettings, args []string) ([]string, error) {
	protocolVersion := "1_0_0"
	connectArgs := make([]string, 0, len(args))
	for _, argName := range args {
		if strings.HasPrefix(argName, "VERSION_") {
			version := strings.TrimPrefix(argName, "VERSION_")
			switch version {
			case "1_0_0", "1_1_0":
				protocolVersion = version
			default:
				protocolVersion = "1_1_0"
			}
			connectArgs = append(connectArgs, "VERSION_"+protocolVersion)
			continue
		}
		connectArgs = append(connectArgs, settings.Values[argName])
	}

	messages := []string{
		EncodeInstruction("size", settings.Width, settings.Height, settings.DPI),
		EncodeInstruction(append([]string{"audio"}, settings.Audio...)...),
		EncodeInstruction(append([]string{"video"}, settings.Video...)...),
		EncodeInstruction(append([]string{"image"}, settings.Image...)...),
	}

	if protocolVersion == "1_1_0" && len(settings.Timezone) > 0 {
		messages = append(messages, EncodeInstruction(append([]string{"timezone"}, settings.Timezone...)...))
	}
	messages = append(messages, EncodeInstruction(append([]string{"connect"}, connectArgs...)...))
	return messages, nil
}
