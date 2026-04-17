package files

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	errManagedFileOperationUnknown       = errors.New("unknown managed file operation")
	errManagedPayloadRequiresObjectStore = errors.New("managed payload operations require object storage")
	errManagedPayloadRequiresScanner     = errors.New("managed payload operations require threat scanner")
	errManagedPayloadRequiresStagePrefix = errors.New("managed payload operations require a stage prefix")
)

var managedFileContractTable = map[managedFileOperation]managedFileOperationContract{
	managedFileOperationUpload: {
		Operation:                managedFileOperationUpload,
		Class:                    managedFileOperationClassPayload,
		ManagedViaREST:           true,
		AllowsDirectClientSFTP:   false,
		RequiresObjectStore:      true,
		RequiresThreatScan:       true,
		RequiresAuditLog:         true,
		RequiresAuditCorrelation: true,
	},
	managedFileOperationDownload: {
		Operation:                managedFileOperationDownload,
		Class:                    managedFileOperationClassPayload,
		ManagedViaREST:           true,
		AllowsDirectClientSFTP:   false,
		RequiresObjectStore:      true,
		RequiresThreatScan:       true,
		RequiresAuditLog:         true,
		RequiresAuditCorrelation: true,
	},
	managedFileOperationList: {
		Operation:              managedFileOperationList,
		Class:                  managedFileOperationClassMetadata,
		ManagedViaREST:         true,
		AllowsDirectClientSFTP: false,
		RequiresAuditLog:       true,
	},
	managedFileOperationMkdir: {
		Operation:              managedFileOperationMkdir,
		Class:                  managedFileOperationClassMetadata,
		ManagedViaREST:         true,
		AllowsDirectClientSFTP: false,
		RequiresAuditLog:       true,
	},
	managedFileOperationDelete: {
		Operation:              managedFileOperationDelete,
		Class:                  managedFileOperationClassMetadata,
		ManagedViaREST:         true,
		AllowsDirectClientSFTP: false,
		RequiresAuditLog:       true,
	},
	managedFileOperationRename: {
		Operation:              managedFileOperationRename,
		Class:                  managedFileOperationClassMetadata,
		ManagedViaREST:         true,
		AllowsDirectClientSFTP: false,
		RequiresAuditLog:       true,
	},
}

var managedFileOperationOrder = []managedFileOperation{
	managedFileOperationUpload,
	managedFileOperationDownload,
	managedFileOperationList,
	managedFileOperationMkdir,
	managedFileOperationDelete,
	managedFileOperationRename,
}

func managedFileContracts() []managedFileOperationContract {
	contracts := make([]managedFileOperationContract, 0, len(managedFileOperationOrder))
	for _, operation := range managedFileOperationOrder {
		contracts = append(contracts, managedFileContractTable[operation])
	}
	return contracts
}

func managedFileContractFor(operation managedFileOperation) (managedFileOperationContract, error) {
	contract, ok := managedFileContractTable[operation]
	if !ok {
		return managedFileOperationContract{}, fmt.Errorf("%w: %s", errManagedFileOperationUnknown, operation)
	}
	return contract, nil
}

func (c managedFileOperationContract) IsPayload() bool {
	return c.Class == managedFileOperationClassPayload
}

func (c managedFileOperationContract) IsMetadata() bool {
	return c.Class == managedFileOperationClassMetadata
}

func (c managedFileOperationContract) validate(deps managedFileDependencies) error {
	if c.RequiresObjectStore && deps.Store == nil {
		return errManagedPayloadRequiresObjectStore
	}
	if c.RequiresThreatScan && deps.Scanner == nil {
		return errManagedPayloadRequiresScanner
	}
	return nil
}

func executeManagedPayloadUpload(
	ctx context.Context,
	deps managedFileDependencies,
	input managedPayloadStageRequest,
	writeRemote func([]byte) error,
) (managedPayloadResult, error) {
	contract, err := managedFileContractFor(managedFileOperationUpload)
	if err != nil {
		return managedPayloadResult{}, err
	}
	result, err := stageManagedPayload(ctx, deps, contract, input)
	if err != nil {
		return managedPayloadResult{}, err
	}
	if writeRemote != nil {
		if err := writeRemote(input.Payload); err != nil {
			return result, err
		}
	}
	return result, nil
}

func executeManagedPayloadDownload(
	ctx context.Context,
	deps managedFileDependencies,
	stagePrefix string,
	readRemote func() (managedRemotePayload, error),
) (managedPayloadResult, error) {
	contract, err := managedFileContractFor(managedFileOperationDownload)
	if err != nil {
		return managedPayloadResult{}, err
	}
	if err := contract.validate(deps); err != nil {
		return managedPayloadResult{}, err
	}
	remotePayload, err := readRemote()
	if err != nil {
		return managedPayloadResult{}, err
	}
	return stageManagedPayload(ctx, deps, contract, managedPayloadStageRequest{
		StagePrefix: stagePrefix,
		FileName:    remotePayload.FileName,
		Payload:     remotePayload.Payload,
		Metadata:    remotePayload.Metadata,
	})
}

func executeManagedPayloadRestore(
	ctx context.Context,
	deps managedFileDependencies,
	input managedPayloadStageRequest,
) (managedPayloadResult, error) {
	return executeManagedPayloadUpload(ctx, deps, input, nil)
}

func stageManagedPayload(
	ctx context.Context,
	deps managedFileDependencies,
	contract managedFileOperationContract,
	input managedPayloadStageRequest,
) (managedPayloadResult, error) {
	if !contract.IsPayload() {
		return managedPayloadResult{}, fmt.Errorf("%w: %s", errManagedFileOperationUnknown, contract.Operation)
	}
	if err := contract.validate(deps); err != nil {
		return managedPayloadResult{}, err
	}
	stagePrefix := strings.TrimSpace(input.StagePrefix)
	if stagePrefix == "" {
		return managedPayloadResult{}, errManagedPayloadRequiresStagePrefix
	}
	fileName := strings.TrimSpace(input.FileName)
	if fileName == "" {
		return managedPayloadResult{}, &requestError{status: http.StatusBadRequest, message: "Invalid file name"}
	}

	verdict, err := deps.Scanner.Scan(ctx, fileName, input.Payload)
	if err != nil {
		return managedPayloadResult{}, fmt.Errorf("scan %s: %w", contract.Operation, err)
	}
	if !verdict.Clean {
		return managedPayloadResult{}, &requestError{status: http.StatusUnprocessableEntity, message: firstNonEmpty(verdict.Reason, "file blocked by threat scanner")}
	}

	auditCorrelationID := uuid.NewString()
	metadata := cloneStringMap(input.Metadata)
	metadata["managed-operation"] = string(contract.Operation)
	metadata["managed-class"] = string(contract.Class)
	metadata["managed-rest"] = "true"
	metadata["managed-namespace"] = "stage"
	metadata["audit-correlation-id"] = auditCorrelationID
	metadata["sha256"] = payloadSHA256(input.Payload)

	stageKey := stageObjectKey(stagePrefix, fmt.Sprintf("%d-%s", time.Now().UTC().UnixNano(), fileName))
	info, err := deps.Store.Put(ctx, stageKey, input.Payload, http.DetectContentType(input.Payload), metadata)
	if err != nil {
		return managedPayloadResult{}, fmt.Errorf("stage managed %s payload: %w", contract.Operation, err)
	}

	return managedPayloadResult{
		Contract:           contract,
		AuditCorrelationID: auditCorrelationID,
		StageKey:           stageKey,
		FileName:           fileName,
		Payload:            append([]byte(nil), input.Payload...),
		Metadata:           cloneStringMap(metadata),
		Object:             info,
	}, nil
}
