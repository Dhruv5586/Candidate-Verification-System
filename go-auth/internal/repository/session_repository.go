package repository

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"candidate-verification/go-auth/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	// ErrSessionNotFound indicates no active session was located for the provided token hash.
	ErrSessionNotFound = errors.New("session not found")

	// ErrSessionRevoked indicates the session has been explicitly terminated.
	ErrSessionRevoked = errors.New("session has been revoked")

	// ErrSessionExpired indicates the session TTL has elapsed.
	ErrSessionExpired = errors.New("session has expired")
)

// GenerateSessionToken produces a 256-bit cryptographically secure URL-safe random string.
func GenerateSessionToken() (string, error) {
	b := make([]byte, 32) // 256 bits of entropy
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate random session token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// HashToken computes a standard lowercase SHA-256 hexadecimal digest of the raw token.
func HashToken(rawToken string) string {
	h := sha256.Sum256([]byte(rawToken))
	return hex.EncodeToString(h[:])
}

// SessionRepository defines persistence operations on user sessions.
type SessionRepository interface {
	CreateSession(ctx context.Context, session *models.Session) error
	FindByTokenHash(ctx context.Context, tokenHash string) (*models.Session, error)
	RevokeSession(ctx context.Context, tokenHash string) error
	RevokeAllUserSessions(ctx context.Context, userID string) error
	UpdateLastAccessed(ctx context.Context, tokenHash string) error
	RotateSessionToken(ctx context.Context, oldTokenHash, newTokenHash string, newExpiresAt time.Time) (*models.Session, error)
	DeleteExpiredSessions(ctx context.Context) (int64, error)
}

// PostgresSessionRepository is the pgxpool-backed implementation of SessionRepository.
type PostgresSessionRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresSessionRepository constructs a new PostgresSessionRepository.
func NewPostgresSessionRepository(pool *pgxpool.Pool) *PostgresSessionRepository {
	return &PostgresSessionRepository{pool: pool}
}

// CreateSession inserts a new session record into the PostgreSQL database.
func (r *PostgresSessionRepository) CreateSession(ctx context.Context, s *models.Session) error {
	if s == nil || s.TokenHash == "" || s.UserID == "" {
		return errors.New("invalid session data: missing user id or token hash")
	}

	query := `
		INSERT INTO sessions (
			user_id, token_hash, ip_address, user_agent, expires_at, is_revoked, created_at, last_accessed_at
		) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
		RETURNING id, created_at, last_accessed_at;
	`

	err := r.pool.QueryRow(
		ctx,
		query,
		s.UserID,
		s.TokenHash,
		s.IPAddress,
		s.UserAgent,
		s.ExpiresAt,
		s.IsRevoked,
	).Scan(&s.ID, &s.CreatedAt, &s.LastAccessedAt)
	if err != nil {
		return fmt.Errorf("failed to insert session: %w", err)
	}

	return nil
}

// FindByTokenHash queries an unrevoked, active session by its SHA-256 hash.
func (r *PostgresSessionRepository) FindByTokenHash(ctx context.Context, tokenHash string) (*models.Session, error) {
	if tokenHash == "" {
		return nil, ErrSessionNotFound
	}

	query := `
		SELECT id, user_id, token_hash, ip_address, user_agent, expires_at, is_revoked, created_at, last_accessed_at, revoked_at
		FROM sessions
		WHERE token_hash = $1;
	`

	var s models.Session
	var ip, ua *string

	err := r.pool.QueryRow(ctx, query, tokenHash).Scan(
		&s.ID,
		&s.UserID,
		&s.TokenHash,
		&ip,
		&ua,
		&s.ExpiresAt,
		&s.IsRevoked,
		&s.CreatedAt,
		&s.LastAccessedAt,
		&s.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, fmt.Errorf("failed to find session: %w", err)
	}

	if ip != nil {
		s.IPAddress = *ip
	}
	if ua != nil {
		s.UserAgent = *ua
	}

	return &s, nil
}

// RevokeSession marks a session as revoked immediately with a timestamp.
func (r *PostgresSessionRepository) RevokeSession(ctx context.Context, tokenHash string) error {
	if tokenHash == "" {
		return ErrSessionNotFound
	}

	query := `
		UPDATE sessions
		SET is_revoked = true, revoked_at = NOW(), last_accessed_at = NOW()
		WHERE token_hash = $1 AND is_revoked = false;
	`

	tag, err := r.pool.Exec(ctx, query, tokenHash)
	if err != nil {
		return fmt.Errorf("failed to revoke session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrSessionNotFound
	}

	return nil
}

// RevokeAllUserSessions revokes every active session for a specific user ID.
func (r *PostgresSessionRepository) RevokeAllUserSessions(ctx context.Context, userID string) error {
	if userID == "" {
		return errors.New("user ID cannot be empty")
	}

	query := `
		UPDATE sessions
		SET is_revoked = true, revoked_at = NOW(), last_accessed_at = NOW()
		WHERE user_id = $1 AND is_revoked = false;
	`

	_, err := r.pool.Exec(ctx, query, userID)
	if err != nil {
		return fmt.Errorf("failed to revoke all sessions for user %s: %w", userID, err)
	}

	return nil
}

// UpdateLastAccessed updates the last_accessed_at timestamp for a session.
func (r *PostgresSessionRepository) UpdateLastAccessed(ctx context.Context, tokenHash string) error {
	query := `
		UPDATE sessions
		SET last_accessed_at = NOW()
		WHERE token_hash = $1 AND is_revoked = false;
	`
	_, err := r.pool.Exec(ctx, query, tokenHash)
	return err
}

// RotateSessionToken atomically invalidates an existing session token and assigns a new token hash.
func (r *PostgresSessionRepository) RotateSessionToken(ctx context.Context, oldTokenHash, newTokenHash string, newExpiresAt time.Time) (*models.Session, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin session rotation transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1. Check existing session with row lock (FOR UPDATE)
	checkQuery := `
		SELECT id, user_id, ip_address, user_agent, expires_at, is_revoked, created_at
		FROM sessions
		WHERE token_hash = $1
		FOR UPDATE;
	`

	var s models.Session
	var ip, ua *string

	err = tx.QueryRow(ctx, checkQuery, oldTokenHash).Scan(
		&s.ID,
		&s.UserID,
		&ip,
		&ua,
		&s.ExpiresAt,
		&s.IsRevoked,
		&s.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, fmt.Errorf("failed to locate session for rotation: %w", err)
	}

	if s.IsRevoked {
		return nil, ErrSessionRevoked
	}
	if time.Now().After(s.ExpiresAt) {
		return nil, ErrSessionExpired
	}

	// 2. Update token hash and new expiration atomically
	updateQuery := `
		UPDATE sessions
		SET token_hash = $1, expires_at = $2, last_accessed_at = NOW()
		WHERE id = $3
		RETURNING last_accessed_at;
	`

	err = tx.QueryRow(ctx, updateQuery, newTokenHash, newExpiresAt, s.ID).Scan(&s.LastAccessedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to rotate session token: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit session rotation: %w", err)
	}

	s.TokenHash = newTokenHash
	s.ExpiresAt = newExpiresAt
	if ip != nil {
		s.IPAddress = *ip
	}
	if ua != nil {
		s.UserAgent = *ua
	}

	return &s, nil
}

// DeleteExpiredSessions purges expired or revoked sessions older than 30 days.
func (r *PostgresSessionRepository) DeleteExpiredSessions(ctx context.Context) (int64, error) {
	query := `
		DELETE FROM sessions
		WHERE expires_at < NOW() - INTERVAL '30 days'
		   OR (is_revoked = true AND revoked_at < NOW() - INTERVAL '30 days');
	`
	tag, err := r.pool.Exec(ctx, query)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
