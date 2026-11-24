package middleware

import "net/http"

// SecurityHeaders applies production HTTP security headers to all responses.
func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Prevent MIME-sniffing
		w.Header().Set("X-Content-Type-Options", "nosniff")

		// Prevent clickjacking by disallowing framing
		w.Header().Set("X-Frame-Options", "DENY")

		// Limit referrer data sent to third parties
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

		// Prevent cross-site scripting and unauthorized resource loading
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")

		// Prevent browser and proxy caching of sensitive auth endpoints
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, private")
		w.Header().Set("Pragma", "no-cache")

		next.ServeHTTP(w, r)
	})
}
