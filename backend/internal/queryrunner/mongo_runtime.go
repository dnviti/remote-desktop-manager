package queryrunner

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type mongoQuerySpec struct {
	Database   string           `json:"database,omitempty"`
	Collection string           `json:"collection,omitempty"`
	Operation  string           `json:"operation"`
	Filter     map[string]any   `json:"filter,omitempty"`
	Projection map[string]any   `json:"projection,omitempty"`
	Sort       map[string]any   `json:"sort,omitempty"`
	Limit      int64            `json:"limit,omitempty"`
	Skip       int64            `json:"skip,omitempty"`
	Pipeline   []map[string]any `json:"pipeline,omitempty"`
	Document   map[string]any   `json:"document,omitempty"`
	Documents  []map[string]any `json:"documents,omitempty"`
	Update     map[string]any   `json:"update,omitempty"`
	Command    map[string]any   `json:"command,omitempty"`
	Field      string           `json:"field,omitempty"`
}

type mongoTargetConn struct {
	client   *mongo.Client
	database *mongo.Database
}

var mongoOperationAliases = map[string]string{
	"find":                   "find",
	"aggregate":              "aggregate",
	"count":                  "count",
	"countdocument":          "count",
	"countdocuments":         "count",
	"estimateddocumentcount": "count",
	"distinct":               "distinct",
	"insertone":              "insertone",
	"insertmany":             "insertmany",
	"updateone":              "updateone",
	"updatemany":             "updatemany",
	"deleteone":              "deleteone",
	"deletemany":             "deletemany",
	"runcmd":                 "runcommand",
	"runcommand":             "runcommand",
}

func openMongoTarget(ctx context.Context, target *contracts.DatabaseTarget) (*mongoTargetConn, error) {
	if target == nil {
		return nil, fmt.Errorf("target is required")
	}
	if strings.TrimSpace(target.Host) == "" {
		return nil, fmt.Errorf("target.host is required")
	}
	if target.Port <= 0 || target.Port > 65535 {
		return nil, fmt.Errorf("target.port must be between 1 and 65535")
	}
	if strings.TrimSpace(target.Username) == "" {
		return nil, fmt.Errorf("target.username is required")
	}

	database := effectiveTargetDatabase(target)
	if database == "" {
		database = "admin"
	}

	u := &url.URL{
		Scheme: "mongodb",
		User:   url.UserPassword(target.Username, target.Password),
		Host:   net.JoinHostPort(target.Host, strconv.Itoa(target.Port)),
		Path:   "/" + database,
	}
	query := u.Query()
	query.Set("appName", "arsenale-query-runner")
	query.Set("authSource", database)
	query.Set("directConnection", "true")
	u.RawQuery = query.Encode()

	clientOpts := options.Client().ApplyURI(u.String()).SetTimeout(defaultQueryTimeout)
	client, err := mongo.Connect(clientOpts)
	if err != nil {
		return nil, fmt.Errorf("connect to target mongodb: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, defaultQueryTimeout)
	defer cancel()
	if err := client.Database(database).RunCommand(pingCtx, bson.M{"ping": 1}).Err(); err != nil {
		_ = client.Disconnect(context.Background())
		return nil, fmt.Errorf("ping mongodb: %w", err)
	}

	return &mongoTargetConn{
		client:   client,
		database: client.Database(database),
	}, nil
}

func (c *mongoTargetConn) Close() {
	if c == nil || c.client == nil {
		return
	}
	_ = c.client.Disconnect(context.Background())
}

func parseMongoQuerySpec(raw string) (mongoQuerySpec, error) {
	trimmed := strings.TrimSpace(raw)
	var payload any
	if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
		return mongoQuerySpec{}, fmt.Errorf("mongodb queries must use a JSON spec: %w", err)
	}
	root, ok := payload.(map[string]any)
	if !ok {
		return mongoQuerySpec{}, fmt.Errorf("mongodb queries must use a JSON object spec")
	}
	spec, err := normalizeMongoQuerySpecMap(root)
	if err != nil {
		return mongoQuerySpec{}, err
	}
	if spec.Operation == "" {
		return mongoQuerySpec{}, fmt.Errorf("mongodb query spec requires an operation")
	}
	return spec, nil
}

func normalizeMongoQuerySpecMap(root map[string]any) (mongoQuerySpec, error) {
	root = unwrapMongoQueryEnvelope(root)

	raw, err := json.Marshal(root)
	if err != nil {
		return mongoQuerySpec{}, fmt.Errorf("marshal mongodb query spec: %w", err)
	}

	var spec mongoQuerySpec
	if err := json.Unmarshal(raw, &spec); err != nil {
		return mongoQuerySpec{}, fmt.Errorf("decode mongodb query spec: %w", err)
	}

	spec.Operation = normalizeMongoOperation(spec.Operation)
	applyMongoCommonAliases(root, &spec)
	if spec.Operation == "" {
		inferMongoOperation(root, &spec)
	}
	normalizeMongoCollectionReference(&spec)
	return spec, nil
}

func normalizeMongoCollectionReference(spec *mongoQuerySpec) {
	if spec == nil {
		return
	}

	spec.Database = strings.TrimSpace(spec.Database)
	spec.Collection = strings.TrimSpace(spec.Collection)
	if spec.Collection == "" || strings.Count(spec.Collection, ".") != 1 {
		return
	}

	parts := strings.SplitN(spec.Collection, ".", 2)
	databaseName := strings.TrimSpace(parts[0])
	collectionName := strings.TrimSpace(parts[1])
	if databaseName == "" || collectionName == "" {
		return
	}

	if spec.Database == "" {
		spec.Database = databaseName
		spec.Collection = collectionName
		return
	}
	if strings.EqualFold(spec.Database, databaseName) {
		spec.Collection = collectionName
	}
}

func unwrapMongoQueryEnvelope(root map[string]any) map[string]any {
	for _, key := range []string{"query", "querySpec", "spec"} {
		nested, ok := root[key].(map[string]any)
		if !ok || len(nested) == 0 {
			continue
		}
		if key == "query" && hasMongoDirectSpecKeys(root) {
			continue
		}
		if !looksLikeMongoQuerySpecMap(nested) {
			continue
		}
		merged := make(map[string]any, len(root)+len(nested))
		for nestedKey, nestedValue := range nested {
			merged[nestedKey] = nestedValue
		}
		for _, passthrough := range []string{"database", "collection", "operation", "filter", "projection", "sort", "limit", "skip", "pipeline", "document", "documents", "update", "command", "field"} {
			if _, ok := merged[passthrough]; ok {
				continue
			}
			if value, ok := root[passthrough]; ok {
				merged[passthrough] = value
			}
		}
		return merged
	}
	return root
}

func hasMongoDirectSpecKeys(root map[string]any) bool {
	for _, key := range []string{"operation", "collection", "filter", "projection", "sort", "limit", "skip", "pipeline", "document", "documents", "update", "command", "field", "find", "aggregate", "count", "distinct", "insertOne", "insertMany", "updateOne", "updateMany", "deleteOne", "deleteMany", "runCommand", "runcommand"} {
		if _, ok := root[key]; ok {
			return true
		}
	}
	return false
}

func looksLikeMongoQuerySpecMap(root map[string]any) bool {
	for _, key := range []string{"operation", "collection", "filter", "projection", "sort", "limit", "skip", "pipeline", "document", "documents", "update", "command", "field", "find", "aggregate", "count", "distinct", "insertOne", "insertMany", "updateOne", "updateMany", "deleteOne", "deleteMany", "runCommand", "runcommand"} {
		if _, ok := root[key]; ok {
			return true
		}
	}
	return false
}

func normalizeMongoOperation(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "_", "")
	value = strings.ReplaceAll(value, "-", "")
	if normalized, ok := mongoOperationAliases[value]; ok {
		return normalized
	}
	return value
}

func applyMongoCommonAliases(root map[string]any, spec *mongoQuerySpec) {
	if spec == nil {
		return
	}
	if len(spec.Filter) == 0 {
		if value, ok := root["query"].(map[string]any); ok && len(value) > 0 {
			spec.Filter = value
		}
	}
	if len(spec.Projection) == 0 {
		if value, ok := root["fields"].(map[string]any); ok && len(value) > 0 {
			spec.Projection = value
		}
	}
	if spec.Field == "" {
		if value, ok := root["key"].(string); ok {
			spec.Field = strings.TrimSpace(value)
		}
	}
}

func inferMongoOperation(root map[string]any, spec *mongoQuerySpec) {
	if spec == nil {
		return
	}

	for _, candidate := range []string{"find", "aggregate", "count", "distinct", "insertOne", "insertMany", "updateOne", "updateMany", "deleteOne", "deleteMany", "runCommand", "runcommand"} {
		value, ok := root[candidate]
		if !ok {
			continue
		}
		spec.Operation = normalizeMongoOperation(candidate)
		applyMongoOperationShorthand(spec, value)
		return
	}

	switch {
	case len(spec.Command) > 0:
		spec.Operation = "runcommand"
	case spec.Collection != "" && len(spec.Pipeline) > 0:
		spec.Operation = "aggregate"
	case spec.Collection != "" && spec.Field != "":
		spec.Operation = "distinct"
	case spec.Collection != "":
		spec.Operation = "find"
	}
}

func applyMongoOperationShorthand(spec *mongoQuerySpec, value any) {
	if spec == nil {
		return
	}

	switch typed := value.(type) {
	case string:
		if spec.Operation != "runcommand" && spec.Collection == "" {
			spec.Collection = strings.TrimSpace(typed)
		}
	case map[string]any:
		raw, err := json.Marshal(typed)
		if err == nil {
			var nested mongoQuerySpec
			if json.Unmarshal(raw, &nested) == nil {
				nested.Operation = normalizeMongoOperation(nested.Operation)
				mergeMongoQuerySpec(spec, nested)
			}
		}
		applyMongoCommonAliases(typed, spec)
		if spec.Collection == "" {
			if collection, ok := typed["collection"].(string); ok {
				spec.Collection = strings.TrimSpace(collection)
			}
		}
		if spec.Operation == "distinct" && spec.Field == "" {
			if key, ok := typed["key"].(string); ok {
				spec.Field = strings.TrimSpace(key)
			}
		}
		if spec.Operation == "runcommand" && len(spec.Command) == 0 {
			spec.Command = typed
		}
	}
}

func mergeMongoQuerySpec(dst *mongoQuerySpec, src mongoQuerySpec) {
	if dst == nil {
		return
	}
	if dst.Database == "" {
		dst.Database = strings.TrimSpace(src.Database)
	}
	if dst.Collection == "" {
		dst.Collection = strings.TrimSpace(src.Collection)
	}
	if dst.Operation == "" {
		dst.Operation = normalizeMongoOperation(src.Operation)
	}
	if len(dst.Filter) == 0 && len(src.Filter) > 0 {
		dst.Filter = src.Filter
	}
	if len(dst.Projection) == 0 && len(src.Projection) > 0 {
		dst.Projection = src.Projection
	}
	if len(dst.Sort) == 0 && len(src.Sort) > 0 {
		dst.Sort = src.Sort
	}
	if dst.Limit == 0 && src.Limit != 0 {
		dst.Limit = src.Limit
	}
	if dst.Skip == 0 && src.Skip != 0 {
		dst.Skip = src.Skip
	}
	if len(dst.Pipeline) == 0 && len(src.Pipeline) > 0 {
		dst.Pipeline = src.Pipeline
	}
	if len(dst.Document) == 0 && len(src.Document) > 0 {
		dst.Document = src.Document
	}
	if len(dst.Documents) == 0 && len(src.Documents) > 0 {
		dst.Documents = src.Documents
	}
	if len(dst.Update) == 0 && len(src.Update) > 0 {
		dst.Update = src.Update
	}
	if len(dst.Command) == 0 && len(src.Command) > 0 {
		dst.Command = src.Command
	}
	if dst.Field == "" {
		dst.Field = strings.TrimSpace(src.Field)
	}
}

func ParseMongoQueryMetadata(raw string) (string, string, error) {
	spec, err := parseMongoQuerySpec(raw)
	if err != nil {
		return "", "", err
	}
	return spec.Operation, strings.TrimSpace(spec.Collection), nil
}

func NormalizeMongoQueryText(raw string) (string, string, string, error) {
	spec, err := parseMongoQuerySpec(raw)
	if err != nil {
		return "", "", "", err
	}
	normalized, err := json.MarshalIndent(spec, "", "  ")
	if err != nil {
		return "", "", "", fmt.Errorf("marshal mongodb query spec: %w", err)
	}
	return string(normalized), spec.Operation, strings.TrimSpace(spec.Collection), nil
}

func NormalizeMongoReadOnlyQueryText(raw string) (string, string, string, error) {
	spec, err := parseMongoQuerySpec(raw)
	if err != nil {
		return "", "", "", err
	}
	if err := validateMongoReadOnlySpec(spec); err != nil {
		return "", "", "", err
	}
	normalized, err := json.MarshalIndent(spec, "", "  ")
	if err != nil {
		return "", "", "", fmt.Errorf("marshal mongodb query spec: %w", err)
	}
	return string(normalized), spec.Operation, strings.TrimSpace(spec.Collection), nil
}

func validateMongoReadOnlySpec(spec mongoQuerySpec) error {
	switch spec.Operation {
	case "find", "aggregate", "count", "distinct", "runcmd", "runcommand":
		return nil
	default:
		return fmt.Errorf("mongodb read-only mode does not allow %q", spec.Operation)
	}
}

func executeMongoReadOnly(ctx context.Context, target *contracts.DatabaseTarget, req contracts.QueryExecutionRequest) (contracts.QueryExecutionResponse, error) {
	spec, err := parseMongoQuerySpec(req.SQL)
	if err != nil {
		return contracts.QueryExecutionResponse{}, err
	}
	if err := validateMongoReadOnlySpec(spec); err != nil {
		return contracts.QueryExecutionResponse{}, err
	}
	return executeMongoAny(ctx, target, req)
}

func executeMongoAny(ctx context.Context, target *contracts.DatabaseTarget, req contracts.QueryExecutionRequest) (contracts.QueryExecutionResponse, error) {
	spec, err := parseMongoQuerySpec(req.SQL)
	if err != nil {
		return contracts.QueryExecutionResponse{}, err
	}

	maxRows := req.MaxRows
	switch {
	case maxRows <= 0:
		maxRows = defaultMaxRows
	case maxRows > maxAllowedRows:
		maxRows = maxAllowedRows
	}
	if spec.Limit <= 0 || spec.Limit > int64(maxRows) {
		spec.Limit = int64(maxRows)
	}

	targetConn, err := openMongoTarget(ctx, target)
	if err != nil {
		return contracts.QueryExecutionResponse{}, err
	}
	defer targetConn.Close()

	if database := strings.TrimSpace(spec.Database); database != "" && database != targetConn.database.Name() {
		targetConn.database = targetConn.client.Database(database)
	}

	queryCtx, cancel := context.WithTimeout(ctx, defaultQueryTimeout)
	defer cancel()

	start := time.Now()
	result, err := executeMongoSpec(queryCtx, targetConn.database, spec)
	if err != nil {
		return contracts.QueryExecutionResponse{}, err
	}
	result.DurationMs = time.Since(start).Milliseconds()
	return result, nil
}

func executeMongoSpec(ctx context.Context, database *mongo.Database, spec mongoQuerySpec) (contracts.QueryExecutionResponse, error) {
	if database == nil {
		return contracts.QueryExecutionResponse{}, fmt.Errorf("mongodb database is unavailable")
	}

	switch spec.Operation {
	case "find":
		collection, err := requireMongoCollection(database, spec.Collection)
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
		findOpts := options.Find()
		findOpts.SetLimit(spec.Limit)
		if len(spec.Projection) > 0 {
			findOpts.SetProjection(spec.Projection)
		}
		if len(spec.Sort) > 0 {
			findOpts.SetSort(spec.Sort)
		}
		if spec.Skip > 0 {
			findOpts.SetSkip(spec.Skip)
		}
		cursor, err := collection.Find(ctx, defaultMongoMap(spec.Filter), findOpts)
		if err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("execute mongodb find: %w", err)
		}
		defer cursor.Close(ctx)
		var docs []bson.M
		if err := cursor.All(ctx, &docs); err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("decode mongodb documents: %w", err)
		}
		return mongoDocumentsToResult(docs), nil
	case "aggregate":
		collection, err := requireMongoCollection(database, spec.Collection)
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
		cursor, err := collection.Aggregate(ctx, spec.Pipeline)
		if err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("execute mongodb aggregate: %w", err)
		}
		defer cursor.Close(ctx)
		var docs []bson.M
		if err := cursor.All(ctx, &docs); err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("decode mongodb aggregate: %w", err)
		}
		return mongoDocumentsToResult(docs), nil
	case "count":
		collection, err := requireMongoCollection(database, spec.Collection)
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
		count, err := collection.CountDocuments(ctx, defaultMongoMap(spec.Filter))
		if err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("execute mongodb count: %w", err)
		}
		return singleRowMongoResult(map[string]any{"count": count}), nil
	case "distinct":
		collection, err := requireMongoCollection(database, spec.Collection)
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
		if strings.TrimSpace(spec.Field) == "" {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("mongodb distinct requires field")
		}
		distinctResult := collection.Distinct(ctx, spec.Field, defaultMongoMap(spec.Filter))
		if err := distinctResult.Err(); err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("execute mongodb distinct: %w", err)
		}
		var values []any
		if err := distinctResult.Decode(&values); err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("decode mongodb distinct: %w", err)
		}
		rows := make([]map[string]any, 0, len(values))
		for _, value := range values {
			rows = append(rows, map[string]any{"value": normalizeMongoValue(value)})
		}
		return contracts.QueryExecutionResponse{Columns: []string{"value"}, Rows: rows, RowCount: len(rows)}, nil
	case "insertone":
		collection, err := requireMongoCollection(database, spec.Collection)
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
		if len(spec.Document) == 0 {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("mongodb insertOne requires document")
		}
		res, err := collection.InsertOne(ctx, spec.Document)
		if err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("execute mongodb insertOne: %w", err)
		}
		return singleRowMongoResult(map[string]any{"insertedId": normalizeMongoValue(res.InsertedID)}), nil
	case "insertmany":
		collection, err := requireMongoCollection(database, spec.Collection)
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
		if len(spec.Documents) == 0 {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("mongodb insertMany requires documents")
		}
		docs := make([]any, 0, len(spec.Documents))
		for _, doc := range spec.Documents {
			docs = append(docs, doc)
		}
		res, err := collection.InsertMany(ctx, docs)
		if err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("execute mongodb insertMany: %w", err)
		}
		return singleRowMongoResult(map[string]any{"insertedCount": len(res.InsertedIDs)}), nil
	case "updateone":
		collection, err := requireMongoCollection(database, spec.Collection)
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
		res, err := collection.UpdateOne(ctx, defaultMongoMap(spec.Filter), defaultMongoMap(spec.Update))
		if err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("execute mongodb updateOne: %w", err)
		}
		return singleRowMongoResult(map[string]any{
			"matchedCount":  res.MatchedCount,
			"modifiedCount": res.ModifiedCount,
			"upsertedCount": boolToInt(res.UpsertedID != nil),
			"upsertedId":    normalizeMongoValue(res.UpsertedID),
		}), nil
	case "updatemany":
		collection, err := requireMongoCollection(database, spec.Collection)
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
		res, err := collection.UpdateMany(ctx, defaultMongoMap(spec.Filter), defaultMongoMap(spec.Update))
		if err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("execute mongodb updateMany: %w", err)
		}
		return singleRowMongoResult(map[string]any{
			"matchedCount":  res.MatchedCount,
			"modifiedCount": res.ModifiedCount,
			"upsertedCount": boolToInt(res.UpsertedID != nil),
			"upsertedId":    normalizeMongoValue(res.UpsertedID),
		}), nil
	case "deleteone":
		collection, err := requireMongoCollection(database, spec.Collection)
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
		res, err := collection.DeleteOne(ctx, defaultMongoMap(spec.Filter))
		if err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("execute mongodb deleteOne: %w", err)
		}
		return singleRowMongoResult(map[string]any{"deletedCount": res.DeletedCount}), nil
	case "deletemany":
		collection, err := requireMongoCollection(database, spec.Collection)
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
		res, err := collection.DeleteMany(ctx, defaultMongoMap(spec.Filter))
		if err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("execute mongodb deleteMany: %w", err)
		}
		return singleRowMongoResult(map[string]any{"deletedCount": res.DeletedCount}), nil
	case "runcmd", "runcommand":
		if len(spec.Command) == 0 {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("mongodb runCommand requires command")
		}
		var doc bson.M
		if err := database.RunCommand(ctx, spec.Command).Decode(&doc); err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("execute mongodb runCommand: %w", err)
		}
		return singleRowMongoResult(normalizeMongoDocument(doc)), nil
	default:
		return contracts.QueryExecutionResponse{}, fmt.Errorf("unsupported mongodb operation %q", spec.Operation)
	}
}

func fetchMongoSchema(ctx context.Context, target *contracts.DatabaseTarget) (contracts.SchemaInfo, error) {
	targetConn, err := openMongoTarget(ctx, target)
	if err != nil {
		return contracts.SchemaInfo{}, err
	}
	defer targetConn.Close()

	queryCtx, cancel := context.WithTimeout(ctx, defaultQueryTimeout)
	defer cancel()

	names, err := targetConn.database.ListCollectionNames(queryCtx, bson.M{})
	if err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("list mongodb collections: %w", err)
	}
	sort.Strings(names)

	result := emptySchemaInfo()
	for _, name := range names {
		table, err := inferMongoCollectionSchema(queryCtx, targetConn.database.Collection(name), targetConn.database.Name())
		if err != nil {
			return contracts.SchemaInfo{}, err
		}
		result.Tables = append(result.Tables, table)
	}
	return result, nil
}

func explainMongoQuery(_ context.Context, _ *contracts.DatabaseTarget, _ contracts.QueryPlanRequest) (contracts.QueryPlanResponse, error) {
	return contracts.QueryPlanResponse{Supported: false}, nil
}

func introspectMongoQuery(ctx context.Context, target *contracts.DatabaseTarget, req contracts.QueryIntrospectionRequest) (contracts.QueryIntrospectionResponse, error) {
	targetConn, err := openMongoTarget(ctx, target)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, err
	}
	defer targetConn.Close()

	queryCtx, cancel := context.WithTimeout(ctx, defaultQueryTimeout)
	defer cancel()

	ref := parseObjectRef(req.Target, "")
	switch req.Type {
	case "indexes":
		collection, err := requireMongoCollection(targetConn.database, ref.Name)
		if err != nil {
			return contracts.QueryIntrospectionResponse{}, err
		}
		cursor, err := collection.Indexes().List(queryCtx)
		if err != nil {
			return contracts.QueryIntrospectionResponse{}, fmt.Errorf("list mongodb indexes: %w", err)
		}
		defer cursor.Close(queryCtx)
		var docs []bson.M
		if err := cursor.All(queryCtx, &docs); err != nil {
			return contracts.QueryIntrospectionResponse{}, fmt.Errorf("decode mongodb indexes: %w", err)
		}
		return contracts.QueryIntrospectionResponse{Supported: true, Data: normalizeMongoDocuments(docs)}, nil
	case "statistics":
		collectionName := ref.Name
		if collectionName == "" {
			return contracts.QueryIntrospectionResponse{}, fmt.Errorf("target is required for introspection type %q", req.Type)
		}
		var doc bson.M
		if err := targetConn.database.RunCommand(queryCtx, bson.M{"collStats": collectionName}).Decode(&doc); err != nil {
			return contracts.QueryIntrospectionResponse{}, fmt.Errorf("run mongodb collStats: %w", err)
		}
		return contracts.QueryIntrospectionResponse{Supported: true, Data: normalizeMongoDocument(doc)}, nil
	case "foreign_keys":
		return contracts.QueryIntrospectionResponse{Supported: false}, nil
	case "table_schema":
		collection, err := requireMongoCollection(targetConn.database, ref.Name)
		if err != nil {
			return contracts.QueryIntrospectionResponse{}, err
		}
		table, err := inferMongoCollectionSchema(queryCtx, collection, targetConn.database.Name())
		if err != nil {
			return contracts.QueryIntrospectionResponse{}, err
		}
		fields := make([]map[string]any, 0, len(table.Columns))
		for _, column := range table.Columns {
			fields = append(fields, map[string]any{
				"name":       column.Name,
				"data_type":  column.DataType,
				"nullable":   column.Nullable,
				"is_primary": column.IsPrimaryKey,
			})
		}
		return contracts.QueryIntrospectionResponse{Supported: true, Data: fields}, nil
	case "row_count":
		collection, err := requireMongoCollection(targetConn.database, ref.Name)
		if err != nil {
			return contracts.QueryIntrospectionResponse{}, err
		}
		count, err := collection.EstimatedDocumentCount(queryCtx)
		if err != nil {
			return contracts.QueryIntrospectionResponse{}, fmt.Errorf("count mongodb documents: %w", err)
		}
		return contracts.QueryIntrospectionResponse{Supported: true, Data: map[string]any{"approximate_count": count}}, nil
	case "database_version":
		var doc bson.M
		if err := targetConn.database.RunCommand(queryCtx, bson.M{"buildInfo": 1}).Decode(&doc); err != nil {
			return contracts.QueryIntrospectionResponse{}, fmt.Errorf("run mongodb buildInfo: %w", err)
		}
		return contracts.QueryIntrospectionResponse{Supported: true, Data: normalizeMongoDocument(doc)}, nil
	default:
		return contracts.QueryIntrospectionResponse{Supported: false}, nil
	}
}

func requireMongoCollection(database *mongo.Database, name string) (*mongo.Collection, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("mongodb queries require collection")
	}
	return database.Collection(name), nil
}

func inferMongoCollectionSchema(ctx context.Context, collection *mongo.Collection, schemaName string) (contracts.SchemaTable, error) {
	table := contracts.SchemaTable{
		Name:    collection.Name(),
		Schema:  schemaName,
		Columns: []contracts.SchemaColumn{},
	}

	var sample bson.M
	err := collection.FindOne(ctx, bson.M{}).Decode(&sample)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			return table, nil
		}
		return contracts.SchemaTable{}, fmt.Errorf("sample mongodb collection %s: %w", collection.Name(), err)
	}

	keys := make([]string, 0, len(sample))
	for key := range sample {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	for _, key := range keys {
		table.Columns = append(table.Columns, contracts.SchemaColumn{
			Name:         key,
			DataType:     mongoTypeName(sample[key]),
			Nullable:     true,
			IsPrimaryKey: key == "_id",
		})
	}

	return table, nil
}

func mongoDocumentsToResult(docs []bson.M) contracts.QueryExecutionResponse {
	rows := normalizeMongoDocuments(docs)
	columnSet := make(map[string]struct{})
	for _, row := range rows {
		for key := range row {
			columnSet[key] = struct{}{}
		}
	}
	columns := make([]string, 0, len(columnSet))
	for key := range columnSet {
		columns = append(columns, key)
	}
	sort.Strings(columns)

	return contracts.QueryExecutionResponse{
		Columns:  columns,
		Rows:     rows,
		RowCount: len(rows),
	}
}

func singleRowMongoResult(row map[string]any) contracts.QueryExecutionResponse {
	columns := make([]string, 0, len(row))
	for key := range row {
		columns = append(columns, key)
	}
	sort.Strings(columns)
	return contracts.QueryExecutionResponse{
		Columns:  columns,
		Rows:     []map[string]any{row},
		RowCount: 1,
	}
}

func normalizeMongoDocuments(docs []bson.M) []map[string]any {
	rows := make([]map[string]any, 0, len(docs))
	for _, doc := range docs {
		rows = append(rows, normalizeMongoDocument(doc))
	}
	return rows
}

func normalizeMongoDocument(doc bson.M) map[string]any {
	row := make(map[string]any, len(doc))
	for key, value := range doc {
		row[key] = normalizeMongoValue(value)
	}
	return row
}

func normalizeMongoValue(value any) any {
	payload, err := bson.MarshalExtJSON(value, false, false)
	if err != nil {
		return value
	}
	var decoded any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return string(payload)
	}
	return decoded
}

func mongoTypeName(value any) string {
	switch value.(type) {
	case nil:
		return "null"
	case bool:
		return "bool"
	case int32, int64, int, float32, float64:
		return "number"
	case string:
		return "string"
	case time.Time:
		return "date"
	case bson.M, map[string]any:
		return "document"
	case []any, bson.A:
		return "array"
	default:
		return fmt.Sprintf("%T", value)
	}
}

func defaultMongoMap(value map[string]any) map[string]any {
	if len(value) == 0 {
		return map[string]any{}
	}
	return value
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
