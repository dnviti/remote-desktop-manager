package files

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path"
	"strings"

	"github.com/google/uuid"
)

const (
	auditActionFileUpload   = "FILE_UPLOAD"
	auditActionFileDownload = "FILE_DOWNLOAD"
	auditActionFileDelete   = "FILE_DELETE"
	auditActionFileMkdir    = "FILE_MKDIR"
	auditActionFileRename   = "FILE_RENAME"
	auditActionFileList     = "FILE_LIST"

	managedAuditTransferModePayload     = "managed-payload"
	managedAuditTransferModeMetadata    = "managed-metadata"
	managedAuditPolicyAllowed           = "allowed"
	managedAuditPolicyDenied            = "denied"
	managedAuditScanClean               = "clean"
	managedAuditScanNotScanned          = "not-scanned"
	managedAuditResultSuccess           = "success"
	managedAuditResultDenied            = "denied"
	managedAuditDispositionNA           = "not-applicable"
	managedAuditDispositionRead         = "read"
	managedAuditDispositionListed       = "listed"
	managedAuditDispositionDeleted      = "deleted"
	managedAuditDispositionRetained     = "retained"
	managedAuditDispositionSkipped      = "not-retained"
	managedAuditDispositionApplied      = "applied"
	managedAuditDispositionCleaned      = "stage-cleaned"
	managedAuditDispositionMaterialized = "materialized"
)

type managedAuditDisposition struct {
	Workspace string
	History   string
	Restore   string
	Cleanup   string
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetID, ipAddress string, details map[string]any) error {
	if s.DB == nil {
		return nil
	}
	ctx = auditWriteContext(ctx)

	rawDetails, err := json.Marshal(details)
	if err != nil {
		return err
	}

	_, err = s.DB.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
			 id, "userId", action, "targetType", "targetId", details, "ipAddress", "geoCoords", flags
		 ) VALUES (
			 $1, $2, $3::"AuditAction", $4, $5, $6::jsonb, $7, ARRAY[]::double precision[], ARRAY[]::text[]
		 )`,
		uuid.NewString(),
		nilIfEmptyString(userID),
		action,
		nilIfEmptyString("Connection"),
		nilIfEmptyString(targetID),
		string(rawDetails),
		nilIfEmptyString(ipAddress),
	)
	return err
}

func auditWriteContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return context.WithoutCancel(ctx)
}

func managedAuditAction(operation managedFileOperation) string {
	switch operation {
	case managedFileOperationUpload:
		return auditActionFileUpload
	case managedFileOperationDownload:
		return auditActionFileDownload
	case managedFileOperationDelete:
		return auditActionFileDelete
	case managedFileOperationMkdir:
		return auditActionFileMkdir
	case managedFileOperationRename:
		return auditActionFileRename
	case managedFileOperationList:
		return auditActionFileList
	default:
		return ""
	}
}

func buildManagedTransferAuditDetails(protocol, remotePath, fileName string, size int64, stageKey, auditCorrelationID string, metadata map[string]string) map[string]any {
	cleanRemotePath := managedAuditRemotePath(remotePath, metadata)
	details := map[string]any{
		"protocol":       strings.TrimSpace(protocol),
		"transferMode":   managedAuditTransferModePayload,
		"remotePath":     cleanRemotePath,
		"size":           size,
		"policyDecision": managedAuditPolicyAllowed,
		"scanResult":     managedAuditScanClean,
		"result":         managedAuditResultSuccess,
	}
	if transferID := firstNonEmpty(strings.TrimSpace(auditCorrelationID), strings.TrimSpace(metadata["audit-correlation-id"])); transferID != "" {
		details["transferId"] = transferID
	}
	if objectKey := strings.TrimSpace(stageKey); objectKey != "" {
		details["objectKey"] = objectKey
	}
	if auditFileName := managedAuditFileName(cleanRemotePath, fileName); auditFileName != "" {
		details["fileName"] = auditFileName
	}
	if checksum := managedPayloadChecksum(metadata); checksum != "" {
		details["checksumSha256"] = checksum
	}
	if scanSignature := strings.TrimSpace(metadata["scan-signature"]); scanSignature != "" {
		details["scanSignature"] = scanSignature
	}
	return applyManagedAuditDisposition(details, managedTransferAuditDisposition(metadata))
}

func buildManagedMetadataAuditDetails(protocol, remotePath string, extra map[string]any) map[string]any {
	cleanRemotePath := normalizeRemotePath(remotePath)
	details := map[string]any{
		"protocol":       strings.TrimSpace(protocol),
		"transferMode":   managedAuditTransferModeMetadata,
		"transferId":     uuid.NewString(),
		"remotePath":     cleanRemotePath,
		"policyDecision": managedAuditPolicyAllowed,
		"scanResult":     managedAuditScanNotScanned,
		"result":         managedAuditResultSuccess,
	}
	details = applyManagedAuditDisposition(details, managedAuditDisposition{
		Workspace: managedAuditDispositionNA,
		History:   managedAuditDispositionNA,
		Restore:   managedAuditDispositionNA,
		Cleanup:   managedAuditDispositionNA,
	})
	if fileName := managedAuditFileName(cleanRemotePath, ""); fileName != "" {
		details["fileName"] = fileName
	}
	for key, value := range extra {
		details[key] = value
	}
	return details
}

func buildManagedTransferDeniedAuditDetails(protocol, remotePath, fileName, reason string) map[string]any {
	details := map[string]any{
		"protocol":       strings.TrimSpace(protocol),
		"transferMode":   managedAuditTransferModePayload,
		"remotePath":     managedAuditRemotePath(remotePath, nil),
		"policyDecision": managedAuditPolicyDenied,
		"scanResult":     managedAuditScanNotScanned,
		"result":         managedAuditResultDenied,
	}
	if auditFileName := managedAuditFileName(remotePath, fileName); auditFileName != "" {
		details["fileName"] = auditFileName
	}
	if reason = strings.TrimSpace(reason); reason != "" {
		details["reason"] = reason
	}
	return applyManagedAuditDisposition(details, managedAuditDisposition{
		Workspace: managedAuditDispositionNA,
		History:   managedAuditDispositionNA,
		Restore:   managedAuditDispositionNA,
		Cleanup:   managedAuditDispositionNA,
	})
}

func managedTransferAuditDisposition(metadata map[string]string) managedAuditDisposition {
	op := managedFileOperation(strings.TrimSpace(metadata["managed-operation"]))
	historySource := strings.EqualFold(strings.TrimSpace(metadata["history-source"]), "true")
	retainedUpload := strings.EqualFold(strings.TrimSpace(metadata["retained-upload"]), "true")

	switch op {
	case managedFileOperationUpload:
		if historySource {
			return managedAuditDisposition{
				Workspace: managedAuditDispositionMaterialized,
				History:   managedAuditDispositionRead,
				Restore:   managedAuditDispositionApplied,
				Cleanup:   managedAuditDispositionCleaned,
			}
		}
		history := managedAuditDispositionSkipped
		if retainedUpload {
			history = managedAuditDispositionRetained
		}
		return managedAuditDisposition{
			Workspace: managedAuditDispositionMaterialized,
			History:   history,
			Restore:   managedAuditDispositionNA,
			Cleanup:   managedAuditDispositionCleaned,
		}
	case managedFileOperationDownload:
		if historySource {
			return managedAuditDisposition{
				Workspace: managedAuditDispositionNA,
				History:   managedAuditDispositionRead,
				Restore:   managedAuditDispositionNA,
				Cleanup:   managedAuditDispositionCleaned,
			}
		}
		return managedAuditDisposition{
			Workspace: managedAuditDispositionRead,
			History:   managedAuditDispositionNA,
			Restore:   managedAuditDispositionNA,
			Cleanup:   managedAuditDispositionCleaned,
		}
	default:
		return managedAuditDisposition{
			Workspace: managedAuditDispositionNA,
			History:   managedAuditDispositionNA,
			Restore:   managedAuditDispositionNA,
			Cleanup:   managedAuditDispositionNA,
		}
	}
}

func applyManagedAuditDisposition(details map[string]any, disposition managedAuditDisposition) map[string]any {
	details["workspace"] = firstNonEmpty(disposition.Workspace, managedAuditDispositionNA)
	details["history"] = firstNonEmpty(disposition.History, managedAuditDispositionNA)
	details["restore"] = firstNonEmpty(disposition.Restore, managedAuditDispositionNA)
	details["cleanup"] = firstNonEmpty(disposition.Cleanup, managedAuditDispositionNA)
	return details
}

func managedAuditRemotePath(remotePath string, metadata map[string]string) string {
	return normalizeRemotePath(firstNonEmpty(strings.TrimSpace(metadata["remote-path"]), remotePath))
}

func managedAuditFileName(remotePath, fallback string) string {
	if fallback = strings.TrimSpace(fallback); fallback != "" {
		return fallback
	}
	cleanRemotePath := normalizeRemotePath(remotePath)
	if cleanRemotePath == "/" {
		return ""
	}
	fileName := strings.TrimSpace(path.Base(cleanRemotePath))
	if fileName == "." || fileName == "/" {
		return ""
	}
	return fileName
}

func managedPayloadChecksum(metadata map[string]string) string {
	if len(metadata) == 0 {
		return ""
	}
	for _, key := range []string{"sha256", "payload-sha256"} {
		if value := strings.TrimSpace(metadata[key]); value != "" {
			return value
		}
	}
	return ""
}

func payloadSHA256(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func nilIfEmptyString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
