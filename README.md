# Our Maps
Our Maps is an app to create and share sets of location pins with others. It is heavily inspired by (the death of) Google My Maps.

## Authentication
Our Maps uses Google OAuth on the client and exchanges the Google ID credential for a custom JSON Web Token (JWT) signed by the server. This custom token is valid for 30 days (compared to the 1-hour Google ID token expiration limit), allowing users to stay signed in for a month.

To configure this:
- **`JWT_SECRET`**: You can set this environment variable in the server's `.env` configuration file to sign the custom tokens. If not specified, a default development secret is used.

## Google Maps Search & Geocoding
Our Maps uses Google Maps APIs to search for locations and perform reverse geocoding:
- **[Places API (New)](https://developers.google.com/maps/documentation/places/web-service/text-search)** — Text Search for finding places by name or address
- **[Geocoding API](https://developers.google.com/maps/documentation/geocoding)** — Reverse geocoding for looking up addresses from coordinates

To configure this:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Places API (New)** and **Geocoding API** for your project
3. Create an API key (or reuse an existing one) and restrict it to those APIs
4. Set `GOOGLE_MAPS_API_KEY` in the server's `.env` file

If `GOOGLE_MAPS_API_KEY` is not set, the server falls back to OpenStreetMap (Nominatim API), which has a significantly smaller places database and may not find user-contributed Google Maps places.

## Vector Map Setup (PMTiles)

Our Maps renders map tiles directly from a local Protomaps PMTiles dataset file (`planet.pmtiles`). Because dataset files can be large, they are not committed to git repository history.

To download the PMTiles dataset on a new clone:

- **Full World Dataset (123.5 GB)**:
  ```bash
  npm run setup:maps:full
  ```
- **Lightweight Sample Dataset (~20 MB)**:
  ```bash
  npm run setup:maps
  ```

This downloads `planet.pmtiles` into `./data/maps/planet.pmtiles` and sets up the server links for both local development and Docker containers.

## Self-Hosting

You can easily self-host Our Maps using Docker and Docker Compose. This packages both the client and server into a single container and sets up a persistent volume for your SQLite database.

### Prerequisites
- Docker
- Docker Compose

### Running the App
1. Download the map dataset (see **Vector Map Setup** above).
2. From the root of the repository, start the application in detached mode:
   ```bash
   docker compose up -d
   ```
3. For web browsers, access the application securely at `https://localhost` or `https://47.144.129.56` (with your local IP address).
   *(Note: Since it uses a self-signed local certificate via Caddy, your browser will warn you. You can safely bypass this warning for local development.)*
5. To view logs:
   ```bash
   docker compose logs -f
   ```
6. To stop the application:
   ```bash
   docker compose down
   ```
   *Note: Your maps and pins are safely stored in the `our_maps_data` Docker volume and will persist across restarts.*