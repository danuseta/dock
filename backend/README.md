# JIDIS Backend

Backend JIDIS terdiri dari BFF GraphQL dan service terpisah untuk Jira, GitHub,
Discord, serta storage PostgreSQL/Prisma.

## Prasyarat

- Node.js 18+
- PostgreSQL 15+ atau Docker Compose
- `DATABASE_URL` dan `ENCRYPTION_KEY` di `.env` root

## Menjalankan lokal

Dari root project:

```powershell
Copy-Item .env.example .env
# isi credential Jira/GitHub/Discord dan ENCRYPTION_KEY
.\start-dev.ps1
```

Endpoint utama:

- Frontend: `http://localhost:3000`
- GraphQL BFF: `http://localhost:4000/graphql`

Untuk menjalankan service secara terpisah, gunakan `npm run dev` dari masing-masing
workspace backend. Storage menjalankan `prisma db push` melalui script start lokal.

## Build dan test

```powershell
npm run build:all
npm run test:all
```

Build/test workspace tetap dapat dijalankan langsung dengan
`npm run build --workspace=<workspace>` dan `npm test --workspace=<workspace>`.
