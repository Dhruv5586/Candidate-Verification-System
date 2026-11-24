package models

import "time"

// Session represents a persistent user session in the PostgreSQL database.
// SECURITY REQUIREMENT: Never store or log raw session bearer tokens.
type Session struct {
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	TokenHash      string     `json:"token_hash"`
	IPAddress      string     `json:"ip_address,omitempty"`
	UserAgent      string     `json:"user_agent,omitempty"`
	ExpiresAt      time.Time  `json:"expires_at"`
	IsRevoked      bool       `json:"is_revoked"`
	CreatedAt      time.Time  `json:"created_at"`
	LastAccessedAt time.Time  `json:"last_accessed_at"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
}

// IsValid checks whether the session is currently active, unrevoked, and unexpired.
func (s *Session) IsValid() bool {
	if s == nil {
		return false
	}
	if s.IsRevoked {
		return false
	}
	return time.Now().Before(s.ExpiresAt)
}
