package files

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
