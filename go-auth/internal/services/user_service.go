package services

import (
	"context"
	"errors"

	"candidate-verification/go-auth/internal/models"
	"candidate-verification/go-auth/internal/repository"
)

// UserService handles business logic for user management and post-authentication persistence.
type UserService struct {
	userRepo repository.UserRepository
}

// NewUserService constructs a new UserService.
func NewUserService(userRepo repository.UserRepository) *UserService {
	return &UserService{userRepo: userRepo}
}

// SyncGoogleUser guarantees that after successful Google OAuth authentication:
// 1. Existing user is updated with the latest Google profile details.
// 2. New user is created if they do not yet exist.
// 3. Duplicate Google identities are prevented via the atomic upsert.
// 4. Default role ('recruiter') is assigned to new users if no roles exist.
func (s *UserService) SyncGoogleUser(ctx context.Context, googleUser *models.GoogleUser) (*models.User, error) {
	if googleUser == nil {
		return nil, errors.New("cannot sync nil google user")
	}

	user, err := s.userRepo.UpsertGoogleUser(ctx, googleUser)
	if err != nil {
		return nil, err
	}

	// Assign default role if new user has no roles yet
	if len(user.Roles) == 0 {
		_ = s.userRepo.AssignRole(ctx, user.ID, "recruiter")
		if roles, err := s.userRepo.GetUserRoles(ctx, user.ID); err == nil {
			user.Roles = roles
		}
	}

	return user, nil
}

// GetUserByID fetches a user by primary key.
func (s *UserService) GetUserByID(ctx context.Context, id string) (*models.User, error) {
	return s.userRepo.FindByID(ctx, id)
}
