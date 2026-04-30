module github.com/dnviti/arsenale/gateways/tunnel-agent

go 1.25.0

require (
	github.com/dnviti/arsenale/gateways/gateway-core v0.0.0
	github.com/gorilla/websocket v1.5.3
)

replace github.com/dnviti/arsenale/gateways/gateway-core => ../gateway-core
