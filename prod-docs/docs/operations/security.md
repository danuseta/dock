# Production Security Guidelines

This document establishes the security standards and requirements for the JIDIS production environment.

## 1. Network Security
- **VPC Isolation:** All database and internal microservices must reside in private subnets with no public IP addresses.
- **Firewall/Security Groups:** 
  - API Gateway accepts traffic only on ports `80` (redirect to 443) and `443`.
  - Internal services only accept traffic from the API Gateway on their specific ports.
  - Database only accepts connections from the application tier subnets.
- **WAF:** A Web Application Firewall (WAF) must be configured in front of the API Gateway to block common OWASP Top 10 attacks.

## 2. Access Control
- **Principle of Least Privilege:** IAM roles and database users must only have the permissions necessary to perform their tasks.
- **MFA Required:** All access to cloud provider consoles, VPNs, and production infrastructure requires Multi-Factor Authentication.
- **No Direct DB Access:** Developers do not have direct access to the production database. Queries must be run through an audited internal portal or via an approved Break-Glass procedure.

## 3. Data Protection
- **Encryption at Rest:** All EBS volumes and RDS instances must use KMS encryption.
- **Encryption in Transit:** TLS 1.3 is enforced for all external traffic. Internal service-to-service communication should use mTLS (e.g., via Istio or linkerd).
- **Secrets Management:** Environment variables must never be baked into container images. They must be fetched at runtime from AWS Secrets Manager or HashiCorp Vault.

## 4. Vulnerability Management
- Container images are scanned on push to the registry. Any image with `Critical` or `High` CVEs will fail the deployment pipeline.
- Weekly automated dependency scanning on the `main` branch.
