package models

import "time"

// User represents the persistent database entity for an authenticated user.
type User struct {
	ID              string    `json:"id"`
	GoogleSubjectID string    `json:"google_subject_id"`
	Email           string    `json:"email"`
	EmailVerified   bool      `json:"email_verified"`
	Name            string    `json:"name"`
	GivenName       string    `json:"given_name,omitempty"`
	FamilyName      string    `json:"family_name,omitempty"`
	Picture         string    `json:"picture,omitempty"`
	IsActive        bool      `json:"is_active"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	Roles           []string  `json:"roles,omitempty"`
}

// Role represents an authorization tier in the system.
type Role struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}
