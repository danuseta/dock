# Troubleshooting Guide

Common issues encountered in the production environment and their resolution steps.

## 1. High API Latency or 504 Gateway Timeout
**Symptoms:** The frontend loads slowly, or requests fail with 504 errors.
**Troubleshooting Steps:**
1. Check the BFF logs in the centralized logging system for timeout errors.
2. Check the Database CPU and Memory metrics. A long-running query or missing index is a common cause.
3. Check internal network connectivity between the BFF and the Data Service.
**Resolution:** Scale up the database if overloaded, or identify and optimize the slow query.

## 2. Application Returning 401 Unauthorized Globally
**Symptoms:** All users are suddenly logged out and cannot log back in.
**Troubleshooting Steps:**
1. Verify the Auth Service is running and passing health checks.
2. Check if the JWT Secret Key was accidentally rotated or altered in the secrets manager.
3. Check Redis connectivity (used for token blacklisting/session management).
**Resolution:** Restore the correct JWT secret or restart the Auth service to pick up correct configuration.

## 3. Database Connection Pool Exhaustion
**Symptoms:** Logs show `FATAL: sorry, too many clients already`.
**Troubleshooting Steps:**
1. Verify the number of running application instances. Each instance opens a pool of connections.
2. Check for connection leaks (connections not being closed/returned to the pool in the code).
**Resolution:** Temporarily increase `max_connections` in PostgreSQL. Implement a connection pooler like `PgBouncer` to multiplex connections.

## 4. Disk Space Full on Database Node
**Symptoms:** The database stops accepting writes, throwing disk space errors.
**Troubleshooting Steps:**
1. Check the AWS RDS or Host disk metrics.
2. Check if transaction logs (WAL) are accumulating because the archiving process to S3 is failing.
**Resolution:** Expand the disk volume immediately. Fix the WAL archiving script if broken.
