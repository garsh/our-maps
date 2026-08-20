import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Map, { Marker, Popup, type MapRef } from 'react-map-gl/maplibre';
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
  isOffline = false,
}: MapViewProps) => {
  const mapRef = useRef<MapRef | null>(null);
  const readOnly = userRole === 'view' || isOffline;
  const lastTarget = useRef<[number, number] | null>(null);
  const lastTargetPinId = useRef<string | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [currentZoom, setCurrentZoom] = useState<number>(zoom);
  const hasFitInitialBoundsRef = useRef(false);

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

      if (validFlavor === 'light') {
        // Land & Water
        if (l.id === 'background') l.paint['background-color'] = '#fcfbfa';
        if (l.id === 'earth') l.paint['fill-color'] = '#f8f7f4';
        if (l.id === 'water') l.paint['fill-color'] = '#a0c8f0';
        if (l.id.includes('water_river') || l.id.includes('water_stream')) l.paint['line-color'] = '#a0c8f0';
        if (l.id === 'landuse_park' || l.id === 'landuse_urban_green') l.paint['fill-color'] = '#d8ebd2';
        if (l.id === 'buildings') { l.paint['fill-color'] = '#e8e4dc'; l.paint['fill-opacity'] = 0.7; }
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

    if (showHillshade) {
      const hillshadeLayer = {
        id: 'hills',
        type: 'hillshade',
        source: 'terrainDem',
        paint: {
          'hillshade-exaggeration': validFlavor === 'dark' ? 0.35 : 0.45,
          'hillshade-shadow-color': validFlavor === 'dark' ? '#000000' : '#473B24',
          'hillshade-highlight-color': validFlavor === 'dark' ? '#2c3340' : '#FFFFFF',
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
          attribution: `OurMaps v.${import.meta.env.VITE_APP_BUILD_TIME || 'dev'} &copy; <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> &copy; <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>`,
        },
        ...(showHillshade
          ? {
              terrainDem: {
                type: 'raster-dem',
                tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                encoding: 'terrarium',
                tileSize: 256,
                maxzoom: 15,
                attribution: '&copy; <a href="https://github.com/tilezen/joerd" target="_blank" rel="noopener">Mapzen / AWS Elevation</a>',
              },
            }
          : {}),
      },
      layers: customLayers,
    };
  }, [mapTheme, showHillshade]);

  const visiblePins = useMemo(
    () => pins.filter((pin) => !hiddenLayerIds?.has(pin.layerId || null)),
    [pins, hiddenLayerIds]
  );
  const selectedPin = targetPinId ? visiblePins.find((p) => p.id === targetPinId) : null;

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
    setCurrentZoom(map.getZoom());
    const bounds = map.getBounds();
    const nw = bounds.getNorthWest();
    const se = bounds.getSouthEast();

    onBoundsChange(`${nw.lng},${nw.lat},${se.lng},${se.lat}`);
  }, [onBoundsChange]);

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
            if (mapRef.current) setCurrentZoom(mapRef.current.getZoom());
          }}
          onMove={updateBounds}
          onMoveEnd={updateBounds}
          onContextMenu={(e: maplibregl.MapLayerMouseEvent) => {
            onMapClick(e.lngLat.lat, e.lngLat.lng);
          }}
          onClick={(e: maplibregl.MapLayerMouseEvent) => {
            if (!e.defaultPrevented) {
              onBackgroundClick?.();
            }
          }}
        >
          <UserLocationMarker />
          {visiblePins.map((pin) => (
            <PinMarker
              key={pin.id}
              pin={pin}
              onUpdatePin={onUpdatePin}
              onHoverPin={onHoverPin}
              onPinClick={onPinClick}
              hoveredPinId={hoveredPinId}
              targetPinId={targetPinId}
              editingPinId={editingPinId}
              readOnly={readOnly}
            />
          ))}
          {selectedPin && (
            <Popup
              longitude={selectedPin.lng}
              latitude={selectedPin.lat}
              anchor="top"
              closeButton={false}
              closeOnClick={false}
              className="modern-popup"
            >
              <div className="leaflet-popup-content" style={{ margin: 0, padding: '4px' }}>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 600 }}>{selectedPin.label}</h3>
                {selectedPin.address && <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: '#666' }}>{selectedPin.address}</p>}
                {selectedPin.description && <p style={{ margin: '0 0 4px 0', fontSize: '12px' }}>{selectedPin.description}</p>}
                {selectedPin.imageUrl && <img src={selectedPin.imageUrl} alt={selectedPin.label} style={{ maxWidth: '100%', borderRadius: '8px' }} />}
              </div>
            </Popup>
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

      <button
        onClick={handleMyLocation}
        style={{
          position: 'absolute',
          bottom: '24px',
          right: '24px',
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          background: 'white',
          border: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
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
          background-color: var(--bg-color);
        }
        .maplibregl-ctrl-attrib {
          display: inline-flex !important;
          flex-direction: row-reverse !important;
          align-items: center !important;
        }
        .maplibregl-ctrl-attrib a.maplibregl-compact {
          order: 99 !important;
        }
      `}</style>
    </div>
  );
};

export default MapView;
