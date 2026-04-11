package cmd

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"

	"github.com/spf13/cobra"
)

// Connection represents a connection resource.
type Connection struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
	Host string `json:"host"`
	Port int    `json:"port"`
}

var connectionColumns = []Column{
	{Header: "ID", Field: "id"},
	{Header: "NAME", Field: "name"},
	{Header: "TYPE", Field: "type"},
	{Header: "HOST", Field: "host"},
	{Header: "PORT", Field: "port"},
}

var connectionCmd = &cobra.Command{
	Use:     "connection",
	Aliases: []string{"conn"},
	Short:   "Manage connections",
}

var connListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all connections",
	Run:   runConnList,
}

var connGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get connection details",
	Args:  cobra.ExactArgs(1),
	Run:   runConnGet,
}

var connCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new connection",
	Long:  `Create a connection from a JSON/YAML file: arsenale connection create --from-file conn.yaml`,
	Run:   runConnCreate,
}

var connUpdateCmd = &cobra.Command{
	Use:   "update <id>",
	Short: "Update a connection",
	Args:  cobra.ExactArgs(1),
	Run:   runConnUpdate,
}

var connDeleteCmd = &cobra.Command{
	Use:   "delete <id>",
	Short: "Delete a connection",
	Args:  cobra.ExactArgs(1),
	Run:   runConnDelete,
}

var connShareCmd = &cobra.Command{
	Use:   "share <id>",
	Short: "Share a connection with a user",
	Long:  `Share a connection: arsenale connection share <id> --user-id <userId> --permission <read|write>`,
	Args:  cobra.ExactArgs(1),
	Run:   runConnShare,
}

var connUnshareCmd = &cobra.Command{
	Use:   "unshare <id> <userId>",
	Short: "Remove sharing for a user",
	Args:  cobra.ExactArgs(2),
	Run:   runConnUnshare,
}

var connSharesCmd = &cobra.Command{
	Use:   "shares <id>",
	Short: "List users with access to a connection",
	Args:  cobra.ExactArgs(1),
	Run:   runConnShares,
}

var connBatchShareCmd = &cobra.Command{
	Use:   "batch-share",
	Short: "Batch share multiple connections",
	Long:  `Batch share from a JSON/YAML file: arsenale connection batch-share --from-file shares.yaml`,
	Run:   runConnBatchShare,
}

var connFavoriteCmd = &cobra.Command{
	Use:   "favorite <id>",
	Short: "Toggle favorite status",
	Args:  cobra.ExactArgs(1),
	Run:   runConnFavorite,
}

var connExportCmd = &cobra.Command{
	Use:   "export",
	Short: "Export connections",
	Run:   runConnExport,
}

var connImportCmd = &cobra.Command{
	Use:   "import",
	Short: "Import connections from file",
	Run:   runConnImport,
}

// Backwards-compat: `arsenale list` -> `arsenale connection list`
var listAliasCmd = &cobra.Command{
	Use:    "list",
	Short:  "List connections (alias for 'connection list')",
	Hidden: true,
	Run:    runConnList,
}

var (
	connFromFile    string
	connShareUserID string
	connSharePerm   string
	connImportFile  string
	connExportIDs   []string
	connSearch      string
)

func init() {
	rootCmd.AddCommand(connectionCmd)
	rootCmd.AddCommand(listAliasCmd)

	connectionCmd.AddCommand(connListCmd)
	connectionCmd.AddCommand(connGetCmd)
	connectionCmd.AddCommand(connCreateCmd)
	connectionCmd.AddCommand(connUpdateCmd)
	connectionCmd.AddCommand(connDeleteCmd)
	connectionCmd.AddCommand(connShareCmd)
	connectionCmd.AddCommand(connUnshareCmd)
	connectionCmd.AddCommand(connSharesCmd)
	connectionCmd.AddCommand(connBatchShareCmd)
	connectionCmd.AddCommand(connFavoriteCmd)
	connectionCmd.AddCommand(connExportCmd)
	connectionCmd.AddCommand(connImportCmd)

	connCreateCmd.Flags().StringVarP(&connFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	connCreateCmd.MarkFlagRequired("from-file")
	connUpdateCmd.Flags().StringVarP(&connFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	connUpdateCmd.MarkFlagRequired("from-file")

	connShareCmd.Flags().StringVar(&connShareUserID, "user-id", "", "User ID to share with")
	connShareCmd.Flags().StringVar(&connSharePerm, "permission", "read", "Permission level")
	connShareCmd.MarkFlagRequired("user-id")

	connBatchShareCmd.Flags().StringVarP(&connFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	connBatchShareCmd.MarkFlagRequired("from-file")

	connImportCmd.Flags().StringVar(&connImportFile, "file", "", "File to import")
	connImportCmd.MarkFlagRequired("file")

	connExportCmd.Flags().StringSliceVar(&connExportIDs, "ids", nil, "Connection IDs to export")

	connListCmd.Flags().StringVar(&connSearch, "search", "", "Search filter")
}

func runConnList(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	path := "/api/connections"
	if connSearch != "" {
		path += "?" + url.Values{"search": {connSearch}}.Encode()
	}

	body, status, err := apiGet(path, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, connectionColumns)
}

func runConnGet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/connections/"+args[0], cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, connectionColumns)
}

func runConnCreate(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(connFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost("/api/connections", json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintCreated(body, "id")
}

func runConnUpdate(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(connFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPut("/api/connections/"+args[0], json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, connectionColumns)
}

func runConnDelete(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiDelete("/api/connections/"+args[0], cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintDeleted("Connection", args[0])
}

func runConnShare(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	payload := map[string]string{
		"userId":     connShareUserID,
		"permission": connSharePerm,
	}

	body, status, err := apiPost(fmt.Sprintf("/api/connections/%s/share", args[0]), payload, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	fmt.Println("Connection shared successfully")
}

func runConnUnshare(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiDelete(fmt.Sprintf("/api/connections/%s/share/%s", args[0], args[1]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	fmt.Println("Share removed")
}

func runConnShares(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet(fmt.Sprintf("/api/connections/%s/shares", args[0]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, []Column{
		{Header: "USER_ID", Field: "userId"},
		{Header: "EMAIL", Field: "email"},
		{Header: "PERMISSION", Field: "permission"},
	})
}

func runConnBatchShare(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(connFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost("/api/connections/batch-share", json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	fmt.Println("Batch share completed")
}

func runConnFavorite(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPatch(fmt.Sprintf("/api/connections/%s/favorite", args[0]), nil, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	fmt.Println("Favorite toggled")
}

func runConnExport(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	var payload interface{}
	if len(connExportIDs) > 0 {
		payload = map[string]interface{}{"ids": connExportIDs}
	}

	body, status, err := apiPost("/api/connections/export", payload, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	// Export always outputs JSON regardless of format flag
	fmt.Fprintln(os.Stdout, string(body))
}

func runConnImport(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(connImportFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost("/api/connections/import", json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	fmt.Println("Import completed")
}

// findConnectionByName looks up a connection by name.
func findConnectionByName(name string, cfg *CLIConfig) (*Connection, error) {
	respBody, status, err := apiGet("/api/cli/connections", cfg)
	if err != nil {
		return nil, fmt.Errorf("fetch connections: %w", err)
	}
	if status != 200 {
		return nil, fmt.Errorf("server returned HTTP %d: %s", status, string(respBody))
	}

	var connections []Connection
	if err := json.Unmarshal(respBody, &connections); err != nil {
		return nil, fmt.Errorf("parse connections: %w", err)
	}

	for _, c := range connections {
		if c.Name == name || c.ID == name {
			return &c, nil
		}
	}
	return nil, fmt.Errorf("connection '%s' not found. Run 'arsenale connection list' to see available connections", name)
}
