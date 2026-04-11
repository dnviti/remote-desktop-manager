package cmd

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

var sshFileColumns = []Column{
	{Header: "NAME", Field: "name"},
	{Header: "TYPE", Field: "type"},
	{Header: "SIZE", Field: "size"},
	{Header: "MODIFIED_AT", Field: "modifiedAt"},
}

var fileSSHCmd = &cobra.Command{
	Use:   "ssh",
	Short: "Manage staged SSH/SFTP file transfers",
}

var fileSSHListCmd = &cobra.Command{
	Use:   "list",
	Short: "List files on the remote SSH target",
	Run:   runSSHFileList,
}

var fileSSHMkdirCmd = &cobra.Command{
	Use:   "mkdir",
	Short: "Create a directory on the remote SSH target",
	Run:   runSSHFileMkdir,
}

var fileSSHDeleteCmd = &cobra.Command{
	Use:   "delete",
	Short: "Delete a file or directory on the remote SSH target",
	Run:   runSSHFileDelete,
}

var fileSSHRenameCmd = &cobra.Command{
	Use:   "rename",
	Short: "Rename a file or directory on the remote SSH target",
	Run:   runSSHFileRename,
}

var fileSSHUploadCmd = &cobra.Command{
	Use:   "upload",
	Short: "Upload a local file to the remote SSH target through staged storage",
	Run:   runSSHFileUpload,
}

var fileSSHDownloadCmd = &cobra.Command{
	Use:   "download",
	Short: "Download a remote SSH file through staged storage",
	Run:   runSSHFileDownload,
}

var (
	sshFileConnection  string
	sshFilePath        string
	sshFileOldPath     string
	sshFileNewPath     string
	sshFileRemotePath  string
	sshFileUploadPath  string
	sshFileDownloadDst string
	sshFileOverrides   credentialOverride
)

func init() {
	fileCmd.AddCommand(fileSSHCmd)
	fileSSHCmd.AddCommand(fileSSHListCmd)
	fileSSHCmd.AddCommand(fileSSHMkdirCmd)
	fileSSHCmd.AddCommand(fileSSHDeleteCmd)
	fileSSHCmd.AddCommand(fileSSHRenameCmd)
	fileSSHCmd.AddCommand(fileSSHUploadCmd)
	fileSSHCmd.AddCommand(fileSSHDownloadCmd)

	for _, subcmd := range []*cobra.Command{
		fileSSHListCmd,
		fileSSHMkdirCmd,
		fileSSHDeleteCmd,
		fileSSHRenameCmd,
		fileSSHUploadCmd,
		fileSSHDownloadCmd,
	} {
		subcmd.Flags().StringVar(&sshFileConnection, "connection", "", "SSH connection name or ID")
		subcmd.MarkFlagRequired("connection")
		addCredentialOverrideFlags(subcmd, &sshFileOverrides)
	}

	fileSSHListCmd.Flags().StringVar(&sshFilePath, "path", "/", "Remote directory path to list")

	fileSSHMkdirCmd.Flags().StringVar(&sshFilePath, "path", "", "Remote directory path to create")
	fileSSHMkdirCmd.MarkFlagRequired("path")

	fileSSHDeleteCmd.Flags().StringVar(&sshFilePath, "path", "", "Remote path to delete")
	fileSSHDeleteCmd.MarkFlagRequired("path")

	fileSSHRenameCmd.Flags().StringVar(&sshFileOldPath, "from", "", "Existing remote path")
	fileSSHRenameCmd.Flags().StringVar(&sshFileNewPath, "to", "", "New remote path")
	fileSSHRenameCmd.MarkFlagRequired("from")
	fileSSHRenameCmd.MarkFlagRequired("to")

	fileSSHUploadCmd.Flags().StringVar(&sshFileUploadPath, "file", "", "Local file to upload")
	fileSSHUploadCmd.Flags().StringVar(&sshFileRemotePath, "remote-path", "", "Destination remote path")
	fileSSHUploadCmd.MarkFlagRequired("file")
	fileSSHUploadCmd.MarkFlagRequired("remote-path")

	fileSSHDownloadCmd.Flags().StringVar(&sshFilePath, "path", "", "Remote file path to download")
	fileSSHDownloadCmd.Flags().StringVar(&sshFileDownloadDst, "dest", ".", "Destination file or directory")
	fileSSHDownloadCmd.MarkFlagRequired("path")
}

func runSSHFileList(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	conn, body := buildConnectionCredentialBody(sshFileConnection, cfg, sshFileOverrides)
	if conn.Type != "SSH" {
		fatal("connection %q is type %s, not SSH", conn.Name, conn.Type)
	}
	body["path"] = strings.TrimSpace(sshFilePath)

	respBody, status, err := apiPost("/api/files/ssh/list", body, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if err := printer().Print(extractWrappedJSONField(respBody, "entries"), sshFileColumns); err != nil {
		fatal("%v", err)
	}
}

func runSSHFileMkdir(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	conn, body := buildConnectionCredentialBody(sshFileConnection, cfg, sshFileOverrides)
	if conn.Type != "SSH" {
		fatal("connection %q is type %s, not SSH", conn.Name, conn.Type)
	}
	body["path"] = strings.TrimSpace(sshFilePath)

	respBody, status, err := apiPost("/api/files/ssh/mkdir", body, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if !quiet {
		fmt.Printf("Directory %q created\n", sshFilePath)
	}
}

func runSSHFileDelete(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	conn, body := buildConnectionCredentialBody(sshFileConnection, cfg, sshFileOverrides)
	if conn.Type != "SSH" {
		fatal("connection %q is type %s, not SSH", conn.Name, conn.Type)
	}
	body["path"] = strings.TrimSpace(sshFilePath)

	respBody, status, err := apiPost("/api/files/ssh/delete", body, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if !quiet {
		fmt.Printf("Remote path %q deleted\n", sshFilePath)
	}
}

func runSSHFileRename(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	conn, body := buildConnectionCredentialBody(sshFileConnection, cfg, sshFileOverrides)
	if conn.Type != "SSH" {
		fatal("connection %q is type %s, not SSH", conn.Name, conn.Type)
	}
	body["oldPath"] = strings.TrimSpace(sshFileOldPath)
	body["newPath"] = strings.TrimSpace(sshFileNewPath)

	respBody, status, err := apiPost("/api/files/ssh/rename", body, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if !quiet {
		fmt.Printf("Remote path %q renamed to %q\n", sshFileOldPath, sshFileNewPath)
	}
}

func runSSHFileUpload(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	conn, body := buildConnectionCredentialBody(sshFileConnection, cfg, sshFileOverrides)
	if conn.Type != "SSH" {
		fatal("connection %q is type %s, not SSH", conn.Name, conn.Type)
	}

	fields := map[string]string{
		"connectionId": body["connectionId"].(string),
		"remotePath":   strings.TrimSpace(sshFileRemotePath),
	}
	if value := strings.TrimSpace(sshFileOverrides.Username); value != "" {
		fields["username"] = value
	}
	if value := strings.TrimSpace(sshFileOverrides.Password); value != "" {
		fields["password"] = value
	}
	if value := strings.TrimSpace(sshFileOverrides.Domain); value != "" {
		fields["domain"] = value
	}
	if value := strings.TrimSpace(sshFileOverrides.CredentialMode); value != "" {
		fields["credentialMode"] = value
	}

	respBody, status, err := apiUploadWithFields("/api/files/ssh/upload", sshFileUploadPath, fields, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if err := printer().PrintCreated(respBody, "name"); err != nil {
		fatal("%v", err)
	}
}

func runSSHFileDownload(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	conn, body := buildConnectionCredentialBody(sshFileConnection, cfg, sshFileOverrides)
	if conn.Type != "SSH" {
		fatal("connection %q is type %s, not SSH", conn.Name, conn.Type)
	}
	body["path"] = strings.TrimSpace(sshFilePath)

	respBody, status, err := apiPost("/api/files/ssh/download", body, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)

	destPath := resolveSSHDownloadDestination(strings.TrimSpace(sshFilePath), strings.TrimSpace(sshFileDownloadDst))
	if err := writeBytesToPath(destPath, respBody); err != nil {
		fatal("%v", err)
	}
	if !quiet {
		fmt.Printf("Downloaded %q to %s\n", sshFilePath, destPath)
	}
}

func resolveSSHDownloadDestination(remotePath, destination string) string {
	if destination == "" {
		destination = "."
	}
	if stat, err := os.Stat(destination); err == nil && stat.IsDir() {
		return filepath.Join(destination, path.Base(remotePath))
	}
	if strings.HasSuffix(destination, string(os.PathSeparator)) {
		return filepath.Join(destination, path.Base(remotePath))
	}
	return destination
}
