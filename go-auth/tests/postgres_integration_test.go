package tests

import (
	"context"
	"testing"
	"time"

	"candidate-verification/go-auth/internal/config"
	"candidate-verification/go-auth/internal/database"
	"candidate-verification/go-auth/internal/models"
	"candidate-verification/go-auth/internal/repository"
	"candidate-verification/go-auth/internal/services"
)

func TestLivePostgres_Integration(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load() returned error: %v", err)
	}
	if cfg.DatabaseURL == "" {
		t.Skip("Skipping live postgres test: DATABASE_URL not set in .env")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// 1. Verify connection pool initialization and ping
	db, err := database.NewPostgresPool(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("Failed to connect to live PostgreSQL: %v", err)
	}
	defer db.Close()

	if err := db.Ping(ctx); err != nil {
		t.Fatalf("PostgreSQL ping failed: %v", err)
	}

	repo := repository.NewPostgresUserRepository(db.Pool)
	userService := services.NewUserService(repo)

	testSubID := "integration-test-google-sub-9999"
	testEmail := "test-candidate-verify@example.com"

	// Clean up any leftover test data
	_, _ = db.Pool.Exec(ctx, "DELETE FROM users WHERE google_subject_id = $1;", testSubID)

	// 2. Test initial user upsert via UserService
	googleUser := &models.GoogleUser{
		GoogleSubjectID: testSubID,
		Email:           testEmail,
		EmailVerified:   true,
		Name:            "Integration Test User",
		GivenName:       "Integration",
		FamilyName:      "User",
		Picture:         "https://example.com/avatar.png",
	}

	createdUser, err := userService.SyncGoogleUser(ctx, googleUser)
	if err != nil {
		t.Fatalf("SyncGoogleUser failed on live DB: %v", err)
	}

	if createdUser.ID == "" {
		t.Fatal("Expected generated UUID for user, got empty string")
	}
	if createdUser.GoogleSubjectID != testSubID {
		t.Fatalf("Subject ID mismatch: expected %s, got %s", testSubID, createdUser.GoogleSubjectID)
	}

	// Verify default role assignment ('recruiter')
	if len(createdUser.Roles) == 0 || createdUser.Roles[0] != "recruiter" {
		t.Fatalf("Expected default role 'recruiter' assigned, got: %v", createdUser.Roles)
	}

	// 3. Test duplicate Google identity prevention (Idempotency)
	updatedGoogleUser := &models.GoogleUser{
		GoogleSubjectID: testSubID,
		Email:           testEmail,
		EmailVerified:   true,
		Name:            "Updated Test User Name",
	}

	updatedUser, err := userService.SyncGoogleUser(ctx, updatedGoogleUser)
	if err != nil {
		t.Fatalf("Second SyncGoogleUser failed: %v", err)
	}

	if updatedUser.ID != createdUser.ID {
		t.Fatalf("CRITICAL: Duplicate identity created! ID changed from %s to %s", createdUser.ID, updatedUser.ID)
	}
	if updatedUser.Name != "Updated Test User Name" {
		t.Fatalf("Expected name updated to 'Updated Test User Name', got: %s", updatedUser.Name)
	}

	// 4. Verify find by Google Subject ID
	foundUser, err := repo.FindByGoogleSubjectID(ctx, testSubID)
	if err != nil || foundUser == nil {
		t.Fatalf("FindByGoogleSubjectID failed: %v", err)
	}
	if foundUser.ID != createdUser.ID {
		t.Fatalf("Found wrong user: expected %s, got %s", createdUser.ID, foundUser.ID)
	}

	// 5. Clean up test record (cascades to user_roles)
	_, err = db.Pool.Exec(ctx, "DELETE FROM users WHERE id = $1;", createdUser.ID)
	if err != nil {
		t.Fatalf("Failed to clean up test user: %v", err)
	}

	t.Log("Live PostgreSQL integration test passed: connection, migrations, roles, upsert, and duplicate prevention verified!")
}
