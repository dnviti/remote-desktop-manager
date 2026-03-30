package geoipapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

const (
	ipAPIBase   = "http://ip-api.com/json"
	ipAPIFields = "status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting,query"
	ipWhoIsBase = "https://ipwho.is"
	cacheTTL    = 10 * time.Minute
)

var ErrLookupUnavailable = errors.New("GeoIP lookup unavailable in this environment")

type Service struct {
	Client *http.Client

	mu        sync.Mutex
	cache     map[string]cachedEntry
	remaining int
	resetAt   time.Time
}

type cachedEntry struct {
	data      ipAPIResponse
	expiresAt time.Time
}

type ipAPIResponse struct {
	Status      string   `json:"status"`
	Message     string   `json:"message,omitempty"`
	Country     string   `json:"country,omitempty"`
	CountryCode string   `json:"countryCode,omitempty"`
	RegionName  string   `json:"regionName,omitempty"`
	City        string   `json:"city,omitempty"`
	Zip         string   `json:"zip,omitempty"`
	Lat         *float64 `json:"lat,omitempty"`
	Lon         *float64 `json:"lon,omitempty"`
	Timezone    string   `json:"timezone,omitempty"`
	ISP         string   `json:"isp,omitempty"`
	Org         string   `json:"org,omitempty"`
	AS          string   `json:"as,omitempty"`
	ASName      string   `json:"asname,omitempty"`
	Mobile      *bool    `json:"mobile,omitempty"`
	Proxy       *bool    `json:"proxy,omitempty"`
	Hosting     *bool    `json:"hosting,omitempty"`
	Query       string   `json:"query,omitempty"`
}

type ipWhoIsResponse struct {
	IP          string   `json:"ip"`
	Success     bool     `json:"success"`
	Message     string   `json:"message"`
	Country     string   `json:"country"`
	CountryCode string   `json:"country_code"`
	Region      string   `json:"region"`
	City        string   `json:"city"`
	Postal      string   `json:"postal"`
	Latitude    *float64 `json:"latitude"`
	Longitude   *float64 `json:"longitude"`
	Connection  struct {
		ASN int    `json:"asn"`
		Org string `json:"org"`
		ISP string `json:"isp"`
	} `json:"connection"`
	Timezone struct {
		ID string `json:"id"`
	} `json:"timezone"`
}

func (s *Service) HandleLookup(w http.ResponseWriter, r *http.Request, _ authn.Claims) {
	ip := strings.TrimSpace(r.PathValue("ip"))
	if ip == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "ip is required")
		return
	}
	result, err := s.Lookup(r.Context(), ip)
	if err != nil {
		if errors.Is(err, ErrLookupUnavailable) {
			app.WriteJSON(w, http.StatusOK, ipAPIResponse{
				Status:  "fail",
				Message: ErrLookupUnavailable.Error(),
				Query:   ip,
			})
			return
		}
		status := http.StatusBadGateway
		if strings.Contains(err.Error(), "rate limit") {
			status = http.StatusTooManyRequests
		}
		app.ErrorJSON(w, status, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s *Service) Lookup(ctx context.Context, ip string) (ipAPIResponse, error) {
	now := time.Now()
	s.mu.Lock()
	if s.cache == nil {
		s.cache = make(map[string]cachedEntry)
	}
	if cached, ok := s.cache[ip]; ok && cached.expiresAt.After(now) {
		s.mu.Unlock()
		return cached.data, nil
	}
	rateLimited := s.remaining <= 2 && !s.resetAt.IsZero() && now.Before(s.resetAt)
	s.mu.Unlock()

	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}

	var (
		payload ipAPIResponse
		err     error
	)
	if rateLimited {
		payload, err = s.lookupIPWhoIs(ctx, client, ip)
	} else {
		payload, err = s.lookupPrimary(ctx, client, ip)
		if err != nil {
			payload, err = s.lookupIPWhoIs(ctx, client, ip)
		}
	}
	if err != nil {
		return ipAPIResponse{}, err
	}

	s.mu.Lock()
	s.cache[ip] = cachedEntry{data: payload, expiresAt: time.Now().Add(cacheTTL)}
	if len(s.cache) > 500 {
		for key, value := range s.cache {
			if value.expiresAt.Before(time.Now()) {
				delete(s.cache, key)
			}
		}
	}
	s.mu.Unlock()

	return payload, nil
}

func (s *Service) lookupPrimary(ctx context.Context, client *http.Client, ip string) (ipAPIResponse, error) {
	endpoint := fmt.Sprintf("%s/%s?fields=%s", ipAPIBase, url.PathEscape(ip), url.QueryEscape(ipAPIFields))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return ipAPIResponse{}, fmt.Errorf("build GeoIP request: %w", err)
	}
	res, err := client.Do(req)
	if err != nil {
		return ipAPIResponse{}, ErrLookupUnavailable
	}
	defer res.Body.Close()

	var payload ipAPIResponse
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		return ipAPIResponse{}, fmt.Errorf("decode GeoIP response: %w", err)
	}

	s.updateRateLimit(res)

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return ipAPIResponse{}, ErrLookupUnavailable
	}
	if strings.EqualFold(payload.Status, "fail") {
		if strings.TrimSpace(payload.Message) == "" {
			payload.Message = "GeoIP lookup failed"
		}
		return ipAPIResponse{}, errors.New(payload.Message)
	}
	return payload, nil
}

func (s *Service) lookupIPWhoIs(ctx context.Context, client *http.Client, ip string) (ipAPIResponse, error) {
	endpoint := fmt.Sprintf("%s/%s", ipWhoIsBase, url.PathEscape(ip))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return ipAPIResponse{}, fmt.Errorf("build GeoIP request: %w", err)
	}
	res, err := client.Do(req)
	if err != nil {
		return ipAPIResponse{}, ErrLookupUnavailable
	}
	defer res.Body.Close()

	var payload ipWhoIsResponse
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		return ipAPIResponse{}, fmt.Errorf("decode GeoIP response: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return ipAPIResponse{}, ErrLookupUnavailable
	}
	if !payload.Success {
		message := strings.TrimSpace(payload.Message)
		if message == "" {
			message = "GeoIP lookup failed"
		}
		return ipAPIResponse{}, errors.New(message)
	}

	return normalizeIPWhoIs(payload), nil
}

func normalizeIPWhoIs(payload ipWhoIsResponse) ipAPIResponse {
	result := ipAPIResponse{
		Status:      "success",
		Country:     strings.TrimSpace(payload.Country),
		CountryCode: strings.TrimSpace(payload.CountryCode),
		RegionName:  strings.TrimSpace(payload.Region),
		City:        strings.TrimSpace(payload.City),
		Zip:         strings.TrimSpace(payload.Postal),
		Timezone:    strings.TrimSpace(payload.Timezone.ID),
		ISP:         strings.TrimSpace(payload.Connection.ISP),
		Org:         strings.TrimSpace(payload.Connection.Org),
		Query:       strings.TrimSpace(payload.IP),
	}
	if payload.Latitude != nil {
		result.Lat = payload.Latitude
	}
	if payload.Longitude != nil {
		result.Lon = payload.Longitude
	}
	if payload.Connection.ASN > 0 {
		result.AS = fmt.Sprintf("AS%d", payload.Connection.ASN)
		result.ASName = result.Org
	}
	return result
}

func (s *Service) updateRateLimit(res *http.Response) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if raw := strings.TrimSpace(res.Header.Get("X-Rl")); raw != "" {
		var remaining int
		if _, err := fmt.Sscanf(raw, "%d", &remaining); err == nil {
			s.remaining = remaining
		}
	}
	if raw := strings.TrimSpace(res.Header.Get("X-Ttl")); raw != "" {
		var ttlSeconds int
		if _, err := fmt.Sscanf(raw, "%d", &ttlSeconds); err == nil {
			s.resetAt = time.Now().Add(time.Duration(ttlSeconds) * time.Second)
		}
	}
}
