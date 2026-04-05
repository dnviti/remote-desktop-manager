package main

import (
	"bytes"
	"encoding/json"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWorldMetadataEndpoint(t *testing.T) {
	mux := http.NewServeMux()
	newTileService().registerRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/tiles/world/metadata", nil)
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}

	var metadata tileMetadataResponse
	if err := json.Unmarshal(res.Body.Bytes(), &metadata); err != nil {
		t.Fatalf("failed to decode metadata: %v", err)
	}
	if metadata.URLTemplate != "/v1/tiles/world/{z}/{x}/{y}" {
		t.Fatalf("unexpected url template: %q", metadata.URLTemplate)
	}
	if metadata.MaxNativeZoom != maxNativeZoom {
		t.Fatalf("unexpected max native zoom: %d", metadata.MaxNativeZoom)
	}
}

func TestWorldTileEndpointReturnsPNG(t *testing.T) {
	mux := http.NewServeMux()
	newTileService().registerRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/tiles/world/0/0/0", nil)
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
	if contentType := res.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "image/png") {
		t.Fatalf("unexpected content type: %q", contentType)
	}
	if cacheControl := res.Header().Get("Cache-Control"); cacheControl != tileCacheControl {
		t.Fatalf("unexpected cache control: %q", cacheControl)
	}
	if etag := res.Header().Get("ETag"); etag == "" {
		t.Fatal("expected ETag header")
	}
	if _, err := png.Decode(bytes.NewReader(res.Body.Bytes())); err != nil {
		t.Fatalf("response was not a decodable png: %v", err)
	}
}

func TestWorldTileEndpointSupportsConditionalRequests(t *testing.T) {
	mux := http.NewServeMux()
	newTileService().registerRoutes(mux)

	firstReq := httptest.NewRequest(http.MethodGet, "/v1/tiles/world/0/0/0", nil)
	firstRes := httptest.NewRecorder()
	mux.ServeHTTP(firstRes, firstReq)

	etag := firstRes.Header().Get("ETag")
	if etag == "" {
		t.Fatal("expected ETag header on first response")
	}

	secondReq := httptest.NewRequest(http.MethodGet, "/v1/tiles/world/0/0/0", nil)
	secondReq.Header.Set("If-None-Match", etag)
	secondRes := httptest.NewRecorder()
	mux.ServeHTTP(secondRes, secondReq)

	if secondRes.Code != http.StatusNotModified {
		t.Fatalf("expected 304, got %d", secondRes.Code)
	}
}

func TestWorldTileEndpointRejectsOutOfRangeCoordinates(t *testing.T) {
	mux := http.NewServeMux()
	newTileService().registerRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/tiles/world/8/0/0", nil)
	res := httptest.NewRecorder()
	mux.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", res.Code)
	}
}
