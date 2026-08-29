# Credential Management Security Guidelines

This document outlines the security principles for handling credentials, tokens, and sensitive data within the JIDIS application.

## 1. Local Storage Guidelines (Electron & Web)
- **Do not store sensitive tokens (like JWTs) in `localStorage` or `sessionStorage`.** These are vulnerable to XSS attacks.
- **Web App:** Store authentication tokens in **secure, HttpOnly cookies**. This prevents client-side scripts from accessing the token.
- **Electron App:** Use the operating system's native secure credential store (e.g., Windows Credential Vault, macOS Keychain, Linux Secret Service) via a library like `keytar` or `electron-store` with encryption enabled for persisting user sessions and tokens.
- **In-Memory Storage:** Short-lived tokens or sensitive application states should only be stored in memory and cleared upon logout or application exit.

## 2. Encryption at Rest
- **Database:** All sensitive data at rest in the PostgreSQL database must be encrypted. Use disk-level encryption or cloud provider's managed encryption keys.
- **Specific Fields:** Highly sensitive PII (Personally Identifiable Information) should be encrypted at the application level before being stored in the database using strong encryption algorithms (e.g., AES-256-GCM).
- **Secrets Management:** Database credentials, API keys, and other application secrets must not be hardcoded. They must be injected via environment variables and managed securely (e.g., HashiCorp Vault, AWS Secrets Manager, or standard secure `.env` files protected by strict file permissions in local dev).

## 3. Token Validation (JWT)
- **Signature Verification:** All services must strictly verify the JWT signature using the centralized public key (if using asymmetric keys) or the shared secret.
- **Expiration (`exp`):** Always check the expiration time. Tokens should have a short lifespan (e.g., 15-60 minutes).
- **Issuer and Audience (`iss`, `aud`):** Validate that the token was issued by the trusted Auth Service and is intended for the specific service receiving it.
- **Refresh Tokens:** Implement secure refresh token rotation. Refresh tokens must be stored securely (HttpOnly cookies for web, secure vault for Electron) and securely invalidated upon use or logout.

## 4. Non-Exposure Principles
- **No Secrets in Source Control:** Use `.gitignore` to prevent `.env` files or hardcoded credentials from being committed. Scan repositories with tools like `git-secrets` or `trufflehog`.
- **Error Handling:** Never expose stack traces or raw database errors to the client. Return generic error messages (e.g., "Internal Server Error").
- **Logging:** Ensure that logs do not capture passwords, tokens, API keys, or sensitive PII. Sanitize inputs before logging.
- **Headers:** Ensure secure HTTP headers are in place (e.g., `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`).
