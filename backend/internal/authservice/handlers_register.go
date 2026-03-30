package authservice

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func (s Service) HandleRegister(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, "read request body")
		return nil
	}

	var payload struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	result, err := s.Register(r.Context(), strings.TrimSpace(strings.ToLower(payload.Email)), payload.Password, requestIP(r))
	if err != nil {
		switch {
		case errors.Is(err, ErrLegacyRegister):
			return err
		case isRequestError(err):
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return nil
	}

	app.WriteJSON(w, http.StatusCreated, result)
	return nil
}
