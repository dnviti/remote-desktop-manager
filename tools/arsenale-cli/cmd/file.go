package cmd

import (
	"fmt"
	"net/url"
	"path/filepath"

	"github.com/spf13/cobra"
)

var fileColumns = []Column{
	{Header: "NAME", Field: "name"},
	{Header: "SIZE", Field: "size"},
	{Header: "MODIFIED_AT", Field: "modifiedAt"},
}

var fileCmd = &cobra.Command{
	Use:   "file",
	Short: "Manage files",
}

var fileListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all files",
	Run:   runFileList,
}

var fileUploadCmd = &cobra.Command{
	Use:   "upload",
	Short: "Upload a file",
	Long:  `Upload a file: arsenale file upload --file /path/to/file.txt`,
	Run:   runFileUpload,
}

var fileDownloadCmd = &cobra.Command{
	Use:   "download <name>",
	Short: "Download a file",
	Long:  `Download a file: arsenale file download myfile.txt --dest /tmp`,
	Args:  cobra.ExactArgs(1),
	Run:   runFileDownload,
}

var fileDeleteCmd = &cobra.Command{
	Use:   "delete <name>",
	Short: "Delete a file",
	Args:  cobra.ExactArgs(1),
	Run:   runFileDelete,
}

var (
	fileUploadPath string
	fileDestDir    string
	fileConnection string
)

func init() {
	rootCmd.AddCommand(fileCmd)

	fileCmd.AddCommand(fileListCmd)
	fileCmd.AddCommand(fileUploadCmd)
	fileCmd.AddCommand(fileDownloadCmd)
	fileCmd.AddCommand(fileDeleteCmd)

	fileUploadCmd.Flags().StringVar(&fileUploadPath, "file", "", "Path to the file to upload")
	fileUploadCmd.MarkFlagRequired("file")

	fileDownloadCmd.Flags().StringVar(&fileDestDir, "dest", ".", "Destination directory")
	fileListCmd.Flags().StringVar(&fileConnection, "connection", "", "Connection name or ID for the shared drive")
	fileUploadCmd.Flags().StringVar(&fileConnection, "connection", "", "Connection name or ID for the shared drive")
	fileDownloadCmd.Flags().StringVar(&fileConnection, "connection", "", "Connection name or ID for the shared drive")
	fileDeleteCmd.Flags().StringVar(&fileConnection, "connection", "", "Connection name or ID for the shared drive")

	fileListCmd.MarkFlagRequired("connection")
	fileUploadCmd.MarkFlagRequired("connection")
	fileDownloadCmd.MarkFlagRequired("connection")
	fileDeleteCmd.MarkFlagRequired("connection")
}

func runFileList(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	connectionID := resolveFileConnectionID(cfg)
	body, status, err := apiGet("/api/files?connectionId="+url.QueryEscape(connectionID), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, fileColumns)
}

func runFileUpload(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	connectionID := resolveFileConnectionID(cfg)
	body, status, err := apiUploadWithFields("/api/files", fileUploadPath, map[string]string{
		"connectionId": connectionID,
	}, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintCreated(body, "name")
}

func runFileDownload(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	name := args[0]
	destPath := filepath.Join(fileDestDir, name)
	connectionID := resolveFileConnectionID(cfg)

	status, err := apiDownload("/api/files/"+url.PathEscape(name)+"?connectionId="+url.QueryEscape(connectionID), destPath, cfg)
	if err != nil {
		fatal("%v", err)
	}
	if status != 200 {
		fatal("download failed (HTTP %d)", status)
	}

	if !quiet {
		fmt.Printf("Downloaded %q to %s\n", name, destPath)
	}
}

func runFileDelete(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	connectionID := resolveFileConnectionID(cfg)
	body, status, err := apiDelete("/api/files/"+url.PathEscape(args[0])+"?connectionId="+url.QueryEscape(connectionID), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintDeleted("File", args[0])
}

func resolveFileConnectionID(cfg *CLIConfig) string {
	conn, err := findConnectionByName(fileConnection, cfg)
	if err != nil {
		fatal("%v", err)
	}
	return conn.ID
}
