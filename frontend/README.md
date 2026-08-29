# JIDIS Frontend

Frontend JIDIS adalah aplikasi React/Vite. Electron wrapper berada di workspace
terpisah pada folder `electron`.

## Menjalankan lokal

Dari root project, gunakan `start-dev.ps1` atau `start-dev.sh`. Untuk frontend
saja:

```bash
npm run dev --workspace=frontend
```

URL GraphQL dibaca dari `VITE_GRAPHQL_URL` dan default ke
`http://localhost:4000/graphql`.

## Build

```bash
npm run build --workspace=frontend
npm run preview --workspace=frontend
```

Build Docker memakai `VITE_GRAPHQL_URL` sebagai build argument dan menyajikan
static assets lewat Nginx pada port 80 di dalam container.
