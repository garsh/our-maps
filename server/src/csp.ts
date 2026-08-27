/** Helmet CSP directives: allow only hosts the client actually uses. */
export function getCspDirectives() {
  return {
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "script-src": [
      "'self'",
      "blob:",
      "https://accounts.google.com",
      "https://www.gstatic.com",
    ],
    "style-src": [
      "'self'",
      "'unsafe-inline'",
      "https://accounts.google.com",
      "https://fonts.googleapis.com",
    ],
    "font-src": ["'self'", "https://fonts.gstatic.com"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://*.googleusercontent.com",
      "https://www.gstatic.com",
      "https://s3.amazonaws.com",
      "https://server.arcgisonline.com",
    ],
    "connect-src": [
      "'self'",
      "blob:",
      "https://accounts.google.com",
      "https://oauth2.googleapis.com",
      "https://www.googleapis.com",
      "https://people.googleapis.com",
      "https://s3.amazonaws.com",
      "https://server.arcgisonline.com",
      "https://protomaps.github.io",
    ],
    "frame-src": ["'self'", "https://accounts.google.com"],
    "worker-src": ["'self'", "blob:"],
    "child-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };
}
