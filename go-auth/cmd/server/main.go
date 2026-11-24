package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"candidate-verification/go-auth/internal/config"
	"candidate-verification/go-auth/internal/database"
	"candidate-verification/go-auth/internal/handlers"
	"candidate-verification/go-auth/internal/middleware"
	"candidate-verification/go-auth/internal/repository"
	"candidate-verification/go-auth/internal/services"
	"candidate-verification/go-auth/internal/store"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

func main() {
	log.Println("[INFO] Starting Candidate Verification System - Go Auth & Session Service (Phase 4)...")

	// 1. Load configuration from environment / .env
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[FATAL] Configuration error: %v", err)
	}
	log.Printf("[INFO] Configuration loaded successfully: %s", cfg.String())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 2. Discover Google OpenID Connect provider configuration
	log.Printf("[INFO] Initializing OIDC provider from issuer: %s", cfg.GoogleIssuerURL)
	provider, err := oidc.NewProvider(ctx, cfg.GoogleIssuerURL)
	if err != nil {
		log.Fatalf("[FATAL] Failed to discover OIDC provider from '%s': %v (ensure network connectivity and valid issuer)", cfg.GoogleIssuerURL, err)
	}

	// 3. Configure cryptographic ID Token Verifier
	oidcVerifier := provider.Verifier(&oidc.Config{
		ClientID: cfg.GoogleClientID,
	})
	tokenVerifier := services.NewGoogleOIDCVerifier(oidcVerifier)

	// 4. Configure Google OAuth 2.0 Client
	oauth2Config := &oauth2.Config{
		ClientID:     cfg.GoogleClientID,
		ClientSecret: cfg.GoogleClientSecret,
		RedirectURL:  cfg.GoogleRedirectURL,
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}

	// 5. Initialize in-memory transaction store for OAuth handshakes
	txStore := store.NewMemoryTransactionStore(1 * time.Minute)
	defer txStore.Close()

	// 6. Connect to PostgreSQL database pool
	var db *database.DB
	if cfg.DatabaseURL != "" {
		log.Printf("[INFO] Initializing PostgreSQL connection pool...")
		db, err = database.NewPostgresPool(ctx, cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("[FATAL] PostgreSQL connection failure: %v", err)
		}
		defer db.Close()
	} else {
		log.Println("[WARN] DATABASE_URL is not set; persistent sessions will be unavailable")
	}

	// 7. Initialize repositories & services
	oauthAdapter := &services.OAuth2ConfigAdapter{Config: oauth2Config}
	googleAuthService := services.NewGoogleAuthService(cfg, oauthAdapter, tokenVerifier, txStore)
	googleAuthHandler := handlers.NewGoogleAuthHandler(googleAuthService)

	cookieManager := middleware.NewSessionCookieManager(cfg.CookieDomain, cfg.CookieSecure)

	var authHandler *handlers.AuthHandler
	var internalHandler *handlers.InternalHandler

	if db != nil {
		userRepo := repository.NewPostgresUserRepository(db.Pool)
		sessionRepo := repository.NewPostgresSessionRepository(db.Pool)

		userService := services.NewUserService(userRepo)
		sessionService := services.NewSessionServiceWithDuration(sessionRepo, userRepo, cfg.SessionTTLDuration)

		// Attach persistent session management to Google OAuth flow
		googleAuthHandler.WithSessionIntegration(userService, sessionService, cookieManager, cfg.FrontendURL)

		authHandler = handlers.NewAuthHandler(sessionService, cookieManager, cfg.FrontendURL)
		internalHandler = handlers.NewInternalHandler(sessionService, cfg.InternalServiceSecret)
	}

	// 8. Register HTTP routes
	mux := http.NewServeMux()

	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		status := "healthy"
		dbStatus := "connected"
		if db != nil {
			if err := db.Ping(r.Context()); err != nil {
				dbStatus = "unreachable"
				status = "degraded"
			}
		} else {
			dbStatus = "not_configured"
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":   status,
			"service":  "go-auth",
			"database": dbStatus,
			"phase":    "4-persistent-sessions",
		})
	})

	// Google OAuth 2.0 endpoints
	mux.HandleFunc("/auth/google/login", googleAuthHandler.HandleLogin)
	mux.HandleFunc("/auth/google/callback", googleAuthHandler.HandleCallback)

	// Session Management endpoints
	if authHandler != nil {
		mux.HandleFunc("/auth/me", authHandler.HandleMe)
		mux.HandleFunc("/auth/logout", authHandler.HandleLogout)
		mux.HandleFunc("/auth/refresh", authHandler.HandleRefresh)
	}

	// Internal Service-to-Service validation bridge (for Node.js API)
	if internalHandler != nil {
		mux.HandleFunc("/internal/session/validate", internalHandler.HandleValidateSession)
	}

	// 9. Wrap router with security headers middleware
	securedHandler := middleware.SecurityHeaders(mux)

	// 10. Configure HTTP server with production timeouts
	serverAddr := fmt.Sprintf(":%s", cfg.ServerPort)
	server := &http.Server{
		Addr:              serverAddr,
		Handler:           securedHandler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Graceful shutdown handling
	shutdownDone := make(chan struct{})
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
		sig := <-sigChan
		log.Printf("[INFO] Received signal %v, initiating graceful shutdown...", sig)

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("[ERROR] Server forced to shutdown: %v", err)
		}
		close(shutdownDone)
	}()

	log.Printf("[INFO] Go Auth & Session Service listening on port %s (http://localhost:%s)", cfg.ServerPort, cfg.ServerPort)
	log.Printf("[INFO] Google Login: http://localhost:%s/auth/google/login", cfg.ServerPort)
	log.Printf("[INFO] Active Session Profile: http://localhost:%s/auth/me", cfg.ServerPort)
	log.Printf("[INFO] Internal Validation Endpoint: http://localhost:%s/internal/session/validate", cfg.ServerPort)

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[FATAL] HTTP server failure: %v", err)
	}

	<-shutdownDone
	log.Println("[INFO] Go Auth & Session Service shut down cleanly.")
}
