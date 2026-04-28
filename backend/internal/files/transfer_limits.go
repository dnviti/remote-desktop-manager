package files

import "net/http"

type managedUploadLimits struct {
	maxPayloadBytes int64
	quotaBytes      int64
}

func (s Service) managedUploadLimits(policy resolvedFilePolicy) managedUploadLimits {
	return managedUploadLimits{
		maxPayloadBytes: effectiveUploadLimit(policy.FileUploadMax, s.maxUploadBytes()),
		quotaBytes:      s.effectiveQuota(tenantFilePolicy{UserDriveQuota: policy.UserDriveQuota}),
	}
}

func (limits managedUploadLimits) enforcesQuota() bool {
	return limits.quotaBytes > 0
}

func (limits managedUploadLimits) validatePayloadSize(size int64) error {
	if size > limits.maxPayloadBytes {
		return &requestError{
			status:  http.StatusRequestEntityTooLarge,
			message: uploadTooLargeMessage(limits.maxPayloadBytes),
		}
	}
	return nil
}

func (limits managedUploadLimits) validateQuota(currentUsage, payloadSize int64) error {
	if !limits.enforcesQuota() || currentUsage+payloadSize <= limits.quotaBytes {
		return nil
	}
	return &requestError{
		status:  http.StatusRequestEntityTooLarge,
		message: quotaExceededMessage(currentUsage, limits.quotaBytes),
	}
}
