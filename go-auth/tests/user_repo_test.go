package tests

import (
	"context"
	"strings"
	"testing"
	"time"

	"candidate-verification/go-auth/internal/config"
	"candidate-verification/go-auth/internal/database"
	"candidate-verification/go-auth/internal/models"
	"candidate-verification/go-auth/internal/services"
)

// --- Mock UserRepository ---

type mockUserRepository struct {
	users          map[string]*models.User
	userRoles      map[string][]string
	upsertCalled   bool
	assignRoleCall bool
}

func newMockUserRepository() *mockUserRepository {
	return &mockUserRepository{
		users:     make(map[string]*models.User),
		userRoles: make(map[string][]string),
	}
}

func (m *mockUserRepository) FindByGoogleSubjectID(ctx context.Context, subjectID string) (*models.User, error) {
	for _, u := range m.users {
		if u.GoogleSubjectID == subjectID {
			return u, nil
		}
	}
	return nil, nil
}

func (m *mockUserRepository) FindByID(ctx context.Context, id string) (*models.User, error) {
	u, exists := m.users[id]
	if !exists {
		return nil, nil
	}
	return u, nil
}

func (m *mockUserRepository) FindByEmail(ctx context.Context, email string) (*models.User, error) {
	for _, u := range m.users {
		if u.Email == email {
			return u, nil
		}
	}
	return nil, nil
}

func (m *mockUserRepository) UpsertGoogleUser(ctx context.Context, googleUser *models.GoogleUser) (*models.User, error) {
	m.upsertCalled = true
	existing, _ := m.FindByGoogleSubjectID(ctx, googleUser.GoogleSubjectID)
	if existing != nil {
		existing.Email = googleUser.Email
		existing.Name = googleUser.Name
		existing.Picture = googleUser.Picture
		existing.UpdatedAt = time.Now()
		return existing, nil
	}

	newUser := &models.User{
		ID:              "mock-uuid-" + googleUser.GoogleSubjectID,
		GoogleSubjectID: googleUser.GoogleSubjectID,
		Email:           googleUser.Email,
		EmailVerified:   googleUser.EmailVerified,
		Name:            googleUser.Name,
		GivenName:       googleUser.GivenName,
		FamilyName:      googleUser.FamilyName,
		Picture:         googleUser.Picture,
		IsActive:        true,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
		Roles:           m.userRoles["mock-uuid-"+googleUser.GoogleSubjectID],
	}
	m.users[newUser.ID] = newUser
	return newUser, nil
}

func (m *mockUserRepository) GetUserRoles(ctx context.Context, userID string) ([]string, error) {
	return m.userRoles[userID], nil
}

func (m *mockUserRepository) AssignRole(ctx context.Context, userID, roleName string) error {
	m.assignRoleCall = true
	m.userRoles[userID] = append(m.userRoles[userID], roleName)
	return nil
}

// --- Tests ---

func TestUserService_SyncGoogleUser_NewUser(t *testing.T) {
	mockRepo := newMockUserRepository()
	service := services.NewUserService(mockRepo)

	googleUser := &models.GoogleUser{
		GoogleSubjectID: "google-sub-1001",
		Email:           "candidate@example.com",
		EmailVerified:   true,
		Name:            "Alex Mercer",
		GivenName:       "Alex",
		FamilyName:      "Mercer",
		Picture:         "https://example.com/avatar.jpg",
	}

	user, err := service.SyncGoogleUser(context.Background(), googleUser)
	if err != nil {
		t.Fatalf("SyncGoogleUser failed: %v", err)
	}

	if user.GoogleSubjectID != "google-sub-1001" {
		t.Fatalf("Expected subject id 'google-sub-1001', got '%s'", user.GoogleSubjectID)
	}
	if !mockRepo.upsertCalled {
		t.Fatal("Expected UpsertGoogleUser to be called on repository")
	}
	if !mockRepo.assignRoleCall {
		t.Fatal("Expected default role 'recruiter' to be assigned to new user")
	}
	if len(user.Roles) == 0 || user.Roles[0] != "recruiter" {
		t.Fatalf("Expected roles to contain 'recruiter', got %v", user.Roles)
	}
}

func TestUserService_SyncGoogleUser_ExistingUser(t *testing.T) {
	mockRepo := newMockUserRepository()
	// Pre-populate user with admin role
	existingID := "mock-uuid-google-sub-2002"
	mockRepo.users[existingID] = &models.User{
		ID:              existingID,
		GoogleSubjectID: "google-sub-2002",
		Email:           "old-email@example.com",
		Roles:           []string{"admin"},
	}
	mockRepo.userRoles[existingID] = []string{"admin"}

	service := services.NewUserService(mockRepo)

	updatedGoogleUser := &models.GoogleUser{
		GoogleSubjectID: "google-sub-2002",
		Email:           "new-email@example.com",
		Name:            "Admin User",
	}

	user, err := service.SyncGoogleUser(context.Background(), updatedGoogleUser)
	if err != nil {
		t.Fatalf("SyncGoogleUser failed: %v", err)
	}

	if user.Email != "new-email@example.com" {
		t.Fatalf("Expected email to be updated to 'new-email@example.com', got '%s'", user.Email)
	}
	if mockRepo.assignRoleCall {
		t.Fatal("AssignRole should NOT be called for existing user with roles")
	}
}

func TestUserService_SyncGoogleUser_Nil(t *testing.T) {
	mockRepo := newMockUserRepository()
	service := services.NewUserService(mockRepo)

	_, err := service.SyncGoogleUser(context.Background(), nil)
	if err == nil {
		t.Fatal("Expected error when syncing nil google user, got nil")
	}
}

func TestPostgresPool_InvalidConfig(t *testing.T) {
	_, errEmpty := database.NewPostgresPool(context.Background(), "")
	if errEmpty == nil {
		t.Fatal("Expected error on empty database URL, got nil")
	}

	_, errInvalid := database.NewPostgresPool(context.Background(), "not-a-valid-connection-string")
	if errInvalid == nil {
		t.Fatal("Expected error on invalid database connection string, got nil")
	}
}

func TestConfig_DatabaseURL_Masking(t *testing.T) {
	cfg := &config.Config{
		GoogleClientID:     "client-id-123",
		GoogleClientSecret: "verysecretsecret",
		GoogleRedirectURL:  "http://localhost:8080/callback",
		DatabaseURL:        "postgres://postgres:SuperSecretPassword123@localhost:5432/candidate_verification?sslmode=disable",
	}

	logString := cfg.String()

	// Verify that the secret password is NOT in the log string
	if strings.Contains(logString, "SuperSecretPassword123") {
		t.Fatal("SECURITY VIOLATION: Database password was not masked in Config.String()!")
	}

	// Verify that the URL is safely redacted by net/url.Redacted()
	if !strings.Contains(logString, "xxxxx") && !strings.Contains(logString, "redacted") {
		t.Fatalf("Expected redacted representation in Config.String(), got: %s", logString)
	}
}
