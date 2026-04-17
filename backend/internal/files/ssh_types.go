package files

import "io"

type sshCredentialPayload struct {
	ConnectionID   string `json:"connectionId"`
	Username       string `json:"username,omitempty"`
	Password       string `json:"password,omitempty"`
	Domain         string `json:"domain,omitempty"`
	CredentialMode string `json:"credentialMode,omitempty"`
}

type sshListRequest struct {
	sshCredentialPayload
	Path string `json:"path"`
}

type sshPathRequest struct {
	sshCredentialPayload
	Path string `json:"path"`
}

type sshRenameRequest struct {
	sshCredentialPayload
	OldPath string `json:"oldPath"`
	NewPath string `json:"newPath"`
}

type sshHistoryRequest struct {
	sshCredentialPayload
	ID   string `json:"id,omitempty"`
	Path string `json:"path,omitempty"`
}

type sshDownloadStream struct {
	FileName           string
	StageKey           string
	AuditCorrelationID string
	Object             ObjectInfo
	Reader             io.ReadCloser
	cleanup            func()
}

func (s sshDownloadStream) Cleanup() {
	if s.cleanup != nil {
		s.cleanup()
	}
}
