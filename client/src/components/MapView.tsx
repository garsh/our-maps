import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import Map, { Marker, AttributionControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import type { Pin, PinIcon } from '@shared/interfaces';
import { ICON_SVG_PATHS, getPreviewMarkerHTML, resolvePinColorCode } from '../utils/mapUtils';
import { Locate } from 'lucide-react';
import { reverseGeocode } from '../utils/geocoding';
import type { MapTheme } from './Sidebar';

import { getActiveExtractPMTiles, getExtractTileJSON, preloadExtract, setActiveOfflineMapId } from '../utils/offlineExtract';
import { clearHoveredPin, getHoveredPinId, useHoveredPinId, hasFinePointer } from '../utils/pinHover';
import { setMapViewportBounds } from '../utils/mapViewport';
import { ensurePinImageByKey, ensurePinImages, getPinIconKey } from '../utils/pinIconSprite';
import { applyBundledSprites } from '../utils/basemapSprites';

maplibregl.setWorkerUrl(workerUrl);

function attachMissingImageResolver(map: any) {
  if (!map || typeof map.setMissingStyleImageResolver !== 'function') return;
  map.setMissingStyleImageResolver(async (id: string) => {
    if (typeof id === 'string' && id.startsWith('pin-')) {
      await ensurePinImageByKey(map, id);
      return;
    }
    if (!map.hasImage(id)) {
      try {
        map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
      } catch {}
    }
  });
}

let globalPMTilesProtocol: Protocol | null = null;
const PMTILES_TILE_REGEX = /^pmtiles:\/\/(?:.+)\/(\d+)\/(\d+)\/(\d+)(?:\.mvt)?$/;

function getFallbackMetadata(baseUrl: string) {
  return {
    tiles: [`${baseUrl}/{z}/{x}/{y}`],
    minzoom: 0,
    maxzoom: 15,
    bounds: [-180, -85, 180, 85],
  };
}

// 1x1 PNG with RGBA (128, 0, 0, 255) representing 0 meters elevation in Terrarium format
// ((128 * 256 + 0 + 0/256) - 32768 = 0m)
const FLAT_TERRARIUM_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 104, 96, 96, 248, 15, 0, 3, 4, 1, 128, 11, 131, 200, 20, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);

let isDEMProtocolRegistered = false;
function setupDEMProtocol() {
  if (!isDEMProtocolRegistered && typeof maplibregl !== 'undefined' && typeof maplibregl.addProtocol === 'function') {
    isDEMProtocolRegistered = true;
    maplibregl.addProtocol('dem', async (params, abortController) => {
      const realUrl = params.url.replace(/^dem:\/\//, '');

      // 1. Try CacheStorage (Workbox elevation-tiles-cache)
      try {
        if (typeof caches !== 'undefined') {
          const cache = await caches.open('elevation-tiles-cache');
          const matched = await cache.match(realUrl);
          if (matched && matched.ok) {
            const buf = await matched.arrayBuffer();
            return { data: buf };
          }
        }
      } catch {}

      // 2. If online, fetch from network and cache for offline 3D use
      if (navigator.onLine) {
        try {
          const res = await fetch(realUrl, { signal: abortController.signal });
          if (res.ok) {
            const clone = res.clone();
            const buf = await res.arrayBuffer();
            if (typeof caches !== 'undefined') {
              caches.open('elevation-tiles-cache').then((c) => c.put(realUrl, clone)).catch(() => {});
            }
            return { data: buf };
          }
        } catch {}
      }

      // 3. Fallback for offline mode when tile is not in cache:
      // Return 0m flat elevation tile so MapLibre renders flat terrain without breaking the canvas
      return { data: FLAT_TERRARIUM_PNG.buffer.slice(0) };
    });
  }
}
setupDEMProtocol();

function setupPMTilesProtocol() {
  if (!globalPMTilesProtocol) {
    globalPMTilesProtocol = new Protocol();
    const offlineTileHandler: maplibregl.AddProtocolAction = async (params, abortController) => {
      const match = params.url.match(PMTILES_TILE_REGEX);
      if (match) {
        const [, z, x, y] = match;

        // CRITICAL FOR OFFLINE MODE:
        // 1. Always query the local PMTiles extract first.
        // NEVER add an online "fast-path" before this cache check based on navigator.onLine!
        // When running offline or when the server is unreachable, navigator.onLine can still report true,
        // which would cause tile requests to bypass the extract, fail on network fetch, and blank the map.
        try {
          const local = await getActiveExtractPMTiles();
          if (local) {
            const result = await local.getZxy(Number(z), Number(x), Number(y));
            if (result && result.data && result.data.byteLength > 0) {
              return { data: new Uint8Array(result.data) };
            }
            // Extract is loaded: missing tiles must throw so MapLibre overzooms a parent tile.
            // Do not fall through to the network — navigator.onLine can be true while the server is down.
            throw new Error(`Tile not found: ${z}/${x}/${y}`);
          }
        } catch (extractErr) {
          if (extractErr instanceof Error && extractErr.message.startsWith('Tile not found:')) {
            throw extractErr;
          }
          if (abortController.signal.aborted) throw extractErr;
          console.error('Failed to read offline map extract', extractErr);
        }

        // 2. No local extract. If the browser reports online, try the live planet archive.
        // NEVER treat navigator.onLine as proof the server is reachable.
        if (navigator.onLine) {
          try {
            return await globalPMTilesProtocol!.tilev4(params, abortController);
          } catch {
            // Fall through to the miss path below.
          }
        }

        // CRITICAL FOR OFFLINE MODE:
        // 3. Tile missing offline -> throw Error rather than returning a 0-byte tile!
        // Returning a 0-byte tile causes MapLibre to treat the tile as valid-but-empty and erase the canvas.
        // Throwing an Error causes MapLibre to automatically scale up and render the parent zoom tile (zooms 4-8).
        throw new Error(`Tile not found: ${z}/${x}/${y}`);
      }

      // Metadata / TileJSON schema request.
      // Prefer the local extract so MapLibre can start asking for tiles without /maps/planet.pmtiles.
      // navigator.onLine is not proof the server is reachable.
      try {
        const fromExtract = await getExtractTileJSON(params.url);
        if (fromExtract) {
          return { data: fromExtract };
        }
      } catch {
        // Fall through to the live archive, then the static fallback.
      }

      try {
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), 1200);
        try {
          return await globalPMTilesProtocol!.tilev4(params, timeoutController);
        } finally {
          clearTimeout(timeoutId);
        }
      } catch {
        return { data: getFallbackMetadata(params.url) };
      }
    };
    maplibregl.addProtocol('pmtiles', offlineTileHandler);
  }
}
setupPMTilesProtocol();

interface MapViewProps {
  mapId?: string | null;
  center?: [number, number]; // [lat, lng]
  zoom?: number;
  pins: Pin[];
  onMapClick: (lat: number, lng: number) => void;
  onPinClick?: (pin: Pin) => void;
  onUpdatePin: (id: string, updates: Partial<Pin>) => void;
  onBoundsChange?: (bounds: string) => void;
  targetPinId?: string | null;
  boundsToFit?: [[number, number], [number, number]] | null;
  userRole?: 'owner' | 'edit' | 'view';
  onHoverPin?: (id: string | null, leavingPinId?: string) => void;
  hiddenLayerIds?: Set<string | null>;
  previewLocation?: { lat: number; lng: number } | null;
  bottomPadding?: number;
  leftPadding?: number;
  editingPinId?: string | null;
  onBackgroundClick?: () => void;
  mapTheme?: MapTheme;
  showSatellite?: boolean;
  showHillshade?: boolean;
  show3DTerrain?: boolean;
  show3DBuildings?: boolean;
  isOffline?: boolean;
}

const UserLocationMarker = ({ position }: { position: { lat: number; lng: number } }) => {
  return (
    <Marker longitude={position.lng} latitude={position.lat} anchor="center">
      <div
        style={{
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          backgroundColor: '#4285F4',
          border: '3px solid white',
          boxShadow: '0 0 8px rgba(0,0,0,0.4)',
          animation: 'pulse 2s infinite',
        }}
      />
    </Marker>
  );
};

interface PinMarkerProps {
  pin: Pin;
  onUpdatePin: (id: string, updates: Partial<Pin>) => void;
  onHoverPin?: (id: string | null, leavingPinId?: string) => void;
  onPinClick?: (pin: Pin) => void;
  isSelected: boolean;
  isHovered: boolean;
  isEditing: boolean;
  readOnly: boolean;
}

const PinMarker = memo(({
  pin,
  onUpdatePin,
  onHoverPin,
  onPinClick,
  isSelected,
  isHovered,
  isEditing,
  readOnly,
}: PinMarkerProps) => {
  const showHighlight = isSelected || isHovered;
  const colorCode = resolvePinColorCode(pin.color);
  const iconPath = pin.icon && pin.icon !== 'default' ? ICON_SVG_PATHS[pin.icon as Exclude<PinIcon, 'default'>] : null;

  const lastGeocodeCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  const handleDragEnd = useCallback(async (e: any) => {
    const newLat = e.lngLat.lat;
    const newLng = e.lngLat.lng;
    lastGeocodeCoordsRef.current = { lat: newLat, lng: newLng };

    // 1. Immediately update lat/lng so pin position moves optimistically and syncs over socket
    onUpdatePin(pin.id, {
      lat: newLat,
      lng: newLng,
    });

    // 2. Fetch address in background and guard against coordinate mismatch
    const newAddress = await reverseGeocode(newLat, newLng);
    if (newAddress && lastGeocodeCoordsRef.current?.lat === newLat && lastGeocodeCoordsRef.current?.lng === newLng) {
      onUpdatePin(pin.id, {
        address: newAddress,
      });
    }
  }, [pin.id, onUpdatePin]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onPinClick?.(pin);
  }, [onPinClick, pin]);

  const handleMouseEnter = useCallback(() => {
    if (hasFinePointer()) {
      onHoverPin?.(pin.id);
    }
  }, [onHoverPin, pin.id]);

  const handleMouseMove = useCallback(() => {
    if (hasFinePointer()) {
      onHoverPin?.(pin.id);
    }
  }, [onHoverPin, pin.id]);

  const handleMouseLeave = useCallback(() => {
    onHoverPin?.(null, pin.id);
  }, [onHoverPin, pin.id]);

  return (
    <Marker
      longitude={pin.lng}
      latitude={pin.lat}
      anchor="bottom"
      draggable={!readOnly && isEditing}
      onDragEnd={handleDragEnd}
      style={{ zIndex: showHighlight ? 1000 : 1 }}
    >
      <div
        className={`leaflet-marker-icon custom-pin-modern ${showHighlight ? 'hovered' : ''}`}
        style={{
          position: 'relative',
          width: '20px',
          height: '28px',
          cursor: 'pointer',
        }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {showHighlight && (
          <div
            style={{
              position: 'absolute',
              top: '-20px',
              left: '-20px',
              width: '60px',
              height: '60px',
              background: `${colorCode}44`,
              border: `3px solid ${colorCode}`,
              borderRadius: '50%',
              zIndex: -1,
              animation: 'pulse 1.2s infinite',
              boxShadow: `0 0 15px ${colorCode}66`,
              pointerEvents: 'none',
            }}
          />
        )}
        <svg
          width="20"
          height="28"
          viewBox="0 0 30 42"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: 'block', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.4))', pointerEvents: 'none' }}
        >
          <path
            d="M15 0C6.71573 0 0 6.71573 0 15C0 26.25 15 42 15 42C15 42 30 26.25 30 15C30 6.71573 23.2843 0 15 0Z"
            fill={colorCode}
          />
          {iconPath ? (
            <g
              transform="translate(4.5, 4.5) scale(0.85)"
              stroke="white"
              color="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              dangerouslySetInnerHTML={{ __html: iconPath }}
            />
          ) : (
            <circle cx="15" cy="15" r="6" fill="white" fillOpacity="0.9" />
          )}
        </svg>
      </div>
    </Marker>
  );
});

const PinOverlays = memo(({
  visiblePins,
  targetPinId,
  editingPinId,
  readOnly,
  onUpdatePin,
  onHoverPin,
  onPinClick,
}: {
  visiblePins: Pin[];
  targetPinId?: string | null;
  editingPinId?: string | null;
  readOnly: boolean;
  onUpdatePin: (id: string, updates: Partial<Pin>) => void;
  onHoverPin?: (id: string | null, leavingPinId?: string) => void;
  onPinClick: (pin: Pin) => void;
}) => {
  const hoveredPinId = useHoveredPinId();
  const overlayPins = visiblePins.filter((pin) => (
    pin.id === targetPinId ||
    pin.id === editingPinId ||
    pin.id === hoveredPinId
  ));

  return (
    <>
      {overlayPins.map((pin) => {
        const isSelected = targetPinId === pin.id || editingPinId === pin.id;
        const isEditing = !readOnly && editingPinId === pin.id;
        const isHovered = hoveredPinId === pin.id;
        return (
          <PinMarker
            key={pin.id}
            pin={pin}
            onUpdatePin={onUpdatePin}
            onHoverPin={onHoverPin}
            onPinClick={onPinClick}
            isSelected={isSelected}
            isHovered={isHovered}
            isEditing={isEditing}
            readOnly={readOnly}
          />
        );
      })}
    </>
  );
});

const LIGHT_MINOR_ROAD_COLOR = ['interpolate', ['linear'], ['zoom'], 10, '#e2dfd7', 13.5, '#d4d0c7', 15.5, '#ffffff'];
const DARK_MINOR_ROAD_COLOR = ['interpolate', ['linear'], ['zoom'], 9, '#36465e', 13, '#3e506c', 15.5, '#485b7a'];

function themePaintUpdates(layer: { id?: string; type?: string }, flavor: 'light' | 'dark'): Record<string, any> | null {
  const id = layer.id || '';
  const type = layer.type;
  if (!id || id === 'esri-satellite') return null;
  const dark = flavor === 'dark';

  if (id === 'background') {
    return {
      'background-color': dark ? '#202a3a' : '#fcfbfa',
      'background-opacity': 1,
    };
  }
  if (id === 'earth' || id === 'landcover') {
    return {
      'fill-color': dark ? '#202a3a' : '#f8f7f4',
      'fill-opacity': 1,
    };
  }
  if (id === 'water') {
    return {
      'fill-color': dark ? '#141f2d' : '#a0c8f0',
      'fill-opacity': 0.88,
    };
  }
  if (id.includes('water_river') || id.includes('water_stream')) {
    return {
      'line-color': dark ? '#141f2d' : '#a0c8f0',
      'line-opacity': 1,
    };
  }
  if (id === 'landuse_park' || id === 'landuse_urban_green') {
    return { 'fill-color': dark ? '#1a3d3c' : '#d8ebd2', 'fill-opacity': 1 };
  }
  if (id === 'buildings' && type !== 'fill-extrusion') {
    return {
      'fill-color': dark ? '#2e3848' : '#e8e4dc',
      'fill-opacity': dark ? 0.75 : 0.7,
    };
  }
  if (id === '3d-buildings') {
    return { 'fill-extrusion-color': dark ? '#2c3847' : '#e0ded7' };
  }
  if (id === 'landuse_school') {
    return { 'fill-color': dark ? '#2a3342' : '#fbf3d5', 'fill-opacity': 1 };
  }
  if (id === 'landuse_hospital') {
    return { 'fill-color': dark ? '#3c2d38' : '#f6e5e5', 'fill-opacity': 1 };
  }
  if (id === 'landuse_industrial') {
    return { 'fill-color': dark ? '#283240' : '#eceeef', 'fill-opacity': 1 };
  }
  if (
    id === 'landuse_aerodrome' ||
    id === 'landuse_pedestrian' ||
    id === 'landuse_zoo' ||
    id === 'landuse_beach' ||
    id === 'landuse_pier' ||
    id === 'landuse_runway'
  ) {
    return { 'fill-color': dark ? '#202a3a' : '#f8f7f4', 'fill-opacity': 1 };
  }
  if (id === 'hills') {
    return {
      'hillshade-exaggeration': dark ? 0.35 : 0.45,
      'hillshade-shadow-color': dark ? '#121820' : '#473B24',
      'hillshade-highlight-color': dark ? '#2f3a4b' : '#FFFFFF',
    };
  }
  if (type === 'symbol' || id.includes('label') || id.startsWith('places_') || id.startsWith('pois')) {
    return {
      'text-color': id.includes('water_')
        ? (dark ? '#515c6d' : '#1d4ed8')
        : (dark ? '#d5e1f2' : '#000000'),
      'text-halo-color': dark ? '#202a3a' : '#ffffff',
      'text-halo-width': 2.5,
    };
  }
  if (id.includes('boundaries')) {
    return { 'line-color': dark ? '#4e5d6c' : '#8a8a8a', 'line-opacity': 1 };
  }
  const isRoad = id.includes('roads_') && !id.includes('labels') && !id.includes('shields') && id !== 'roads_oneway';
  if (isRoad && type !== 'symbol') {
    const isCasing = id.includes('casing');
    if (id.includes('roads_highway') || id.includes('highway')) {
      if (isCasing) return { 'line-color': dark ? '#14222d' : '#de7a22' };
      return { 'line-color': dark ? '#3c7d9c' : '#fca855' };
    }
    if (id.includes('roads_major') || id.includes('major')) {
      if (isCasing) return { 'line-color': dark ? '#182230' : '#e0aa1b' };
      return { 'line-color': dark ? '#526482' : '#ffd54f' };
    }
    if (isCasing) return { 'line-color': dark ? '#182230' : '#e0ded7' };
    return { 'line-color': dark ? DARK_MINOR_ROAD_COLOR : LIGHT_MINOR_ROAD_COLOR };
  }
  return null;
}

function applyThemePaintsOnMap(map: any, flavor: 'light' | 'dark') {
  if (typeof map.setPaintProperty !== 'function') return;
  const ids: string[] = typeof map.getLayersOrder === 'function'
    ? map.getLayersOrder()
    : (map.getStyle?.()?.layers ?? []).map((l: any) => l.id).filter(Boolean);

  for (const id of ids) {
    let type: string | undefined;
    try {
      type = map.getLayer?.(id)?.type;
    } catch {}
    const updates = themePaintUpdates({ id, type }, flavor);
    if (!updates) continue;
    for (const [prop, value] of Object.entries(updates)) {
      try {
        map.setPaintProperty(id, `${prop}-transition`, { duration: 0, delay: 0 }, { validate: false });
      } catch {}
      try {
        map.setPaintProperty(id, prop, value, { validate: false });
      } catch {}
    }
  }
  if (typeof map.triggerRepaint === 'function') {
    try { map.triggerRepaint(); } catch {}
  }
}

function prefetchMapSprites() {
  if (typeof window === 'undefined') return;
  const origin = window.location.origin;
  for (const flavor of ['light', 'dark'] as const) {
    const base = `${origin}/maps/sprites/${flavor}`;
    try {
      const img = new Image();
      img.src = `${base}.png`;
      const img2 = new Image();
      img2.src = `${base}@2x.png`;
    } catch {}
    if (typeof fetch === 'function') {
      try {
        Promise.resolve(fetch(`${base}.json`)).catch(() => {});
      } catch {}
    }
  }
}
prefetchMapSprites();

// Terrain flyTo freezes camera height and only calls _finalizeElevation when this is set.
// Without it, street labels keep a mid-flight perspective scale after Find my location.
const FLY_TO_TERRAIN = { freezeElevation: true as const };
const MAP_EDGE_PADDING = 80;

export function paddedMapView(leftPadding: number, bottomPadding: number) {
  return {
    top: MAP_EDGE_PADDING,
    left: leftPadding + MAP_EDGE_PADDING,
    right: MAP_EDGE_PADDING,
    bottom: MAP_EDGE_PADDING + bottomPadding,
  };
}

export function isPinInPaddedViewport(
  map: {
    project?: (lngLat: [number, number]) => { x: number; y: number };
    getContainer?: () => { getBoundingClientRect?: () => { width: number; height: number }; clientWidth?: number; clientHeight?: number } | null;
    getBounds?: () => { contains?: (lngLat: [number, number]) => boolean };
  },
  pin: { lat: number; lng: number },
  leftPadding: number,
  bottomPadding: number
): boolean {
  const pad = paddedMapView(leftPadding, bottomPadding);

  if (typeof map.project === 'function') {
    const point = map.project([pin.lng, pin.lat]);
    const el = typeof map.getContainer === 'function' ? map.getContainer() : null;
    const rect = el?.getBoundingClientRect?.();
    const w = rect?.width || el?.clientWidth || 0;
    const h = rect?.height || el?.clientHeight || 0;
    if (w > 0 && h > 0) {
      return point.x >= pad.left && point.x <= w - pad.right && point.y >= pad.top && point.y <= h - pad.bottom;
    }
  }

  try {
    return !!map.getBounds?.()?.contains?.([pin.lng, pin.lat]);
  } catch {
    return false;
  }
}

const MapView = ({
  mapId = null,
  center = [0, 0], // default [lat, lng]
  zoom = 1,
  pins,
  onMapClick,
  onPinClick,
  onUpdatePin,
  onBoundsChange,
  targetPinId,
  boundsToFit,
  userRole = 'owner',
  onHoverPin,
  hiddenLayerIds,
  previewLocation,
  bottomPadding = 0,
  leftPadding = 0,
  editingPinId,
  onBackgroundClick,
  mapTheme = 'light',
  showSatellite = false,
  showHillshade = true,
  show3DTerrain = true,
  show3DBuildings = true,
  isOffline = false,
}: MapViewProps) => {

  const mapRef = useRef<MapRef | null>(null);

  useLayoutEffect(() => {
    if (!mapId) return;
    setActiveOfflineMapId(mapId);
    void preloadExtract(mapId).then((pmt) => {
      if (!pmt) return;
      const mapInstance = mapRef.current?.getMap();
      const source = mapInstance?.getSource?.('protomaps') as { reload?: () => void } | undefined;
      if (typeof source?.reload === 'function') {
        source.reload();
      } else {
        mapInstance?.triggerRepaint?.();
      }
    });
  }, [mapId]);
  const leftPaddingRef = useRef(leftPadding);
  leftPaddingRef.current = leftPadding;
  const bottomPaddingRef = useRef(bottomPadding);
  bottomPaddingRef.current = bottomPadding;
  const readOnly = userRole === 'view' || isOffline;

  const visiblePins = useMemo(
    () => pins.filter((pin) => !hiddenLayerIds?.has(pin.layerId || null)),
    [pins, hiddenLayerIds]
  );
  const visiblePinsRef = useRef(visiblePins);
  visiblePinsRef.current = visiblePins;

  const setMapRef = useCallback((instance: MapRef | null) => {
    mapRef.current = instance;
    if (!instance) return;
    const mapInstance = instance.getMap();
    attachMissingImageResolver(mapInstance);
    if (mapInstance && typeof mapInstance.on === 'function') {
      mapInstance.on('error', (e: any) => {
        console.error('[MAPLIBRE ERROR]', e?.error?.message || e?.error || e);
      });
      mapInstance.on('style.load', () => {
        setIsMapLoaded(true);
        const flavor: 'light' | 'dark' = mapTheme === 'dark' ? 'dark' : 'light';
        void applyBundledSprites(mapInstance, flavor).then(() => {
          if (visiblePinsRef.current.length > 0) {
            ensurePinImages(mapInstance, visiblePinsRef.current);
          }
          mapInstance.triggerRepaint();
        });
      });
      mapInstance.on('sourcedata', (e: any) => {
        if (e.sourceDataType === 'metadata' || e.sourceDataType === 'content') {
          mapInstance.triggerRepaint();
        }
      });
      mapInstance.on('data', (e: any) => {
        if (e.dataType === 'style' || e.dataType === 'source') {
          mapInstance.triggerRepaint();
        }
      });
      mapInstance.once('load', () => {
        setIsMapLoaded(true);
        mapInstance.triggerRepaint();
      });
      mapInstance.once('idle', () => {
        setIsMapLoaded(true);
        mapInstance.triggerRepaint();
      });
    }

    // Immediately enable map load and trigger initial frame render
    setIsMapLoaded(true);
    if (mapInstance) {
      mapInstance.triggerRepaint();
    }
  }, [mapTheme]);
  const lastTargetPinId = useRef<string | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const compassSvgRef = useRef<SVGSVGElement | null>(null);
  const compassGroupRef = useRef<SVGGElement | null>(null);
  const compassButtonRef = useRef<HTMLButtonElement | null>(null);
  const zoomPillRef = useRef<HTMLDivElement | null>(null);
  const lastBoundsStrRef = useRef<string | null>(null);
  const hasFitInitialBoundsRef = useRef(false);
  const compassLongPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compassClickSuppressRef = useRef(false);
  const compassClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compassClickCountRef = useRef(0);
  const onHoverPinRef = useRef(onHoverPin);
  onHoverPinRef.current = onHoverPin;
  const onBoundsChangeRef = useRef(onBoundsChange);
  onBoundsChangeRef.current = onBoundsChange;

  const [pendingContextLocation, setPendingContextLocation] = useState<{ lat: number; lng: number } | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; lat: number; lng: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingContextMarkerRef = useRef(false);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const handleTouchStart = useCallback(
    (e: maplibregl.MapLayerTouchEvent) => {
      if (readOnly) return;
      const orig = e.originalEvent as TouchEvent | undefined;
      if (orig && orig.touches && orig.touches.length > 1) {
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        touchStartRef.current = null;
        return;
      }

      const point = e.point;
      const lngLat = e.lngLat;
      touchStartRef.current = { x: point.x, y: point.y, lat: lngLat.lat, lng: lngLat.lng };

      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => {
        if (touchStartRef.current) {
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try {
              navigator.vibrate(40);
            } catch {}
          }
          setPendingContextLocation({ lat: touchStartRef.current.lat, lng: touchStartRef.current.lng });
          touchStartRef.current = null;
        }
      }, 500);
    },
    [readOnly]
  );

  const handleTouchMove = useCallback((e: maplibregl.MapLayerTouchEvent) => {
    if (!touchStartRef.current) return;
    const point = e.point;
    const dx = point.x - touchStartRef.current.x;
    const dy = point.y - touchStartRef.current.y;
    if (Math.hypot(dx, dy) > 8) {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      touchStartRef.current = null;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    touchStartRef.current = null;
  }, []);

  // Dynamically toggle satellite layer visibility without rebuilding MapLibre style
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;

    const syncSatellite = () => {
      try {
        if (typeof map.getLayer === 'function' && typeof map.setLayoutProperty === 'function') {
          if (map.getLayer('esri-satellite')) {
            map.setLayoutProperty('esri-satellite', 'visibility', showSatellite ? 'visible' : 'none');
          }
        }
      } catch {}
    };

    if (typeof map.isStyleLoaded === 'function' && map.isStyleLoaded()) {
      syncSatellite();
    } else if (typeof map.once === 'function') {
      map.once('idle', syncSatellite);
    } else {
      syncSatellite();
    }
  }, [showSatellite]);

  // Dynamically toggle hillshade layer visibility without rebuilding MapLibre style
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;

    const syncHillshade = () => {
      try {
        if (typeof map.getLayer === 'function' && typeof map.setLayoutProperty === 'function') {
          if (map.getLayer('hills')) {
            map.setLayoutProperty('hills', 'visibility', showHillshade && !showSatellite ? 'visible' : 'none');
          }
        }
      } catch {}
    };

    if (typeof map.isStyleLoaded === 'function' && map.isStyleLoaded()) {
      syncHillshade();
    } else if (typeof map.once === 'function') {
      map.once('idle', syncHillshade);
    } else {
      syncHillshade();
    }
  }, [showHillshade, showSatellite]);

  // Dynamically toggle 3D buildings vs 2D buildings visibility without rebuilding MapLibre style
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;

    const sync3DBuildings = () => {
      try {
        if (typeof map.getLayer === 'function' && typeof map.setLayoutProperty === 'function') {
          if (map.getLayer('3d-buildings')) {
            map.setLayoutProperty('3d-buildings', 'visibility', show3DBuildings ? 'visible' : 'none');
          }
          if (map.getLayer('buildings')) {
            map.setLayoutProperty('buildings', 'visibility', show3DBuildings ? 'none' : 'visible');
          }
        }
      } catch {}
    };

    if (typeof map.isStyleLoaded === 'function' && map.isStyleLoaded()) {
      sync3DBuildings();
    } else if (typeof map.once === 'function') {
      map.once('idle', sync3DBuildings);
    } else {
      sync3DBuildings();
    }
  }, [show3DBuildings]);

  // Ensure MapLibre terrain state stays in sync across theme and layer changes without tearing down terrain
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;

    const syncTerrain = () => {
      if (!mapRef.current) return;
      const m = mapRef.current.getMap();
      if (!m) return;

      try {
        if (typeof m.setTerrain === 'function') {
          // 3D Terrain is routed via dem:// protocol which:
          // 1. Returns cached DEM tiles offline (full 3D terrain rendered offline when cached)
          // 2. Returns 0m flat elevation fallback if offline and not cached (preventing blank map bugs)
          // 3. Fetches and caches DEM tiles from AWS S3 when online
          if (show3DTerrain) {
            m.setTerrain({ source: 'terrainElevation', exaggeration: 1.0 });
          } else {
            m.setTerrain(null);
          }
        }
        if (typeof m.triggerRepaint === 'function') {
          m.triggerRepaint();
        }
      } catch {
        if (typeof m.triggerRepaint === 'function') m.triggerRepaint();
      }
    };

    if (typeof map.isStyleLoaded === 'function' && map.isStyleLoaded() && (typeof map.isMoving !== 'function' || !map.isMoving())) {
      syncTerrain();
    } else if (typeof map.once === 'function') {
      map.once('idle', syncTerrain);
    } else {
      syncTerrain();
    }
  }, [mapTheme, show3DTerrain, isMapLoaded]);

  const appliedThemeRef = useRef(mapTheme);
  // Recolor the existing style in one frame. setStyle on theme change reloads
  // sprites and lets MapLibre's 300ms paint transitions finish layer-by-layer.
  useEffect(() => {
    if (appliedThemeRef.current === mapTheme) return;
    appliedThemeRef.current = mapTheme;
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;

    const flavor: 'light' | 'dark' = mapTheme === 'dark' ? 'dark' : 'light';
    const apply = () => {
      try {
        applyThemePaintsOnMap(map, flavor);
        void applyBundledSprites(map, flavor);
      } catch {}
    };

    if (typeof map.isStyleLoaded === 'function' && map.isStyleLoaded()) {
      apply();
    } else if (typeof map.once === 'function') {
      map.once('idle', apply);
    } else {
      apply();
    }
  }, [mapTheme]);

  const mapStyle = useMemo<any>(() => {
    const pmtilesUrl = `${window.location.origin}/maps/planet.pmtiles`;
    const validFlavor = ['light', 'dark'].includes(mapTheme) ? mapTheme : 'light';
    const rawLayers = protomapsLayers('protomaps', namedFlavor(validFlavor as any), { lang: 'en' });

    // Customize Protomaps layers according to active theme
    const customLayers = rawLayers.map((layer: any) => {
      const l = {
        ...layer,
        paint: layer.paint ? { ...layer.paint } : {},
        layout: layer.layout ? { ...layer.layout } : {},
      };

      if (l.id === 'buildings') {
        l.layout['visibility'] = show3DBuildings ? 'none' : 'visible';
      }

      if (validFlavor === 'light') {
        // Land & Water
        if (l.id === 'background') {
          l.paint['background-color'] = '#fcfbfa';
          l.paint['background-opacity'] = 1;
        }
        if (l.id === 'earth') {
          l.paint['fill-color'] = '#f8f7f4';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id === 'landcover') {
          l.paint['fill-color'] = '#f8f7f4';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id === 'water') {
          l.paint['fill-color'] = '#a0c8f0';
          l.paint['fill-opacity'] = 0.88;
        }
        if (l.id.includes('water_river') || l.id.includes('water_stream')) {
          l.paint['line-color'] = '#a0c8f0';
          l.paint['line-opacity'] = 1;
        }
        if (l.id === 'landuse_park' || l.id === 'landuse_urban_green') {
          l.paint['fill-color'] = '#d8ebd2';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id === 'buildings') {
          l.paint['fill-color'] = '#e8e4dc';
          l.paint['fill-opacity'] = 0.7;
        }
        if (l.id === 'landuse_school') {
          l.paint['fill-color'] = '#fbf3d5';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id === 'landuse_hospital') {
          l.paint['fill-color'] = '#f6e5e5';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id === 'landuse_industrial') {
          l.paint['fill-color'] = '#eceeef';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id === 'landuse_aerodrome' || l.id === 'landuse_pedestrian' || l.id === 'landuse_zoo' || l.id === 'landuse_beach' || l.id === 'landuse_pier' || l.id === 'landuse_runway') {
          l.paint['fill-color'] = '#f8f7f4';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id.includes('boundaries')) {
          l.paint['line-color'] = '#8a8a8a';
          l.paint['line-opacity'] = 1;
        }

        // Typography & Labels
        if (l.type === 'symbol') {
          if (l.paint['text-color']) {
            l.paint['text-color'] = l.id.includes('water_') ? '#1d4ed8' : '#000000';
            l.paint['text-halo-color'] = '#ffffff';
            l.paint['text-halo-width'] = 2.5;
          }
        }

        // Highways / Interstates (I-76, I-79)
        if (l.id.includes('roads_highway') && !l.id.includes('casing') && !l.id.includes('labels')) {
          l.paint['line-color'] = '#fca855';
        }
        if (l.id.includes('roads_highway_casing')) {
          l.paint['line-color'] = '#de7a22';
        }

        // Major Primary / Secondary Roads (Route 19, Route 50)
        if (l.id.includes('roads_major') && !l.id.includes('casing') && !l.id.includes('labels')) {
          l.paint['line-color'] = '#ffd54f';
          l.paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 6, 0.8, 8, 2.2, 12, 3.8, 15, 5.5, 18, 14];
        }
        if (l.id.includes('roads_major_casing')) {
          l.paint['line-color'] = '#e0aa1b';
          l.paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 7, 0.5, 9, 1.0, 12, 1.8];
        }
        if (l.id === 'roads_labels_major') l.minzoom = 8;

        // Minor / Residential Streets
        if ((l.id.includes('roads_minor') || l.id.includes('roads_other') || l.id.includes('roads_pier')) && !l.id.includes('casing')) {
          l.paint['line-color'] = ['interpolate', ['linear'], ['zoom'], 10, '#e2dfd7', 13.5, '#d4d0c7', 15.5, '#ffffff'];
        }
        if (l.id.includes('roads_minor_casing')) {
          l.paint['line-color'] = '#e0ded7';
        }
      } else if (validFlavor === 'dark') {
        // Land & Water (Google Maps Android Dark Mode)
        if (l.id === 'background') {
          l.paint['background-color'] = '#202a3a';
          l.paint['background-opacity'] = 1;
        }
        if (l.id === 'earth') {
          l.paint['fill-color'] = '#202a3a';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id === 'landcover') {
          l.paint['fill-color'] = '#202a3a';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id === 'water') {
          l.paint['fill-color'] = '#141f2d';
          l.paint['fill-opacity'] = 0.88;
        }
        if (l.id.includes('water_river') || l.id.includes('water_stream')) {
          l.paint['line-color'] = '#141f2d';
          l.paint['line-opacity'] = 1;
        }
        if (l.id === 'landuse_park' || l.id === 'landuse_urban_green') {
          l.paint['fill-color'] = '#1a3d3c';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id === 'buildings') {
          l.paint['fill-color'] = '#2e3848';
          l.paint['fill-opacity'] = 0.75;
        }
        if (l.id === 'landuse_school') {
          l.paint['fill-color'] = '#2a3342';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id === 'landuse_hospital') {
          l.paint['fill-color'] = '#3c2d38';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id === 'landuse_industrial') {
          l.paint['fill-color'] = '#283240';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id === 'landuse_aerodrome' || l.id === 'landuse_pedestrian' || l.id === 'landuse_zoo' || l.id === 'landuse_beach' || l.id === 'landuse_pier' || l.id === 'landuse_runway') {
          l.paint['fill-color'] = '#202a3a';
          l.paint['fill-opacity'] = 1;
        }
        if (l.id.includes('boundaries')) {
          l.paint['line-color'] = '#4e5d6c';
          l.paint['line-opacity'] = 1;
        }

        // Typography & Labels
        if (l.type === 'symbol') {
          if (l.paint['text-color']) {
            l.paint['text-color'] = l.id.includes('water_') ? '#515c6d' : '#d5e1f2';
            l.paint['text-halo-color'] = '#202a3a';
            l.paint['text-halo-width'] = 2.5;
          }
        }

        // Highways / Interstates (matching Google Maps dark mode cyan-teal highway tone in screenshot)
        if (l.id.includes('roads_highway') && !l.id.includes('casing') && !l.id.includes('labels')) {
          l.paint['line-color'] = '#3c7d9c';
          l.paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 5, 1.2, 8, 2.8, 12, 4.5, 15, 7.0, 18, 16];
        }
        if (l.id.includes('roads_highway') && l.id.includes('casing')) {
          l.paint['line-color'] = '#14222d';
          l.paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 6, 0.8, 9, 1.2, 12, 2.0];
        }

        // Major Primary / Secondary Roads (Rochester Rd, Powell Rd - brighter slate blue)
        if (l.id.includes('roads_major') && !l.id.includes('casing') && !l.id.includes('labels')) {
          l.paint['line-color'] = '#526482';
          l.paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 6, 0.8, 8, 2.2, 12, 3.8, 15, 5.5, 18, 14];
        }
        if (l.id.includes('roads_major') && l.id.includes('casing')) {
          l.paint['line-color'] = '#182230';
          l.paint['line-width'] = ['interpolate', ['linear'], ['zoom'], 7, 0.5, 9, 1.0, 12, 1.8];
        }
        if (l.id === 'roads_labels_major') l.minzoom = 8;

        // Minor / Residential Streets, Links, Service Roads, Tunnels & Bridges (brighter blue-grey street grid)
        if ((l.id.includes('roads_minor') || l.id.includes('roads_other') || l.id.includes('roads_pier') || l.id.includes('roads_link') || l.id.includes('roads_tunnels') || l.id.includes('roads_bridges')) && !l.id.includes('casing')) {
          l.paint['line-color'] = ['interpolate', ['linear'], ['zoom'], 9, '#36465e', 13, '#3e506c', 15.5, '#485b7a'];
        }
        if (l.id.includes('casing') && !l.id.includes('roads_highway') && !l.id.includes('roads_major')) {
          l.paint['line-color'] = '#182230';
        }
      }

      // Bump text size across all themes for readability
      if (l.type === 'symbol' && l.layout?.['text-size']) {
        const s = l.layout['text-size'];
        if (typeof s === 'number') l.layout['text-size'] = s + 2.5;
        else if (Array.isArray(s) && (s[0] === 'interpolate' || s[0] === 'step')) {
          const bumped = [...s];
          for (let i = 4; i < bumped.length; i += 2) {
            if (typeof bumped[i] === 'number') bumped[i] = (bumped[i] as number) + 2.5;
          }
          l.layout['text-size'] = bumped;
        }
      }

      return l;
    });

    const esriSatelliteLayer = {
      id: 'esri-satellite',
      type: 'raster',
      source: 'esriSatellite',
      minzoom: 0,
      maxzoom: 19,
      layout: {
        visibility: showSatellite ? 'visible' : 'none',
      },
    };

    const roadIndex = customLayers.findIndex(
      (l: any) =>
        l.id?.startsWith('roads_tunnels') ||
        l.id === 'buildings' ||
        (l.id?.startsWith('roads_') && !l.id?.includes('runway') && !l.id?.includes('taxiway')) ||
        l.id?.includes('boundaries') ||
        l.type === 'symbol'
    );
    if (roadIndex !== -1) {
      customLayers.splice(roadIndex, 0, esriSatelliteLayer);
    } else {
      customLayers.push(esriSatelliteLayer);
    }

    // 3D Extruded Buildings layer (active when show3D is toggled on)
    const building3DColor = validFlavor === 'dark' ? '#2c3847' : '#e0ded7';

    const building3dLayer = {
      id: '3d-buildings',
      type: 'fill-extrusion',
      source: 'protomaps',
      'source-layer': 'buildings',
      minzoom: 14,
      layout: {
        visibility: show3DBuildings ? 'visible' : 'none',
      },
      paint: {
        'fill-extrusion-color': building3DColor,
        'fill-extrusion-height': ['coalesce', ['get', 'height'], 10],
        'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.8,
      },
    };

    const labelIndex = customLayers.findIndex((l: any) => l.type === 'symbol');
    if (labelIndex !== -1) {
      customLayers.splice(labelIndex, 0, building3dLayer);
    } else {
      customLayers.push(building3dLayer);
    }

    const hillshadeShadowColor = validFlavor === 'dark' ? '#121820' : '#473B24';
    const hillshadeHighlightColor = validFlavor === 'dark' ? '#2f3a4b' : '#FFFFFF';
    const hillshadeExaggeration = validFlavor === 'dark' ? 0.35 : 0.45;

    const hillshadeLayer = {
      id: 'hills',
      type: 'hillshade',
      source: 'hillshadeDem',
      layout: {
        visibility: (showHillshade && !showSatellite) ? 'visible' : 'none',
      },
      paint: {
        'hillshade-exaggeration': hillshadeExaggeration,
        'hillshade-shadow-color': hillshadeShadowColor,
        'hillshade-highlight-color': hillshadeHighlightColor,
        'hillshade-accent-color': '#000000',
      },
    };

    const insertIndex = customLayers.findIndex(
      (l: any) => l.id?.includes('water') || l.id?.includes('roads') || l.type === 'symbol'
    );
    if (insertIndex !== -1) {
      customLayers.splice(insertIndex, 0, hillshadeLayer);
    } else {
      customLayers.push(hillshadeLayer);
    }

    return {
      version: 8,
      transition: { duration: 0, delay: 0 },
      // Glyphs are drawn locally with TinySDF. A remote glyphs URL is fetched
      // from the MapLibre worker during tile parse; Chrome DevTools Offline
      // fails those GETs and can drop the whole tile.
      // Sprites are registered from the JS bundle in applyBundledSprites.
      // A remote `sprite` URL is fetched during style load and, when Chrome
      // DevTools is Offline, that fetch fails and MapLibre never requests tiles.
      sources: {
        protomaps: {
          type: 'vector',
          // Explicit tile templates so MapLibre asks the worker for z/x/y
          // immediately. `url` (TileJSON) only runs on the main thread; tiles
          // still require the worker, which must not depend on HTTP.
          tiles: [`pmtiles://${pmtilesUrl}/{z}/{x}/{y}`],
          minzoom: 1,
          maxzoom: 15,
          attribution: `&copy; <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> &copy; <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>`,
        },
        esriSatellite: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '&copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        },
        // Note: terrainElevation (3D mesh extrusion via map.setTerrain) and hillshadeDem
        // (2D shaded relief via hillshade layer) must remain separate raster-dem sources.
        // MapLibre's internal terrain manager and hillshade tile pipeline conflict when sharing
        // a single raster-dem source, causing tile decode collisions and rendering errors.
        terrainElevation: {
          type: 'raster-dem',
          tiles: ['dem://https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 15,
          attribution: '&copy; <a href="https://github.com/tilezen/joerd" target="_blank" rel="noopener">Mapzen / AWS Elevation</a>',
        },
        hillshadeDem: {
          type: 'raster-dem',
          tiles: ['dem://https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 15,
          attribution: '&copy; <a href="https://github.com/tilezen/joerd" target="_blank" rel="noopener">Mapzen / AWS Elevation</a>',
        },
      },
      // CRITICAL FOR OFFLINE MODE:
      // Do NOT add `terrain: { source: 'terrainElevation', exaggeration: 1.0 }` here in the static style!
      // When `terrain` is declared statically in initial mapStyle, MapLibre GL JS forces 3D terrain mode
      // during initial style initialization before any rendering occurs.
      // Instead, 3D terrain is safely activated at runtime via `map.setTerrain(...)` in `syncTerrain`,
      // backed by the `dem://` protocol which serves cached DEM tiles offline for full 3D rendering
      // and returns a flat 0m fallback for uncached areas to prevent blank map canvas bugs.
      layers: customLayers,
    };
  // Theme paints/sprites are applied in place; omitting mapTheme keeps
  // react-map-gl from calling setStyle (which staggers layer updates).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pinsGeoJson = useMemo(() => {
    // If a pin is actively being drag-edited, exclude it from the GeoJSON layer to avoid duplicate ghost marker
    const isDragEditing = (pinId: string) => !readOnly && editingPinId === pinId;

    return {
      type: 'FeatureCollection' as const,
      features: visiblePins
        .filter((pin) => !isDragEditing(pin.id))
        .map((pin) => ({
          type: 'Feature' as const,
          id: pin.id,
          geometry: {
            type: 'Point' as const,
            coordinates: [pin.lng, pin.lat] as [number, number],
          },
          properties: {
            id: pin.id,
            iconKey: getPinIconKey(pin.color, pin.icon),
          },
        })),
    };
  }, [visiblePins, editingPinId, readOnly]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    if (map) {
      ensurePinImages(map, visiblePins);
    }
  }, [visiblePins, isMapLoaded]);

  // Calculate immediate initial view state using native bounds & fitBoundsOptions so the map opens instantly focused on frame 1
  const initialViewState = useRef(
    (() => {
      let targetBounds: [[number, number], [number, number]] | null = null;
      if (boundsToFit && Array.isArray(boundsToFit) && boundsToFit.length === 2) {
        targetBounds = boundsToFit;
      } else {
        const pinsToUse = visiblePins.length > 0 ? visiblePins : pins;
        if (pinsToUse.length > 0) {
          const lats = pinsToUse.map((p) => p.lat);
          const lngs = pinsToUse.map((p) => p.lng);
          targetBounds = [
            [Math.min(...lats), Math.min(...lngs)],
            [Math.max(...lats), Math.max(...lngs)],
          ];
        }
      }

      if (targetBounds) {
        const [first, second] = targetBounds;
        const minLat = Math.min(first[0], second[0]);
        const maxLat = Math.max(first[0], second[0]);
        const minLng = Math.min(first[1], second[1]);
        const maxLng = Math.max(first[1], second[1]);

        if (Math.abs(maxLat - minLat) < 0.0001 && Math.abs(maxLng - minLng) < 0.0001) {
          return { longitude: minLng, latitude: minLat, zoom: 13 };
        }

        return {
          bounds: [minLng, minLat, maxLng, maxLat] as [number, number, number, number],
          fitBoundsOptions: {
            padding: paddedMapView(leftPadding, bottomPadding),
            maxZoom: 13,
          },
        };
      }

      return { longitude: center[1], latitude: center[0], zoom };
    })()
  ).current;

  const updateCompassDirect = useCallback(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;
    const b = map.getBearing();
    const p = map.getPitch();

    if (compassSvgRef.current) {
      compassSvgRef.current.style.transform = `perspective(60px) rotateX(${Math.min(p, 70)}deg)`;
    }
    if (compassGroupRef.current) {
      compassGroupRef.current.style.transform = `rotate(${-b}deg)`;
    }
    if (compassButtonRef.current) {
      compassButtonRef.current.title = `Heading: ${Math.round((b % 360 + 360) % 360)}°, Tilt: ${Math.round(p)}° (Click to reset)`;
    }
    if (zoomPillRef.current) {
      zoomPillRef.current.textContent = `Zoom: ${map.getZoom().toFixed(1)}`;
    }
  }, []);

  const updateBounds = useCallback(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;

    updateCompassDirect();

    try {
      const el = typeof map.getContainer === 'function' ? map.getContainer() : null;
      const rect = el?.getBoundingClientRect?.();
      const w = rect?.width || el?.clientWidth || 0;
      const h = rect?.height || el?.clientHeight || 0;

      const left = leftPaddingRef.current || 0;
      const bottom = bottomPaddingRef.current || 0;

      if (w > 0 && h > 0 && typeof map.unproject === 'function') {
        const nw = map.unproject([left, 0]);
        const ne = map.unproject([w, 0]);
        const sw = map.unproject([left, Math.max(0, h - bottom)]);
        const se = map.unproject([w, Math.max(0, h - bottom)]);

        const west = Math.min(nw.lng, sw.lng);
        const east = Math.max(ne.lng, se.lng);
        const north = Math.max(nw.lat, ne.lat);
        const south = Math.min(sw.lat, se.lat);

        const boundsStr = `${west},${north},${east},${south}`;
        if (lastBoundsStrRef.current !== boundsStr) {
          lastBoundsStrRef.current = boundsStr;
          setMapViewportBounds(boundsStr);
          onBoundsChangeRef.current?.(boundsStr);
        }
      } else {
        const bounds = map.getBounds();
        if (bounds && typeof bounds.getWest === 'function') {
          const west = bounds.getWest();
          const north = bounds.getNorth();
          const east = bounds.getEast();
          const south = bounds.getSouth();
          const boundsStr = `${west},${north},${east},${south}`;
          if (lastBoundsStrRef.current !== boundsStr) {
            lastBoundsStrRef.current = boundsStr;
            setMapViewportBounds(boundsStr);
            onBoundsChangeRef.current?.(boundsStr);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to get map bounds:', e);
    }
  }, [updateCompassDirect]);

  useEffect(() => {
    updateBounds();
  }, [leftPadding, bottomPadding, updateBounds]);

  const handlePinClickStable = useCallback((clickedPin: Pin) => {
    setPendingContextLocation(null);
    onPinClick?.(clickedPin);
  }, [onPinClick]);

  const fitAllPinsRef = useRef<(() => void) | null>(null);

  const handleCombinedCompassTilt = useCallback(() => {
    // Suppress click if it was triggered by a long-press release
    if (compassClickSuppressRef.current) {
      compassClickSuppressRef.current = false;
      return;
    }
    compassClickCountRef.current += 1;
    if (compassClickCountRef.current === 1) {
      // Wait briefly for a potential second click
      compassClickTimerRef.current = setTimeout(() => {
        compassClickCountRef.current = 0;
        // Single click: original compass/tilt behavior
        if (!mapRef.current) return;
        const map = mapRef.current.getMap();
        const currentBearing = map.getBearing();
        const currentPitch = map.getPitch();
        if (Math.abs(currentBearing) > 0.5 || currentPitch > 5) {
          mapRef.current.easeTo({ bearing: 0, pitch: 0, duration: 300 });
        } else {
          mapRef.current.easeTo({ pitch: 60, duration: 300 });
        }
      }, 300);
    } else {
      // Double click: reset tilt and fit all pins
      compassClickCountRef.current = 0;
      if (compassClickTimerRef.current) clearTimeout(compassClickTimerRef.current);
      fitAllPinsRef.current?.();
    }
  }, []);

  const clearHoverDuringPan = useCallback(() => {
    if (!getHoveredPinId()) return;
    clearHoveredPin();
    onHoverPinRef.current?.(null);
  }, []);

  const handleMapMove = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    touchStartRef.current = null;
    updateCompassDirect();
    clearHoverDuringPan();
  }, [updateCompassDirect, clearHoverDuringPan]);

  const handleMapLoad = useCallback((e: any) => {
    setIsMapLoaded(true);
    const map = e.target || mapRef.current?.getMap();
    attachMissingImageResolver(map);
    updateBounds();
  }, [updateBounds]);

  const applyBoundsToFit = useCallback(
    (bounds: [[number, number], [number, number]] | null, animate = true) => {
      if (!bounds || !mapRef.current) return;
      const [first, second] = bounds;

      const minLat = Math.min(first[0], second[0]);
      const maxLat = Math.max(first[0], second[0]);
      const minLng = Math.min(first[1], second[1]);
      const maxLng = Math.max(first[1], second[1]);

      const duration = animate ? 1200 : 0;

      if (Math.abs(maxLat - minLat) < 0.0001 && Math.abs(maxLng - minLng) < 0.0001) {
        mapRef.current.flyTo({
          center: [minLng, minLat],
          zoom: 13,
          bearing: 0,
          pitch: 0,
          duration,
          ...FLY_TO_TERRAIN,
        });
      } else {
        mapRef.current.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          {
            padding: paddedMapView(leftPadding, bottomPadding),
            maxZoom: 13,
            bearing: 0,
            pitch: 0,
            duration,
            ...FLY_TO_TERRAIN,
          }
        );
      }
    },
    [leftPadding, bottomPadding]
  );

  const fitAllPins = useCallback(() => {
    const pinsToUse = visiblePins.length > 0 ? visiblePins : pins;
    if (pinsToUse && pinsToUse.length > 0) {
      const lats = pinsToUse.map((p) => p.lat);
      const lngs = pinsToUse.map((p) => p.lng);
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ];
      applyBoundsToFit(bounds, true);
    }
  }, [pins, visiblePins, applyBoundsToFit]);
  fitAllPinsRef.current = fitAllPins;

  const handleCompassPointerDown = useCallback(() => {
    compassClickSuppressRef.current = false;
    compassLongPressRef.current = setTimeout(() => {
      compassClickSuppressRef.current = true;
      fitAllPins();
    }, 500);
  }, [fitAllPins]);

  const handleCompassPointerUp = useCallback(() => {
    if (compassLongPressRef.current) {
      clearTimeout(compassLongPressRef.current);
      compassLongPressRef.current = null;
    }
  }, []);

  // Camera movements for targetPinId
  useEffect(() => {
    if (!targetPinId) {
      lastTargetPinId.current = null;
      return;
    }
    if (targetPinId === lastTargetPinId.current) return;
    lastTargetPinId.current = targetPinId;
    const pin = pins?.find((p) => p.id === targetPinId);
    if (!pin || !mapRef.current) return;

    const map = mapRef.current.getMap();
    const left = leftPaddingRef.current;
    const bottom = bottomPaddingRef.current;
    if (!isPinInPaddedViewport(map, pin, left, bottom)) {
      map.flyTo({
        center: [pin.lng, pin.lat],
        zoom: map.getZoom(),
        padding: paddedMapView(left, bottom),
        duration: 1200,
        ...FLY_TO_TERRAIN,
      });
    }
  }, [targetPinId, pins]);



  // Camera movements for boundsToFit or initial pins focus
  useEffect(() => {
    if (!isMapLoaded) return;

    let targetBounds = boundsToFit;
    if ((!targetBounds || !Array.isArray(targetBounds) || targetBounds.length !== 2) && !hasFitInitialBoundsRef.current) {
      const pinsToUse = visiblePins.length > 0 ? visiblePins : pins;
      if (pinsToUse && pinsToUse.length > 0) {
        const lats = pinsToUse.map((p) => p.lat);
        const lngs = pinsToUse.map((p) => p.lng);
        targetBounds = [
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)],
        ];
      }
    }

    if (!targetBounds || !Array.isArray(targetBounds) || targetBounds.length !== 2) return;

    if (!hasFitInitialBoundsRef.current) {
      hasFitInitialBoundsRef.current = true;
      applyBoundsToFit(targetBounds, false);
      return;
    }

    applyBoundsToFit(targetBounds, true);
  }, [boundsToFit, isMapLoaded, applyBoundsToFit, pins, visiblePins]);

  // Update bounds when map is loaded
  useEffect(() => {
    if (isMapLoaded) {
      updateBounds();
    }
  }, [isMapLoaded, updateBounds]);

  const [isTrackingLocation, setIsTrackingLocation] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isTrackingLocation) {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setUserLocation(null);
      return;
    }

    if (navigator.geolocation) {
      let isFirstLock = true;
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          setUserLocation({ lat, lng });

          if (isFirstLock) {
            isFirstLock = false;
            mapRef.current?.flyTo({
              center: [lng, lat],
              zoom: 16,
              duration: 1500,
              ...FLY_TO_TERRAIN,
            });
          }
        },
        (err) => {
          console.warn('Geolocation error:', err);
          setIsTrackingLocation(false);
        },
        { enableHighAccuracy: true }
      );
      watchIdRef.current = watchId;

      return () => {
        if (navigator.geolocation && watchId !== null) {
          navigator.geolocation.clearWatch(watchId);
        }
      };
    } else {
      setIsTrackingLocation(false);
    }
  }, [isTrackingLocation]);

  const handleToggleLocationTracking = useCallback(() => {
    setIsTrackingLocation((prev) => !prev);
  }, []);

  const previewMarker = previewLocation ? getPreviewMarkerHTML() : null;

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {mapStyle && (
        <Map
          attributionControl={false}
          localIdeographFontFamily="'Noto Sans CJK JP', 'Hiragino Kaku Gothic ProN', 'Meiryo', 'Yu Gothic', sans-serif"
          ref={setMapRef}
          initialViewState={initialViewState}
          mapStyle={mapStyle}
          style={{ width: '100%', height: '100%' }}
          doubleClickZoom={false}
          maxZoom={22}
          minZoom={1}
          maxPitch={85}
          onLoad={handleMapLoad}
          onZoomStart={clearHoverDuringPan}
          onZoomEnd={updateBounds}
          onMoveStart={clearHoverDuringPan}
          onMove={handleMapMove}
          onRotate={updateCompassDirect}
          onPitch={updateCompassDirect}
          onMoveEnd={updateBounds}
          onRotateEnd={updateBounds}
          onPitchEnd={updateBounds}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          interactiveLayerIds={['pins-symbol-layer']}
          onMouseEnter={(e: maplibregl.MapLayerMouseEvent) => {
            if (hasFinePointer()) {
              const hoveredFeature = e.features && e.features[0];
              if (hoveredFeature && hoveredFeature.layer.id === 'pins-symbol-layer') {
                const pinId = hoveredFeature.properties?.id;
                if (pinId) {
                  if (mapRef.current) {
                    mapRef.current.getMap().getCanvas().style.cursor = 'pointer';
                  }
                  if (getHoveredPinId() !== pinId) {
                    onHoverPinRef.current?.(pinId);
                  }
                }
              }
            }
          }}
          onMouseMove={(e: maplibregl.MapLayerMouseEvent) => {
            if (hasFinePointer()) {
              const hoveredFeature = e.features && e.features[0];
              if (hoveredFeature && hoveredFeature.layer.id === 'pins-symbol-layer') {
                const pinId = hoveredFeature.properties?.id;
                if (pinId) {
                  if (mapRef.current) {
                    mapRef.current.getMap().getCanvas().style.cursor = 'pointer';
                  }
                  if (getHoveredPinId() !== pinId) {
                    onHoverPinRef.current?.(pinId);
                  }
                }
              } else {
                if (mapRef.current) {
                  mapRef.current.getMap().getCanvas().style.cursor = '';
                }
                if (getHoveredPinId() !== null) {
                  onHoverPinRef.current?.(null);
                }
              }
            }
          }}
          onMouseLeave={() => {
            if (mapRef.current) {
              mapRef.current.getMap().getCanvas().style.cursor = '';
            }
            onHoverPinRef.current?.(null);
          }}
          onContextMenu={(e: maplibregl.MapLayerMouseEvent) => {
            if (readOnly) return;
            if (e.originalEvent) e.originalEvent.preventDefault();
            if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
            setPendingContextLocation({ lat: e.lngLat.lat, lng: e.lngLat.lng });
          }}
          onClick={(e: maplibregl.MapLayerMouseEvent) => {
            if (pendingContextLocation) {
              setPendingContextLocation(null);
            }
            const clickedFeature = e.features && e.features[0];
            if (clickedFeature && clickedFeature.layer.id === 'pins-symbol-layer') {
              const pinId = clickedFeature.properties?.id;
              const clickedPin = visiblePins.find((p) => p.id === pinId);
              if (clickedPin) {
                handlePinClickStable(clickedPin);
                return;
              }
            }
            if (!e.defaultPrevented) {
              onBackgroundClick?.();
            }
          }}
        >
          <AttributionControl compact={true} customAttribution={`OurMaps v.${import.meta.env.VITE_APP_BUILD_TIME || 'dev'}`} />
          {isTrackingLocation && userLocation && (
            <UserLocationMarker position={userLocation} />
          )}

          {/* WebGL Symbol Layer for GPU-accelerated Pin Rendering */}
          <Source id="pins-source" type="geojson" data={pinsGeoJson}>
            <Layer
              id="pins-symbol-layer"
              type="symbol"
              layout={{
                'icon-image': ['get', 'iconKey'],
                'icon-anchor': 'bottom',
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-size': 0.67,
              }}
            />
          </Source>

          {/* Hybrid DOM Markers for Selected, Hovered, or Drag-Edited Pins */}
          <PinOverlays
            visiblePins={visiblePins}
            targetPinId={targetPinId}
            editingPinId={editingPinId}
            readOnly={readOnly}
            onUpdatePin={onUpdatePin}
            onHoverPin={onHoverPin}
            onPinClick={handlePinClickStable}
          />

          {pendingContextLocation && !readOnly && (
            <Marker
              longitude={pendingContextLocation.lng}
              latitude={pendingContextLocation.lat}
              anchor="bottom"
              draggable={true}
              onDragStart={() => {
                isDraggingContextMarkerRef.current = true;
              }}
              onDrag={(e: any) => {
                setPendingContextLocation({ lat: e.lngLat.lat, lng: e.lngLat.lng });
              }}
              onDragEnd={(e: any) => {
                setPendingContextLocation({ lat: e.lngLat.lat, lng: e.lngLat.lng });
                setTimeout(() => {
                  isDraggingContextMarkerRef.current = false;
                }, 100);
              }}
              style={{ zIndex: 2000 }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  cursor: 'grab',
                  filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.3))',
                  userSelect: 'none',
                }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isDraggingContextMarkerRef.current) return;
                    const { lat, lng } = pendingContextLocation;
                    setPendingContextLocation(null);
                    onMapClick(lat, lng);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: 'var(--primary-color, #483D8B)',
                    color: 'white',
                    border: 'none',
                    padding: '8px 14px',
                    borderRadius: '20px',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <svg width="15" height="21" viewBox="0 0 30 42" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'inline-block', flexShrink: 0 }}>
                    <path d="M15 0C6.71573 0 0 6.71573 0 15C0 26.25 15 42 15 42C15 42 30 26.25 30 15C30 6.71573 23.2843 0 15 0Z" fill="#2A81CB"/>
                    <circle cx="15" cy="15" r="6" fill="white" fillOpacity="0.9"/>
                  </svg>
                  Add Pin Here
                </button>
                <div
                  style={{
                    width: 0,
                    height: 0,
                    borderLeft: '10px solid transparent',
                    borderRight: '10px solid transparent',
                    borderTop: '20px solid var(--primary-color, #483D8B)',
                    marginTop: '-1px',
                  }}
                />
              </div>
            </Marker>
          )}
          {previewLocation && previewMarker && (
            <Marker longitude={previewLocation.lng} latitude={previewLocation.lat} anchor="bottom">
              <div
                className={previewMarker.className}
                style={{ width: previewMarker.width, height: previewMarker.height, position: 'relative' }}
                dangerouslySetInnerHTML={{ __html: previewMarker.html }}
              />
            </Marker>
          )}
        </Map>
      )}

      {/* Live Zoom Level Indicator Pill (Dev Server Only) */}
      {import.meta.env.DEV && (
        <div ref={zoomPillRef} className="zoom-level-pill">
          Zoom: {zoom.toFixed(1)}
        </div>
      )}

      {/* Combined Compass & Tilt Indicator Control */}
      <button
        ref={compassButtonRef}
        onClick={handleCombinedCompassTilt}
        onPointerDown={handleCompassPointerDown}
        onPointerUp={handleCompassPointerUp}
        onPointerCancel={handleCompassPointerUp}
        onPointerLeave={handleCompassPointerUp}
        style={{
          position: 'absolute',
          bottom: '60px',
          right: '12px',
          width: '42px',
          height: '42px',
          borderRadius: '12px',
          background: 'var(--surface-color)',
          border: '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 1000,
          color: mapTheme === 'dark' ? '#cbd5e1' : 'var(--primary-color)',
          transition: 'all 0.2s',
          touchAction: 'none',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-color)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface-color)')}
        title="Heading: 0°, Tilt: 0° (Click to reset)"
        aria-label="Compass - Reset bearing to North"
      >
        <svg
          ref={compassSvgRef}
          width="34"
          height="34"
          viewBox="0 0 24 24"
          style={{
            transform: 'perspective(60px) rotateX(0deg)',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
            willChange: 'transform',
          }}
        >
          <g
            ref={compassGroupRef}
            style={{
              transform: 'rotate(0deg)',
              transformOrigin: '12px 12px',
              willChange: 'transform',
            }}
          >
            {/* Outer ring around compass */}
            <circle cx="12" cy="12" r="11" fill="none" stroke={mapTheme === 'dark' ? '#cbd5e1' : 'currentColor'} strokeWidth="1.5" opacity={mapTheme === 'dark' ? 0.95 : 0.8} />
            {/* North pointer (solid red) */}
            <polygon points="12,1 17,12 7,12" fill="#ea4335" />
            {/* South pointer */}
            <polygon points="12,23 17,12 7,12" fill={mapTheme === 'dark' ? '#9ca3af' : '#374151'} />
          </g>
        </svg>
      </button>

      <button
        onClick={handleToggleLocationTracking}
        style={{
          position: 'absolute',
          bottom: '10px',
          right: '12px',
          width: '42px',
          height: '42px',
          borderRadius: '12px',
          background: 'var(--surface-color)',
          border: isTrackingLocation ? '2px solid #4285F4' : '1px solid var(--border-color)',
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 1000,
          color: isTrackingLocation ? '#4285F4' : (mapTheme === 'dark' ? '#cbd5e1' : 'var(--primary-color)'),
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-color)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface-color)')}
        title={!isTrackingLocation ? 'Find my location' : userLocation ? 'Stop location tracking' : 'Locating...'}
        aria-label={!isTrackingLocation ? 'Find my location' : userLocation ? 'Stop location tracking' : 'Locating...'}
        aria-pressed={isTrackingLocation}
      >
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Locate size={24} />
          {isTrackingLocation && (
            <div
              style={{
                position: 'absolute',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#4285F4',
                ...(userLocation
                  ? {}
                  : {
                      animation: 'locatePulse 1.4s ease-in-out infinite',
                    }),
              }}
            />
          )}
        </div>
      </button>

      <style>{`
        @keyframes locatePulse {
          0%, 100% {
            transform: scale(0.35);
            opacity: 0.25;
          }
          50% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(66, 133, 244, 0.7); }
          70% { box-shadow: 0 0 0 15px rgba(66, 133, 244, 0); }
          100% { box-shadow: 0 0 0 0 rgba(66, 133, 244, 0); }
        }
        .maplibregl-container {
          background-color: ${mapTheme === 'dark' ? '#1f1f1f' : '#f8f9fa'};
        }
        .maplibregl-ctrl-attrib {
          display: inline-flex !important;
          flex-direction: row-reverse !important;
          align-items: center !important;
          margin: 0 60px 10px 0 !important;
          background: var(--surface-color) !important;
          color: var(--text-secondary) !important;
          border: 1px solid var(--border-color) !important;
          border-radius: 12px !important;
          box-shadow: var(--shadow-sm) !important;
        }
        .maplibregl-ctrl-attrib a {
          color: var(--text-secondary) !important;
        }
        .maplibregl-ctrl-attrib button,
        .maplibregl-ctrl-attrib-button {
          width: 24px !important;
          height: 24px !important;
          background-color: ${mapTheme === 'dark' ? '#121212' : 'var(--surface-color)'} !important;
          background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='${mapTheme === 'dark' ? '%23cbd5e1' : '%2344474e'}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10' stroke='${mapTheme === 'dark' ? '%23cbd5e1' : '%2344474e'}' stroke-width='1.5' fill='none'/%3E%3Cline x1='12' y1='16' x2='12' y2='12' stroke='${mapTheme === 'dark' ? '%23cbd5e1' : '%2344474e'}' stroke-width='2'/%3E%3Cline x1='12' y1='8' x2='12.01' y2='8' stroke='${mapTheme === 'dark' ? '%23cbd5e1' : '%2344474e'}' stroke-width='2.5'/%3E%3C/svg%3E") !important;
          background-repeat: no-repeat !important;
          background-position: center !important;
          background-size: 18px 18px !important;
          border-radius: 50% !important;
          border: 1px solid var(--border-color) !important;
          box-shadow: var(--shadow-sm) !important;
          opacity: 0.95 !important;
          filter: none !important;
        }
        .maplibregl-ctrl-attrib a.maplibregl-compact {
          order: 99 !important;
        }
      `}</style>
    </div>
  );
};

export default memo(MapView);
