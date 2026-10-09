# Transit line colors in the planet build

## 1. The change

Transit v1 paints physical track by class: slate for rail, blue for subway, amber for tram and light rail. See `TRANSIT.md`. Those three layers stay.

This change draws each passenger line in its own color on top of that track. The 1 train and the A train share track in places and must still paint as two colors. The color is the line's published color from OpenStreetMap when a mapper has set one. A line with no published color gets a stable color from its identity, so it stays the same color across tiles and rebuilds.

The attributes live on OSM route relations, which the planet build already reads and then discards. They go into the same `planet.pmtiles` archive, in the `transit` source-layer. OurMaps keeps a single archive, and a regional offline extract copies the new layer with the rest of the bounding box. There is no companion tileset and no live transit API.

The map change that consumes the layer is in section 8. It waits on a planet file that contains the layer. Until then the class colors from v1 remain the whole transit display.

## 2. Why the current archive cannot do this

`data/maps/planet.pmtiles` is a Protomaps Basemap v4 archive. Its vector layers are `boundaries`, `buildings`, `earth`, `landcover`, `landuse`, `places`, `pois`, `roads`, and `water`. Rail track is in `roads` with `kind=rail`. The documented `transit` layer is absent because the profile's `Transit.processOsm` is empty, and empty layers are omitted from the archive.

A rail way in that layer carries `kind_detail`, and often a way `name`, `ref`, and `network`. Those describe the corridor or the track, not the service:

- A Times Square subway way is named `IND Queens Boulevard Line` or `IRT 42nd Street Line`. Several services share each corridor. Subway `ref` is empty there.
- The Chicago Loop way is named `Loop 'L'`, which carries Brown, Pink, Orange, and Green.
- London tube ways are often the real line, and also split by direction (`Victoria Line Northbound`). National Rail `ref` values there are engineering codes.
- Paris Métro 11 is named and numbered on the way. Adjacent mainline ways are `Voie 1` and `Voie 2`.
- A way has one value per key. Shared track can only have one of those names.

`colour` is not among the `roads` fields. The profile's relation preprocessor keeps `type=route` relations only when `route=road`, and it keeps them for highway shields.

## 3. Where the attributes are in OpenStreetMap

A passenger line is a relation:

- `type=route`
- `route` is one of `subway`, `light_rail`, `tram`, `monorail`, `funicular`

Tags on that relation:

| Tag | Use |
| --- | --- |
| `colour` | Published line color. The key is spelled the British way. |
| `color` | American spelling of the same tag. Accept it when `colour` is absent. |
| `ref` | Public identifier: `1`, `A`, `U8`, `Victoria`. |
| `name` | Line name. |
| `network` | System name, such as `London Underground`. |
| `operator` | Operating company. Copied for inspection. The style does not key off it. |

The parent relation is `type=route_master` with `route_master` set to the same vehicle type. It carries the same tags. Mappers sometimes set `colour` only on the master. Each direction is usually its own route relation, and both are members of one master.

Track geometry is the way members. Their role is empty. Members with role `stop`, `stop_entry_only`, `stop_exit_only`, `platform`, `platform_entry_only`, or `platform_exit_only` are stops, not line geometry.

As of the 2026-10-08 taginfo snapshot: about 2,600 `route=subway` relations, 5,100 `route=tram`, 1,100 `route=light_rail`, 230 `route=monorail`, and 18,400 `route=train`. Train and bus relations are out of this change. Train routes stack many services on one corridor. Bus routes are a different map.

A railway way sometimes has its own `colour` or `color`. That is a fallback for track that belongs to none of the route relations above. It still cannot split two lines on one way.

## 4. Tile schema

Add features to the existing `transit` source-layer. Leave `roads` as the profile already writes it, including whatever zoom change is in progress for physical track.

One linestring per route relation per member way. A way in four route relations produces four features, with the same geometry and different `ref` and `colour`. Both directions of one line produce two features. They share `network`, `ref`, and `colour`, and section 6 gives them the same `slot`, so they draw as one stroke.

Attributes:

| Attribute | Type | Rule |
| --- | --- | --- |
| `route` | string | `subway`, `light_rail`, `tram`, `monorail`, or `funicular`. |
| `ref` | string | From the route relation. From the route master when the route's `ref` is empty. Omit when both are empty. |
| `name` | string | Same fallback order as `ref`. This is the route name, not the way name. |
| `network` | string | Same fallback order. |
| `operator` | string | From the route relation, then the master. Omit when empty. |
| `colour` | string | Normalized published color. Omit when neither the route nor the master has a usable color. |
| `colour_fallback` | string | Always set. A palette color from section 5. |
| `way_id` | string | Decimal OSM way id. Used to assign `slot`. A string avoids a 32-bit integer overflow as way ids pass 2^31. |
| `slot` | int | 0-based index among distinct lines on this way. Assigned in post-process. |
| `is_tunnel` | boolean | True when the way has `tunnel` other than `no`. Omit otherwise. |
| `is_bridge` | boolean | True when the way has `bridge` other than `no`. Omit otherwise. |

Do not copy the way's `name`, `ref`, or `network` onto these features. Those are the corridor fields section 2 rejects.

Feature ids must differ for each copy of a way. `FeatureId.create(sf)` is the way id alone, so a second route on the same way would repeat it. Mix the way id and the route relation id. The style does not use feature state.

Zoom: `minzoom` 14 through the archive `maxzoom` (15 unless the rebuild raises it). Zoom 14 is the stock profile's first zoom for `subway`, `tram`, `light_rail`, `monorail`, and `funicular` track. If the rebuild lowers that floor so physical transit track appears earlier, use the same floor here. Do not emit these features at country zooms.

## 5. Color values

Normalize `colour` and `color` in this order:

1. Trim whitespace. Take the text before the first `;` when the tag holds several values.
2. A leading `#` followed by 3, 4, 6, or 8 hex digits is a color. Lowercase it. Expand `#rgb` to `#rrggbb` and `#rgba` to `#rrggbbaa`.
3. A string of ASCII letters only is a CSS color name. Lowercase it. `red` and `grey` stay. `dark blue` and `#gg0000` are dropped.
4. Anything else is dropped.

Resolution order for `colour`: the route's `colour`, the route's `color`, the master's `colour`, the master's `color`. The first value that survives normalization wins.

`colour_fallback` is always written, including when `colour` is present. The client prefers `colour`.

Palette, in index order:

```
#e11d48  #f97316  #eab308  #16a34a
#0d9488  #0284c7  #4f46e5  #9333ea
#db2777  #78716c  #65a30d  #0891b2
```

Identity string, using U+001F as the separator:

1. `network + separator + ref` when either side is non-empty after the master fallback.
2. Otherwise `name` when non-empty.
3. Otherwise the decimal route relation id.

Append `separator + route`. Index is `floorMod(identity.hashCode(), 12)`, using Java's specified `String.hashCode` (the polynomial with multiplier 31). `Math.floorMod` makes a negative hash land in `0..11`. The same identity produces the same swatch on every rebuild.

## 6. Slot

`postProcess` runs per tile, after clipping. Group the tile's `transit` features by `way_id`. Within a group, a line key is `network + U+001F + ref + U+001F + colour`, using `colour_fallback` when `colour` is absent. Sort those keys as strings. `slot` is the index of a feature's line key in that sorted list.

Both directions share a key, so they share a slot. The offset is relative to the way's direction, and both copies use the way geometry as stored, so the shared slot draws them on top of each other.

The set of routes on a way is the same on every tile the way crosses, so the sorted index does not flip at a tile boundary. A way that joins a trunk midway has a different set on each side, and the slot may change there. That matches the track.

The client draws slots 0 through 3. Higher slots stay in the tile so the data is complete.

## 7. Profile change

The work is in the Protomaps basemap profile that produces the archive, not in the OurMaps repo. Upstream `tiles/src/main/java/com/protomaps/basemap/layers/Transit.java` is already registered from `Basemap.java` and its `processOsm` is empty. Fill that class in. `registerHandler(transit)` already runs, and it picks up `OsmRelationPreprocessor` and `LayerPostProcessor` once `Transit` implements them. `registerSourceHandler("osm", transit::processOsm)` already runs. An Overture build has no OSM route relations, so this layer stays empty on that path. The OurMaps planet is built from OSM.

`Transit` needs three pieces of state:

- A `ConcurrentHashMap<Long, MasterTags>` from child route relation id to the tags of its route master. Relation preprocessing runs in parallel and finishes before any way is processed.
- The palette and the normalizer from section 5.
- No other profile class changes. `Roads` continues to emit physical track.

`MasterTags` holds the normalized `colour`, plus raw `ref`, `name`, `network`, and `operator`.

### 7.1 `preprocessOsmRelation`

For `type=route_master` and `route_master` in `subway`, `light_rail`, `tram`, `monorail`, `funicular`:

- Normalize the master's color.
- For each member whose type is relation, store the master's tags under that member's id. When an entry already exists, keep the stored color if the new master has none.

For `type=route` and `route` in that same set, return one `OsmRelationInfo` record:

- `id` is the route relation id. Planetiler attaches the record to every member.
- Fields: `route`, `ref`, `name`, `network`, `operator`, and the route's own normalized color. Leave the master lookup to way processing, because the master may be preprocessed later in the same pass.

Return an empty list for every other relation, including `route=road`, `route=train`, and `route=bus`. `Roads` still handles `route=road`.

### 7.2 `processOsm`

Return immediately unless the element is a line.

Collect the `OsmRelationInfo` records from section 7.1. Drop any whose member role on this element is a stop or platform role from section 3.

Also require a track tag. The way's `railway` value must be one of `rail`, `subway`, `light_rail`, `tram`, `monorail`, `funicular`, `narrow_gauge`. That rejects platforms, abandoned track, proposed track, and station buildings that were added to the relation. A route member that fails this test is skipped rather than drawn through a platform.

For each remaining route, emit `features.line("transit")`:

- Resolve `ref`, `name`, `network`, `operator`, and `colour` with the master map and the rules in sections 4 and 5.
- Set `route` from the relation, not from the way. A `railway=rail` way that belongs to `route=subway` is subway.
- Set `colour_fallback` from the resolved identity.
- Set `way_id` to the decimal OSM way id (`OsmSourceFeature.originalElement().id()`).
- Set `is_tunnel` and `is_bridge` from the way.
- Set zoom range 14 (or the rebuild's transit floor) through 15.
- Set a feature id that mixes the way id and the route relation id.
- Leave `slot` unset here. Post-process writes it.

After the route copies, a way-level fallback applies when all of these are true:

- The way's `railway` value is in the track list above.
- No route feature was emitted for the way.
- The way's own `colour` or `color` normalizes.

Emit one feature. `route` is `subway`, `light_rail`, `tram`, `monorail`, or `funicular` when `railway` is that value, and `light_rail` when `railway` is `rail` or `narrow_gauge`. `colour` is the way color. `ref`, `name`, and `network` stay omitted, so the fallback swatch is keyed by the route relation id when there is no relation, and by the way id in this fallback path. Use the way id in place of the relation id for that hash only. `way_id` is the way id, so `slot` is 0.

Do not emit a fallback feature just because a rail way exists. Uncolored track stays on the v1 class layers.

### 7.3 `postProcess`

Implement section 6. Read and write attributes through `feature.tags()`. Drop nothing. Return the same list.

### 7.4 Build and check

Rebuild with the same OSM PBF and the same `--maxzoom` as the planet build in progress. A full planet is the long run. A city extract is enough to check the schema. Monaco has little rail. Use an extract that contains a metro, or `--area` pointed at a city that has one.

Inspect one high-zoom tile and confirm:

- The tile has a `transit` layer.
- A shared trunk has several features with one `way_id`, different `ref` values, and different `colour` values where OSM has them.
- The two directions of one line share `slot`.
- `slot` on a way is stable in the neighboring tile.
- A `roads` feature for that way still has no `colour`.
- `route=bus` and `route=train` produced no features.

Then build the planet and replace `data/maps/planet.pmtiles` the way this repo already installs it (`scripts/download-map.js` writes that path and the server link). Offline copies downloaded from the previous archive have no `transit` layer until that map is downloaded again. The client treats a missing layer as an empty one.

## 8. Map rendering

This is the client half. It is not part of the planet build.

In `client/src/components/MapView.tsx`, keep `transit-rail`, `transit-subway`, and `transit-tram` on `source-layer` `roads`. Add two line layers on `source-layer` `transit`, inserted immediately after `transit-tram`, so they sit above the class colors and below labels.

### 8.1 Layer definitions

`transit-route-casing`, then `transit-route`:

- **Filter**:
  ```json
  [
    "all",
    ["in", ["get", "route"], ["literal", ["subway", "light_rail", "tram", "monorail", "funicular"]]],
    ["<", ["get", "slot"], 4]
  ]
  ```
- **Visibility**: follows `showTransit`, through the same `syncTransit` path as the three class layers. Add both ids to that list (`['transit-rail', 'transit-subway', 'transit-tram', 'transit-route-casing', 'transit-route']`).
- **Layout**: `'line-cap': 'round'`, `'line-join': 'round'`.
- **Width**:
  - `transit-route`: tracks `transit-subway`: `['interpolate', ['linear'], ['zoom'], 9, 1.2, 13, 2.5, 16, 4.5]`.
  - `transit-route-casing`: 2 pixels wider: `['interpolate', ['linear'], ['zoom'], 9, 3.2, 13, 4.5, 16, 6.5]`.
- **Line Offset**:
  - Both layers use `['*', ['get', 'slot'], 1.5]` to cleanly offset parallel lines without overlapping strokes.
- **Line Color**:
  - `transit-route`: `['coalesce', ['get', 'colour'], ['get', 'colour_fallback']]`.
  - `transit-route-casing`: `#e0ded7` in light mode, `#182230` in dark mode.

### 8.2 Layer ordering & MapStyle

Insert both layers immediately following `transit-tram`:
```typescript
const railIndex = customLayers.findIndex((l: any) => l.id === 'roads_rail');
if (railIndex !== -1) {
  customLayers.splice(railIndex + 1, 0,
    transitRailLayer,
    transitSubwayLayer,
    transitTramLayer,
    transitRouteCasingLayer,
    transitRouteLayer
  );
}
```

### 8.3 Theme Paint Updates

`mapStyle` is built once. Dark Mode repaints through `themePaintUpdates`, and a layer id that contains `roads_` is repainted as a minor road. Both new ids stay free of that prefix.

`themePaintUpdates` in `client/src/components/MapView.tsx`:
```typescript
if (id === 'transit-route') {
  return {
    'line-color': ['coalesce', ['get', 'colour'], ['get', 'colour_fallback']],
  };
}
if (id === 'transit-route-casing') {
  return {
    'line-color': dark ? '#182230' : '#e0ded7',
  };
}
```

`themePaintUpdates` for `transit-route` returns the same data-driven color expression for light and dark. The published color stays the published color. For `transit-route-casing` it returns the casing color for the active flavor.

Lines with an OSM color come out of the archive already colored. Lines without one come out in their palette swatch. Slots 4 and above are in the tile and are filtered out. Track with no route and no way color stays on the class layers underneath.

### 8.4 Testing requirements

`client/src/components/__tests__/MapView.test.tsx` must cover:
1. `updates transit layers and roads_rail visibility with mutual exclusion`: verifies both `transit-route-casing` and `transit-route` visibility toggle in sync with `showTransit`.
2. `themePaintUpdates provides distinct styling for transit layers across light and dark modes`: verifies `transit-route` preserves the data-driven coalesce expression in both modes, and `transit-route-casing` uses `#e0ded7` (light) and `#182230` (dark).
3. `inserts transit layers immediately after roads_rail in mapStyle`: verifies `transit-route-casing` and `transit-route` are placed immediately after `transit-tram`.

## 9. Out of scope

- `route=train` and `route=bus`.
- Ref pills and a legend. Color separates the lines. A label is what names them.
- A new station layer. `TRANSIT.md` still applies.
- Low-zoom route lines merged into one long geometry.
- Writing `colour` onto `roads`, or a second PMTiles archive.
- Replacing the v1 class colors. They remain the underlay.

## 10. Implementation Status & Next Steps

### 10.1 Build status (Completed)
- **Profile Code**: Custom Planetiler build profile (`Roads.java` with rail minZoom 6 and subway/tram minZoom 10; `Transit.java` with route relation preprocessing, color normalization, deterministic fallback swatches, and slotting) compiled and validated with all 73 tests passing.
- **Planet PMTiles Archive**: Successfully generated on Legion Tower using `--compress-temp=true --nodemap-type=sparsearray --storage=mmap -Xmx18g`.
- **Target Archive Path**: The generated archive should be placed at `data/maps/planet.pmtiles` (which `server/public/maps/planet.pmtiles` links to). Note that hard links or direct `mv` should be used rather than symlinks outside the repository root so Docker production mounts (`docker-compose.yml`) and server allowlists resolve without error.

### 10.2 Next conversation task list
1. **Edit `client/src/components/MapView.tsx`**:
   - Add `transitRouteCasingLayer` and `transitRouteLayer` to `customLayers`.
   - Add both layer IDs to `syncTransit` layer array.
   - Update `themePaintUpdates` for both layer IDs.
2. **Update `client/src/components/__tests__/MapView.test.tsx`**:
   - Update visibility test assertions to include the two new layers.
   - Update `themePaintUpdates` test assertions.
   - Update layer order assertions.
3. **Verify**:
   - Ask user to run `npm --prefix client run test` to verify client tests pass.
   - Ask user to run `npm run build` to confirm TypeScript and build integrity.
