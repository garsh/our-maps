# Native Android App Plan

This plan outlines the reconstruction of the "Our Maps" mobile client as a native Android application using Kotlin and Jetpack Compose.

## 1. Goals
- **Decoupling**: Remove all dependencies on React Native/Expo.
- **Feature Equality**: Replicate Login, Map List, Map View, Pin viewing/management.
- **Independence**: The app must work with the existing backend but stand alone as a codebase.
- **Testing**: Robust unit testing for data and business logic.

## 2. Tech Stack
- **Language**: Kotlin
- **UI Framework**: Jetpack Compose (Modern, declarative UI)
- **Networking**: Retrofit + OkHttp + Gson (Standard, type-safe API calls)
- **Concurrency**: Coroutines + Flow
- **Maps**: OSMDroid (OpenStreetMap for Android - matches Leaflet's data source and requires no API key for dev)
- **Dependency Injection**: Manual DI (Simple for this scale, avoids complex Dagger/Hilt setup in a text-only generation environment)
- **Architecture**: MVVM (Model - View - ViewModel)

## 3. Architecture

### Layers
1.  **Data Layer**:
    -   `MapApi`: Retrofit interface defining backend endpoints.
    -   `MapRepository`: Repository class to manage data fetching and caching (in-memory).
    -   `Models`: Data classes mirroring `shared/interfaces.ts` (Pin, MapData, User).

2.  **Domain/ViewModel Layer**:
    -   `AuthViewModel`: Handles login (Mock/Google), token storage.
    -   `MapListViewModel`: Fetches list of maps.
    -   `MapDetailViewModel`: Fetches specific map details, manages map state (center, zoom).

3.  **UI Layer (Compose)**:
    -   `App`: Main entry point, Navigation host.
    -   `LoginScreen`: Login UI.
    -   `MapListScreen`: List of user's maps.
    -   `MapDetailScreen`: The interactive map view with BottomSheet.

## 4. Feature Implementation Strategy

### Authentication
- Use `SharedPreferences` (or `DataStore`) to store the `token` and `user` info.
- **Development**: Implement "Mock Login" flow matching the web app (send custom header).
- **Production**: Implement Google Sign-In using the native Android SDK credential manager.
- **Parity**: Ensure users can sign in, sign out, and their session persists.

### Map Visualization & Management
- **View**: Use `OSMDroid` to render maps and markers.
- **Categorization**: Custom `Drawable` markers based on pin color and icon type (e.g., tinting icons).
- **Save**: Implement `POST/PUT` requests in `MapRepository` to save map state (pins, groups).
- **Share**: Implement a dialog to send `POST /maps/{id}/share` requests to grant access to other emails.

### Import/Export (KML)
- **Export**: Generate KML strings locally using a Kotlin KML builder (or manual XML construction) and use Android's `ActivityResultContracts.CreateDocument` to save to the device storage.
- **Import**: Use `ActivityResultContracts.OpenDocument` to select KML/JSON files. Parse them using standard XML/JSON parsers and populate the `MapData` model.

### Networking
- Base URL: `http://10.0.2.2:3001/api/` (Emulator) or `http://<YOUR_PC_IP>:3001/api/` (Physical Device).
- Interceptor to add `Authorization: Bearer <token>` header.

## 5. Testing Plan
- **Unit Tests**: Verify KML parsing logic, Repository data mapping, and ViewModel state transitions.
- **Manual Verification (Physical Device)**:
    1.  Connect phone via USB debugging.
    2.  Update `MapRepository` BASE_URL to your PC's local IP (e.g., `192.168.1.X`).
    3.  Run the backend (`npm run start` in `server/`).
    4.  Install & Run app (`./gradlew installDebug`).
    5.  **Auth**: Log in with Google (or Mock).
    6.  **Maps**: Create a map, add pins, verify they appear.
    7.  **Import**: Transfer a KML file to phone, import it, verify pins appear.
    8.  **Export**: Export map, verify file creation.

## 6. Directory Structure (Simulated)
We will create the files in `android-native/app/src/main/java/com/google/ourmaps/`.

-   `api/`
-   `model/`
-   `repository/`
-   `ui/`
-   `viewmodel/`
