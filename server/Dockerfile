FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# The SQLite database should be stored in a volume mounted at /data
# and we will set DB_PATH to point to it.
ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/database.sqlite

CMD ["npm", "start"]
