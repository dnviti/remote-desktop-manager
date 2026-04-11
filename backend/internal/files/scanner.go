package files

import (
	"bytes"
	"context"
	"os"
	"strings"
)

const eicarSignature = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"

type builtinThreatScanner struct{}
type noopThreatScanner struct{}

func LoadThreatScannerFromEnv() ThreatScanner {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("FILE_THREAT_SCANNER_MODE"))) {
	case "", "builtin":
		return builtinThreatScanner{}
	case "disabled", "noop":
		return noopThreatScanner{}
	default:
		return builtinThreatScanner{}
	}
}

func (builtinThreatScanner) Scan(_ context.Context, _ string, payload []byte) (ScanVerdict, error) {
	if bytes.Contains(payload, []byte(eicarSignature)) {
		return ScanVerdict{
			Clean:     false,
			Reason:    "file blocked by builtin threat scanner",
			Signature: "EICAR",
		}, nil
	}
	return ScanVerdict{Clean: true}, nil
}

func (noopThreatScanner) Scan(_ context.Context, _ string, _ []byte) (ScanVerdict, error) {
	return ScanVerdict{Clean: true}, nil
}
