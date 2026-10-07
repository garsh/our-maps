# Specification & Implementation Plan: Transit Layer & Appearance Toggle (v3 Consolidated)

## 1. Executive Summary

This document specifies the consolidated architecture and implementation plan for adding transit infrastructure display to Our Maps.

The feature introduces a **Transit** toggle in the sidebar's **Appearance** menu. 
- **When toggled on**: Physical rail transit infrastructure—comprising mainline/regional passenger rail, subway/metro lines, and tram/light rail—is rendered with prominent, high-contrast cartography directly from the server's vector PMTiles extract (`data/maps/planet.pmtiles`). Simultaneously, the faint default basemap rail layer (`roads_rail`) is hidden to avoid overlapping geometry and visual noise.
- **When toggled off (default)**: The custom transit layers are hidden and `roads_rail` remains visible with subtle basemap styling, preserving standard map navigation.

The implementation is 100% offline-ready, requiring no external network requests or third-party transit APIs, and relies on WebGL layout visibility toggles (`map.setLayoutProperty`) for instant, zero-flicker UI updates without rebuilding the map style.

---

## 2. Dataset Capabilities & Schema Realities

Inspection of the server's `data/maps/planet.pmtiles` (Protomaps Basemap v4, derived from OpenStreetMap and Tilezen) establishes the following schema characteristics:

### 2.1 Physical Track Geometry (`roads` vector layer)
- Rail infrastructure lives in the `roads` vector layer where `kind = "rail"`.
- Detailed classifications are stored in `kind_detail`:
  - `rail`, `narrow_gauge`, `light_rail`, `subway`, `tram`, `monorail`, `funicular`, `preserved`, `miniature`, and `disused`.
- Service functions are distinguished by the `service` attribute:
  - `siding`, `crossover`, `yard`, `spur`.
- Track centerlines represent physical rails, not passenger service routes (e.g. named lines or route numbers like Thameslink or NYC Subway lines, which reside in route relations that are not populated in the PMTiles extract). v1 focuses exclusively on physical track classification styling without route labels or line-specific route colors.

### 2.2 Stations & Stops (`pois` vector layer)
- Documented transit stops in Protomaps v4 exist in `pois` with `kind = "station"` and `kind = "bus_stop"`. There are no `railway_station`, `subway_entrance`, or `tram_stop` kinds in the Protomaps v4 schema.
- The `iata` attribute exists solely for aerodromes, not rail stations.
- The existing basemap `pois` layer in `@protomaps/basemaps` already renders `kind = "station"` using sprite `train_station`, multiline localized names (`name:en` / `name`), text halos, and per-feature QRank `min_zoom` (revealing major hubs before minor stations).
- Therefore, stations are already drawn with proper icons and density throttling. A separate station symbol layer is excluded from v1 to prevent duplicate markers, sprite conflicts, and visual clutter.

### 2.3 Aerodromes, Waterways, and Piers
- `aerodrome`, `runway`, `taxiway`, and `pier` are already rendered by the base cartography and remain outside the scope of this toggle.

---

## 3. User Experience & Design Requirements

1. **Appearance Menu Item**:
   - Location: Under the **Appearance** section of the sidebar, immediately after `3D Buildings` and before `Hillshading`.
   - Label: `"Transit"`.
   - Default State: **Off** (`false`).
   - Icon: Lucide `Train` (`size={15}`), styled with `#1d4ed8` when active, `#64748b` when inactive.
   - Switch Color: `#3b82f6` (on) / `#e2e8f0` (off).
   - Switch Knob Position: `left: 18px` (on) / `left: 2px` (off).
   - Tooltip: `DOWNLOAD_OFFLINE_TIP` (*"Available offline via download."*), grouping it with other vector-extract toggles (`Dark Mode`, `3D Buildings`).

2. **Persistence**:
   - Persisted in browser `localStorage` under key `'ourmaps_transit'`.

3. **Map Rendering & Mutual Exclusion**:
   - **Off (Default)**:
     - `roads_rail`: `'visible'` (subtle basemap dash).
     - `transit-rail`, `transit-subway`, `transit-tram`: `'none'`.
   - **On**:
     - `roads_rail`: `'none'` (prevent double-drawing).
     - `transit-rail`, `transit-subway`, `transit-tram`: `'visible'`.

4. **Performance & Responsiveness**:
   - Toggling updates layer visibility via `setLayoutProperty` in 0ms without style rebuilds or canvas flashing.
   - The `mapStyle` `useMemo` dependency array remains `[]` to prevent `react-map-gl` from triggering `setStyle`.

---

## 4. Architecture & Technical Design

```
┌────────────────────────────────────────────────────────┐
│                      client/App.tsx                    │
│  - showTransit state (default: false)                  │
│  - localStorage persistence ('ourmaps_transit')       │
│  - handleToggleTransit callback                        │
└───────────────┬────────────────────────┬───────────────┘
                │                        │
                ▼                        ▼
┌──────────────────────────────┐ ┌───────────────────────────────────────────┐
│   client/Sidebar.tsx         │ │         client/MapView.tsx                │
│ - "Transit" AppearanceRow    │ │ - customLayers (transit-rail, subway, tram)│
│ - Lucide Train icon          │ │ - inserted immediately after roads_rail   │
│ - DOWNLOAD_OFFLINE_TIP       │ │ - themePaintUpdates (light/dark colors)   │
│ - onToggleTransit callback   │ │ - syncTransit effect with styledata guard │
└──────────────────────────────┘ └───────────────────────────────────────────┘
```

### 4.1 Layer Filtering & Ordering in `MapView.tsx`

Three dedicated line layers are added to `customLayers` in `mapStyle`, inserted **immediately after `roads_rail`** so they render beneath road bridges and beneath all text labels:

1. **`transit-rail`** (Mainline / Passenger / Regional rail):
   - Source: `protomaps`, `source-layer: "roads"`.
   - Filter:
     ```ts
     [
       'all',
       ['==', ['get', 'kind'], 'rail'],
       ['in', ['get', 'kind_detail'], ['literal', ['rail', 'narrow_gauge', 'preserved', 'monorail', 'funicular']]],
       ['!', ['in', ['get', 'service'], ['literal', ['siding', 'crossover', 'yard']]]],
     ]
     ```
   - Layout: `visibility: showTransit ? 'visible' : 'none'`, `line-join: 'round'`, `line-cap: 'round'`.
   - Paint: Distinct railroad styling with dash array (`[2, 2]`), line-width interpolated by zoom (e.g. z6: 0.8, z12: 2.0, z16: 3.5), light color `#475569`, dark color `#94a3b8`.

2. **`transit-subway`** (Subway / Metro centerlines):
   - Source: `protomaps`, `source-layer: "roads"`.
   - Filter:
     ```ts
     [
       'all',
       ['==', ['get', 'kind'], 'rail'],
       ['==', ['get', 'kind_detail'], 'subway'],
     ]
     ```
   - Layout: `visibility: showTransit ? 'visible' : 'none'`, `line-join: 'round'`, `line-cap: 'round'`.
   - Paint: Solid vibrant transit line, line-width interpolated by zoom (e.g. z9: 1.2, z13: 2.5, z16: 4.5), light color `#0284c7`, dark color `#38bdf8`.

3. **`transit-tram`** (Tram / Streetcar / Light rail):
   - Source: `protomaps`, `source-layer: "roads"`.
   - Filter:
     ```ts
     [
       'all',
       ['==', ['get', 'kind'], 'rail'],
       ['in', ['get', 'kind_detail'], ['literal', ['tram', 'light_rail']]],
     ]
     ```
   - Layout: `visibility: showTransit ? 'visible' : 'none'`, `line-join: 'round'`, `line-cap: 'round'`.
   - Paint: Solid accent line, line-width interpolated by zoom (e.g. z10: 1.0, z14: 2.0, z16: 3.5), light color `#d97706`, dark color `#fbbf24`.

---

### 4.2 Theme Paint Synchronization (`themePaintUpdates`)

Because `mapStyle` is built once (`[]`), Dark Mode does not rebuild styles. Runtime theme changes execute `applyThemePaintsOnMap`, which queries `themePaintUpdates(layer, flavor)`.

- Layer IDs must **not** begin with `roads_`, preventing the minor-road gray fallback from overriding them.
- Add explicit handlers in `themePaintUpdates`:
  ```ts
  if (id === 'transit-rail') {
    return { 'line-color': dark ? '#94a3b8' : '#475569' };
  }
  if (id === 'transit-subway') {
    return { 'line-color': dark ? '#38bdf8' : '#0284c7' };
  }
  if (id === 'transit-tram') {
    return { 'line-color': dark ? '#fbbf24' : '#d97706' };
  }
  ```

---

### 4.3 Runtime Sync Effect (`syncTransit`)

Use the robust guard pattern established for Satellite and Hillshade in `MapView.tsx`:

```ts
useEffect(() => {
  if (!mapRef.current) return;
  const map = mapRef.current.getMap();
  if (!map) return;

  const syncTransit = () => {
    try {
      if (typeof map.getLayer === 'function' && typeof map.setLayoutProperty === 'function') {
        const transitTarget = showTransit ? 'visible' : 'none';
        const roadsRailTarget = showTransit ? 'none' : 'visible';

        if (map.getLayer('roads_rail')) {
          const current = typeof map.getLayoutProperty === 'function'
            ? map.getLayoutProperty('roads_rail', 'visibility')
            : undefined;
          if (current !== roadsRailTarget) {
            map.setLayoutProperty('roads_rail', 'visibility', roadsRailTarget);
          }
        }

        const transitLayers = ['transit-rail', 'transit-subway', 'transit-tram'];
        for (const layerId of transitLayers) {
          if (map.getLayer(layerId)) {
            const current = typeof map.getLayoutProperty === 'function'
              ? map.getLayoutProperty(layerId, 'visibility')
              : undefined;
            if (current !== transitTarget) {
              map.setLayoutProperty(layerId, 'visibility', transitTarget);
            }
          }
        }
      }
    } catch {}
  };

  if (typeof map.getLayer === 'function' && map.getLayer('transit-rail')) {
    syncTransit();
  } else if (typeof map.once === 'function') {
    map.once('styledata', syncTransit);
  } else {
    syncTransit();
  }
}, [showTransit]);
```

---

## 5. File Modifications Checklist

| File | Change Description |
|---|---|
| `client/src/App.tsx` | - Initialize state: `const [showTransit, setShowTransit] = useState(() => getStoredBoolean('ourmaps_transit', false))`<br>- Define `handleToggleTransit = useCallback((enabled) => { setShowTransit(enabled); setStoredBoolean('ourmaps_transit', enabled); }, [])`<br>- Pass `showTransit` and `onToggleTransit` to `<Sidebar>` and `showTransit` to `<MapView>`. |
| `client/src/components/Sidebar.tsx` | - Add `showTransit?: boolean` and `onToggleTransit?: (enabled: boolean) => void` to `SidebarProps`.<br>- Insert `AppearanceRow` between `3D Buildings` and `Hillshading`.<br>- Use Lucide `Train` icon (`size={15}`), switch color `#3b82f6`/`#e2e8f0`, and `DOWNLOAD_OFFLINE_TIP`. |
| `client/src/components/MapView.tsx` | - Add `showTransit?: boolean` (default `false`) to `MapViewProps`.<br>- Insert `transit-rail`, `transit-subway`, and `transit-tram` layers into `customLayers` right after `roads_rail`.<br>- Set initial `visibility: showTransit ? 'none' : 'visible'` for `roads_rail`, and `visibility: showTransit ? 'visible' : 'none'` for the three transit layers.<br>- Add `transit-rail`, `transit-subway`, and `transit-tram` color definitions to `themePaintUpdates`.<br>- Add `syncTransit` effect with the `styledata` guard. |
| `client/src/components/__tests__/Sidebar.test.tsx` | - Update Appearance rows order test to: `['Dark Mode', '3D Buildings', 'Transit', 'Hillshading', '3D Terrain', 'Satellite']`.<br>- Add test asserting `onToggleTransit` is triggered when clicking the Transit row.<br>- Add test verifying knob position (`left: 18px` when active, `left: 2px` when inactive).<br>- Add test verifying hover/long-press tooltip text is `"Available offline via download."`. |
| `client/src/components/__tests__/MapView.test.tsx` | - Assert mutual exclusion: when `showTransit` is true, `mockSetLayoutProperty` is called with `('roads_rail', 'visibility', 'none')` and `('transit-rail', 'visibility', 'visible')`, etc. When false, the reverse.<br>- Assert `themePaintUpdates` covers the three new transit layer IDs for light and dark flavors. |
| `client/src/__tests__/App.test.tsx` | - Assert initial default render has transit disabled.<br>- Assert localStorage hydration initializes transit state when `'ourmaps_transit'` is `'true'`.<br>- Assert toggle action updates state and writes `'ourmaps_transit'` to localStorage. |

---

## 6. Testing & Quality Assurance Plan

### 6.1 Automated Tests
Once requested by the user:
- Client unit tests: `npm --prefix client run test`
  - Covers `Sidebar.test.tsx` (order, toggle interaction, styling, tooltip).
  - Covers `MapView.test.tsx` (layer mutual exclusion, layout properties, theme paint updates).
  - Covers `App.test.tsx` (persistence and state propagation).

### 6.2 Manual Verification
1. **Appearance Menu Layout**:
   - Open Appearance menu in sidebar.
   - Confirm "Transit" is positioned between "3D Buildings" and "Hillshading".
   - Confirm the Train icon renders cleanly and matches neighboring icons.
   - Hover and long-press to verify tooltip says: *"Available offline via download."*
2. **Dynamic Visibility Toggling**:
   - Navigate to a dense rail area (e.g. New York, London, Chicago, Tokyo).
   - Toggle "Transit" ON:
     - Faint basemap rails disappear.
     - Bold heavy rail tracks, subway centerlines, and tram lines appear instantly with zero flicker or map reload.
   - Toggle "Transit" OFF:
     - Prominent transit lines vanish.
     - Faint basemap rail lines reappear.
3. **Dark Mode Integration**:
   - With Transit toggled ON, toggle Dark Mode ON/OFF.
   - Confirm transit line colors adapt immediately without reloading or reverting to minor street styling.
4. **Offline Mode**:
   - Switch to offline mode using a downloaded PMTiles extract.
   - Confirm Transit toggle functions fully offline.
5. **Persistence**:
   - Toggle Transit ON, refresh browser. Confirm toggle remains ON and transit layers render immediately.
