package services

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"candidate-verification/go-auth/internal/config"
	"candidate-verification/go-auth/internal/models"
	"candidate-verification/go-auth/internal/store"

	"golang.org/x/oauth2"
)

const (
	// TransactionTTL defines the maximum validity period for an OAuth authorization request.
	TransactionTTL = 10 * time.Minute

	// EntropyByteLength defines the byte length of cryptographic random values (256 bits).
	EntropyByteLength = 32
)

// TokenExchanger abstracts code-for-token exchange for testability.
type TokenExchanger interface {
	Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error)
	AuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string
}

// OAuth2ConfigAdapter wraps *oauth2.Config to implement TokenExchanger.
type OAuth2ConfigAdapter struct {
	Config *oauth2.Config
}

func (a *OAuth2ConfigAdapter) Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	return a.Config.Exchange(ctx, code, opts...)
}

func (a *OAuth2ConfigAdapter) AuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string {
	return a.Config.AuthCodeURL(state, opts...)
}

// GoogleAuthService manages the Google OAuth 2.0 and OIDC authentication lifecycle.
type GoogleAuthService struct {
	cfg      *config.Config
	oauth    TokenExchanger
	verifier TokenVerifier
	txStore  store.TransactionStore
}

// NewGoogleAuthService constructs a new GoogleAuthService.
func NewGoogleAuthService(
	cfg *config.Config,
	oauth TokenExchanger,
	verifier TokenVerifier,
	txStore store.TransactionStore,
) *GoogleAuthService {
	return &GoogleAuthService{
		cfg:      cfg,
		oauth:    oauth,
		verifier: verifier,
		txStore:  txStore,
	}
}

// GenerateAuthURL initiates the OAuth login flow by generating cryptographic PKCE parameters,
// state, and nonce, persisting the transaction, and returning the Google consent URL.
func (s *GoogleAuthService) GenerateAuthURL() (string, error) {
	// 1. Generate cryptographic random state
	state, err := GenerateRandomString(EntropyByteLength)
	if err != nil {
		return "", fmt.Errorf("failed to generate secure state: %w", err)
	}

	// 2. Generate cryptographic random nonce for OIDC replay protection
	nonce, err := GenerateRandomString(EntropyByteLength)
	if err != nil {
		return "", fmt.Errorf("failed to generate secure nonce: %w", err)
	}

	// 3. Generate PKCE verifier and challenge (RFC 7636 S256)
	pkceVerifier, err := GenerateRandomString(EntropyByteLength)
	if err != nil {
		return "", fmt.Errorf("failed to generate PKCE verifier: %w", err)
	}
	pkceChallenge := ComputeS256Challenge(pkceVerifier)

	// 4. Save transaction in store
	now := time.Now()
	tx := &store.OAuthTransaction{
		State:        state,
		Nonce:        nonce,
		PKCEVerifier: pkceVerifier,
		CreatedAt:    now,
		ExpiresAt:    now.Add(TransactionTTL),
		Consumed:     false,
	}

	if err := s.txStore.Save(state, tx); err != nil {
		return "", fmt.Errorf("failed to persist oauth transaction: %w", err)
	}

	// 5. Construct Google authorization URL with PKCE and OIDC parameters
	authURL := s.oauth.AuthCodeURL(
		state,
		oauth2.SetAuthURLParam("code_challenge", pkceChallenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
		oauth2.SetAuthURLParam("nonce", nonce),
		oauth2.SetAuthURLParam("prompt", "select_account"),
		oauth2.AccessTypeOffline,
	)

	return authURL, nil
}

// ProcessCallback validates the OAuth callback, exchanges authorization code with PKCE,
// verifies the ID token, asserts nonce match, and returns the sanitized user profile.
func (s *GoogleAuthService) ProcessCallback(ctx context.Context, state, code string) (*models.GoogleUser, error) {
	if state == "" {
		return nil, errors.New("state parameter is required")
	}
	if code == "" {
		return nil, errors.New("authorization code is required")
	}

	// 1. Atomically retrieve, validate expiration, and consume the transaction (single-use)
	tx, err := s.txStore.GetAndConsume(state)
	if err != nil {
		return nil, fmt.Errorf("state validation failed: %w", err)
	}

	// 2. Exchange authorization code with PKCE verifier
	token, err := s.oauth.Exchange(
		ctx,
		code,
		oauth2.SetAuthURLParam("code_verifier", tx.PKCEVerifier),
	)
	if err != nil {
		return nil, fmt.Errorf("token exchange failed: %w", err)
	}

	// 3. Extract raw ID token from response
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		return nil, errors.New("missing or empty id_token in Google OAuth response")
	}

	// 4. Cryptographically verify ID token signature, issuer, audience, and expiration
	claims, err := s.verifier.VerifyAndExtractClaims(ctx, rawIDToken)
	if err != nil {
		return nil, fmt.Errorf("id_token cryptographic verification failed: %w", err)
	}

	// 5. Assert Nonce match to prevent replay and injection attacks
	if claims.Nonce == "" || claims.Nonce != tx.Nonce {
		return nil, errors.New("oidc nonce validation failed: mismatched or missing nonce")
	}

	// 6. Assert Google stable Subject ID presence
	if claims.Subject == "" {
		return nil, errors.New("invalid id_token: missing subject (sub) claim")
	}

	// 7. Convert verified claims to sanitized GoogleUser model (no secrets/tokens exposed)
	user := claims.ToGoogleUser()
	return user, nil
}

// GenerateRandomString generates a URL-safe base64-encoded cryptographic random string.
func GenerateRandomString(byteLength int) (string, error) {
	b := make([]byte, byteLength)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// ComputeS256Challenge computes the S256 PKCE code challenge according to RFC 7636.
// code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))
func ComputeS256Challenge(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}
