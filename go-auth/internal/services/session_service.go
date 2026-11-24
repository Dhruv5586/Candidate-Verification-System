package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"candidate-verification/go-auth/internal/models"
	"candidate-verification/go-auth/internal/repository"
)

var (
	// ErrInvalidToken indicates the session token is malformed, missing, or inactive.
	ErrInvalidToken = errors.New("invalid or inactive session token")

	// ErrUserInactive indicates the user account linked to the session has been deactivated.
	ErrUserInactive = errors.New("user account is inactive")
)

// SessionService orchestrates session lifecycle, token generation, validation, and rotation.
type SessionService struct {
	sessionRepo repository.SessionRepository
	userRepo    repository.UserRepository
	ttl         time.Duration
}

// NewSessionServiceWithDuration creates a new SessionService with custom time.Duration.
func NewSessionServiceWithDuration(
	sessionRepo repository.SessionRepository,
	userRepo repository.UserRepository,
	ttl time.Duration,
) *SessionService {
	if ttl <= 0 {
		ttl = 30 * time.Minute // Default 30 minutes
	}
	return &SessionService{
		sessionRepo: sessionRepo,
		userRepo:    userRepo,
		ttl:         ttl,
	}
}

// NewSessionService creates a new SessionService with hours (backwards compatibility).
func NewSessionService(
	sessionRepo repository.SessionRepository,
	userRepo repository.UserRepository,
	ttlHours int,
) *SessionService {
	if ttlHours <= 0 {
		return NewSessionServiceWithDuration(sessionRepo, userRepo, 30*time.Minute)
	}
	return NewSessionServiceWithDuration(sessionRepo, userRepo, time.Duration(ttlHours)*time.Hour)
}

// CreateSession generates a secure 256-bit token, hashes it, and persists the session.
// Returns the raw token for client cookie issuance and the saved session record.
func (s *SessionService) CreateSession(ctx context.Context, userID, ipAddress, userAgent string) (string, *models.Session, error) {
	if userID == "" {
		return "", nil, errors.New("user ID is required to create session")
	}

	// 1. Generate 256-bit cryptographically secure token
	rawToken, err := repository.GenerateSessionToken()
	if err != nil {
		return "", nil, err
	}

	// 2. Hash token with SHA-256 (raw token is NEVER stored in database)
	tokenHash := repository.HashToken(rawToken)

	now := time.Now()
	session := &models.Session{
		UserID:    userID,
		TokenHash: tokenHash,
		IPAddress: ipAddress,
		UserAgent: userAgent,
		ExpiresAt: now.Add(s.ttl),
		IsRevoked: false,
	}

	// 3. Persist session record
	if err := s.sessionRepo.CreateSession(ctx, session); err != nil {
		return "", nil, fmt.Errorf("failed to persist session: %w", err)
	}

	return rawToken, session, nil
}

// ValidateSession verifies a raw bearer session token, asserting expiration, revocation, and active user status.
func (s *SessionService) ValidateSession(ctx context.Context, rawToken string) (*models.User, *models.Session, error) {
	if rawToken == "" {
		return nil, nil, ErrInvalidToken
	}

	tokenHash := repository.HashToken(rawToken)

	session, err := s.sessionRepo.FindByTokenHash(ctx, tokenHash)
	if err != nil {
		return nil, nil, ErrInvalidToken
	}

	// Assert session validity
	if !session.IsValid() {
		return nil, nil, ErrInvalidToken
	}

	// Asynchronously update last activity
	go func() {
		updateCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = s.sessionRepo.UpdateLastAccessed(updateCtx, tokenHash)
	}()

	// Load authenticated user profile and roles
	user, err := s.userRepo.FindByID(ctx, session.UserID)
	if err != nil || user == nil {
		return nil, nil, ErrInvalidToken
	}

	if !user.IsActive {
		return nil, nil, ErrUserInactive
	}

	return user, session, nil
}

// RevokeSession terminates a session by its raw bearer token.
func (s *SessionService) RevokeSession(ctx context.Context, rawToken string) error {
	if rawToken == "" {
		return nil
	}
	tokenHash := repository.HashToken(rawToken)
	return s.sessionRepo.RevokeSession(ctx, tokenHash)
}

// RevokeAllUserSessions revokes every active session for a user.
func (s *SessionService) RevokeAllUserSessions(ctx context.Context, userID string) error {
	return s.sessionRepo.RevokeAllUserSessions(ctx, userID)
}

// RefreshSession performs atomic token rotation: the old token is invalidated and a fresh token is issued.
func (s *SessionService) RefreshSession(ctx context.Context, oldRawToken, ipAddress, userAgent string) (string, *models.Session, error) {
	if oldRawToken == "" {
		return "", nil, ErrInvalidToken
	}

	oldTokenHash := repository.HashToken(oldRawToken)

	// 1. Generate new 256-bit token
	newRawToken, err := repository.GenerateSessionToken()
	if err != nil {
		return "", nil, err
	}
	newTokenHash := repository.HashToken(newRawToken)

	newExpiresAt := time.Now().Add(s.ttl)

	// 2. Perform atomic rotation in database
	session, err := s.sessionRepo.RotateSessionToken(ctx, oldTokenHash, newTokenHash, newExpiresAt)
	if err != nil {
		return "", nil, fmt.Errorf("session token rotation failed: %w", err)
	}

	return newRawToken, session, nil
}
