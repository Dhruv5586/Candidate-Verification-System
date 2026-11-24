package tests

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"candidate-verification/go-auth/internal/config"
	"candidate-verification/go-auth/internal/handlers"
	"candidate-verification/go-auth/internal/middleware"
	"candidate-verification/go-auth/internal/models"
	"candidate-verification/go-auth/internal/services"
	"candidate-verification/go-auth/internal/store"

	"golang.org/x/oauth2"
)

// --- Mocks ---

type mockTokenExchanger struct {
	token *oauth2.Token
	err   error
}

func (m *mockTokenExchanger) Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.token, nil
}

func (m *mockTokenExchanger) AuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string {
	u, _ := url.Parse("https://accounts.google.com/o/oauth2/v2/auth")
	q := u.Query()
	q.Set("state", state)
	u.RawQuery = q.Encode()
	return u.String()
}

type mockTokenVerifier struct {
	claims *models.GoogleClaims
	err    error
}

func (m *mockTokenVerifier) VerifyAndExtractClaims(ctx context.Context, rawIDToken string) (*models.GoogleClaims, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.claims, nil
}

// --- Test 1: PKCE S256 Challenge Computation (RFC 7636 Test Vector) ---
func TestPKCES256ChallengeRFC7636(t *testing.T) {
	// RFC 7636 Appendix B test vector
	verifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	expectedChallenge := "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

	actualChallenge := services.ComputeS256Challenge(verifier)
	if actualChallenge != expectedChallenge {
		t.Fatalf("PKCE challenge mismatch: expected %s, got %s", expectedChallenge, actualChallenge)
	}
}

// --- Test 2: Cryptographic Random Generation ---
func TestGenerateRandomString(t *testing.T) {
	str1, err1 := services.GenerateRandomString(32)
	str2, err2 := services.GenerateRandomString(32)

	if err1 != nil || err2 != nil {
		t.Fatalf("Failed to generate random strings: %v, %v", err1, err2)
	}
	if str1 == "" || str2 == "" {
		t.Fatal("Generated random string was empty")
	}
	if str1 == str2 {
		t.Fatal("Colliding random strings: entropy generation failed")
	}
}

// --- Test 3: Transaction Store - Save and Single-Use Consumption ---
func TestTransactionStore_SingleUse(t *testing.T) {
	txStore := store.NewMemoryTransactionStore(10 * time.Minute)
	defer txStore.Close()

	state := "test-state-12345"
	tx := &store.OAuthTransaction{
		State:        state,
		Nonce:        "test-nonce-123",
		PKCEVerifier: "test-verifier-xyz",
		CreatedAt:    time.Now(),
		ExpiresAt:    time.Now().Add(5 * time.Minute),
		Consumed:     false,
	}

	if err := txStore.Save(state, tx); err != nil {
		t.Fatalf("Failed to save transaction: %v", err)
	}

	// First consumption: MUST succeed
	consumedTx, err := txStore.GetAndConsume(state)
	if err != nil {
		t.Fatalf("First consumption failed: %v", err)
	}
	if consumedTx.Nonce != "test-nonce-123" {
		t.Fatalf("Retrieved wrong transaction nonce: got %s", consumedTx.Nonce)
	}

	// Second consumption: MUST fail with replay error
	_, errSecond := txStore.GetAndConsume(state)
	if !errors.Is(errSecond, store.ErrTransactionNotFound) && !errors.Is(errSecond, store.ErrTransactionAlreadyConsumed) {
		t.Fatalf("Replay attack not prevented! Expected ErrTransactionNotFound or AlreadyConsumed, got: %v", errSecond)
	}
}

// --- Test 4: Transaction Store - Expired Transaction Rejection ---
func TestTransactionStore_Expired(t *testing.T) {
	txStore := store.NewMemoryTransactionStore(10 * time.Minute)
	defer txStore.Close()

	state := "expired-state-999"
	tx := &store.OAuthTransaction{
		State:        state,
		Nonce:        "nonce-999",
		PKCEVerifier: "verifier-999",
		CreatedAt:    time.Now().Add(-15 * time.Minute),
		ExpiresAt:    time.Now().Add(-5 * time.Minute), // Already expired
		Consumed:     false,
	}

	_ = txStore.Save(state, tx)

	_, err := txStore.GetAndConsume(state)
	if !errors.Is(err, store.ErrTransactionExpired) {
		t.Fatalf("Expected ErrTransactionExpired, got %v", err)
	}
}

// --- Test 5: Login Endpoint - Redirect and Parameters ---
func TestGoogleAuthHandler_LoginEndpoint(t *testing.T) {
	cfg := &config.Config{
		GoogleClientID:     "mock-client-id",
		GoogleClientSecret: "mock-client-secret",
		GoogleRedirectURL:  "http://localhost:8080/auth/google/callback",
		ServerPort:         "8080",
	}

	txStore := store.NewMemoryTransactionStore(5 * time.Minute)
	defer txStore.Close()

	authService := services.NewGoogleAuthService(cfg, &mockTokenExchanger{}, &mockTokenVerifier{}, txStore)
	handler := handlers.NewGoogleAuthHandler(authService)

	req := httptest.NewRequest(http.MethodGet, "/auth/google/login", nil)
	rr := httptest.NewRecorder()

	handler.HandleLogin(rr, req)

	if rr.Code != http.StatusFound {
		t.Fatalf("Expected status 302 Found, got %d", rr.Code)
	}

	loc := rr.Header().Get("Location")
	if loc == "" {
		t.Fatal("Expected Location header in redirect, got empty")
	}

	parsedURL, err := url.Parse(loc)
	if err != nil {
		t.Fatalf("Failed to parse redirect location: %v", err)
	}

	state := parsedURL.Query().Get("state")
	if state == "" {
		t.Fatal("Missing state query parameter in redirect URL")
	}

	// Verify that state was persisted into the transaction store
	tx, err := txStore.GetAndConsume(state)
	if err != nil {
		t.Fatalf("State was not stored in transaction store: %v", err)
	}
	if tx.Nonce == "" || tx.PKCEVerifier == "" {
		t.Fatal("Stored transaction is missing Nonce or PKCEVerifier")
	}
}

// --- Test 6: Callback - Google OAuth Error Handling ---
func TestGoogleAuthHandler_Callback_GoogleError(t *testing.T) {
	cfg := &config.Config{}
	txStore := store.NewMemoryTransactionStore(5 * time.Minute)
	defer txStore.Close()

	authService := services.NewGoogleAuthService(cfg, &mockTokenExchanger{}, &mockTokenVerifier{}, txStore)
	handler := handlers.NewGoogleAuthHandler(authService)

	req := httptest.NewRequest(http.MethodGet, "/auth/google/callback?error=access_denied&error_description=User+cancelled", nil)
	rr := httptest.NewRecorder()

	handler.HandleCallback(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("Expected status 400 Bad Request, got %d", rr.Code)
	}

	var resp handlers.ErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to parse JSON error response: %v", err)
	}
	if resp.Error != "google_auth_error" {
		t.Fatalf("Expected error code 'google_auth_error', got '%s'", resp.Error)
	}
}

// --- Test 7: Callback - Missing State or Code ---
func TestGoogleAuthHandler_Callback_MissingParams(t *testing.T) {
	cfg := &config.Config{}
	txStore := store.NewMemoryTransactionStore(5 * time.Minute)
	defer txStore.Close()

	authService := services.NewGoogleAuthService(cfg, &mockTokenExchanger{}, &mockTokenVerifier{}, txStore)
	handler := handlers.NewGoogleAuthHandler(authService)

	// Missing code
	req := httptest.NewRequest(http.MethodGet, "/auth/google/callback?state=xyz", nil)
	rr := httptest.NewRecorder()
	handler.HandleCallback(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("Expected status 400 for missing code, got %d", rr.Code)
	}

	// Missing state
	req2 := httptest.NewRequest(http.MethodGet, "/auth/google/callback?code=abc", nil)
	rr2 := httptest.NewRecorder()
	handler.HandleCallback(rr2, req2)
	if rr2.Code != http.StatusBadRequest {
		t.Fatalf("Expected status 400 for missing state, got %d", rr2.Code)
	}
}

// --- Test 8: Callback - Nonce Mismatch Protection ---
func TestGoogleAuthHandler_Callback_NonceMismatch(t *testing.T) {
	cfg := &config.Config{}
	txStore := store.NewMemoryTransactionStore(5 * time.Minute)
	defer txStore.Close()

	state := "valid-state-123"
	correctNonce := "correct-nonce-456"

	_ = txStore.Save(state, &store.OAuthTransaction{
		State:        state,
		Nonce:        correctNonce,
		PKCEVerifier: "verifier-123",
		CreatedAt:    time.Now(),
		ExpiresAt:    time.Now().Add(5 * time.Minute),
	})

	// Mock token exchanger returning mock token
	token := (&oauth2.Token{}).WithExtra(map[string]interface{}{
		"id_token": "mock-raw-id-token",
	})
	mockExchanger := &mockTokenExchanger{token: token}

	// Mock token verifier returning claims with WRONG nonce
	mockVerifier := &mockTokenVerifier{
		claims: &models.GoogleClaims{
			Subject:       "google-sub-987",
			Email:         "user@example.com",
			EmailVerified: true,
			Nonce:         "wrong-nonce-attacker", // ATTACK / MISMATCH
		},
	}

	authService := services.NewGoogleAuthService(cfg, mockExchanger, mockVerifier, txStore)
	handler := handlers.NewGoogleAuthHandler(authService)

	req := httptest.NewRequest(http.MethodGet, "/auth/google/callback?state="+state+"&code=auth-code-123", nil)
	rr := httptest.NewRecorder()

	handler.HandleCallback(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("Expected status 401 Unauthorized on nonce mismatch, got %d", rr.Code)
	}
}

// --- Test 9: Callback - ID Token Verification Failure ---
func TestGoogleAuthHandler_Callback_InvalidIDToken(t *testing.T) {
	cfg := &config.Config{}
	txStore := store.NewMemoryTransactionStore(5 * time.Minute)
	defer txStore.Close()

	state := "state-test-fail"
	_ = txStore.Save(state, &store.OAuthTransaction{
		State:        state,
		Nonce:        "nonce-123",
		PKCEVerifier: "verifier-123",
		CreatedAt:    time.Now(),
		ExpiresAt:    time.Now().Add(5 * time.Minute),
	})

	token := (&oauth2.Token{}).WithExtra(map[string]interface{}{
		"id_token": "tampered-signature-id-token",
	})
	mockExchanger := &mockTokenExchanger{token: token}
	mockVerifier := &mockTokenVerifier{
		err: errors.New("crypto/rsa: verification error: signature invalid"),
	}

	authService := services.NewGoogleAuthService(cfg, mockExchanger, mockVerifier, txStore)
	handler := handlers.NewGoogleAuthHandler(authService)

	req := httptest.NewRequest(http.MethodGet, "/auth/google/callback?state="+state+"&code=auth-code-123", nil)
	rr := httptest.NewRecorder()

	handler.HandleCallback(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("Expected status 401 Unauthorized on invalid ID token signature, got %d", rr.Code)
	}
}

// --- Test 10: Callback - Successful Verification and Identity Extraction ---
func TestGoogleAuthHandler_Callback_SuccessfulVerification(t *testing.T) {
	cfg := &config.Config{}
	txStore := store.NewMemoryTransactionStore(5 * time.Minute)
	defer txStore.Close()

	state := "legitimate-state-001"
	nonce := "legitimate-nonce-001"

	_ = txStore.Save(state, &store.OAuthTransaction{
		State:        state,
		Nonce:        nonce,
		PKCEVerifier: "valid-pkce-verifier",
		CreatedAt:    time.Now(),
		ExpiresAt:    time.Now().Add(5 * time.Minute),
	})

	token := (&oauth2.Token{}).WithExtra(map[string]interface{}{
		"id_token": "valid.signed.google.id.token",
	})
	mockExchanger := &mockTokenExchanger{token: token}
	mockVerifier := &mockTokenVerifier{
		claims: &models.GoogleClaims{
			Subject:       "google-uid-1029384756",
			Email:         "candidate@verified.com",
			EmailVerified: true,
			Name:          "John Doe",
			Picture:       "https://lh3.googleusercontent.com/photo.jpg",
			GivenName:     "John",
			FamilyName:    "Doe",
			Nonce:         nonce,
		},
	}

	authService := services.NewGoogleAuthService(cfg, mockExchanger, mockVerifier, txStore)
	handler := handlers.NewGoogleAuthHandler(authService)

	req := httptest.NewRequest(http.MethodGet, "/auth/google/callback?state="+state+"&code=valid-auth-code", nil)
	rr := httptest.NewRecorder()

	handler.HandleCallback(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("Expected status 200 OK, got %d. Body: %s", rr.Code, rr.Body.String())
	}

	var resp handlers.SuccessAuthResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to decode response JSON: %v", err)
	}

	if !resp.Success {
		t.Fatal("Expected response.success to be true")
	}

	user := resp.User
	if user == nil {
		t.Fatal("Expected user in response, got nil")
	}

	if user.GoogleSubjectID != "google-uid-1029384756" {
		t.Fatalf("Wrong subject ID: got %s", user.GoogleSubjectID)
	}
	if user.Email != "candidate@verified.com" || !user.EmailVerified {
		t.Fatalf("Wrong email details: email=%s, verified=%v", user.Email, user.EmailVerified)
	}
	if user.Name != "John Doe" || user.GivenName != "John" || user.FamilyName != "Doe" {
		t.Fatalf("Wrong profile names: name=%s, given=%s, family=%s", user.Name, user.GivenName, user.FamilyName)
	}

	// Verify that the transaction is now consumed (replay defense)
	_, errSecondUse := txStore.GetAndConsume(state)
	if errSecondUse == nil {
		t.Fatal("Security flaw: transaction was not consumed after successful callback")
	}
}

// --- Test 11: Security Headers Middleware ---
func TestSecurityHeadersMiddleware(t *testing.T) {
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	secured := middleware.SecurityHeaders(dummyHandler)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rr := httptest.NewRecorder()

	secured.ServeHTTP(rr, req)

	expectedHeaders := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "strict-origin-when-cross-origin",
		"Cache-Control":          "no-store, no-cache, must-revalidate, private",
	}

	for header, expectedValue := range expectedHeaders {
		actual := rr.Header().Get(header)
		if actual != expectedValue {
			t.Errorf("Header %s mismatch: expected '%s', got '%s'", header, expectedValue, actual)
		}
	}
}
