package contracts

type TunnelHeartbeat struct {
	Healthy       bool  `json:"healthy"`
	LatencyMs     *int  `json:"latencyMs,omitempty"`
	ActiveStreams *int  `json:"activeStreams,omitempty"`
	BytesIn       int64 `json:"bytesIn,omitempty"`
	BytesOut      int64 `json:"bytesOut,omitempty"`
}

type TunnelStatus struct {
	GatewayID         string           `json:"gatewayId"`
	Connected         bool             `json:"connected"`
	ConnectedAt       string           `json:"connectedAt,omitempty"`
	LastHeartbeatAt   string           `json:"lastHeartbeatAt,omitempty"`
	ClientVersion     string           `json:"clientVersion,omitempty"`
	ClientIP          string           `json:"clientIp,omitempty"`
	ActiveStreams     int              `json:"activeStreams,omitempty"`
	BytesTransferred  int64            `json:"bytesTransferred,omitempty"`
	PingPongLatencyMs *int64           `json:"pingPongLatencyMs,omitempty"`
	Heartbeat         *TunnelHeartbeat `json:"heartbeat,omitempty"`
}

type TunnelProxyRequest struct {
	GatewayID   string `json:"gatewayId"`
	TargetHost  string `json:"targetHost"`
	TargetPort  int    `json:"targetPort"`
	TimeoutMs   int    `json:"timeoutMs,omitempty"`
	IdleTimeout int    `json:"idleTimeoutMs,omitempty"`
}

type TunnelProxyResponse struct {
	ID        string `json:"id"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	ExpiresIn int    `json:"expiresInMs,omitempty"`
}

type TunnelStatusesResponse struct {
	Tunnels []TunnelStatus `json:"tunnels"`
}
