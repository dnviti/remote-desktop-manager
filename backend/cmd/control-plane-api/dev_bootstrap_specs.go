package main

import "path/filepath"

func buildDevGatewaySpecs(certDir string, runtime devBootstrapRuntime) []devGatewaySpec {
	specs := make([]devGatewaySpec, 0, 5)
	if runtime.features.ConnectionsEnabled {
		specs = append(specs,
			devGatewaySpec{
				ID:             requiredEnv("DEV_LOCAL_MANAGED_SSH_GATEWAY_ID", "44444444-4444-4444-8444-444444444444"),
				Name:           "Dev Local Managed SSH",
				Type:           "MANAGED_SSH",
				Host:           "ssh-gateway",
				Port:           2222,
				APIPort:        intPtr(9022),
				DeploymentMode: "SINGLE_INSTANCE",
				IsManaged:      false,
				TunnelEnabled:  false,
				Description:    "Development managed SSH gateway backed by the local ssh-gateway container",
			},
			devGatewaySpec{
				ID:             requiredEnv("DEV_LOCAL_GUACD_GATEWAY_ID", "55555555-5555-4555-8555-555555555555"),
				Name:           "Dev Local GUACD",
				Type:           "GUACD",
				Host:           "guacd",
				Port:           4822,
				DeploymentMode: "SINGLE_INSTANCE",
				IsManaged:      false,
				TunnelEnabled:  false,
				Description:    "Development GUACD gateway backed by the local guacd container",
			},
		)
	}

	if !runtime.features.ZeroTrustEnabled || !runtime.tunnelFixturesEnabled {
		return specs
	}

	if runtime.features.ConnectionsEnabled {
		specs = append(specs,
			devGatewaySpec{
				ID:             requiredEnv("DEV_TUNNEL_MANAGED_SSH_GATEWAY_ID", "11111111-1111-4111-8111-111111111111"),
				Name:           "Dev Tunnel Managed SSH",
				Type:           "MANAGED_SSH",
				Host:           "dev-tunnel-ssh-gateway",
				Port:           2222,
				APIPort:        intPtr(9022),
				DeploymentMode: "MANAGED_GROUP",
				IsManaged:      true,
				TunnelEnabled:  true,
				Token:          requiredEnv("DEV_TUNNEL_MANAGED_SSH_TOKEN", "dev-tunnel-managed-ssh-token"),
				CertDir:        filepath.Join(certDir, "tunnel-managed-ssh"),
				Description:    "Development managed SSH gateway registered through the zero-trust tunnel",
				EgressPolicy:   devTunnelManagedSSHEgressPolicy(),
			},
			devGatewaySpec{
				ID:             requiredEnv("DEV_TUNNEL_GUACD_GATEWAY_ID", "22222222-2222-4222-8222-222222222222"),
				Name:           "Dev Tunnel GUACD",
				Type:           "GUACD",
				Host:           "dev-tunnel-guacd",
				Port:           4822,
				DeploymentMode: "MANAGED_GROUP",
				IsManaged:      true,
				TunnelEnabled:  true,
				Token:          requiredEnv("DEV_TUNNEL_GUACD_TOKEN", "dev-tunnel-guacd-token"),
				CertDir:        filepath.Join(certDir, "tunnel-guacd"),
				Description:    "Development guacd gateway registered through the zero-trust tunnel",
				EgressPolicy:   devTunnelGuacdEgressPolicy(),
			},
		)
	}
	if runtime.features.DatabaseProxyEnabled {
		specs = append(specs, devGatewaySpec{
			ID:             requiredEnv("DEV_TUNNEL_DB_PROXY_GATEWAY_ID", "33333333-3333-4333-8333-333333333333"),
			Name:           "Dev Tunnel DB Proxy",
			Type:           "DB_PROXY",
			Host:           "dev-tunnel-db-proxy",
			Port:           5432,
			DeploymentMode: "MANAGED_GROUP",
			IsManaged:      true,
			TunnelEnabled:  true,
			Token:          requiredEnv("DEV_TUNNEL_DB_PROXY_TOKEN", "dev-tunnel-db-proxy-token"),
			CertDir:        filepath.Join(certDir, "tunnel-db-proxy"),
			Description:    "Development database proxy gateway registered through the zero-trust tunnel",
			EgressPolicy:   devTunnelDBProxyEgressPolicy(),
		})
	}
	return specs
}

func devTunnelManagedSSHEgressPolicy() string {
	return `{"rules":[{"description":"Development SSH fixtures","protocols":["SSH"],"hosts":["terminal-target","dev-debian-target","dev-debian-ssh-target"],"ports":[22,2224]}]}`
}

func devTunnelGuacdEgressPolicy() string {
	return `{"rules":[{"description":"Development desktop fixtures","protocols":["RDP"],"hosts":["terminal-target"],"ports":[3389]},{"description":"Development VNC fixtures","protocols":["VNC"],"hosts":["terminal-target"],"ports":[5900]}]}`
}

func devTunnelDBProxyEgressPolicy() string {
	return `{"rules":[{"description":"Development database fixtures","protocols":["DATABASE"],"hosts":["dev-demo-postgres","dev-demo-mysql","dev-demo-mongodb","dev-demo-oracle","dev-demo-mssql"],"ports":[5432,3306,27017,1521,1433]}]}`
}

func buildDevDemoDatabaseSpecs() []devDemoDatabaseSpec {
	return []devDemoDatabaseSpec{
		{
			Name:        requiredEnv("DEV_SAMPLE_POSTGRES_CONNECTION_NAME", "Dev Demo PostgreSQL"),
			Host:        requiredEnv("DEV_SAMPLE_POSTGRES_HOST", "dev-demo-postgres"),
			Port:        requiredEnvInt("DEV_SAMPLE_POSTGRES_PORT", 5432),
			Username:    requiredEnv("DEV_SAMPLE_POSTGRES_USER", "demo_pg_user"),
			Password:    requiredEnv("DEV_SAMPLE_POSTGRES_PASSWORD", "DemoPgPass123!"),
			Description: "Seeded development PostgreSQL fixture used for database session smoke tests.",
			DBSettings: map[string]any{
				"protocol":     "postgresql",
				"databaseName": requiredEnv("DEV_SAMPLE_POSTGRES_DATABASE", "arsenale_demo"),
				"sslMode":      requiredEnv("DEV_SAMPLE_POSTGRES_SSL_MODE", "disable"),
			},
		},
		{
			Name:        requiredEnv("DEV_SAMPLE_MYSQL_CONNECTION_NAME", "Dev Demo MySQL"),
			Host:        requiredEnv("DEV_SAMPLE_MYSQL_HOST", "dev-demo-mysql"),
			Port:        requiredEnvInt("DEV_SAMPLE_MYSQL_PORT", 3306),
			Username:    requiredEnv("DEV_SAMPLE_MYSQL_USER", "demo_mysql_user"),
			Password:    requiredEnv("DEV_SAMPLE_MYSQL_PASSWORD", "DemoMySqlPass123!"),
			Description: "Seeded development MySQL fixture used for direct smoke tests.",
			DBSettings: map[string]any{
				"protocol":     "mysql",
				"databaseName": requiredEnv("DEV_SAMPLE_MYSQL_DATABASE", "arsenale_demo"),
			},
		},
		{
			Name:        requiredEnv("DEV_SAMPLE_MONGODB_CONNECTION_NAME", "Dev Demo MongoDB"),
			Host:        requiredEnv("DEV_SAMPLE_MONGODB_HOST", "dev-demo-mongodb"),
			Port:        requiredEnvInt("DEV_SAMPLE_MONGODB_PORT", 27017),
			Username:    requiredEnv("DEV_SAMPLE_MONGODB_USER", "demo_mongo_user"),
			Password:    requiredEnv("DEV_SAMPLE_MONGODB_PASSWORD", "DemoMongoPass123!"),
			Description: "Seeded development MongoDB fixture used for direct smoke tests.",
			DBSettings: map[string]any{
				"protocol":     "mongodb",
				"databaseName": requiredEnv("DEV_SAMPLE_MONGODB_DATABASE", "arsenale_demo"),
			},
		},
		{
			Name:        requiredEnv("DEV_SAMPLE_ORACLE_CONNECTION_NAME", "Dev Demo Oracle"),
			Host:        requiredEnv("DEV_SAMPLE_ORACLE_HOST", "dev-demo-oracle"),
			Port:        requiredEnvInt("DEV_SAMPLE_ORACLE_PORT", 1521),
			Username:    requiredEnv("DEV_SAMPLE_ORACLE_USER", "demo_oracle_user"),
			Password:    requiredEnv("DEV_SAMPLE_ORACLE_PASSWORD", "DemoOraclePass123!"),
			Description: "Seeded development Oracle fixture used for direct smoke tests.",
			DBSettings: map[string]any{
				"protocol":             "oracle",
				"databaseName":         requiredEnv("DEV_SAMPLE_ORACLE_SERVICE_NAME", "FREEPDB1"),
				"oracleConnectionType": "basic",
				"oracleServiceName":    requiredEnv("DEV_SAMPLE_ORACLE_SERVICE_NAME", "FREEPDB1"),
			},
		},
		{
			Name:        requiredEnv("DEV_SAMPLE_MSSQL_CONNECTION_NAME", "Dev Demo SQL Server"),
			Host:        requiredEnv("DEV_SAMPLE_MSSQL_HOST", "dev-demo-mssql"),
			Port:        requiredEnvInt("DEV_SAMPLE_MSSQL_PORT", 1433),
			Username:    requiredEnv("DEV_SAMPLE_MSSQL_USER", "demo_mssql_user"),
			Password:    requiredEnv("DEV_SAMPLE_MSSQL_PASSWORD", "DemoMssqlPass123!"),
			Description: "Seeded development SQL Server fixture used for direct smoke tests.",
			DBSettings: map[string]any{
				"protocol":      "mssql",
				"databaseName":  requiredEnv("DEV_SAMPLE_MSSQL_DATABASE", "ArsenaleDemo"),
				"mssqlAuthMode": "sql",
			},
		},
	}
}

func intPtr(value int) *int {
	return &value
}
