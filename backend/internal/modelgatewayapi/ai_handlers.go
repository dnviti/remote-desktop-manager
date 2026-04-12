package modelgatewayapi

import (
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleAnalyzeQuery(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireDatabaseProxyFeature(); err != nil {
		s.writeError(w, err)
		return
	}

	var req aiAnalyzeRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	req.Prompt = strings.TrimSpace(req.Prompt)
	req.SessionID = strings.TrimSpace(req.SessionID)
	req.DBProtocol = normalizeKnownDBProtocol(req.DBProtocol)

	if req.Prompt == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "Prompt is required")
		return
	}
	if req.SessionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "Session ID is required")
		return
	}
	if len(req.Prompt) > 2000 {
		app.ErrorJSON(w, http.StatusBadRequest, "Prompt must be 2000 characters or fewer")
		return
	}
	if strings.TrimSpace(claims.UserID) == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	if strings.TrimSpace(claims.TenantID) == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant membership required")
		return
	}
	aiContext, err := s.DatabaseSessions.ResolveOwnedAIContext(r.Context(), claims.UserID, claims.TenantID, req.SessionID)
	if err != nil {
		s.writeError(w, err)
		return
	}

	schema, sessionProtocol := s.fetchSchemaForAI(r.Context(), claims.UserID, claims.TenantID, req.SessionID)
	dbProtocol := req.DBProtocol
	if dbProtocol == "" {
		dbProtocol = normalizeKnownDBProtocol(aiContext.Protocol)
	}
	if dbProtocol == "" {
		dbProtocol = normalizeKnownDBProtocol(sessionProtocol)
	}
	if dbProtocol == "" {
		dbProtocol = "postgresql"
	}

	result, err := s.analyzeQueryIntent(r.Context(), analyzeQueryIntentParams{
		TenantID:   claims.TenantID,
		UserID:     claims.UserID,
		Prompt:     req.Prompt,
		Schema:     schema,
		DBProtocol: dbProtocol,
		AIContext:  aiContext,
		IPAddress:  requestIP(r),
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleConfirmGeneration(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireDatabaseProxyFeature(); err != nil {
		s.writeError(w, err)
		return
	}

	var req aiConfirmRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	req.ConversationID = strings.TrimSpace(req.ConversationID)
	if req.ConversationID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "conversationId is required")
		return
	}
	if len(req.ApprovedObjects) == 0 {
		app.ErrorJSON(w, http.StatusBadRequest, "approvedObjects must be a non-empty array of table names")
		return
	}
	if strings.TrimSpace(claims.UserID) == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	if strings.TrimSpace(claims.TenantID) == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant membership required")
		return
	}

	result, err := s.confirmAndGenerate(r.Context(), req.ConversationID, req.ApprovedObjects, claims.UserID, claims.TenantID, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleOptimizeQuery(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireDatabaseProxyFeature(); err != nil {
		s.writeError(w, err)
		return
	}

	var req optimizeQueryRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	req.SQL = strings.TrimSpace(req.SQL)
	req.SessionID = strings.TrimSpace(req.SessionID)
	req.DBProtocol = normalizeKnownDBProtocol(req.DBProtocol)
	if req.SQL == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "sql is required")
		return
	}
	if req.SessionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "sessionId is required")
		return
	}
	if req.DBProtocol == "" {
		_, sessionProtocol := s.fetchSchemaForAI(r.Context(), claims.UserID, claims.TenantID, req.SessionID)
		req.DBProtocol = normalizeKnownDBProtocol(sessionProtocol)
	}
	if strings.TrimSpace(claims.UserID) == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	if req.DBProtocol == "" {
		app.ErrorJSON(w, http.StatusBadRequest, `Unsupported dbProtocol "". Must be one of: postgresql, mysql, mongodb, oracle, mssql, db2`)
		return
	}
	if strings.TrimSpace(claims.TenantID) == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant membership required")
		return
	}

	result, err := s.optimizeQuery(r.Context(), optimizeQueryInput{
		SQL:           req.SQL,
		ExecutionPlan: req.ExecutionPlan,
		SessionID:     req.SessionID,
		DBProtocol:    req.DBProtocol,
		DBVersion:     strings.TrimSpace(req.DBVersion),
		SchemaContext: req.SchemaContext,
	}, claims.UserID, claims.TenantID, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleContinueOptimization(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireDatabaseProxyFeature(); err != nil {
		s.writeError(w, err)
		return
	}

	var req continueOptimizationRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	req.ConversationID = strings.TrimSpace(req.ConversationID)
	if req.ConversationID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "conversationId is required")
		return
	}
	if req.ApprovedData == nil {
		app.ErrorJSON(w, http.StatusBadRequest, "approvedData is required")
		return
	}
	if strings.TrimSpace(claims.TenantID) == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant membership required")
		return
	}

	result, err := s.continueOptimization(r.Context(), req.ConversationID, req.ApprovedData, claims.UserID, claims.TenantID, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}
