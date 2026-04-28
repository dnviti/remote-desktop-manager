package main

import (
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (d *apiDependencies) registerOperationsRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/admin/email/status", d.authenticator.Middleware(d.adminService.HandleGetEmailStatus))
	mux.HandleFunc("POST /api/admin/email/test", d.authenticator.Middleware(d.adminService.HandleSendTestEmail))
	mux.HandleFunc("GET /api/admin/app-config", d.authenticator.Middleware(d.adminService.HandleGetAppConfig))
	mux.HandleFunc("PUT /api/admin/app-config/self-signup", d.authenticator.Middleware(d.adminService.HandleSetSelfSignup))
	mux.HandleFunc("GET /api/admin/system-settings", d.authenticator.Middleware(d.systemSettingsService.HandleList))
	mux.HandleFunc("PUT /api/admin/system-settings", d.authenticator.Middleware(d.systemSettingsService.HandleBulkUpdate))
	mux.HandleFunc("PUT /api/admin/system-settings/{key}", d.authenticator.Middleware(d.systemSettingsService.HandleUpdateSingle))
	mux.HandleFunc("GET /api/admin/system-settings/db-status", d.authenticator.Middleware(d.adminService.HandleGetSystemSettingsDBStatus))
	if d.features.EnterpriseAuthEnabled {
		mux.HandleFunc("GET /api/admin/auth-providers", d.authenticator.Middleware(d.adminService.HandleGetAuthProviders))
	}
	if d.features.AIQueryEnabled() {
		mux.HandleFunc("GET /api/ai/config", d.authenticator.Middleware(d.modelGatewayService.HandleGetConfig))
		mux.HandleFunc("PUT /api/ai/config", d.authenticator.Middleware(d.modelGatewayService.HandleUpdateConfig))
		mux.HandleFunc("POST /api/ai/generate-query", d.authenticator.Middleware(d.modelGatewayService.HandleAnalyzeQuery))
		mux.HandleFunc("POST /api/ai/generate-query/confirm", d.authenticator.Middleware(d.modelGatewayService.HandleConfirmGeneration))
		mux.HandleFunc("POST /api/ai/optimize-query", d.authenticator.Middleware(d.modelGatewayService.HandleOptimizeQuery))
		mux.HandleFunc("POST /api/ai/optimize-query/continue", d.authenticator.Middleware(d.modelGatewayService.HandleContinueOptimization))
	}

	if d.features.ConnectionsEnabled {
		mux.HandleFunc("GET /api/access-policies", d.authenticator.Middleware(d.accessPolicyService.HandleList))
		mux.HandleFunc("POST /api/access-policies", d.authenticator.Middleware(d.accessPolicyService.HandleCreate))
		mux.HandleFunc("PUT /api/access-policies/{id}", d.authenticator.Middleware(d.accessPolicyService.HandleUpdate))
		mux.HandleFunc("DELETE /api/access-policies/{id}", d.authenticator.Middleware(d.accessPolicyService.HandleDelete))

		mux.HandleFunc("GET /api/keystroke-policies", d.authenticator.Middleware(d.keystrokePolicyService.HandleList))
		mux.HandleFunc("GET /api/keystroke-policies/{id}", d.authenticator.Middleware(d.keystrokePolicyService.HandleGet))
		mux.HandleFunc("POST /api/keystroke-policies", d.authenticator.Middleware(d.keystrokePolicyService.HandleCreate))
		mux.HandleFunc("PUT /api/keystroke-policies/{id}", d.authenticator.Middleware(d.keystrokePolicyService.HandleUpdate))
		mux.HandleFunc("DELETE /api/keystroke-policies/{id}", d.authenticator.Middleware(d.keystrokePolicyService.HandleDelete))
	}

	if d.features.AnyConnectionFeature() {
		mux.HandleFunc("GET /api/gateways", d.authenticator.Middleware(d.gatewayService.HandleList))
		mux.HandleFunc("POST /api/gateways", d.authenticator.Middleware(d.gatewayService.HandleCreate))
		mux.HandleFunc("POST /api/gateways/ssh-keypair", d.authenticator.Middleware(d.gatewayService.HandleGenerateSSHKeyPair))
		mux.HandleFunc("GET /api/gateways/ssh-keypair", d.authenticator.Middleware(d.gatewayService.HandleGetSSHKeyPair))
		mux.HandleFunc("GET /api/gateways/ssh-keypair/private", d.authenticator.Middleware(d.gatewayService.HandleDownloadSSHPrivateKey))
		mux.HandleFunc("POST /api/gateways/ssh-keypair/rotate", d.authenticator.Middleware(d.gatewayService.HandleRotateSSHKeyPair))
		mux.HandleFunc("PATCH /api/gateways/ssh-keypair/rotation", d.authenticator.Middleware(d.gatewayService.HandleUpdateSSHKeyRotationPolicy))
		mux.HandleFunc("GET /api/gateways/ssh-keypair/rotation", d.authenticator.Middleware(d.gatewayService.HandleGetSSHKeyRotationStatus))
		mux.HandleFunc("GET /api/gateways/templates", d.authenticator.Middleware(d.gatewayService.HandleListTemplates))
		mux.HandleFunc("POST /api/gateways/templates", d.authenticator.Middleware(d.gatewayService.HandleCreateTemplate))
		if d.features.ZeroTrustEnabled {
			mux.HandleFunc("GET /api/gateways/tunnel-overview", d.authenticator.Middleware(d.gatewayService.HandleTunnelOverview))
		}
		mux.HandleFunc("/api/gateways/", d.authenticator.Middleware(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
			path := strings.TrimPrefix(r.URL.Path, "/api/gateways/")
			if path == "" {
				app.ErrorJSON(w, http.StatusNotFound, "not found")
				return
			}
			if path == "tunnel-overview" && !d.features.ZeroTrustEnabled {
				app.ErrorJSON(w, http.StatusNotFound, "not found")
				return
			}

			if strings.HasPrefix(path, "templates/") {
				templatePath := strings.TrimPrefix(path, "templates/")
				switch {
				case strings.HasSuffix(templatePath, "/deploy"):
					templateID := strings.TrimSuffix(templatePath, "/deploy")
					templateID = strings.TrimSuffix(templateID, "/")
					if templateID == "" || strings.Contains(templateID, "/") {
						app.ErrorJSON(w, http.StatusNotFound, "not found")
						return
					}
					if r.Method != http.MethodPost {
						w.Header().Set("Allow", http.MethodPost)
						app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
						return
					}
					r.SetPathValue("templateId", templateID)
					d.gatewayService.HandleDeployTemplate(w, r, claims)
					return
				default:
					templateID := strings.TrimSuffix(templatePath, "/")
					if templateID == "" || strings.Contains(templateID, "/") {
						app.ErrorJSON(w, http.StatusNotFound, "not found")
						return
					}
					r.SetPathValue("templateId", templateID)
					switch r.Method {
					case http.MethodPut:
						d.gatewayService.HandleUpdateTemplate(w, r, claims)
					case http.MethodDelete:
						d.gatewayService.HandleDeleteTemplate(w, r, claims)
					default:
						w.Header().Set("Allow", "DELETE, PUT")
						app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
					}
					return
				}
			}

			id, rest, hasRest := strings.Cut(path, "/")
			id = strings.TrimSuffix(id, "/")
			if id == "" || strings.Contains(id, "/") {
				app.ErrorJSON(w, http.StatusNotFound, "not found")
				return
			}
			r.SetPathValue("id", id)

			if !hasRest {
				switch r.Method {
				case http.MethodPut:
					d.gatewayService.HandleUpdate(w, r, claims)
				case http.MethodDelete:
					d.gatewayService.HandleDelete(w, r, claims)
				default:
					w.Header().Set("Allow", "DELETE, PUT")
					app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
				}
				return
			}

			if strings.HasPrefix(rest, "instances/") {
				instancePath := strings.TrimPrefix(rest, "instances/")
				instanceID, action, ok := strings.Cut(instancePath, "/")
				instanceID = strings.TrimSuffix(instanceID, "/")
				if !ok || instanceID == "" || strings.Contains(instanceID, "/") {
					app.ErrorJSON(w, http.StatusNotFound, "not found")
					return
				}
				r.SetPathValue("instanceId", instanceID)
				switch action {
				case "restart":
					if r.Method != http.MethodPost {
						w.Header().Set("Allow", http.MethodPost)
						app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
						return
					}
					d.gatewayService.HandleRestartInstance(w, r, claims)
				case "logs":
					if r.Method != http.MethodGet {
						w.Header().Set("Allow", http.MethodGet)
						app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
						return
					}
					d.gatewayService.HandleGetInstanceLogs(w, r, claims)
				default:
					app.ErrorJSON(w, http.StatusNotFound, "not found")
				}
				return
			}

			if strings.Contains(rest, "/") {
				app.ErrorJSON(w, http.StatusNotFound, "not found")
				return
			}

			switch rest {
			case "egress":
				switch r.Method {
				case http.MethodGet:
					d.gatewayService.HandleGetEgressPolicy(w, r, claims)
				case http.MethodPut:
					d.gatewayService.HandleUpdateEgressPolicy(w, r, claims)
				default:
					w.Header().Set("Allow", "GET, PUT")
					app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
				}
			case "test":
				if r.Method != http.MethodPost {
					w.Header().Set("Allow", http.MethodPost)
					app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
					return
				}
				d.gatewayService.HandleTestConnectivity(w, r, claims)
			case "push-key":
				if r.Method != http.MethodPost {
					w.Header().Set("Allow", http.MethodPost)
					app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
					return
				}
				d.gatewayService.HandlePushSSHKey(w, r, claims)
			case "scaling":
				switch r.Method {
				case http.MethodGet:
					d.gatewayService.HandleGetScalingStatus(w, r, claims)
				case http.MethodPut:
					d.gatewayService.HandleUpdateScalingConfig(w, r, claims)
				default:
					w.Header().Set("Allow", "GET, PUT")
					app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
				}
			case "instances":
				if r.Method != http.MethodGet {
					w.Header().Set("Allow", http.MethodGet)
					app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
					return
				}
				d.gatewayService.HandleListInstances(w, r, claims)
			case "deploy":
				switch r.Method {
				case http.MethodPost:
					d.gatewayService.HandleDeploy(w, r, claims)
				case http.MethodDelete:
					d.gatewayService.HandleUndeploy(w, r, claims)
				default:
					w.Header().Set("Allow", "DELETE, POST")
					app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
				}
			case "scale":
				if r.Method != http.MethodPost {
					w.Header().Set("Allow", http.MethodPost)
					app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
					return
				}
				d.gatewayService.HandleScale(w, r, claims)
			case "tunnel-token":
				if !d.features.ZeroTrustEnabled {
					app.ErrorJSON(w, http.StatusNotFound, "not found")
					return
				}
				switch r.Method {
				case http.MethodPost:
					d.gatewayService.HandleGenerateTunnelToken(w, r, claims)
				case http.MethodDelete:
					d.gatewayService.HandleRevokeTunnelToken(w, r, claims)
				default:
					w.Header().Set("Allow", "DELETE, POST")
					app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
				}
			case "tunnel-disconnect":
				if !d.features.ZeroTrustEnabled {
					app.ErrorJSON(w, http.StatusNotFound, "not found")
					return
				}
				if r.Method != http.MethodPost {
					w.Header().Set("Allow", http.MethodPost)
					app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
					return
				}
				d.gatewayService.HandleForceDisconnectTunnel(w, r, claims)
			case "tunnel-events":
				if !d.features.ZeroTrustEnabled {
					app.ErrorJSON(w, http.StatusNotFound, "not found")
					return
				}
				if r.Method != http.MethodGet {
					w.Header().Set("Allow", http.MethodGet)
					app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
					return
				}
				d.gatewayService.HandleGetTunnelEvents(w, r, claims)
			case "tunnel-metrics":
				if !d.features.ZeroTrustEnabled {
					app.ErrorJSON(w, http.StatusNotFound, "not found")
					return
				}
				if r.Method != http.MethodGet {
					w.Header().Set("Allow", http.MethodGet)
					app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
					return
				}
				d.gatewayService.HandleGetTunnelMetrics(w, r, claims)
			default:
				app.ErrorJSON(w, http.StatusNotFound, "not found")
			}
		}))
	}
	if d.features.ConnectionsEnabled {
		mux.HandleFunc("GET /api/rdgw/config", d.authenticator.Middleware(d.rdGatewayService.HandleGetConfig))
		mux.HandleFunc("PUT /api/rdgw/config", d.authenticator.Middleware(d.rdGatewayService.HandleUpdateConfig))
		mux.HandleFunc("GET /api/rdgw/status", d.authenticator.Middleware(d.rdGatewayService.HandleStatus))
		mux.HandleFunc("GET /api/rdgw/connections/{connectionId}/rdpfile", d.authenticator.Middleware(d.rdGatewayService.HandleRDPFile))
	}
	if d.features.RecordingsEnabled {
		mux.HandleFunc("GET /api/recordings", d.authenticator.Middleware(d.recordingService.HandleList))
		mux.HandleFunc("GET /api/recordings/{id}", d.authenticator.Middleware(d.recordingService.HandleGet))
		mux.HandleFunc("GET /api/recordings/{id}/stream", d.authenticator.Middleware(d.recordingService.HandleStream))
		mux.HandleFunc("GET /api/recordings/{id}/analyze", d.authenticator.Middleware(d.recordingService.HandleAnalyze))
		mux.HandleFunc("GET /api/recordings/{id}/video", d.authenticator.Middleware(d.recordingService.HandleExportVideo))
		mux.HandleFunc("GET /api/recordings/{id}/audit-trail", d.authenticator.Middleware(d.recordingService.HandleAuditTrail))
		mux.HandleFunc("DELETE /api/recordings/{id}", d.authenticator.Middleware(d.recordingService.HandleDelete))
	}

	if d.features.IPGeolocationEnabled {
		mux.HandleFunc("GET /api/geoip/{ip}", d.authenticator.Middleware(d.geoIPService.HandleLookup))
	}
	if d.features.EnterpriseAuthEnabled {
		mux.HandleFunc("GET /api/ldap/status", d.authenticator.Middleware(d.ldapService.HandleGetStatus))
		mux.HandleFunc("POST /api/ldap/test", d.authenticator.Middleware(d.ldapService.HandleTestConnection))
		mux.HandleFunc("POST /api/ldap/sync", d.authenticator.Middleware(d.ldapService.HandleTriggerSync))
	}

	mux.HandleFunc("GET /api/notifications", d.authenticator.Middleware(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
		switch r.Method {
		case http.MethodGet:
			d.notificationService.HandleList(w, r, claims)
		default:
			w.Header().Set("Allow", http.MethodGet)
			app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	}))
	mux.HandleFunc("/api/notifications/", d.authenticator.Middleware(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
		path := strings.TrimPrefix(r.URL.Path, "/api/notifications/")
		switch {
		case path == "preferences":
			switch r.Method {
			case http.MethodGet:
				d.notificationService.HandleGetPreferences(w, r, claims)
			case http.MethodPut:
				d.notificationService.HandleBulkUpdatePreferences(w, r, claims)
			default:
				w.Header().Set("Allow", "GET, PUT")
				app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
			}
		case strings.HasPrefix(path, "preferences/"):
			if r.Method != http.MethodPut {
				w.Header().Set("Allow", http.MethodPut)
				app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			r.SetPathValue("type", strings.TrimPrefix(path, "preferences/"))
			d.notificationService.HandleUpdatePreference(w, r, claims)
		case path == "read-all":
			if r.Method != http.MethodPut {
				w.Header().Set("Allow", http.MethodPut)
				app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			d.notificationService.HandleMarkAllRead(w, r, claims)
		case strings.HasSuffix(path, "/read"):
			if r.Method != http.MethodPut {
				w.Header().Set("Allow", http.MethodPut)
				app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			r.SetPathValue("id", strings.TrimSuffix(path, "/read"))
			d.notificationService.HandleMarkRead(w, r, claims)
		default:
			if r.Method != http.MethodDelete {
				w.Header().Set("Allow", http.MethodDelete)
				app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			r.SetPathValue("id", path)
			d.notificationService.HandleDelete(w, r, claims)
		}
	}))

	mux.HandleFunc("GET /api/audit/gateways", d.authenticator.Middleware(d.auditService.HandleListGateways))
	mux.HandleFunc("GET /api/audit/countries", d.authenticator.Middleware(d.auditService.HandleListCountries))
	mux.HandleFunc("GET /api/audit", d.authenticator.Middleware(d.auditService.HandleList))
	mux.HandleFunc("GET /api/audit/tenant", d.authenticator.Middleware(d.auditService.HandleListTenantLogs))
	mux.HandleFunc("GET /api/audit/connection/{connectionId}", d.authenticator.Middleware(d.auditService.HandleListConnectionLogs))
	mux.HandleFunc("GET /api/audit/connection/{connectionId}/users", d.authenticator.Middleware(d.auditService.HandleListConnectionUsers))
	mux.HandleFunc("GET /api/audit/session/{sessionId}/recording", d.authenticator.Middleware(d.auditService.HandleGetSessionRecording))
	mux.HandleFunc("GET /api/audit/tenant/gateways", d.authenticator.Middleware(d.auditService.HandleListTenantGateways))
	mux.HandleFunc("GET /api/audit/tenant/countries", d.authenticator.Middleware(d.auditService.HandleListTenantCountries))
	if d.features.IPGeolocationEnabled {
		mux.HandleFunc("GET /api/audit/tenant/geo-summary", d.authenticator.Middleware(d.auditService.HandleTenantGeoSummary))
	}

	if d.features.DatabaseProxyEnabled {
		mux.HandleFunc("GET /api/db-audit/logs", d.authenticator.Middleware(d.dbAuditService.HandleListLogs))
		mux.HandleFunc("GET /api/db-audit/logs/connections", d.authenticator.Middleware(d.dbAuditService.HandleListConnections))
		mux.HandleFunc("GET /api/db-audit/logs/users", d.authenticator.Middleware(d.dbAuditService.HandleListUsers))
		mux.HandleFunc("GET /api/db-audit/firewall-rules", d.authenticator.Middleware(d.dbAuditService.HandleListFirewallRules))
		mux.HandleFunc("GET /api/db-audit/firewall-rules/{ruleId}", d.authenticator.Middleware(d.dbAuditService.HandleGetFirewallRule))
		mux.HandleFunc("POST /api/db-audit/firewall-rules", d.authenticator.Middleware(d.dbAuditService.HandleCreateFirewallRule))
		mux.HandleFunc("PUT /api/db-audit/firewall-rules/{ruleId}", d.authenticator.Middleware(d.dbAuditService.HandleUpdateFirewallRule))
		mux.HandleFunc("DELETE /api/db-audit/firewall-rules/{ruleId}", d.authenticator.Middleware(d.dbAuditService.HandleDeleteFirewallRule))
		mux.HandleFunc("GET /api/db-audit/masking-policies", d.authenticator.Middleware(d.dbAuditService.HandleListMaskingPolicies))
		mux.HandleFunc("GET /api/db-audit/masking-policies/{policyId}", d.authenticator.Middleware(d.dbAuditService.HandleGetMaskingPolicy))
		mux.HandleFunc("POST /api/db-audit/masking-policies", d.authenticator.Middleware(d.dbAuditService.HandleCreateMaskingPolicy))
		mux.HandleFunc("PUT /api/db-audit/masking-policies/{policyId}", d.authenticator.Middleware(d.dbAuditService.HandleUpdateMaskingPolicy))
		mux.HandleFunc("DELETE /api/db-audit/masking-policies/{policyId}", d.authenticator.Middleware(d.dbAuditService.HandleDeleteMaskingPolicy))
		mux.HandleFunc("GET /api/db-audit/rate-limit-policies", d.authenticator.Middleware(d.dbAuditService.HandleListRateLimitPolicies))
		mux.HandleFunc("GET /api/db-audit/rate-limit-policies/{policyId}", d.authenticator.Middleware(d.dbAuditService.HandleGetRateLimitPolicy))
		mux.HandleFunc("POST /api/db-audit/rate-limit-policies", d.authenticator.Middleware(d.dbAuditService.HandleCreateRateLimitPolicy))
		mux.HandleFunc("PUT /api/db-audit/rate-limit-policies/{policyId}", d.authenticator.Middleware(d.dbAuditService.HandleUpdateRateLimitPolicy))
		mux.HandleFunc("DELETE /api/db-audit/rate-limit-policies/{policyId}", d.authenticator.Middleware(d.dbAuditService.HandleDeleteRateLimitPolicy))
	}

	mux.HandleFunc("GET /api/tabs", d.authenticator.Middleware(d.tabsService.HandleList))
	mux.HandleFunc("PUT /api/tabs", d.authenticator.Middleware(d.tabsService.HandleSync))
	mux.HandleFunc("DELETE /api/tabs", d.authenticator.Middleware(d.tabsService.HandleClear))
}
