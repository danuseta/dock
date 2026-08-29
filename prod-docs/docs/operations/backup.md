# Production Backup & Restore

This document defines the disaster recovery plan for the JIDIS production database.

## Backup Schedule
- **Full Backups:** Daily at 02:00 AM UTC.
- **Incremental/WAL Backups:** Continuous archiving to secure cloud storage (e.g., AWS S3).
- **Retention Policy:**
  - Daily backups kept for 30 days.
  - Weekly backups kept for 6 months.

## Automated Backup System
We utilize tools like `pgBackRest` or cloud-managed services (AWS RDS snapshots) for automated, reliable backups.

## Restore Procedure (Disaster Recovery)
In the event of catastrophic data loss:

1. **Assess the Damage:** Determine the point-in-time needed for restoration.
2. **Stop Application Traffic:** Bring down the BFF to prevent new data writes.
3. **Provision a New DB Instance:** It is often safer to restore to a fresh database instance rather than overwriting a corrupted one.
4. **Execute Restore:**
   ```bash
   # Example using pgBackRest point-in-time recovery
   pgbackrest --stanza=jidis_db --type=time --target="2026-07-30 10:00:00" restore
   ```
5. **Verify Data:** Connect to the database manually and verify key tables.
6. **Update Credentials:** Update the `DATABASE_URL` in the production secrets manager to point to the new instance.
7. **Resume Traffic:** Start the application services.

## Periodic Testing
Backups must be tested quarterly. An automated script will restore a recent backup to a staging environment and run integrity tests to ensure the backup files are valid and the process works.
