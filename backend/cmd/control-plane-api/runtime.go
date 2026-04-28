package main

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/accesspolicies"
	"github.com/dnviti/arsenale/backend/internal/adminapi"
	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/auditapi"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/authservice"
	"github.com/dnviti/arsenale/backend/internal/catalog"
	"github.com/dnviti/arsenale/backend/internal/checkouts"
	"github.com/dnviti/arsenale/backend/internal/cliapi"
	"github.com/dnviti/arsenale/backend/internal/connections"
	"github.com/dnviti/arsenale/backend/internal/credentialresolver"
	"github.com/dnviti/arsenale/backend/internal/dbauditapi"
	"github.com/dnviti/arsenale/backend/internal/dbsessions"
	"github.com/dnviti/arsenale/backend/internal/desktopsessions"
	"github.com/dnviti/arsenale/backend/internal/externalvaultapi"
	"github.com/dnviti/arsenale/backend/internal/files"
	"github.com/dnviti/arsenale/backend/internal/folders"
	"github.com/dnviti/arsenale/backend/internal/gateways"
	"github.com/dnviti/arsenale/backend/internal/geoipapi"
	"github.com/dnviti/arsenale/backend/internal/importexportapi"
	"github.com/dnviti/arsenale/backend/internal/keystrokepolicies"
	"github.com/dnviti/arsenale/backend/internal/ldapapi"
	"github.com/dnviti/arsenale/backend/internal/mfaapi"
	"github.com/dnviti/arsenale/backend/internal/modelgateway"
	"github.com/dnviti/arsenale/backend/internal/modelgatewayapi"
	"github.com/dnviti/arsenale/backend/internal/notifications"
	"github.com/dnviti/arsenale/backend/internal/oauthapi"
	"github.com/dnviti/arsenale/backend/internal/orchestration"
	"github.com/dnviti/arsenale/backend/internal/passwordrotationapi"
	"github.com/dnviti/arsenale/backend/internal/publicconfig"
	"github.com/dnviti/arsenale/backend/internal/publicshareapi"
	"github.com/dnviti/arsenale/backend/internal/rdgatewayapi"
	"github.com/dnviti/arsenale/backend/internal/recordingsapi"
	"github.com/dnviti/arsenale/backend/internal/runtimefeatures"
	"github.com/dnviti/arsenale/backend/internal/secretsmeta"
	"github.com/dnviti/arsenale/backend/internal/sessionadmin"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/setup"
	"github.com/dnviti/arsenale/backend/internal/sshproxyapi"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
	"github.com/dnviti/arsenale/backend/internal/storage"
	"github.com/dnviti/arsenale/backend/internal/syncprofiles"
	"github.com/dnviti/arsenale/backend/internal/systemsettingsapi"
	"github.com/dnviti/arsenale/backend/internal/tabs"
	"github.com/dnviti/arsenale/backend/internal/teams"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/dnviti/arsenale/backend/internal/tenants"
	"github.com/dnviti/arsenale/backend/internal/tenantvaultapi"
	"github.com/dnviti/arsenale/backend/internal/users"
	"github.com/dnviti/arsenale/backend/internal/vaultapi"
	"github.com/dnviti/arsenale/backend/internal/vaultfolders"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func newAPIRuntime(ctx context.Context) (*apiRuntime, error) {
	var closeFns []func()
	db, err := storage.OpenPostgres(ctx)
	if err != nil {
		return nil, err
	}
	if db != nil {
		closeFns = append(closeFns, func() { db.Close() })
	}

	redisClient, err := storage.OpenRedis(ctx)
	if err != nil {
		closeRuntimeResources(closeFns)
		return nil, err
	}
	if redisClient != nil {
		closeFns = append(closeFns, func() { _ = redisClient.Close() })
	}

	secrets, err := loadRuntimeSecrets()
	if err != nil {
		closeRuntimeResources(closeFns)
		return nil, err
	}
	serverEncryptionKey := secrets.ServerEncryptionKey
	runtimePrincipalKey, err := loadOptionalSecret("RUNTIME_EGRESS_PRINCIPAL_SIGNING_KEY", "RUNTIME_EGRESS_PRINCIPAL_SIGNING_KEY_FILE")
	if err != nil {
		closeRuntimeResources(closeFns)
		return nil, err
	}

	gatewayRuntime := loadGatewayRuntimeConfig()
	store := orchestration.NewStore(db)
	modelGatewayStore := modelgateway.NewStore(db)
	featureManifest := runtimefeatures.FromEnv()
	recordingRuntimeEnabled := featureManifest.RecordingsEnabled && strings.EqualFold(getenv("RECORDING_ENABLED", "false"), "true")

	sessionStore := sessions.NewStore(db)
	tenantAuthService := tenantauth.Service{DB: db}
	vaultTTL := time.Duration(parseInt(getenv("VAULT_TTL_MINUTES", "30"), 30)) * time.Minute
	tenantVaultService := tenantvaultapi.Service{
		DB:        db,
		Redis:     redisClient,
		ServerKey: serverEncryptionKey,
		VaultTTL:  vaultTTL,
	}
	orchestratorDNSServers := parseCSV(os.Getenv("ORCHESTRATOR_DNS_SERVERS"))
	sharedFileStore, err := files.LoadObjectStoreFromEnv(ctx)
	if err != nil {
		closeRuntimeResources(closeFns)
		return nil, err
	}
	sharedFileScanner := files.LoadThreatScannerFromEnv()
	sshSessionService := sshsessions.Service{
		DB:                  db,
		Redis:               redisClient,
		SessionStore:        sessionStore,
		TenantAuth:          tenantAuthService,
		ServerEncryptionKey: serverEncryptionKey,
		TerminalBrokerURL:   getenv("TERMINAL_BROKER_URL", "http://terminal-broker:8090"),
		TunnelBrokerURL:     getenv("GO_TUNNEL_BROKER_URL", "http://tunnel-broker:8092"),
		RecordingPath:       getenv("RECORDING_PATH", "/recordings"),
		RecordingEnabled:    recordingRuntimeEnabled,
	}
	authService := authservice.Service{
		DB:                 db,
		Redis:              redisClient,
		JWTSecret:          []byte(strings.TrimSpace(secrets.JWTSecret)),
		ServerKey:          serverEncryptionKey,
		ClientURL:          getenv("CLIENT_URL", "https://localhost:3000"),
		TokenBinding:       os.Getenv("TOKEN_BINDING_ENABLED") != "false",
		EmailVerify:        os.Getenv("EMAIL_VERIFY_REQUIRED") == "true",
		CookieSecure:       authservice.DefaultCookieSecure(),
		AccessTokenTTL:     parseExpiry(getenv("JWT_EXPIRES_IN", "15m")),
		RefreshCookieTTL:   parseExpiry(getenv("JWT_REFRESH_EXPIRES_IN", "7d")),
		VaultTTL:           vaultTTL,
		Features:           featureManifest,
		TenantVaultService: &tenantVaultService,
	}

	deps := &apiDependencies{
		db:    db,
		store: store,
		desktopSessionService: desktopsessions.Service{
			Secret:             secrets.GuacamoleSecret,
			Store:              sessionStore,
			DB:                 db,
			TenantAuth:         tenantAuthService,
			ConnectionResolver: sshSessionService,
			RecordingPath:      getenv("RECORDING_PATH", "/recordings"),
			DriveBasePath:      getenv("DRIVE_BASE_PATH", "/guacd-drive"),
			RecordingEnabled:   recordingRuntimeEnabled,
		},
		databaseSessionService: dbsessions.Service{
			Store:               sessionStore,
			DB:                  db,
			TenantAuth:          tenantAuthService,
			ConnectionResolver:  sshSessionService,
			ServerEncryptionKey: serverEncryptionKey,
			RuntimePrincipalKey: strings.TrimSpace(runtimePrincipalKey),
		},
		sessionStore: sessionStore,
		setupService: setup.Service{
			DB:                 db,
			Redis:              redisClient,
			ServerKey:          serverEncryptionKey,
			VaultTTL:           vaultTTL,
			TenantVaultService: &tenantVaultService,
		},
		publicConfigService: publicconfig.Service{
			DB:       db,
			Features: featureManifest,
		},
		publicShareService: publicshareapi.Service{DB: db},
		authService:        authService,
		mfaService: mfaapi.Service{
			DB:        db,
			Redis:     redisClient,
			ServerKey: serverEncryptionKey,
		},
		userService: users.Service{
			DB:                  db,
			Redis:               redisClient,
			ServerEncryptionKey: serverEncryptionKey,
			TenantAuth:          tenantAuthService,
		},
		connectionService: connections.Service{
			DB:                  db,
			Redis:               redisClient,
			ServerEncryptionKey: serverEncryptionKey,
		},
		cliService: cliapi.Service{
			DB:        db,
			ClientURL: getenv("CLIENT_URL", "https://localhost:3000"),
		},
		checkoutService: checkouts.Service{DB: db},
		folderService:   folders.Service{DB: db},
		vaultFolderService: vaultfolders.Service{
			DB: db,
		},
		fileService: files.Service{
			DB:                 db,
			DriveBasePath:      getenv("DRIVE_BASE_PATH", "/guacd-drive"),
			FileUploadMaxSize:  int64(parseInt(getenv("FILE_UPLOAD_MAX_SIZE", "104857600"), 100*1024*1024)),
			UserDriveQuota:     int64(parseInt(getenv("USER_DRIVE_QUOTA", "104857600"), 100*1024*1024)),
			ConnectionResolver: sshSessionService,
			Store:              sharedFileStore,
			Scanner:            sharedFileScanner,
		},
		gatewayService: gateways.Service{
			DB:                    db,
			Redis:                 redisClient,
			ServerEncryptionKey:   serverEncryptionKey,
			DefaultGRPCPort:       parseInt(getenv("GATEWAY_GRPC_PORT", "9022"), 9022),
			GatewayGRPCTLSCA:      gatewayRuntime.GRPCTLSCA,
			GatewayGRPCClientCA:   gatewayRuntime.GRPCClientCA,
			GatewayGRPCTLSCert:    gatewayRuntime.GRPCTLSCert,
			GatewayGRPCTLSKey:     gatewayRuntime.GRPCTLSKey,
			GatewayGRPCServerCert: gatewayRuntime.GRPCServerCert,
			GatewayGRPCServerKey:  gatewayRuntime.GRPCServerKey,
			GuacdTLSCert:          gatewayRuntime.GuacdTLSCert,
			GuacdTLSKey:           gatewayRuntime.GuacdTLSKey,
			TunnelBrokerURL:       getenv("GO_TUNNEL_BROKER_URL", getenv("TUNNEL_BROKER_URL", "http://tunnel-broker:8092")),
			TunnelTrustDomain:     getenv("SPIFFE_TRUST_DOMAIN", "arsenale.local"),
			OrchestratorType:      strings.TrimSpace(os.Getenv("ORCHESTRATOR_TYPE")),
			DockerSocketPath:      getenv("DOCKER_SOCKET_PATH", "/var/run/docker.sock"),
			PodmanSocketPath:      getenv("PODMAN_SOCKET_PATH", "/run/podman/podman.sock"),
			DNSServers:            orchestratorDNSServers,
			ResolvConfPath:        gatewayRuntime.OrchestratorResolv,
			EgressNetwork:         gatewayRuntime.OrchestratorEgressNet,
			EdgeNetwork:           getenv("ORCHESTRATOR_EDGE_NETWORK", "arsenale-net-edge"),
			DBNetwork:             getenv("ORCHESTRATOR_DB_NETWORK", "arsenale-net-db"),
			GuacdNetwork:          getenv("ORCHESTRATOR_GUACD_NETWORK", "arsenale-net-guacd"),
			GatewayNetwork:        getenv("ORCHESTRATOR_GATEWAY_NETWORK", "arsenale-net-gateway"),
			SSHGatewayImage:       getenv("ORCHESTRATOR_SSH_GATEWAY_IMAGE", "localhost/arsenale_ssh-gateway:latest"),
			GuacdImage:            getenv("ORCHESTRATOR_GUACD_IMAGE", "localhost/arsenale_guacd:latest"),
			DBProxyImage:          getenv("ORCHESTRATOR_DB_PROXY_IMAGE", "ghcr.io/dnviti/arsenale/db-proxy:stable"),
			RecordingPath:         getenv("RECORDING_PATH", "/recordings"),
			RuntimePrincipalKey:   strings.TrimSpace(runtimePrincipalKey),
		},
		features: featureManifest,
		notificationService: notifications.Service{
			DB:       db,
			Features: featureManifest,
		},
		oauthService: oauthapi.Service{
			DB:                 db,
			Redis:              redisClient,
			ServerKey:          serverEncryptionKey,
			VaultTTL:           vaultTTL,
			ClientURL:          getenv("CLIENT_URL", "https://localhost:3000"),
			TenantVaultService: &tenantVaultService,
		},
		passwordRotationService: passwordrotationapi.Service{
			DB: db,
			Resolver: credentialresolver.Resolver{
				DB:        db,
				Redis:     redisClient,
				ServerKey: serverEncryptionKey,
				VaultTTL:  vaultTTL,
			},
		},
		geoIPService: &geoipapi.Service{},
		ldapService:  ldapapi.Service{DB: db},
		rdGatewayService: rdgatewayapi.Service{
			DB: db,
		},
		recordingService: recordingsapi.Service{
			DB:                    db,
			TenantAuth:            tenantAuthService,
			RecordingPath:         getenv("RECORDING_PATH", "/recordings"),
			GuacencServiceURL:     getenv("GUACENC_SERVICE_URL", "http://guacenc:3003"),
			GuacencUseTLS:         strings.EqualFold(getenv("GUACENC_USE_TLS", "false"), "true"),
			GuacencTLSCA:          strings.TrimSpace(os.Getenv("GUACENC_TLS_CA")),
			GuacencAuthToken:      secrets.GuacencAuthToken,
			GuacencTimeout:        time.Duration(parseInt(getenv("GUACENC_TIMEOUT_MS", "120000"), 120000)) * time.Millisecond,
			GuacencRecordingPath:  getenv("GUACENC_RECORDING_PATH", "/recordings"),
			AsciicastConverterURL: getenv("ASCIICAST_CONVERTER_URL", getenv("GUACENC_SERVICE_URL", "http://guacenc:3003")),
		},
		tabsService: tabs.Service{DB: db},
		tenantService: tenants.Service{
			DB:                  db,
			Redis:               redisClient,
			TenantAuth:          tenantAuthService,
			AuthService:         &authService,
			TenantVaultService:  &tenantVaultService,
			ServerEncryptionKey: serverEncryptionKey,
			Features:            featureManifest,
		},
		teamService: teams.Service{
			DB:                  db,
			Redis:               redisClient,
			ServerEncryptionKey: serverEncryptionKey,
			VaultTTL:            vaultTTL,
		},
		syncProfileService: syncprofiles.Service{
			DB:                  db,
			ServerEncryptionKey: serverEncryptionKey,
			Scheduler:           syncprofiles.NewSchedulerState(),
		},
		externalVaultService: externalvaultapi.Service{
			DB:                  db,
			ServerEncryptionKey: serverEncryptionKey,
		},
		vaultService: vaultapi.Service{
			DB:                 db,
			Redis:              redisClient,
			ServerKey:          serverEncryptionKey,
			VaultTTL:           vaultTTL,
			TenantVaultService: &tenantVaultService,
		},
		secretsMetaService: secretsmeta.Service{
			DB:        db,
			Redis:     redisClient,
			ServerKey: serverEncryptionKey,
			VaultTTL:  vaultTTL,
			ClientURL: getenv("CLIENT_URL", "https://localhost:3000"),
		},
		tenantVaultService: tenantVaultService,
		adminService: adminapi.Service{
			DB:         db,
			TenantAuth: tenantAuthService,
		},
		systemSettingsService: systemsettingsapi.Service{
			DB:         db,
			TenantAuth: tenantAuthService,
		},
		auditService: auditapi.Service{
			DB:         db,
			TenantAuth: tenantAuthService,
		},
		dbAuditService: dbauditapi.Service{
			DB:         db,
			TenantAuth: tenantAuthService,
		},
		accessPolicyService:    accesspolicies.Service{DB: db},
		keystrokePolicyService: keystrokepolicies.Service{DB: db},
		sessionAdminService: sessionadmin.Service{
			Store:             sessionStore,
			TenantAuth:        tenantAuthService,
			SSHObserverGrants: sshSessionService,
		},
		sshSessionService: sshSessionService,
		sshProxyService: sshproxyapi.Service{
			DB:        db,
			JWTSecret: []byte(strings.TrimSpace(secrets.JWTSecret)),
		},
		modelGatewayService: modelgatewayapi.Service{
			Store:      modelGatewayStore,
			DB:         db,
			TenantAuth: tenantAuthService,
			DatabaseSessions: dbsessions.Service{
				Store:               sessionStore,
				DB:                  db,
				TenantAuth:          tenantAuthService,
				ConnectionResolver:  sshSessionService,
				ServerEncryptionKey: serverEncryptionKey,
				RuntimePrincipalKey: strings.TrimSpace(runtimePrincipalKey),
			},
			ServerEncryptionKey: serverEncryptionKey,
			AIState:             modelgatewayapi.NewAIState(),
		},
	}

	deps.cliService.Auth = &deps.authService
	deps.setupService.AuthService = &deps.authService
	deps.setupService.TenantService = &deps.tenantService
	deps.connectionService.Redis = redisClient
	deps.desktopSessionService.Connections = deps.connectionService
	deps.sessionAdminService.DesktopObserverGrants = deps.desktopSessionService
	deps.importExportService = importexportapi.Service{
		DB:                  db,
		Redis:               redisClient,
		ServerEncryptionKey: serverEncryptionKey,
		Connections:         &deps.connectionService,
	}
	deps.rdGatewayService.Connections = deps.connectionService
	deps.tabsService.Connections = deps.connectionService
	deps.sshProxyService.Connections = deps.connectionService

	authenticator, err := authn.NewAuthenticator()
	if err != nil {
		closeRuntimeResources(closeFns)
		return nil, err
	}
	deps.authenticator = authenticator
	deps.oauthService.Auth = &deps.authService
	deps.oauthService.Authenticator = authenticator
	if err := deps.syncProfileService.StartScheduler(ctx); err != nil {
		closeRuntimeResources(closeFns)
		return nil, err
	}
	closeFns = append(closeFns, func() {
		deps.syncProfileService.StopScheduler()
	})

	return &apiRuntime{
		service: app.StaticService{
			Descriptor: catalog.MustService(contracts.ServiceControlPlaneAPI),
			Register:   deps.register,
		},
		deps:     deps,
		closeFns: closeFns,
	}, nil
}
