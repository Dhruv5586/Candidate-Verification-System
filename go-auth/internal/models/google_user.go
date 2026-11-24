package models

// GoogleUser represents a sanitized and cryptographically verified Google identity profile.
// Security Note: This struct MUST NEVER expose access tokens, refresh tokens, or raw ID tokens.
type GoogleUser struct {
	// GoogleSubjectID is Google's stable, globally unique, immutable identifier for the user.
	GoogleSubjectID string `json:"google_subject_id"`
	Email           string `json:"email"`
	EmailVerified   bool   `json:"email_verified"`
	Name            string `json:"name"`
	Picture         string `json:"picture,omitempty"`
	GivenName       string `json:"given_name,omitempty"`
	FamilyName      string `json:"family_name,omitempty"`
}

// GoogleClaims represents the OIDC claims payload received in the verified ID token.
type GoogleClaims struct {
	Subject       string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Nonce         string `json:"nonce"`
}

// ToGoogleUser converts verified claims into the sanitized GoogleUser model.
func (c *GoogleClaims) ToGoogleUser() *GoogleUser {
	return &GoogleUser{
		GoogleSubjectID: c.Subject,
		Email:           c.Email,
		EmailVerified:   c.EmailVerified,
		Name:            c.Name,
		Picture:         c.Picture,
		GivenName:       c.GivenName,
		FamilyName:      c.FamilyName,
	}
}
