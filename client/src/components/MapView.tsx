import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Map, { Marker, AttributionControl, type MapRef } from 'react-map-gl/maplibre';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);
import { Protocol } from 'pmtiles';
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';
import type { Pin } from '@shared/interfaces';
import { getMarkerHTML, getPreviewMarkerHTML } from '../utils/mapUtils';
import { Locate } from 'lucide-react';
import { reverseGeocode } from '../utils/geocoding';
import type { MapTheme } from './Sidebar';

import { getTile } from '../utils/tileUtils';

let globalPMTilesProtocol: Protocol | null = null;
function setupPMTilesProtocol() {
  if (!globalPMTilesProtocol) {
    globalPMTilesProtocol = new Protocol();
    const offlineTileHandler: maplibregl.AddProtocolAction = async (params, abortController) => {
      const match = params.url.match(/pmtiles:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)/);
      if (match) {
        const [, , z, x, y] = match;
        const tileUrl = `${window.location.origin}/maps/tile/${z}/${x}/${y}.mvt`;
        try {
          const blob = await getTile(tileUrl);
          if (blob) {
            const arrayBuffer = await blob.arrayBuffer();
            return { data: new Uint8Array(arrayBuffer) };
          }
        } catch {
          // fallback to pmtiles protocol if tile lookup fails
        }

        if (!navigator.onLine) {
          return { data: new Uint8Array(0) };
        }
      }

      try {
        return await globalPMTilesProtocol!.tilev4(params, abortController);
      } catch (err: any) {
        if (match) {
          return { data: new Uint8Array(0) };
        }
        const fallbackMetadata = {
          tilejson: "3.0.0",
          scheme: "xyz",
          tiles: [`${params.url}/{z}/{x}/{y}.mvt`],
          minzoom: 0,
          maxzoom: 15,
          bounds: [-180, -85, 180, 85],
          center: [0, 0, 0],
          vector_layers: [
            { id: "boundaries", fields: {} },
            { id: "buildings", fields: {} },
            { id: "earth", fields: {} },
            { id: "landcover", fields: {} },
            { id: "landuse", fields: {} },
            { id: "places", fields: {} },
            { id: "pois", fields: {} },
            { id: "roads", fields: {} },
            { id: "water", fields: {} }
          ]
        };
        return { data: fallbackMetadata };
      }
    };
    maplibregl.addProtocol('pmtiles', offlineTileHandler);
  }
}
setupPMTilesProtocol();

interface MapViewProps {
  center?: [number, number]; // [lat, lng]
  zoom?: number;
  pins: Pin[];
  onMapClick: (lat: number, lng: number) => void;
  onPinClick?: (pin: Pin) => void;
  onUpdatePin: (id: string, updates: Partial<Pin>) => void;
  onBoundsChange: (bounds: string) => void;
  targetLocation?: [number, number] | null; // [lat, lng]
  targetPinId?: string | null;
  boundsToFit?: [[number, number], [number, number]] | null;
  userRole?: 'owner' | 'edit' | 'view';
  hoveredPinId?: string | null;
  onHoverPin?: (id: string | null) => void;
  hiddenLayerIds?: Set<string | null>;
  previewLocation?: { lat: number; lng: number } | null;
  bottomPadding?: number;
  leftPadding?: number;
  editingPinId?: string | null;
  onBackgroundClick?: () => void;
  mapTheme?: MapTheme;
  showHillshade?: boolean;
  show3DTerrain?: boolean;
  show3DBuildings?: boolean;
  isOffline?: boolean;
}

const UserLocationMarker = () => {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setPosition({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        },
        (err) => console.warn('Geolocation error:', err),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  if (!position) return null;

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

const PinMarker = ({
  pin,
  onUpdatePin,
  onHoverPin,
  onPinClick,
  hoveredPinId,
  targetPinId,
  editingPinId,
  readOnly,
}: {
  pin: Pin;
  onUpdatePin: (id: string, updates: Partial<Pin>) => void;
  onHoverPin?: (id: string | null) => void;
  onPinClick?: (pin: Pin) => void;
  hoveredPinId?: string | null;
  targetPinId?: string | null;
  editingPinId?: string | null;
  readOnly: boolean;
}) => {
  const isSelected = hoveredPinId === pin.id || targetPinId === pin.id || editingPinId === pin.id;
  const { html, className } = getMarkerHTML(pin.color, pin.icon, isSelected);

  const handleDragEnd = async (e: any) => {
    const newLat = e.lngLat.lat;
    const newLng = e.lngLat.lng;
    const newAddress = await reverseGeocode(newLat, newLng);

    onUpdatePin(pin.id, {
      lat: newLat,
      lng: newLng,
      address: newAddress || undefined,
    });
  };

  return (
    <Marker
      longitude={pin.lng}
      latitude={pin.lat}
      anchor="bottom"
      draggable={!readOnly && editingPinId === pin.id}
      onDragEnd={handleDragEnd}
      style={{ zIndex: isSelected ? 1000 : 1 }}
    >
      <div
        className={className}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onPinClick?.(pin);
        }}
        onMouseEnter={() => onHoverPin?.(pin.id)}
        onMouseLeave={() => onHoverPin?.(null)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Marker>
  );
};

const MapView = ({
  center = [20, 0], // default [lat, lng]
  zoom = 3,
  pins,
  onMapClick,
  onPinClick,
  onUpdatePin,
  onBoundsChange,
  targetLocation,
  targetPinId,
  boundsToFit,
  userRole = 'owner',
  hoveredPinId,
  onHoverPin,
  hiddenLayerIds,
  previewLocation,
  bottomPadding = 0,
  leftPadding = 0,
  editingPinId,
  onBackgroundClick,
  mapTheme = 'light',
  showHillshade = true,
  show3DTerrain = true,
  show3DBuildings = true,
  isOffline = false,
}: MapViewProps) => {
  const mapRef = useRef<MapRef | null>(null);
  const readOnly = userRole === 'view' || isOffline;
  const lastTarget = useRef<[number, number] | null>(null);
  const lastTargetPinId = useRef<string | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [currentZoom, setCurrentZoom] = useState<number>(zoom);
  const [bearing, setBearing] = useState<number>(0);
  const [pitch, setPitch] = useState<number>(0);
  const compassSvgRef = useRef<SVGSVGElement | null>(null);
  const compassGroupRef = useRef<SVGGElement | null>(null);
  const hasFitInitialBoundsRef = useRef(false);

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

  // Flush MapLibre terrain tile cache when map theme changes while 3D terrain is active
  const isInitialThemeMount = useRef(true);
  useEffect(() => {
    if (isInitialThemeMount.current) {
      isInitialThemeMount.current = false;
      return;
    }
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;

    if (show3DTerrain) {
      try {
        map.setTerrain(null);
        setTimeout(() => {
          if (mapRef.current) {
            const m = mapRef.current.getMap();
            if (m) {
              m.setTerrain({ source: 'terrainElevation', exaggeration: 1.0 });
              m.triggerRepaint();
            }
          }
        }, 50);
      } catch {
        map.triggerRepaint();
      }
    } else {
      map.triggerRepaint();
    }
  }, [mapTheme, show3DTerrain]);

  const mapStyle = useMemo<any>(() => {
    const pmtilesUrl = `${window.location.origin}/maps/planet.pmtiles`;
    const validFlavor = ['light', 'dark', 'grayscale', 'white', 'black'].includes(mapTheme) ? mapTheme : 'light';
    const rawLayers = protomapsLayers('protomaps', namedFlavor(validFlavor as any), { lang: 'en' });

    // Customize Protomaps layers according to active theme
    const customLayers = rawLayers.map((layer: any) => {
      const l = {
        ...layer,
        paint: layer.paint ? { ...layer.paint } : {},
        layout: layer.layout ? { ...layer.layout } : {},
      };

      if (l.id === 'buildings' && show3DBuildings) {
        l.layout['visibility'] = 'none';
      }

      if (validFlavor === 'light') {
        // Land & Water
        if (l.id === 'background') l.paint['background-color'] = '#fcfbfa';
        if (l.id === 'earth') l.paint['fill-color'] = '#f8f7f4';
        if (l.id === 'water') l.paint['fill-color'] = '#a0c8f0';
        if (l.id.includes('water_river') || l.id.includes('water_stream')) l.paint['line-color'] = '#a0c8f0';
        if (l.id === 'landuse_park' || l.id === 'landuse_urban_green') l.paint['fill-color'] = '#d8ebd2';
        if (l.id === 'buildings' && !show3DBuildings) { l.paint['fill-color'] = '#e8e4dc'; l.paint['fill-opacity'] = 0.7; }
        if (l.id === 'landuse_school') l.paint['fill-color'] = '#fbf3d5';
        if (l.id === 'landuse_hospital') l.paint['fill-color'] = '#f6e5e5';
        if (l.id === 'landuse_industrial') l.paint['fill-color'] = '#eceeef';
        if (l.id.includes('boundaries')) l.paint['line-color'] = '#8a8a8a';

        // Typography & Labels
        if (l.type === 'symbol') {
          if (l.paint['text-color']) {
            l.paint['text-color'] = l.id.includes('water_') ? '#1d4ed8' : '#000000';
            l.paint['text-halo-color'] = '#ffffff';
            l.paint['text-halo-width'] = 2.5;
          }
        }

        // Highways / Interstates (I-76, I-79)
        if (l.id.includes('roads_highway') && !l.id.includes('casing') && !l.id.includes('labels')) l.paint['line-color'] = '#fca855';
        if (l.id.includes('roads_highway_casing')) l.paint['line-color'] = '#de7a22';

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
        if (l.id.includes('roads_minor_casing')) l.paint['line-color'] = '#e0ded7';
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

    // 3D Extruded Buildings layer (active when show3D is toggled on)
    const building3DColor =
      validFlavor === 'dark'
        ? '#2c3340'
        : validFlavor === 'black'
        ? '#333333'
        : validFlavor === 'white'
        ? '#d0d0d0'
        : validFlavor === 'grayscale'
        ? '#b0b0b0'
        : '#e0ded7';

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

    const hillshadeShadowColor =
      validFlavor === 'dark' || validFlavor === 'black'
        ? '#000000'
        : validFlavor === 'grayscale'
        ? '#555555'
        : validFlavor === 'white'
        ? '#888888'
        : '#473B24';

    const hillshadeHighlightColor =
      validFlavor === 'dark'
        ? '#2c3340'
        : validFlavor === 'black'
        ? '#1f1f1f'
        : validFlavor === 'grayscale' || validFlavor === 'white'
        ? '#ffffff'
        : '#FFFFFF';

    const hillshadeExaggeration =
      validFlavor === 'dark' || validFlavor === 'black' || validFlavor === 'grayscale' || validFlavor === 'white'
        ? 0.35
        : 0.45;

    const hillshadeLayer = {
      id: 'hills',
      type: 'hillshade',
      source: 'hillshadeDem',
      layout: {
        visibility: showHillshade ? 'visible' : 'none',
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
      glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
      sprite: `${window.location.origin}/maps/sprites/${validFlavor}`,
      sources: {
        protomaps: {
          type: 'vector',
          url: `pmtiles://${pmtilesUrl}`,
          maxzoom: 15,
          attribution: `&copy; <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> &copy; <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>`,
        },
        terrainElevation: {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 15,
          attribution: '&copy; <a href="https://github.com/tilezen/joerd" target="_blank" rel="noopener">Mapzen / AWS Elevation</a>',
        },
        hillshadeDem: {
          type: 'raster-dem',
          tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 15,
          attribution: '&copy; <a href="https://github.com/tilezen/joerd" target="_blank" rel="noopener">Mapzen / AWS Elevation</a>',
        },
      },
      layers: customLayers,
      terrain: show3DTerrain ? { source: 'terrainElevation', exaggeration: 1.0 } : undefined,
    };
  }, [mapTheme, showHillshade, show3DTerrain, show3DBuildings]);

  const visiblePins = useMemo(
    () => pins.filter((pin) => !hiddenLayerIds?.has(pin.layerId || null)),
    [pins, hiddenLayerIds]
  );

  // Calculate immediate initial view state using native bounds & fitBoundsOptions so the map opens instantly focused on frame 1
  const initialViewState = useMemo(() => {
    if (targetLocation) {
      return { longitude: targetLocation[1], latitude: targetLocation[0], zoom: 14 };
    }

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

      const computedLeftPadding = leftPadding + 80;

      if (Math.abs(maxLat - minLat) < 0.0001 && Math.abs(maxLng - minLng) < 0.0001) {
        return { longitude: minLng, latitude: minLat, zoom: 13 };
      }

      return {
        bounds: [minLng, minLat, maxLng, maxLat] as [number, number, number, number],
        fitBoundsOptions: {
          padding: { top: 80, left: computedLeftPadding, right: 80, bottom: 80 + bottomPadding },
          maxZoom: 13,
        },
      };
    }

    return { longitude: center[1], latitude: center[0], zoom };
  }, [boundsToFit, visiblePins, pins, targetLocation, center, zoom, bottomPadding, leftPadding]);

  const updateBounds = useCallback(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    const b = map.getBearing();
    const p = map.getPitch();

    setCurrentZoom(map.getZoom());
    setBearing(b);
    setPitch(p);

    if (compassSvgRef.current) {
      compassSvgRef.current.style.transform = `perspective(60px) rotateX(${Math.min(p, 70)}deg)`;
    }
    if (compassGroupRef.current) {
      compassGroupRef.current.style.transform = `rotate(${-b}deg)`;
    }

    const bounds = map.getBounds();
    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();

    onBoundsChange(`${nw.lng},${nw.lat},${se.lng},${se.lat}`);
  }, [onBoundsChange]);

  const handleCombinedCompassTilt = () => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    const currentBearing = map.getBearing();
    const currentPitch = map.getPitch();

    if (Math.abs(currentBearing) > 0.5 || currentPitch > 5) {
      mapRef.current.easeTo({ bearing: 0, pitch: 0, duration: 300 });
    } else {
      mapRef.current.easeTo({ pitch: 60, duration: 300 });
    }
  };

  const applyBoundsToFit = useCallback(
    (bounds: [[number, number], [number, number]] | null, animate = true) => {
      if (!bounds || !mapRef.current) return;
      const [first, second] = bounds;

      const minLat = Math.min(first[0], second[0]);
      const maxLat = Math.max(first[0], second[0]);
      const minLng = Math.min(first[1], second[1]);
      const maxLng = Math.max(first[1], second[1]);

      const duration = animate ? 1200 : 0;
      const computedLeftPadding = leftPadding + 80;

      if (Math.abs(maxLat - minLat) < 0.0001 && Math.abs(maxLng - minLng) < 0.0001) {
        mapRef.current.flyTo({
          center: [minLng, minLat],
          zoom: 13,
          duration,
        });
      } else {
        mapRef.current.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          {
            padding: { top: 80, left: computedLeftPadding, right: 80, bottom: 80 + bottomPadding },
            maxZoom: 13,
            duration,
          }
        );
      }
    },
    [leftPadding, bottomPadding]
  );

  // Camera movements for targetLocation
  useEffect(() => {
    if (
      targetLocation &&
      (targetLocation[0] !== lastTarget.current?.[0] || targetLocation[1] !== lastTarget.current?.[1])
    ) {
      mapRef.current?.flyTo({
        center: [targetLocation[1], targetLocation[0]], // [lng, lat]
        zoom: 14,
        duration: 1500,
      });
      lastTarget.current = targetLocation;
    }
  }, [targetLocation]);

  // Camera movements for targetPinId
  useEffect(() => {
    if (!targetPinId || targetPinId === lastTargetPinId.current) return;
    lastTargetPinId.current = targetPinId;
    const pin = pins?.find((p) => p.id === targetPinId);
    if (!pin || !mapRef.current) return;

    const map = mapRef.current.getMap();
    const bounds = map.getBounds();
    if (!bounds.contains([pin.lng, pin.lat])) {
      map.flyTo({
        center: [pin.lng, pin.lat],
        zoom: map.getZoom(),
        duration: 1200,
      });
    }
  }, [targetPinId, pins]);



  // Camera movements for boundsToFit (subsequent changes only, preventing initial zoom shift)
  useEffect(() => {
    if (!isMapLoaded) return;

    if (!hasFitInitialBoundsRef.current) {
      hasFitInitialBoundsRef.current = true;
      return;
    }

    if (boundsToFit && Array.isArray(boundsToFit) && boundsToFit.length === 2) {
      applyBoundsToFit(boundsToFit, true);
    }
  }, [boundsToFit, isMapLoaded, applyBoundsToFit]);

  const handleMyLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          mapRef.current?.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: 16,
            duration: 1500,
          });
        },
        (err) => console.warn('Location lookup failed:', err),
        { enableHighAccuracy: true }
      );
    }
  };

  const previewMarker = previewLocation ? getPreviewMarkerHTML() : null;

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {mapStyle && (
        <Map
          attributionControl={false}
          localIdeographFontFamily="'Noto Sans CJK JP', 'Hiragino Kaku Gothic ProN', 'Meiryo', 'Yu Gothic', sans-serif"
          ref={(instance) => {
            mapRef.current = instance;
            if (instance) {
              const map = instance.getMap();
              if (map && typeof map.setMissingStyleImageResolver === 'function') {
                map.setMissingStyleImageResolver((id: string) => {
                  if (!map.hasImage(id)) {
                    try {
                      map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
                    } catch {}
                  }
                });
              }
            }
          }}
          initialViewState={initialViewState}
          mapStyle={mapStyle}
          style={{ width: '100%', height: '100%' }}
          doubleClickZoom={false}
          maxZoom={22}
          minZoom={1}
          maxPitch={85}
          onLoad={(e: any) => {
            setIsMapLoaded(true);
            const map = e.target || mapRef.current?.getMap();
            if (map && typeof map.setMissingStyleImageResolver === 'function') {
              map.setMissingStyleImageResolver((id: string) => {
                if (!map.hasImage(id)) {
                  try {
                    map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
                  } catch {}
                }
              });
            }
            if (mapRef.current) {
              const m = mapRef.current.getMap();
              setCurrentZoom(m.getZoom());
              setBearing(m.getBearing());
              setPitch(m.getPitch());
            }
          }}
          onMove={() => {
            if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
            touchStartRef.current = null;
            updateBounds();
          }}
          onRotate={updateBounds}
          onPitch={updateBounds}
          onMoveEnd={updateBounds}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
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
            if (!e.defaultPrevented) {
              onBackgroundClick?.();
            }
          }}
        >
          <AttributionControl compact={true} customAttribution={`OurMaps v.${import.meta.env.VITE_APP_BUILD_TIME || 'dev'}`} />
          <UserLocationMarker />
          {visiblePins.map((pin) => (
            <PinMarker
              key={pin.id}
              pin={pin}
              onUpdatePin={onUpdatePin}
              onHoverPin={onHoverPin}
              onPinClick={(clickedPin) => {
                setPendingContextLocation(null);
                onPinClick?.(clickedPin);
              }}
              hoveredPinId={hoveredPinId}
              targetPinId={targetPinId}
              editingPinId={editingPinId}
              readOnly={readOnly}
            />
          ))}

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
                dangerouslySetInnerHTML={{ __html: previewMarker.html }}
              />
            </Marker>
          )}
        </Map>
      )}

      {/* Live Zoom Level Indicator Pill (Dev Server Only) */}
      {import.meta.env.DEV && (
        <div className="zoom-level-pill">
          Zoom: {currentZoom.toFixed(1)}
        </div>
      )}

      {/* Combined Compass & Tilt Indicator Control */}
      <button
        onClick={handleCombinedCompassTilt}
        style={{
          position: 'absolute',
          bottom: '60px',
          right: '12px',
          width: '42px',
          height: '42px',
          borderRadius: '12px',
          background: 'white',
          border: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 1000,
          color: 'var(--primary-color)',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#f8f9fa')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
        title={`Heading: ${Math.round((bearing % 360 + 360) % 360)}°, Tilt: ${Math.round(pitch)}° (Click to reset)`}
        aria-label="Compass - Reset bearing to North"
      >
        <svg
          ref={compassSvgRef}
          width="34"
          height="34"
          viewBox="0 0 24 24"
          style={{
            transform: `perspective(60px) rotateX(${Math.min(pitch, 70)}deg)`,
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
            willChange: 'transform',
          }}
        >
          <g
            ref={compassGroupRef}
            style={{
              transform: `rotate(${-bearing}deg)`,
              transformOrigin: '12px 12px',
              willChange: 'transform',
            }}
          >
            {/* Thin outer ring around compass */}
            <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
            {/* North pointer (solid red) */}
            <polygon points="12,1 17,12 7,12" fill="#ea4335" />
            {/* South pointer (solid dark grey) */}
            <polygon points="12,23 17,12 7,12" fill="#374151" />
          </g>
        </svg>
      </button>

      <button
        onClick={handleMyLocation}
        style={{
          position: 'absolute',
          bottom: '10px',
          right: '12px',
          width: '42px',
          height: '42px',
          borderRadius: '12px',
          background: 'white',
          border: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 1000,
          color: 'var(--primary-color)',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#f8f9fa')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
        title="Find my location"
      >
        <Locate size={24} />
      </button>

      <style>{`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(66, 133, 244, 0.7); }
          70% { box-shadow: 0 0 0 15px rgba(66, 133, 244, 0); }
          100% { box-shadow: 0 0 0 0 rgba(66, 133, 244, 0); }
        }
        .maplibregl-container {
          background-color: ${
            mapTheme === 'dark'
              ? '#1f1f1f'
              : mapTheme === 'black'
              ? '#000000'
              : mapTheme === 'white'
              ? '#ffffff'
              : mapTheme === 'grayscale'
              ? '#f0f0f0'
              : '#f8f9fa'
          };
        }
        .maplibregl-ctrl-attrib {
          display: inline-flex !important;
          flex-direction: row-reverse !important;
          align-items: center !important;
          margin: 0 60px 10px 0 !important;
        }
        .maplibregl-ctrl-attrib a.maplibregl-compact {
          order: 99 !important;
        }
        .add-pin-context-popup .maplibregl-popup-content {
          background: transparent !important;
          box-shadow: none !important;
          padding: 0 !important;
          border-radius: 0 !important;
        }
        .add-pin-context-popup .maplibregl-popup-tip {
          border-top-width: 20px !important;
          border-left-width: 10px !important;
          border-right-width: 10px !important;
          border-top-color: var(--primary-color, #483D8B) !important;
          border-bottom-color: var(--primary-color, #483D8B) !important;
          margin-top: -1px;
        }
      `}</style>
    </div>
  );
};

export default MapView;
