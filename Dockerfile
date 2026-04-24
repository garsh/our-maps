# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root and sub-project package files
COPY package.json package-lock.json ./
COPY client/package.json client/package-lock.json ./client/
COPY server/package.json server/package-lock.json ./server/

# Install dependencies across all workspaces
RUN npm ci
RUN cd client && npm ci
RUN cd server && npm ci

# Copy all project files (ignoring node_modules via .dockerignore)
COPY . .

# Build the client app and server
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS runner

WORKDIR /app

# Set node environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/database.sqlite

# Copy only what's needed to run
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/

# Install production dependencies
RUN cd server && npm ci --omit=dev

# Copy over the compiled code from the builder stages
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/server/dist ./server/dist

# Set up the data directory for the SQLite database
RUN mkdir -p /data && chown -R node:node /data

# Expose port 3000 for the app
EXPOSE 3000

# Optionally, you can switch to the node non-root user for security
USER node

# Start up using the root package.json start script
CMD ["npm", "start"]
