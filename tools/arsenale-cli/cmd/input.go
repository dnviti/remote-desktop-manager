package cmd

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// readResourceFromFileOrStdin reads a JSON or YAML resource from a file path.
// If path is "-", reads from stdin.
// Returns the data normalized to JSON bytes.
func readResourceFromFileOrStdin(path string) ([]byte, error) {
	var data []byte
	var err error

	if path == "-" {
		data, err = io.ReadAll(os.Stdin)
	} else {
		data, err = os.ReadFile(path)
	}
	if err != nil {
		return nil, fmt.Errorf("read input: %w", err)
	}

	data = []byte(strings.TrimSpace(string(data)))
	if len(data) == 0 {
		return nil, fmt.Errorf("empty input")
	}

	// If it's already valid JSON, return as-is
	if json.Valid(data) {
		return data, nil
	}

	// Try parsing as YAML and convert to JSON
	var obj interface{}
	if err := yaml.Unmarshal(data, &obj); err != nil {
		return nil, fmt.Errorf("input is neither valid JSON nor YAML: %w", err)
	}

	jsonData, err := json.Marshal(convertYAMLToJSON(obj))
	if err != nil {
		return nil, fmt.Errorf("convert YAML to JSON: %w", err)
	}

	return jsonData, nil
}

// readTextFromFileOrStdin reads plain text from a file path or stdin.
// If path is "-", reads from stdin. Leading and trailing whitespace is trimmed.
func readTextFromFileOrStdin(path string) (string, error) {
	var data []byte
	var err error

	if path == "-" {
		data, err = io.ReadAll(os.Stdin)
	} else {
		data, err = os.ReadFile(path)
	}
	if err != nil {
		return "", fmt.Errorf("read input: %w", err)
	}

	text := strings.TrimSpace(string(data))
	if text == "" {
		return "", fmt.Errorf("empty input")
	}
	return text, nil
}

// convertYAMLToJSON recursively converts YAML-parsed types to JSON-compatible types.
// YAML unmarshal produces map[string]interface{} but sometimes map[interface{}]interface{}.
func convertYAMLToJSON(v interface{}) interface{} {
	switch val := v.(type) {
	case map[interface{}]interface{}:
		m := make(map[string]interface{})
		for k, v := range val {
			m[fmt.Sprintf("%v", k)] = convertYAMLToJSON(v)
		}
		return m
	case map[string]interface{}:
		m := make(map[string]interface{})
		for k, v := range val {
			m[k] = convertYAMLToJSON(v)
		}
		return m
	case []interface{}:
		for i, v := range val {
			val[i] = convertYAMLToJSON(v)
		}
		return val
	default:
		return v
	}
}

// promptPassword reads a password from stdin without echoing.
// Falls back to simple line read if terminal control isn't available.
func promptPassword(prompt string) (string, error) {
	fmt.Fprint(os.Stderr, prompt)
	scanner := bufio.NewScanner(os.Stdin)
	if scanner.Scan() {
		return scanner.Text(), nil
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", fmt.Errorf("no input")
}

// buildJSONBody builds a JSON body from a map of key-value pairs,
// filtering out zero-value entries.
func buildJSONBody(fields map[string]interface{}) ([]byte, error) {
	filtered := make(map[string]interface{})
	for k, v := range fields {
		if v == nil {
			continue
		}
		switch val := v.(type) {
		case string:
			if val != "" {
				filtered[k] = val
			}
		default:
			filtered[k] = val
		}
	}
	return json.Marshal(filtered)
}
