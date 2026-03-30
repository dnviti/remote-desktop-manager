package connections

import (
	"errors"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/jackc/pgx/v5"
)

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.ListConnections(r.Context(), claims.UserID, claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleCLIList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.ListConnections(r.Context(), claims.UserID, claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	lightweight := make([]map[string]any, 0, len(result.Own)+len(result.Shared)+len(result.Team))
	appendConnection := func(item connectionResponse) {
		lightweight = append(lightweight, map[string]any{
			"id":   item.ID,
			"name": item.Name,
			"type": item.Type,
			"host": item.Host,
			"port": item.Port,
		})
	}

	for _, item := range result.Own {
		appendConnection(item)
	}
	for _, item := range result.Shared {
		appendConnection(item)
	}
	for _, item := range result.Team {
		appendConnection(item)
	}

	app.WriteJSON(w, http.StatusOK, lightweight)
}

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	payload, err := parseCreatePayload(r)
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return nil
		}
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	created, err := s.CreateConnection(r.Context(), claims, payload, requestIP(r))
	if err != nil {
		if errors.Is(err, ErrLegacyConnectionFlow) {
			return err
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return nil
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return nil
	}

	app.WriteJSON(w, http.StatusCreated, created)
	return nil
}

func (s Service) HandleGetOne(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.GetConnection(r.Context(), claims.UserID, claims.TenantID, r.PathValue("id"))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Connection not found")
			return
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleUpdate(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	payload, err := parseUpdatePayload(r)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	updated, err := s.UpdateConnection(r.Context(), claims, r.PathValue("id"), payload, requestIP(r))
	if err != nil {
		if errors.Is(err, ErrLegacyConnectionFlow) {
			return err
		}
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Connection not found")
			return nil
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return nil
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return nil
	}

	app.WriteJSON(w, http.StatusOK, updated)
	return nil
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.DeleteConnection(r.Context(), claims, r.PathValue("id"), requestIP(r)); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Connection not found")
			return
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s Service) HandleToggleFavorite(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.ToggleFavorite(r.Context(), claims, r.PathValue("id"), requestIP(r))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Connection not found")
			return
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}
