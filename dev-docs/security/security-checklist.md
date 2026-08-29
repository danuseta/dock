# Security Verification Checklist

This checklist must be followed before any code merge to main/production branches and before any deployment.

## Pre-Merge Checklist
- [ ] **No Hardcoded Secrets**: Ensure no API keys, passwords, or tokens are committed in the code.
- [ ] **Dependencies Audited**: Run `npm audit` or `yarn audit` and resolve all High/Critical vulnerabilities.
- [ ] **Code Review Complete**: Security-sensitive changes (auth, database queries, API routes) must be reviewed by at least one Senior Engineer.
- [ ] **Input Validation**: All incoming API requests and form inputs must be strictly validated and sanitized to prevent SQLi and XSS.
- [ ] **Auth Checks**: Ensure new API routes have proper authentication and authorization middleware applied.
- [ ] **Error Handling**: Verify that errors are caught gracefully and do not leak sensitive backend information to the client.

## Pre-Deployment Checklist
- [ ] **Environment Variables Secured**: Confirm all required secrets are properly set in the production environment (e.g., Vault, CI/CD secret manager) and NOT in plain text.
- [ ] **Database Encryption**: Verify that production database storage is encrypted at rest.
- [ ] **Network Isolation**: Ensure internal microservices (Data, Auth) are not exposed to the public internet, only the BFF/API Gateway.
- [ ] **HTTPS Enforced**: Ensure all traffic is forced over TLS 1.2 or higher. No insecure HTTP connections allowed.
- [ ] **CORS Configured**: Verify that Cross-Origin Resource Sharing (CORS) is restricted to specific trusted domains.
- [ ] **Rate Limiting**: Ensure rate limiters are active on critical endpoints (e.g., login, password reset).
- [ ] **Logging & Monitoring**: Confirm that application logs are being sent to the centralized logging system and alerts are active.

## Periodic Security Audits
- [ ] Perform monthly dependency updates and security patches.
- [ ] Conduct quarterly penetration testing or automated security scanning (e.g., OWASP ZAP).
- [ ] Review access logs for anomalous behavior or unauthorized access attempts.
