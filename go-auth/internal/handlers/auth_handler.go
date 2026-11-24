package handlers

import (
	"encoding/json"
	"net/http"

	"candidate-verification/go-auth/internal/middleware"
	"candidate-verification/go-auth/internal/models"
	"candidate-verification/go-auth/internal/services"
)

// AuthHandler provides endpoints for session inspection, refresh, and termination.
type AuthHandler struct {
	sessionService *services.SessionService
	cookieManager  *middleware.SessionCookieManager
	frontendURL    string
}

// NewAuthHandler constructs a new AuthHandler.
func NewAuthHandler(
	sessionService *services.SessionService,
	cookieManager *middleware.SessionCookieManager,
	frontendURL string,
) *AuthHandler {
	return &AuthHandler{
		sessionService: sessionService,
		cookieManager:  cookieManager,
		frontendURL:    frontendURL,
	}
}

// SessionInfo represents metadata for the client about their active session.
type SessionInfo struct {
	ID        string `json:"id"`
	ExpiresAt string `json:"expires_at"`
}

// MeResponse represents the authenticated user profile and session info.
type MeResponse struct {
	Authenticated bool         `json:"authenticated"`
	User          *models.User `json:"user"`
	Session       SessionInfo  `json:"session"`
}

// HandleMe handles GET /auth/me.
func (h *AuthHandler) HandleMe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}

	rawToken, err := h.cookieManager.GetSessionToken(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"authenticated": false, "error": "missing_session"})
		return
	}

	user, session, err := h.sessionService.ValidateSession(r.Context(), rawToken)
	if err != nil {
		h.cookieManager.ClearSessionCookie(w)
		writeJSON(w, http.StatusUnauthorized, map[string]any{"authenticated": false, "error": "session_expired_or_invalid"})
		return
	}

	writeJSON(w, http.StatusOK, MeResponse{
		Authenticated: true,
		User:          user,
		Session: SessionInfo{
			ID:        session.ID,
			ExpiresAt: session.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		},
	})
}

// HandleLogout handles POST /auth/logout.
func (h *AuthHandler) HandleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}

	// CSRF Origin validation on state-changing logout
	if err := middleware.ValidateCSRFOrigin(r, h.frontendURL, "http://localhost:8080", "http://localhost:3000"); err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "csrf_validation_failed"})
		return
	}

	rawToken, _ := h.cookieManager.GetSessionToken(r)
	if rawToken != "" {
		_ = h.sessionService.RevokeSession(r.Context(), rawToken)
	}

	h.cookieManager.ClearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "successfully logged out",
	})
}

// HandleRefresh handles POST /auth/refresh.
func (h *AuthHandler) HandleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
		return
	}

	// CSRF Origin validation on state-changing refresh
	if err := middleware.ValidateCSRFOrigin(r, h.frontendURL, "http://localhost:8080", "http://localhost:3000"); err != nil {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "csrf_validation_failed"})
		return
	}

	rawToken, err := h.cookieManager.GetSessionToken(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "missing_session"})
		return
	}

	clientIP := getClientIP(r)
	userAgent := r.UserAgent()

	newToken, session, err := h.sessionService.RefreshSession(r.Context(), rawToken, clientIP, userAgent)
	if err != nil {
		h.cookieManager.ClearSessionCookie(w)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "refresh_failed_or_expired"})
		return
	}

	// Set fresh rotated cookie
	h.cookieManager.SetSessionCookie(w, newToken, session.ExpiresAt)

	writeJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"expires_at": session.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := r.Header.Values("X-Forwarded-For")
		if len(parts) > 0 {
			return parts[0]
		}
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	return r.RemoteAddr
}
