package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Config encapsulates runtime configuration for the Go Auth Service.
type Config struct {
	GoogleClientID        string
	GoogleClientSecret    string
	GoogleRedirectURL     string
	GoogleIssuerURL       string
	DatabaseURL           string
	InternalServiceSecret string
	SessionTTLHours       int
	SessionTTLDuration    time.Duration
	CookieDomain          string
	CookieSecure          bool
	ServerPort            string
	FrontendURL           string
	AppEnv                string
}

// Load reads configuration from environment variables and optionally loads a .env file.
func Load() (*Config, error) {
	// Attempt loading .env file from current or parent directories
	_ = godotenv.Load()
	_ = godotenv.Load("../.env")
	_ = godotenv.Load("../../.env")

	sessionTTLMinutes := 30 // Default 30 minutes
	if val := os.Getenv("SESSION_TTL_MINUTES"); val != "" {
		if parsed, err := strconv.Atoi(val); err == nil && parsed > 0 {
			sessionTTLMinutes = parsed
		}
	} else if val := os.Getenv("SESSION_TTL_HOURS"); val != "" {
		if parsed, err := strconv.Atoi(val); err == nil && parsed > 0 {
			sessionTTLMinutes = parsed * 60
		}
	}

	cookieSecure := false
	if val := os.Getenv("COOKIE_SECURE"); val != "" {
		cookieSecure = strings.EqualFold(val, "true") || val == "1"
	} else if os.Getenv("APP_ENV") == "production" {
		cookieSecure = true
	}

	cfg := &Config{
		GoogleClientID:        strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID")),
		GoogleClientSecret:    strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_SECRET")),
		GoogleRedirectURL:     strings.TrimSpace(os.Getenv("GOOGLE_REDIRECT_URL")),
		GoogleIssuerURL:       strings.TrimSpace(os.Getenv("GOOGLE_ISSUER_URL")),
		DatabaseURL:           strings.TrimSpace(os.Getenv("DATABASE_URL")),
		InternalServiceSecret: strings.TrimSpace(os.Getenv("INTERNAL_SERVICE_SECRET")),
		SessionTTLHours:       sessionTTLMinutes / 60,
		SessionTTLDuration:    time.Duration(sessionTTLMinutes) * time.Minute,
		CookieDomain:          strings.TrimSpace(os.Getenv("COOKIE_DOMAIN")),
		CookieSecure:          cookieSecure,
		ServerPort:            strings.TrimSpace(os.Getenv("SERVER_PORT")),
		FrontendURL:           strings.TrimSpace(os.Getenv("FRONTEND_URL")),
		AppEnv:                strings.TrimSpace(os.Getenv("APP_ENV")),
	}

	// Apply default values
	if cfg.GoogleIssuerURL == "" {
		cfg.GoogleIssuerURL = "https://accounts.google.com"
	}
	if cfg.ServerPort == "" {
		cfg.ServerPort = "8080"
	}
	if cfg.FrontendURL == "" {
		cfg.FrontendURL = "http://localhost:3000"
	}
	if cfg.AppEnv == "" {
		cfg.AppEnv = "development"
	}

	// Validate required OAuth variables
	if cfg.GoogleClientID == "" {
		return nil, errors.New("missing required environment variable: GOOGLE_CLIENT_ID")
	}
	if cfg.GoogleClientSecret == "" {
		return nil, errors.New("missing required environment variable: GOOGLE_CLIENT_SECRET")
	}
	if cfg.GoogleRedirectURL == "" {
		return nil, errors.New("missing required environment variable: GOOGLE_REDIRECT_URL")
	}

	return cfg, nil
}

// String implements fmt.Stringer to ensure secrets and database passwords are never leaked when logging configuration.
func (c *Config) String() string {
	maskedSecret := "******"
	if len(c.GoogleClientSecret) > 4 {
		maskedSecret = "..." + c.GoogleClientSecret[len(c.GoogleClientSecret)-4:]
	}

	maskedInternalSecret := "unset"
	if len(c.InternalServiceSecret) > 0 {
		maskedInternalSecret = "******"
	}

	maskedDB := "unset"
	if c.DatabaseURL != "" {
		if parsed, err := url.Parse(c.DatabaseURL); err == nil {
			maskedDB = parsed.Redacted()
		} else {
			maskedDB = "configured (redacted)"
		}
	}

	return fmt.Sprintf(
		"Config[GoogleClientID=%s, GoogleClientSecret=%s, GoogleRedirectURL=%s, GoogleIssuerURL=%s, DatabaseURL=%s, InternalServiceSecret=%s, SessionTTLHours=%d, CookieSecure=%v, ServerPort=%s, FrontendURL=%s, AppEnv=%s]",
		c.GoogleClientID, maskedSecret, c.GoogleRedirectURL, c.GoogleIssuerURL, maskedDB, maskedInternalSecret, c.SessionTTLHours, c.CookieSecure, c.ServerPort, c.FrontendURL, c.AppEnv,
	)
}
