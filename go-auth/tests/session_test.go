package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"candidate-verification/go-auth/internal/config"
	"candidate-verification/go-auth/internal/handlers"
	"candidate-verification/go-auth/internal/middleware"
	"candidate-verification/go-auth/internal/models"
	"candidate-verification/go-auth/internal/repository"
	"candidate-verification/go-auth/internal/services"
	"candidate-verification/go-auth/internal/store"

	"golang.org/x/oauth2"
)

// --- Mock Session Repository ---

type mockSessionRepository struct {
	mu       sync.Mutex
	sessions map[string]*models.Session
}

func newMockSessionRepository() *mockSessionRepository {
	return &mockSessionRepository{
		sessions: make(map[string]*models.Session),
	}
}

func (m *mockSessionRepository) CreateSession(ctx context.Context, s *models.Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s.ID = "mock-session-" + s.TokenHash[:8]
	s.CreatedAt = time.Now()
	s.LastAccessedAt = time.Now()
	m.sessions[s.TokenHash] = s
	return nil
}

func (m *mockSessionRepository) FindByTokenHash(ctx context.Context, tokenHash string) (*models.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, exists := m.sessions[tokenHash]
	if !exists {
		return nil, repository.ErrSessionNotFound
	}
	return s, nil
}

func (m *mockSessionRepository) RevokeSession(ctx context.Context, tokenHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, exists := m.sessions[tokenHash]
	if !exists {
		return repository.ErrSessionNotFound
	}
	s.IsRevoked = true
	now := time.Now()
	s.RevokedAt = &now
	return nil
}

func (m *mockSessionRepository) RevokeAllUserSessions(ctx context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	for _, s := range m.sessions {
		if s.UserID == userID {
			s.IsRevoked = true
			s.RevokedAt = &now
		}
	}
	return nil
}

func (m *mockSessionRepository) UpdateLastAccessed(ctx context.Context, tokenHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, exists := m.sessions[tokenHash]; exists {
		s.LastAccessedAt = time.Now()
	}
	return nil
}

func (m *mockSessionRepository) RotateSessionToken(ctx context.Context, oldTokenHash, newTokenHash string, newExpiresAt time.Time) (*models.Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	oldSession, exists := m.sessions[oldTokenHash]
	if !exists {
		return nil, repository.ErrSessionNotFound
	}
	if oldSession.IsRevoked {
		return nil, repository.ErrSessionRevoked
	}
	if time.Now().After(oldSession.ExpiresAt) {
		return nil, repository.ErrSessionExpired
	}

	// Invalidate old session token
	delete(m.sessions, oldTokenHash)

	// Create updated session under new token hash
	newSession := &models.Session{
		ID:             oldSession.ID,
		UserID:         oldSession.UserID,
		TokenHash:      newTokenHash,
		IPAddress:      oldSession.IPAddress,
		UserAgent:      oldSession.UserAgent,
		ExpiresAt:      newExpiresAt,
		IsRevoked:      false,
		CreatedAt:      oldSession.CreatedAt,
		LastAccessedAt: time.Now(),
	}
	m.sessions[newTokenHash] = newSession
	return newSession, nil
}

func (m *mockSessionRepository) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	return 0, nil
}

// --- Test 1: Session Token Entropy & Format ---
func TestSessionToken_EntropyAndFormat(t *testing.T) {
	token1, err1 := repository.GenerateSessionToken()
	token2, err2 := repository.GenerateSessionToken()

	if err1 != nil || err2 != nil {
		t.Fatalf("Failed to generate session tokens: %v, %v", err1, err2)
	}
	if len(token1) < 40 || len(token2) < 40 {
		t.Fatalf("Token length too short for 256-bit entropy: len=%d", len(token1))
	}
	if token1 == token2 {
		t.Fatal("Colliding session tokens: random generation failed")
	}
}

// --- Test 2: Token Hashing SHA-256 ---
func TestTokenHashing_SHA256(t *testing.T) {
	rawToken := "sample-session-token-xyz-123456789"
	hash1 := repository.HashToken(rawToken)
	hash2 := repository.HashToken(rawToken)

	if len(hash1) != 64 {
		t.Fatalf("Expected 64-char hexadecimal SHA-256 hash, got %d chars", len(hash1))
	}
	if hash1 != hash2 {
		t.Fatal("SHA-256 hash is not deterministic")
	}
	if strings.Contains(hash1, rawToken) {
		t.Fatal("Hash exposes raw token plaintext")
	}
}

// --- Test 3: Session Creation and Validation ---
func TestSessionService_CreateAndValidate(t *testing.T) {
	mockSessionRepo := newMockSessionRepository()
	mockUserRepo := newMockUserRepository()

	// Prepopulate user
	user := &models.User{
		ID:        "user-uuid-1",
		Email:     "admin@candidateverify.com",
		Name:      "Admin User",
		IsActive:  true,
		Roles:     []string{"admin"},
		CreatedAt: time.Now(),
	}
	mockUserRepo.users[user.ID] = user

	service := services.NewSessionService(mockSessionRepo, mockUserRepo, 24)

	// Create session
	rawToken, session, err := service.CreateSession(context.Background(), user.ID, "127.0.0.1", "Mozilla/5.0")
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}
	if rawToken == "" || session.ID == "" {
		t.Fatal("Session or rawToken is empty")
	}

	// Validate session with raw token
	validatedUser, validatedSession, err := service.ValidateSession(context.Background(), rawToken)
	if err != nil {
		t.Fatalf("ValidateSession failed: %v", err)
	}
	if validatedUser.ID != user.ID {
		t.Fatalf("User ID mismatch: expected %s, got %s", user.ID, validatedUser.ID)
	}
	if validatedSession.ID != session.ID {
		t.Fatalf("Session ID mismatch: expected %s, got %s", session.ID, validatedSession.ID)
	}
}

// --- Test 4: Expired Session Rejection ---
func TestSessionService_ExpiredSession(t *testing.T) {
	mockSessionRepo := newMockSessionRepository()
	mockUserRepo := newMockUserRepository()

	service := services.NewSessionService(mockSessionRepo, mockUserRepo, 24)

	rawToken, err := repository.GenerateSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	tokenHash := repository.HashToken(rawToken)

	// Inject expired session
	mockSessionRepo.sessions[tokenHash] = &models.Session{
		ID:        "session-expired",
		UserID:    "user-1",
		TokenHash: tokenHash,
		ExpiresAt: time.Now().Add(-1 * time.Hour), // Expired 1 hour ago
		IsRevoked: false,
	}

	_, _, errValidate := service.ValidateSession(context.Background(), rawToken)
	if errValidate == nil {
		t.Fatal("Security flaw: expired session was accepted as valid")
	}
}

// --- Test 5: Revoked Session Rejection ---
func TestSessionService_RevokedSession(t *testing.T) {
	mockSessionRepo := newMockSessionRepository()
	mockUserRepo := newMockUserRepository()

	user := &models.User{ID: "user-revoked", IsActive: true}
	mockUserRepo.users[user.ID] = user

	service := services.NewSessionService(mockSessionRepo, mockUserRepo, 24)

	rawToken, _, err := service.CreateSession(context.Background(), user.ID, "127.0.0.1", "Go-Agent")
	if err != nil {
		t.Fatal(err)
	}

	// Revoke session
	if err := service.RevokeSession(context.Background(), rawToken); err != nil {
		t.Fatalf("RevokeSession failed: %v", err)
	}

	// Assert rejected after revocation
	_, _, errValidate := service.ValidateSession(context.Background(), rawToken)
	if errValidate == nil {
		t.Fatal("Security flaw: revoked session was accepted as valid")
	}
}

// --- Test 6: Token Rotation and Invalidation of Old Token ---
func TestSessionService_TokenRotation(t *testing.T) {
	mockSessionRepo := newMockSessionRepository()
	mockUserRepo := newMockUserRepository()

	user := &models.User{ID: "user-rotation", IsActive: true}
	mockUserRepo.users[user.ID] = user

	service := services.NewSessionService(mockSessionRepo, mockUserRepo, 24)

	oldToken, _, err := service.CreateSession(context.Background(), user.ID, "127.0.0.1", "Browser")
	if err != nil {
		t.Fatal(err)
	}

	// Rotate token
	newToken, _, err := service.RefreshSession(context.Background(), oldToken, "127.0.0.1", "Browser")
	if err != nil {
		t.Fatalf("RefreshSession failed: %v", err)
	}
	if newToken == oldToken {
		t.Fatal("Token rotation returned identical token")
	}

	// Old token MUST now be invalid
	_, _, errOld := service.ValidateSession(context.Background(), oldToken)
	if errOld == nil {
		t.Fatal("Security flaw: old token remains valid after rotation")
	}

	// New token MUST be valid
	validatedUser, _, errNew := service.ValidateSession(context.Background(), newToken)
	if errNew != nil {
		t.Fatalf("New rotated token failed validation: %v", errNew)
	}
	if validatedUser.ID != user.ID {
		t.Fatal("User ID mismatch on rotated token")
	}
}

// --- Test 7: Concurrent Refresh Defense (Single-Use Old Token) ---
func TestSessionService_ConcurrentRefresh(t *testing.T) {
	mockSessionRepo := newMockSessionRepository()
	mockUserRepo := newMockUserRepository()

	user := &models.User{ID: "user-race", IsActive: true}
	mockUserRepo.users[user.ID] = user

	service := services.NewSessionService(mockSessionRepo, mockUserRepo, 24)

	rawToken, _, _ := service.CreateSession(context.Background(), user.ID, "127.0.0.1", "Test")

	// First refresh: Succeeded
	_, _, err1 := service.RefreshSession(context.Background(), rawToken, "127.0.0.1", "Test")
	if err1 != nil {
		t.Fatalf("First refresh failed: %v", err1)
	}

	// Second concurrent attempt with same old token: MUST fail
	_, _, err2 := service.RefreshSession(context.Background(), rawToken, "127.0.0.1", "Test")
	if err2 == nil {
		t.Fatal("Security flaw: replayed old token accepted during concurrent refresh attempt")
	}
}

// --- Test 8: Cookie Manager Attributes ---
func TestCookieManager_Attributes(t *testing.T) {
	manager := middleware.NewSessionCookieManager("localhost", true)

	rr := httptest.NewRecorder()
	expiresAt := time.Now().Add(24 * time.Hour)
	manager.SetSessionCookie(rr, "test-raw-bearer-token", expiresAt)

	cookie := rr.Result().Cookies()[0]
	if cookie.Name != middleware.SessionCookieName {
		t.Fatalf("Expected cookie name %s, got %s", middleware.SessionCookieName, cookie.Name)
	}
	if !cookie.HttpOnly {
		t.Fatal("Security flaw: HttpOnly is not true")
	}
	if !cookie.Secure {
		t.Fatal("Security flaw: Secure is not true")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Fatal("Security flaw: SameSite is not Lax")
	}
	if cookie.Path != "/" {
		t.Fatalf("Expected path '/', got '%s'", cookie.Path)
	}

	// Clear cookie test
	rrClear := httptest.NewRecorder()
	manager.ClearSessionCookie(rrClear)
	clearedCookie := rrClear.Result().Cookies()[0]
	if clearedCookie.MaxAge != -1 || clearedCookie.Value != "" {
		t.Fatal("ClearSessionCookie did not invalidate cookie")
	}
}

// --- Test 9: Internal Session Validation Endpoint (/internal/session/validate) ---
func TestInternalHandler_ValidateEndpoint(t *testing.T) {
	mockSessionRepo := newMockSessionRepository()
	mockUserRepo := newMockUserRepository()

	user := &models.User{
		ID:       "internal-user-123",
		Email:    "reviewer@verify.com",
		Name:     "Lead Reviewer",
		Roles:    []string{"reviewer"},
		IsActive: true,
	}
	mockUserRepo.users[user.ID] = user

	sessionService := services.NewSessionService(mockSessionRepo, mockUserRepo, 24)
	internalSecret := "super-secure-internal-secret-for-tests-12345"
	internalHandler := handlers.NewInternalHandler(sessionService, internalSecret)

	rawToken, _, _ := sessionService.CreateSession(context.Background(), user.ID, "127.0.0.1", "Agent")

	// Case A: Missing or wrong secret -> 401 Unauthorized
	reqUnauthorized := httptest.NewRequest(http.MethodPost, "/internal/session/validate", bytes.NewBufferString(`{"session_token":"`+rawToken+`"}`))
	reqUnauthorized.Header.Set("X-Internal-Secret", "wrong-secret")
	rrUnauthorized := httptest.NewRecorder()
	internalHandler.HandleValidateSession(rrUnauthorized, reqUnauthorized)

	if rrUnauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("Expected 401 Unauthorized for wrong internal secret, got %d", rrUnauthorized.Code)
	}

	// Case B: Authorized request with valid session -> 200 OK with minimal user profile
	reqAuthorized := httptest.NewRequest(http.MethodPost, "/internal/session/validate", bytes.NewBufferString(`{"session_token":"`+rawToken+`"}`))
	reqAuthorized.Header.Set("X-Internal-Secret", internalSecret)
	rrAuthorized := httptest.NewRecorder()
	internalHandler.HandleValidateSession(rrAuthorized, reqAuthorized)

	if rrAuthorized.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK for valid internal validation, got %d", rrAuthorized.Code)
	}

	var resp handlers.ValidateResponse
	if err := json.Unmarshal(rrAuthorized.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to decode response JSON: %v", err)
	}
	if !resp.Valid || resp.UserID != user.ID || resp.Email != user.Email {
		t.Fatalf("Invalid response fields: valid=%v, user_id=%s", resp.Valid, resp.UserID)
	}
	if len(resp.Roles) == 0 || resp.Roles[0] != "reviewer" {
		t.Fatalf("Roles not properly returned: %v", resp.Roles)
	}
}

// --- Test 10: Google OAuth Login Flow Creating Persistent Session ---
func TestGoogleAuthHandler_WithSessionIntegration(t *testing.T) {
	cfg := &config.Config{
		GoogleClientID:     "mock-client-id",
		GoogleClientSecret: "mock-client-secret",
		GoogleRedirectURL:  "http://localhost:8080/auth/google/callback",
		FrontendURL:        "http://localhost:3000/dashboard",
	}

	txStore := &mockTxStore{
		tx: &store.OAuthTransaction{
			State:        "state-session-flow",
			Nonce:        "nonce-session-flow",
			PKCEVerifier: "verifier-xyz",
			ExpiresAt:    time.Now().Add(5 * time.Minute),
		},
	}

	mockToken := (&oauth2.Token{}).WithExtra(map[string]interface{}{
		"id_token": "mock.jwt.id_token",
	})
	mockExchanger := &mockTokenExchanger{token: mockToken}

	// Set up dependencies
	mockUserRepo := newMockUserRepository()
	mockSessionRepo := newMockSessionRepository()
	userService := services.NewUserService(mockUserRepo)
	sessionService := services.NewSessionService(mockSessionRepo, mockUserRepo, 24)
	cookieManager := middleware.NewSessionCookieManager("localhost", false)

	authService := services.NewGoogleAuthService(
		cfg,
		mockExchanger,
		&mockTokenVerifier{
			claims: &models.GoogleClaims{
				Subject:       "google-sub-777",
				Email:         "candidate777@verify.com",
				EmailVerified: true,
				Name:          "Lucky Candidate",
				Nonce:         "nonce-session-flow",
			},
		},
		txStore,
	)

	handler := handlers.NewGoogleAuthHandler(authService)
	handler.WithSessionIntegration(userService, sessionService, cookieManager, cfg.FrontendURL)

	req := httptest.NewRequest(http.MethodGet, "/auth/google/callback?state=state-session-flow&code=code-123", nil)
	rr := httptest.NewRecorder()

	handler.HandleCallback(rr, req)

	// MUST issue HTTP 302 redirect to FrontendURL
	if rr.Code != http.StatusFound {
		t.Fatalf("Expected 302 Found redirect, got %d. Body: %s", rr.Code, rr.Body.String())
	}
	if loc := rr.Header().Get("Location"); loc != cfg.FrontendURL {
		t.Fatalf("Redirect location mismatch: expected %s, got %s", cfg.FrontendURL, loc)
	}

	// MUST set secure session cookie
	cookies := rr.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Name != middleware.SessionCookieName {
		t.Fatal("Session cookie was not set on Google OAuth callback redirect")
	}

	// Verify user and session were created in repositories
	user, err := mockUserRepo.FindByGoogleSubjectID(context.Background(), "google-sub-777")
	if err != nil || user == nil {
		t.Fatal("User was not saved into repository during OAuth callback")
	}
	if len(mockSessionRepo.sessions) != 1 {
		t.Fatalf("Expected 1 session created, got %d", len(mockSessionRepo.sessions))
	}
}

// Mock transaction store for test 10
type mockTxStore struct {
	tx *store.OAuthTransaction
}

func (m *mockTxStore) Save(state string, tx *store.OAuthTransaction) error {
	m.tx = tx
	return nil
}

func (m *mockTxStore) GetAndConsume(state string) (*store.OAuthTransaction, error) {
	if m.tx == nil {
		return nil, store.ErrTransactionNotFound
	}
	tx := m.tx
	m.tx = nil
	return tx, nil
}

func (m *mockTxStore) Close() {}
