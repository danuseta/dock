# Database Backup and Restore Procedures

This document outlines the backup and restore procedures for the JIDIS PostgreSQL database.

## Automated Backups
In a production environment, backups should be automated using cron jobs or a managed database service (e.g., AWS RDS automated backups).

### Cron Job Script Example
A daily backup script running on the host server:

```bash
#!/bin/bash
# backup.sh
BACKUP_DIR="/var/backups/jidis_db"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_CONTAINER_NAME="jidis_db_1"
DB_USER="jidis_admin"
DB_NAME="jidis"

mkdir -p "$BACKUP_DIR"
docker exec "$DB_CONTAINER_NAME" pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$BACKUP_DIR/backup_${TIMESTAMP}.dump"

# Keep only the last 7 days of backups
find "$BACKUP_DIR" -type f -name "*.dump" -mtime +7 -delete
```

## Manual Backup
To manually trigger a backup of the running PostgreSQL Docker container:

```bash
docker exec -t <db_container_name> pg_dump -U <db_user> -Fc <db_name> > backup_$(date +%Y-%m-%d).dump
```

## Restore Procedure
**WARNING: Restoring a database will overwrite current data. Always take a fresh backup before restoring an older one.**

1. Ensure the PostgreSQL container is running, but stop application services (`bff`, `data-service`) to prevent writes during restore.
2. Drop and recreate the database (or use `pg_restore --clean`, but dropping is safer).

```bash
# Connect to default postgres DB to drop the target DB
docker exec -it <db_container_name> psql -U <db_user> -d postgres -c "DROP DATABASE <db_name> WITH (FORCE);"
docker exec -it <db_container_name> psql -U <db_user> -d postgres -c "CREATE DATABASE <db_name>;"

# Restore the dump file
docker exec -i <db_container_name> pg_restore -U <db_user> -d <db_name> -1 < /path/to/backup_file.dump
```

## Verification
After restoration, verify the data integrity by:
1. Restarting the backend services.
2. Logging in as an administrator.
3. Checking key dashboard metrics and recent records.
