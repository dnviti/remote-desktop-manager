package main

import (
	"context"
	"net/http"
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
	"github.com/dnviti/arsenale/backend/internal/dbauditapi"
	"github.com/dnviti/arsenale/backend/internal/dbsessions"
	"github.com/dnviti/arsenale/backend/internal/desktopbroker"
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
	"github.com/dnviti/arsenale/backend/internal/notifications"
	"github.com/dnviti/arsenale/backend/internal/oauthapi"
	"github.com/dnviti/arsenale/backend/internal/orchestration"
	"github.com/dnviti/arsenale/backend/internal/passwordrotationapi"
	"github.com/dnviti/arsenale/backend/internal/publicconfig"
	"github.com/dnviti/arsenale/backend/internal/publicshareapi"
	"github.com/dnviti/arsenale/backend/internal/rdgatewayapi"
	"github.com/dnviti/arsenale/backend/internal/recordingsapi"
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
	"github.com/jackc/pgx/v5/pgxpool"
)

type apiRuntime struct {
	service  app.StaticService
	closeFns []func()
}

func (r *apiRuntime) Close() {
	for i := len(r.closeFns) - 1; i >= 0; i-- {
		if r.closeFns[i] != nil {
			r.closeFns[i]()
		}
	}
}

func (r *apiRuntime) Run(ctx context.Context) error {
	return app.Run(ctx, r.service)
}

type apiDependencies struct {
	db                      *pgxpool.Pool
	store                   *orchestration.Store
	sessionStore            *sessions.Store
	desktopSessionService   desktopsessions.Service
	databaseSessionService  dbsessions.Service
	setupService            setup.Service
	publicConfigService     publicconfig.Service
	publicShareService      publicshareapi.Service
	authService             authservice.Service
	mfaService              mfaapi.Service
	userService             users.Service
	connectionService       connections.Service
	importExportService     importexportapi.Service
	cliService              cliapi.Service
	checkoutService         checkouts.Service
	folderService           folders.Service
	vaultFolderService      vaultfolders.Service
	fileService             files.Service
	gatewayService          gateways.Service
	notificationService     notifications.Service
	oauthService            oauthapi.Service
	passwordRotationService passwordrotationapi.Service
	geoIPService            *geoipapi.Service
	ldapService             ldapapi.Service
	rdGatewayService        rdgatewayapi.Service
	recordingService        recordingsapi.Service
	secretsMetaService      secretsmeta.Service
	tenantVaultService      tenantvaultapi.Service
	tabsService             tabs.Service
	tenantService           tenants.Service
	teamService             teams.Service
	syncProfileService      syncprofiles.Service
	externalVaultService    externalvaultapi.Service
	vaultService            vaultapi.Service
	adminService            adminapi.Service
	systemSettingsService   systemsettingsapi.Service
	auditService            auditapi.Service
	dbAuditService          dbauditapi.Service
	accessPolicyService     accesspolicies.Service
	keystrokePolicyService  keystrokepolicies.Service
	sessionAdminService     sessionadmin.Service
	sshSessionService       sshsessions.Service
	sshProxyService         sshproxyapi.Service
	authenticator           *authn.Authenticator
	legacyAPIProxy          http.Handler
	legacyAPIProbe          *legacyAPIProbe
}

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
		for i := len(closeFns) - 1; i >= 0; i-- {
			closeFns[i]()
		}
		return nil, err
	}
	if redisClient != nil {
		closeFns = append(closeFns, func() { _ = redisClient.Close() })
	}

	guacamoleSecret, err := desktopbroker.LoadSecret("GUACAMOLE_SECRET", "GUACAMOLE_SECRET_FILE")
	if err != nil {
		for i := len(closeFns) - 1; i >= 0; i-- {
			closeFns[i]()
		}
		return nil, err
	}
	jwtSecret, err := desktopbroker.LoadSecret("JWT_SECRET", "JWT_SECRET_FILE")
	if err != nil {
		for i := len(closeFns) - 1; i >= 0; i-- {
			closeFns[i]()
		}
		return nil, err
	}
	guacencAuthToken, err := loadOptionalSecret("GUACENC_AUTH_TOKEN", "GUACENC_AUTH_TOKEN_FILE")
	if err != nil {
		for i := len(closeFns) - 1; i >= 0; i-- {
			closeFns[i]()
		}
		return nil, err
	}
	serverEncryptionKey, err := modelgateway.LoadServerEncryptionKey()
	if err != nil {
		for i := len(closeFns) - 1; i >= 0; i-- {
			closeFns[i]()
		}
		return nil, err
	}

	store := orchestration.NewStore(db)
	if err := store.EnsureSchema(ctx); err != nil {
		for i := len(closeFns) - 1; i >= 0; i-- {
			closeFns[i]()
		}
		return nil, err
	}

	sessionStore := sessions.NewStore(db)
	tenantAuthService := tenantauth.Service{DB: db}
	vaultTTL := time.Duration(parseInt(getenv("VAULT_TTL_MINUTES", "30"), 30)) * time.Minute
	authService := authservice.Service{
		DB:               db,
		Redis:            redisClient,
		JWTSecret:        []byte(strings.TrimSpace(jwtSecret)),
		ServerKey:        serverEncryptionKey,
		ClientURL:        getenv("CLIENT_URL", "https://localhost:3000"),
		TokenBinding:     os.Getenv("TOKEN_BINDING_ENABLED") != "false",
		EmailVerify:      os.Getenv("EMAIL_VERIFY_REQUIRED") == "true",
		CookieSecure:     authservice.DefaultCookieSecure(),
		AccessTokenTTL:   parseExpiry(getenv("JWT_EXPIRES_IN", "15m")),
		RefreshCookieTTL: parseExpiry(getenv("JWT_REFRESH_EXPIRES_IN", "7d")),
		VaultTTL:         vaultTTL,
	}

	deps := &apiDependencies{
		db:    db,
		store: store,
		desktopSessionService: desktopsessions.Service{
			Secret: guacamoleSecret,
			Store:  sessionStore,
		},
		databaseSessionService: dbsessions.Service{
			Store: sessionStore,
			DB:    db,
		},
		sessionStore: sessionStore,
		setupService: setup.Service{
			DB:        db,
			Redis:     redisClient,
			ServerKey: serverEncryptionKey,
			VaultTTL:  vaultTTL,
		},
		publicConfigService: publicconfig.Service{
			DB: db,
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
			DB:                db,
			DriveBasePath:     getenv("DRIVE_BASE_PATH", "/guacd-drive"),
			FileUploadMaxSize: int64(parseInt(getenv("FILE_UPLOAD_MAX_SIZE", "10485760"), 10*1024*1024)),
			UserDriveQuota:    int64(parseInt(getenv("USER_DRIVE_QUOTA", "104857600"), 100*1024*1024)),
		},
		gatewayService: gateways.Service{
			DB:                  db,
			Redis:               redisClient,
			ServerEncryptionKey: serverEncryptionKey,
			DefaultGRPCPort:     parseInt(getenv("GATEWAY_GRPC_PORT", "9022"), 9022),
		},
		notificationService: notifications.Service{
			DB: db,
		},
		oauthService: oauthapi.Service{
			DB:        db,
			Redis:     redisClient,
			ServerKey: serverEncryptionKey,
			VaultTTL:  vaultTTL,
		},
		passwordRotationService: passwordrotationapi.Service{
			DB: db,
		},
		geoIPService: &geoipapi.Service{},
		ldapService:  ldapapi.Service{DB: db},
		rdGatewayService: rdgatewayapi.Service{
			DB: db,
		},
		recordingService: recordingsapi.Service{
			DB:                    db,
			RecordingPath:         getenv("RECORDING_PATH", "/recordings"),
			GuacencServiceURL:     getenv("GUACENC_SERVICE_URL", "http://guacenc:3003"),
			GuacencUseTLS:         strings.EqualFold(getenv("GUACENC_USE_TLS", "false"), "true"),
			GuacencTLSCA:          strings.TrimSpace(os.Getenv("GUACENC_TLS_CA")),
			GuacencAuthToken:      guacencAuthToken,
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
			ServerEncryptionKey: serverEncryptionKey,
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
		},
		externalVaultService: externalvaultapi.Service{
			DB:                  db,
			ServerEncryptionKey: serverEncryptionKey,
		},
		vaultService: vaultapi.Service{
			DB:        db,
			Redis:     redisClient,
			ServerKey: serverEncryptionKey,
			VaultTTL:  vaultTTL,
		},
		secretsMetaService: secretsmeta.Service{
			DB: db,
		},
		tenantVaultService: tenantvaultapi.Service{
			DB:        db,
			Redis:     redisClient,
			ServerKey: serverEncryptionKey,
			VaultTTL:  vaultTTL,
		},
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
			Store:      sessionStore,
			TenantAuth: tenantAuthService,
		},
		sshSessionService: sshsessions.Service{
			DB:                  db,
			Redis:               redisClient,
			SessionStore:        sessionStore,
			TenantAuth:          tenantAuthService,
			ServerEncryptionKey: serverEncryptionKey,
			TerminalBrokerURL:   getenv("TERMINAL_BROKER_URL", "http://terminal-broker-go:8090"),
			TunnelBrokerURL:     getenv("GO_TUNNEL_BROKER_URL", "http://tunnel-broker-go:8092"),
		},
		sshProxyService: sshproxyapi.Service{
			DB:        db,
			JWTSecret: []byte(strings.TrimSpace(jwtSecret)),
		},
	}

	deps.cliService.Auth = &deps.authService
	deps.setupService.AuthService = &deps.authService
	deps.setupService.TenantService = &deps.tenantService
	deps.connectionService.Redis = redisClient
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
		for i := len(closeFns) - 1; i >= 0; i-- {
			closeFns[i]()
		}
		return nil, err
	}
	legacyAPIProxy, err := newLegacyAPIProxy()
	if err != nil {
		for i := len(closeFns) - 1; i >= 0; i-- {
			closeFns[i]()
		}
		return nil, err
	}
	legacyAPIProbe, err := newLegacyAPIProbe()
	if err != nil {
		for i := len(closeFns) - 1; i >= 0; i-- {
			closeFns[i]()
		}
		return nil, err
	}

	deps.authenticator = authenticator
	deps.legacyAPIProxy = legacyAPIProxy
	deps.legacyAPIProbe = legacyAPIProbe

	return &apiRuntime{
		service: app.StaticService{
			Descriptor: catalog.MustService(contracts.ServiceControlPlaneAPI),
			Register:   deps.register,
		},
		closeFns: closeFns,
	}, nil
}
