package database

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Default connection pool parameters
const (
	defaultMaxConns        = 25
	defaultMinConns        = 5
	defaultMaxConnLifetime = 1 * time.Hour
	defaultMaxConnIdleTime = 30 * time.Minute
	defaultHealthCheck     = 1 * time.Minute
	defaultConnectTimeout  = 10 * time.Second
)

// DB wraps *pgxpool.Pool to provide structured logging, health checks, and lifecycle management.
type DB struct {
	Pool *pgxpool.Pool
}

// NewPostgresPool establishes and verifies a connection pool to the PostgreSQL database.
func NewPostgresPool(ctx context.Context, databaseURL string) (*DB, error) {
	if databaseURL == "" {
		return nil, errors.New("database URL cannot be empty")
	}

	// Parse connection configuration
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse postgres database URL: %w", err)
	}

	// Configure pool parameters
	poolConfig.MaxConns = defaultMaxConns
	poolConfig.MinConns = defaultMinConns
	poolConfig.MaxConnLifetime = defaultMaxConnLifetime
	poolConfig.MaxConnIdleTime = defaultMaxConnIdleTime
	poolConfig.HealthCheckPeriod = defaultHealthCheck

	// Create context with connection timeout
	connectCtx, cancel := context.WithTimeout(ctx, defaultConnectTimeout)
	defer cancel()

	// Initialize pool
	pool, err := pgxpool.NewWithConfig(connectCtx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize postgres connection pool: %w", err)
	}

	// Verify connectivity with immediate ping
	if err := pool.Ping(connectCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping postgres database: %w", err)
	}

	log.Printf("[INFO] Successfully connected to PostgreSQL database (max_conns=%d, min_conns=%d)", defaultMaxConns, defaultMinConns)
	return &DB{Pool: pool}, nil
}

// Ping performs a health check query against the database.
func (db *DB) Ping(ctx context.Context) error {
	if db == nil || db.Pool == nil {
		return errors.New("database connection pool is nil")
	}
	return db.Pool.Ping(ctx)
}

// Close gracefully drains and closes all connections in the pool.
func (db *DB) Close() {
	if db != nil && db.Pool != nil {
		log.Println("[INFO] Closing PostgreSQL connection pool...")
		db.Pool.Close()
		log.Println("[INFO] PostgreSQL connection pool closed.")
	}
}
