package mfaapi

import "strings"

func validateTOTPCode(code string) error {
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return requestErr(400, "Invalid code format")
	}
	for _, ch := range code {
		if ch < '0' || ch > '9' {
			return requestErr(400, "Invalid code format")
		}
	}
	return nil
}
