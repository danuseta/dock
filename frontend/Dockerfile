FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_GRAPHQL_URL=http://localhost:4000/graphql
ENV VITE_GRAPHQL_URL=$VITE_GRAPHQL_URL
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
