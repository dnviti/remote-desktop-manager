package main

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func newLegacyAPIProxy() (http.Handler, error) {
	upstream := getenv("LEGACY_NODE_API_URL", "https://server:3001")
	target, err := url.Parse(upstream)
	if err != nil {
		return nil, err
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport, err = legacyAPIProxyTransport(target)
	if err != nil {
		return nil, err
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		app.ErrorJSON(w, http.StatusBadGateway, "legacy API proxy unavailable: "+err.Error())
	}

	return proxy, nil
}

func legacyAPIProxyTransport(target *url.URL) (http.RoundTripper, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if target.Scheme != "https" {
		return transport, nil
	}

	rootCAs, err := x509.SystemCertPool()
	if err != nil || rootCAs == nil {
		rootCAs = x509.NewCertPool()
	}

	if certPath := os.Getenv("LEGACY_NODE_API_CA_CERT"); certPath != "" {
		pem, readErr := os.ReadFile(certPath)
		if readErr != nil {
			return nil, readErr
		}
		if ok := rootCAs.AppendCertsFromPEM(pem); !ok {
			return nil, errors.New("failed to append legacy API CA certificate")
		}
	}

	transport.TLSClientConfig = &tls.Config{
		MinVersion: tls.VersionTLS12,
		RootCAs:    rootCAs,
	}
	return transport, nil
}

type legacyAPIProbe struct {
	client *http.Client
	url    string
}

func newLegacyAPIProbe() (*legacyAPIProbe, error) {
	upstream := getenv("LEGACY_NODE_API_URL", "https://server:3001")
	target, err := url.Parse(upstream)
	if err != nil {
		return nil, err
	}
	transport, err := legacyAPIProxyTransport(target)
	if err != nil {
		return nil, err
	}
	return &legacyAPIProbe{
		client: &http.Client{
			Timeout:   5 * time.Second,
			Transport: transport,
		},
		url: target.ResolveReference(&url.URL{Path: "/api/health"}).String(),
	}, nil
}
