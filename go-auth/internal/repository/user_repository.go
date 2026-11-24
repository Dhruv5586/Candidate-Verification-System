package repository

import (
	"context"
	"errors"
	"fmt"

	"candidate-verification/go-auth/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	// ErrUserNotFound indicates that no user record matches the query criteria.
	ErrUserNotFound = errors.New("user not found")

	// ErrDuplicateIdentity indicates a conflict on unique constraints.
	ErrDuplicateIdentity = errors.New("duplicate identity: user already exists")
)

// PgxIface abstracts pgxpool.Pool to enable testing and mocking.
type PgxIface interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

// UserRepository defines persistent operations on users and their roles.
type UserRepository interface {
	FindByGoogleSubjectID(ctx context.Context, subjectID string) (*models.User, error)
	FindByID(ctx context.Context, id string) (*models.User, error)
	FindByEmail(ctx context.Context, email string) (*models.User, error)
	UpsertGoogleUser(ctx context.Context, googleUser *models.GoogleUser) (*models.User, error)
	GetUserRoles(ctx context.Context, userID string) ([]string, error)
	AssignRole(ctx context.Context, userID, roleName string) error
}

// PostgresUserRepository is the production implementation backed by pgxpool.
type PostgresUserRepository struct {
	pool PgxIface
}

// NewPostgresUserRepository constructs a new PostgresUserRepository.
func NewPostgresUserRepository(pool *pgxpool.Pool) *PostgresUserRepository {
	return &PostgresUserRepository{pool: pool}
}

// NewUserRepositoryWithIface allows injecting a custom or mock PgxIface for tests.
func NewUserRepositoryWithIface(iface PgxIface) *PostgresUserRepository {
	return &PostgresUserRepository{pool: iface}
}

// FindByGoogleSubjectID retrieves a user by Google's stable subject ID.
func (r *PostgresUserRepository) FindByGoogleSubjectID(ctx context.Context, subjectID string) (*models.User, error) {
	query := `
		SELECT id, google_subject_id, email, email_verified, name, given_name, family_name, picture, is_active, created_at, updated_at
		FROM users
		WHERE google_subject_id = $1;
	`
	user, err := r.scanUser(r.pool.QueryRow(ctx, query, subjectID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to query user by google_subject_id: %w", err)
	}

	roles, err := r.GetUserRoles(ctx, user.ID)
	if err == nil {
		user.Roles = roles
	}
	return user, nil
}

// FindByID retrieves a user by their UUID primary key.
func (r *PostgresUserRepository) FindByID(ctx context.Context, id string) (*models.User, error) {
	query := `
		SELECT id, google_subject_id, email, email_verified, name, given_name, family_name, picture, is_active, created_at, updated_at
		FROM users
		WHERE id = $1;
	`
	user, err := r.scanUser(r.pool.QueryRow(ctx, query, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to query user by id: %w", err)
	}

	roles, err := r.GetUserRoles(ctx, user.ID)
	if err == nil {
		user.Roles = roles
	}
	return user, nil
}

// FindByEmail retrieves a user by email address.
func (r *PostgresUserRepository) FindByEmail(ctx context.Context, email string) (*models.User, error) {
	query := `
		SELECT id, google_subject_id, email, email_verified, name, given_name, family_name, picture, is_active, created_at, updated_at
		FROM users
		WHERE email = $1;
	`
	user, err := r.scanUser(r.pool.QueryRow(ctx, query, email))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to query user by email: %w", err)
	}

	roles, err := r.GetUserRoles(ctx, user.ID)
	if err == nil {
		user.Roles = roles
	}
	return user, nil
}

// UpsertGoogleUser creates a new user or updates profile details for an existing user.
// Uses ON CONFLICT (google_subject_id) to atomically guarantee no duplicate identities.
func (r *PostgresUserRepository) UpsertGoogleUser(ctx context.Context, googleUser *models.GoogleUser) (*models.User, error) {
	if googleUser == nil || googleUser.GoogleSubjectID == "" {
		return nil, errors.New("invalid google user: missing google subject id")
	}

	query := `
		INSERT INTO users (
			google_subject_id, email, email_verified, name, given_name, family_name, picture
		) VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (google_subject_id) DO UPDATE SET
			email = EXCLUDED.email,
			email_verified = EXCLUDED.email_verified,
			name = EXCLUDED.name,
			given_name = EXCLUDED.given_name,
			family_name = EXCLUDED.family_name,
			picture = EXCLUDED.picture,
			updated_at = NOW()
		RETURNING id, google_subject_id, email, email_verified, name, given_name, family_name, picture, is_active, created_at, updated_at;
	`

	user, err := r.scanUser(r.pool.QueryRow(
		ctx,
		query,
		googleUser.GoogleSubjectID,
		googleUser.Email,
		googleUser.EmailVerified,
		googleUser.Name,
		googleUser.GivenName,
		googleUser.FamilyName,
		googleUser.Picture,
	))
	if err != nil {
		return nil, fmt.Errorf("failed to upsert google user: %w", err)
	}

	// Fetch assigned roles
	roles, err := r.GetUserRoles(ctx, user.ID)
	if err == nil {
		user.Roles = roles
	}

	return user, nil
}

// GetUserRoles retrieves role names assigned to a user.
func (r *PostgresUserRepository) GetUserRoles(ctx context.Context, userID string) ([]string, error) {
	query := `
		SELECT r.name
		FROM roles r
		INNER JOIN user_roles ur ON ur.role_id = r.id
		WHERE ur.user_id = $1
		ORDER BY r.name ASC;
	`
	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query user roles: %w", err)
	}
	defer rows.Close()

	var roles []string
	for rows.Next() {
		var roleName string
		if err := rows.Scan(&roleName); err != nil {
			return nil, err
		}
		roles = append(roles, roleName)
	}
	return roles, nil
}

// AssignRole assigns a named role to a user.
func (r *PostgresUserRepository) AssignRole(ctx context.Context, userID, roleName string) error {
	query := `
		INSERT INTO user_roles (user_id, role_id)
		SELECT $1, r.id FROM roles r WHERE r.name = $2
		ON CONFLICT DO NOTHING;
	`
	_, err := r.pool.Exec(ctx, query, userID, roleName)
	if err != nil {
		return fmt.Errorf("failed to assign role '%s' to user %s: %w", roleName, userID, err)
	}
	return nil
}

func (r *PostgresUserRepository) scanUser(row pgx.Row) (*models.User, error) {
	var u models.User
	var givenName, familyName, picture *string

	err := row.Scan(
		&u.ID,
		&u.GoogleSubjectID,
		&u.Email,
		&u.EmailVerified,
		&u.Name,
		&givenName,
		&familyName,
		&picture,
		&u.IsActive,
		&u.CreatedAt,
		&u.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if givenName != nil {
		u.GivenName = *givenName
	}
	if familyName != nil {
		u.FamilyName = *familyName
	}
	if picture != nil {
		u.Picture = *picture
	}

	return &u, nil
}
