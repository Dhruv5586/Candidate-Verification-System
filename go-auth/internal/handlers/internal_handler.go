package handlers

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"

	"candidate-verification/go-auth/internal/services"
)

// InternalHandler handles service-to-service validation requests from the Node.js API.
type InternalHandler struct {
	sessionService *services.SessionService
	internalSecret string
}

// NewInternalHandler constructs a new InternalHandler.
func NewInternalHandler(sessionService *services.SessionService, internalSecret string) *InternalHandler {
	return &InternalHandler{
		sessionService: sessionService,
		internalSecret: internalSecret,
	}
}

// ValidateRequest represents the internal payload sent by the Node.js backend.
type ValidateRequest struct {
	SessionToken string `json:"session_token"`
}

// ValidateResponse represents the secure verification outcome for the Node.js backend.
type ValidateResponse struct {
	Valid     bool     `json:"valid"`
	UserID    string   `json:"user_id,omitempty"`
	Email     string   `json:"email,omitempty"`
	Name      string   `json:"name,omitempty"`
	Roles     []string `json:"roles,omitempty"`
	SessionID string   `json:"session_id,omitempty"`
	ExpiresAt string   `json:"expires_at,omitempty"`
	Error     string   `json:"error,omitempty"`
}

// HandleValidateSession handles POST /internal/session/validate.
func (h *InternalHandler) HandleValidateSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, ValidateResponse{Valid: false, Error: "method_not_allowed"})
		return
	}

	// 1. Enforce X-Internal-Secret with constant-time cryptographic comparison
	providedSecret := r.Header.Get("X-Internal-Secret")
	if len(providedSecret) == 0 || len(h.internalSecret) == 0 ||
		subtle.ConstantTimeCompare([]byte(providedSecret), []byte(h.internalSecret)) != 1 {
		writeJSON(w, http.StatusUnauthorized, ValidateResponse{Valid: false, Error: "unauthorized_service_call"})
		return
	}

	// 2. Extract session token from JSON body or Authorization header
	var req ValidateRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	token := strings.TrimSpace(req.SessionToken)
	if token == "" {
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}

	if token == "" {
		writeJSON(w, http.StatusBadRequest, ValidateResponse{Valid: false, Error: "missing_session_token"})
		return
	}

	// 3. Cryptographically hash token and validate session in PostgreSQL
	user, session, err := h.sessionService.ValidateSession(r.Context(), token)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, ValidateResponse{Valid: false, Error: "session_expired_or_revoked"})
		return
	}

	// 4. Return minimal authenticated user information and roles
	writeJSON(w, http.StatusOK, ValidateResponse{
		Valid:     true,
		UserID:    user.ID,
		Email:     user.Email,
		Name:      user.Name,
		Roles:     user.Roles,
		SessionID: session.ID,
		ExpiresAt: session.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	})
}
