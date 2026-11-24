package middleware

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	// SessionCookieName is the standard cookie name for the candidate verification session.
	SessionCookieName = "cvs_session"
)

// CookieConfig holds parameters for session cookie issuance.
type CookieConfig struct {
	Domain   string
	Secure   bool
	SameSite http.SameSite
}

// SessionCookieManager handles secure cookie reading and writing.
type SessionCookieManager struct {
	cfg CookieConfig
}

// NewSessionCookieManager constructs a new SessionCookieManager.
func NewSessionCookieManager(domain string, secure bool) *SessionCookieManager {
	return &SessionCookieManager{
		cfg: CookieConfig{
			Domain:   domain,
			Secure:   secure,
			SameSite: http.SameSiteLaxMode,
		},
	}
}

// SetSessionCookie sets a secure, HTTP-only session cookie on the response.
func (m *SessionCookieManager) SetSessionCookie(w http.ResponseWriter, rawToken string, expiresAt time.Time) {
	cookie := &http.Cookie{
		Name:     SessionCookieName,
		Value:    rawToken,
		Path:     "/",
		Domain:   m.cfg.Domain,
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
		HttpOnly: true,
		Secure:   m.cfg.Secure,
		SameSite: m.cfg.SameSite,
	}
	http.SetCookie(w, cookie)
}

// ClearSessionCookie invalidates the session cookie by setting an expired Max-Age.
func (m *SessionCookieManager) ClearSessionCookie(w http.ResponseWriter) {
	cookie := &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		Domain:   m.cfg.Domain,
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   m.cfg.Secure,
		SameSite: m.cfg.SameSite,
	}
	http.SetCookie(w, cookie)
}

// GetSessionToken retrieves the raw session token from the request cookie or Authorization header.
func (m *SessionCookieManager) GetSessionToken(r *http.Request) (string, error) {
	// 1. Check HTTP-only cookie first
	if cookie, err := r.Cookie(SessionCookieName); err == nil && cookie.Value != "" {
		return cookie.Value, nil
	}

	// 2. Fall back to Bearer token in Authorization header
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token != "" {
			return token, nil
		}
	}

	return "", errors.New("no session token found in request")
}

// ValidateCSRFOrigin asserts that state-changing requests originate from the expected frontend domain.
func ValidateCSRFOrigin(r *http.Request, allowedOrigins ...string) error {
	// Safe HTTP methods do not mutate state
	if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
		return nil
	}

	// 1. Inspect Origin header
	origin := r.Header.Get("Origin")
	if origin != "" {
		if isAllowed(origin, allowedOrigins) {
			return nil
		}
		return errors.New("csrf: origin header mismatch")
	}

	// 2. Inspect Referer header
	referer := r.Header.Get("Referer")
	if referer != "" {
		parsed, err := url.Parse(referer)
		if err == nil {
			refererOrigin := parsed.Scheme + "://" + parsed.Host
			if isAllowed(refererOrigin, allowedOrigins) {
				return nil
			}
		}
		return errors.New("csrf: referer header mismatch")
	}

	// If neither header is present on a state-changing POST/PUT request, reject
	return errors.New("csrf: missing origin/referer header on state-changing request")
}

func isAllowed(candidate string, allowed []string) bool {
	for _, a := range allowed {
		if strings.TrimRight(candidate, "/") == strings.TrimRight(a, "/") {
			return true
		}
	}
	return false
}
