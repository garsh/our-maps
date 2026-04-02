# Our Maps
Our Maps is an app to create and share sets of location pins with others. It is heavily inspired by (the death of) Google My Maps.

## Android App (Native)

The `android-native/` directory contains a completely independent, native Android application written in Kotlin and Jetpack Compose. It does not use Expo or React Native.

### Setup
1.  Open Android Studio.
2.  Select **Open** and navigate to the `android-native` folder in this repository.
3.  Allow Gradle to sync and download dependencies.

### Features
-   **Native UI**: Built with Jetpack Compose for a modern, performant experience.
-   **Networking**: Uses Retrofit to communicate with the shared backend (configured for `10.0.2.2` for emulator access).
-   **Maps**: Integrated with OSMDroid for OpenStreetMap support.
-   **Pin Editor**: Advanced pin editor with color and icon selectors matching the web app.
-   **Map Management**: Create, import (KML), and delete maps directly from the app.
-   **Offline Support**: View cached maps and download map areas for offline use.
-   **Modern Styling**: Marker symbols and colors aligned with the web application.

### Testing
Unit tests for the ViewModels and Repositories are included. You can run them via Android Studio or the command line:
```bash
./gradlew test
```

## Self-Hosting

You can easily self-host Our Maps using Docker and Docker Compose. This packages both the client and server into a single container and sets up a persistent volume for your SQLite database.

### Prerequisites
- Docker
- Docker Compose

### Running the App
1. From the root of the repository, start the application in detached mode:
   ```bash
   docker compose up -d
   ```
2. For web browsers, access the application securely at `https://localhost` or `https://192.168.4.146` (with your local IP address).
   *(Note: Since it uses a self-signed local certificate via Caddy, your browser will warn you. You can safely bypass this warning for local development.)*
3. For the Android App, keep your Retrofit base URL using plain HTTP on port 3000: `http://192.168.4.146:3000/api/`
4. To view logs:
   ```bash
   docker compose logs -f
   ```
5. To stop the application:
   ```bash
   docker compose down
   ```
   *Note: Your maps and pins are safely stored in the `our_maps_data` Docker volume and will persist across restarts.*