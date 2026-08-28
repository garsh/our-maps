# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Root package.json is only needed for `npm run build` / `npm start` scripts.
COPY package.json ./
COPY client/package.json client/package-lock.json ./client/
COPY server/package.json server/package-lock.json ./server/

# Install client (Vite build) and server (tsc) dependencies.
# Root deps (Playwright, concurrently, wait-on) are not used in this image.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN cd client && npm ci --no-audit --no-fund
RUN cd server && npm ci --no-audit --no-fund

# Copy all project files (ignoring node_modules via .dockerignore)
COPY . .

# Build the client app and server
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS runner

WORKDIR /app

# Set node environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/database.sqlite

# Copy only what's needed to run
COPY package.json ./
COPY server/package.json server/package-lock.json ./server/

# Install production dependencies
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN cd server && npm ci --omit=dev --no-audit --no-fund

# Copy over the compiled code and static map assets from the builder stages
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/data/sprites ./data/sprites
COPY --from=builder /app/data/fonts ./data/fonts

# Set up the data, fonts, and maps directories for SQLite and vector tiles
RUN mkdir -p /data /app/data/maps /app/data/sprites /app/data/fonts /app/server/public/maps && chown -R node:node /data /app/data /app/server

# Expose port 3000 for the app
EXPOSE 3000

# Optionally, you can switch to the node non-root user for security
USER node

# Start up using the root package.json start script
CMD ["npm", "start"]
