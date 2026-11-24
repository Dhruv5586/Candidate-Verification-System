package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"candidate-verification/go-auth/internal/middleware"
	"candidate-verification/go-auth/internal/models"
	"candidate-verification/go-auth/internal/services"
)

// GoogleAuthHandler exposes HTTP handlers for the Google OAuth 2.0 / OIDC flow.
type GoogleAuthHandler struct {
	authService    *services.GoogleAuthService
	userService    *services.UserService
	sessionService *services.SessionService
	cookieManager  *middleware.SessionCookieManager
	frontendURL    string
}

// NewGoogleAuthHandler creates a new GoogleAuthHandler.
func NewGoogleAuthHandler(authService *services.GoogleAuthService) *GoogleAuthHandler {
	return &GoogleAuthHandler{
		authService: authService,
	}
}

// WithSessionIntegration attaches database user persistence and session cookie management.
func (h *GoogleAuthHandler) WithSessionIntegration(
	userService *services.UserService,
	sessionService *services.SessionService,
	cookieManager *middleware.SessionCookieManager,
	frontendURL string,
) *GoogleAuthHandler {
	h.userService = userService
	h.sessionService = sessionService
	h.cookieManager = cookieManager
	h.frontendURL = frontendURL
	return h
}

// ErrorResponse represents a standardized, safe error response without sensitive internals.
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

// SuccessAuthResponse represents the safe authenticated user response.
type SuccessAuthResponse struct {
	Success bool               `json:"success"`
	User    *models.GoogleUser `json:"user"`
}

// HandleLogin initiates the OAuth 2.0 PKCE flow and redirects the client to Google.
// Route: GET /auth/google/login
func (h *GoogleAuthHandler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeJSONError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Only GET method is supported")
		return
	}

	authURL, err := h.authService.GenerateAuthURL()
	if err != nil {
		log.Printf("[ERROR] Failed to generate Google auth URL: %v", err)
		h.writeJSONError(w, http.StatusInternalServerError, "internal_error", "Failed to initiate authentication")
		return
	}

	// Issue 302 Found redirect to Google authorization page
	http.Redirect(w, r, authURL, http.StatusFound)
}

// HandleCallback handles the Google OAuth redirect callback, verifies credentials, creates session, and issues cookie.
// Route: GET /auth/google/callback
func (h *GoogleAuthHandler) HandleCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeJSONError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Only GET method is supported")
		return
	}

	// 1. Check for errors returned by Google (e.g. access_denied, consent dismissed)
	googleErr := r.URL.Query().Get("error")
	if googleErr != "" {
		errDesc := r.URL.Query().Get("error_description")
		log.Printf("[WARN] Google OAuth callback returned error: %s (%s)", googleErr, errDesc)
		h.writeJSONError(w, http.StatusBadRequest, "google_auth_error", "Google authentication was cancelled or rejected")
		return
	}

	// 2. Validate presence of code and state query parameters
	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	if state == "" || code == "" {
		h.writeJSONError(w, http.StatusBadRequest, "invalid_request", "Missing authorization code or state parameter")
		return
	}

	// 3. Process the callback (state verification, single-use, code exchange, ID token verification, nonce check)
	googleUser, err := h.authService.ProcessCallback(r.Context(), state, code)
	if err != nil {
		log.Printf("[SECURITY] Authentication callback processing failed: %v", err)
		h.writeJSONError(w, http.StatusUnauthorized, "authentication_failed", "Authentication failed: invalid or expired session")
		return
	}

	// 4. If Persistent Session Integration is configured:
	//    a) Upsert user into PostgreSQL (preventing duplicate Google identities)
	//    b) Create persistent session with SHA-256 hashed token
	//    c) Set secure HTTP-only session cookie
	//    d) Redirect to FRONTEND_URL
	if h.userService != nil && h.sessionService != nil && h.cookieManager != nil {
		user, err := h.userService.SyncGoogleUser(r.Context(), googleUser)
		if err != nil {
			log.Printf("[ERROR] Failed to synchronize user profile into database: %v", err)
			h.writeJSONError(w, http.StatusInternalServerError, "internal_error", "Failed to record user identity")
			return
		}

		clientIP := getClientIP(r)
		userAgent := r.UserAgent()

		rawToken, session, err := h.sessionService.CreateSession(r.Context(), user.ID, clientIP, userAgent)
		if err != nil {
			log.Printf("[ERROR] Failed to establish persistent session: %v", err)
			h.writeJSONError(w, http.StatusInternalServerError, "internal_error", "Failed to create session")
			return
		}

		// Set secure HTTP-only session cookie
		h.cookieManager.SetSessionCookie(w, rawToken, session.ExpiresAt)

		// Redirect to client frontend (zero tokens exposed in URL)
		targetURL := h.frontendURL
		if targetURL == "" || targetURL == "/" {
			targetURL = "/dashboard.html"
		}
		http.Redirect(w, r, targetURL, http.StatusFound)
		return
	}

	// Fallback for standalone/mock unit testing (returns sanitized GoogleUser JSON)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(SuccessAuthResponse{
		Success: true,
		User:    googleUser,
	})
}

func (h *GoogleAuthHandler) writeJSONError(w http.ResponseWriter, status int, errCode, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(ErrorResponse{
		Error:   errCode,
		Message: message,
	})
}
