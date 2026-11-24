package services

import (
	"context"

	"candidate-verification/go-auth/internal/models"
	"github.com/coreos/go-oidc/v3/oidc"
)

// TokenVerifier abstracts ID token verification and claims extraction to facilitate testing.
type TokenVerifier interface {
	VerifyAndExtractClaims(ctx context.Context, rawIDToken string) (*models.GoogleClaims, error)
}

// GoogleOIDCVerifier is the production implementation wrapping *oidc.IDTokenVerifier.
type GoogleOIDCVerifier struct {
	verifier *oidc.IDTokenVerifier
}

// NewGoogleOIDCVerifier creates a new verifier bound to an OIDC provider.
func NewGoogleOIDCVerifier(verifier *oidc.IDTokenVerifier) *GoogleOIDCVerifier {
	return &GoogleOIDCVerifier{verifier: verifier}
}

// VerifyAndExtractClaims cryptographically verifies the raw ID token and unmarshals its claims.
func (v *GoogleOIDCVerifier) VerifyAndExtractClaims(ctx context.Context, rawIDToken string) (*models.GoogleClaims, error) {
	idToken, err := v.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return nil, err
	}

	var claims models.GoogleClaims
	if err := idToken.Claims(&claims); err != nil {
		return nil, err
	}

	return &claims, nil
}
