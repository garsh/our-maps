import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
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
import { clearHoveredPin, getHoveredPinId, useDraggingPinId, useHoveredPinId, hasFinePointer } from '../utils/pinHover';
import { setMapViewportBounds } from '../utils/mapViewport';
import { ensurePinImageByKey, ensurePinImages, getPinIconKey, clearRegisteredImages } from '../utils/pinIconSprite';
import { applyBundledSprites, applyBundledSpriteById, isBundledSpriteId } from '../utils/basemapSprites';

maplibregl.setWorkerUrl(workerUrl);

export function toSafeLngLat(coord: any) {
  if (coord && typeof coord.wrap === 'function') return coord;
  const lng = Number(coord?.lng ?? coord?.[0] ?? 0);
  const lat = Number(coord?.lat ?? coord?.[1] ?? 0);
  if (typeof (maplibregl as any)?.LngLat === 'function') {
    try {
      return new (maplibregl as any).LngLat(lng, lat);
    } catch {}
  }
  return {
    lng,
    lat,
    wrap() {
      const wrappedLng = ((((lng + 180) % 360) + 360) % 360) - 180;
      return { lng: wrappedLng, lat, wrap() { return this; } };
    },
    toArray() {
      return [lng, lat];
    },
  };
}

function attachMissingImageResolver(map: any, getTheme: () => 'light' | 'dark') {
  if (!map || typeof map.setMissingStyleImageResolver !== 'function') return;
  map.setMissingStyleImageResolver(async (id: string) => {
    if (typeof id === 'string' && id.startsWith('pin-')) {
      await ensurePinImageByKey(map, id);
      return;
    }
    if (typeof id === 'string' && isBundledSpriteId(id)) {
      await applyBundledSpriteById(map, id, getTheme());
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

/** MapLibre treats status 404 as a missing tile and overzooms a parent. Other throws abort the tile. */
function throwTileNotFound(z: string | number, x: string | number, y: string | number): never {
  const err = new Error(`Tile not found: ${z}/${x}/${y}`) as Error & { status: number };
  err.status = 404;
  throw err;
}

/**
 * Read one tile from the live planet archive.
 * Returns null when the browser is offline, the archive has no bytes for this
 * tile, or the request fails. A 0-byte body is a miss: MapLibre would treat it
 * as a valid empty tile and skip parent overzoom. Aborts propagate.
 */
async function readLivePlanetTile(
  params: { url: string },
  abortController: AbortController,
) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  try {
    const result = await globalPMTilesProtocol!.tilev4(params, abortController);
    const data = result?.data;
    if (data instanceof Uint8Array && data.byteLength > 0) return result;
    return null;
  } catch (err) {
    if (abortController.signal.aborted) throw err;
    return null;
  }
}

/**
 * Lowest elevation, in meters, among DEM tiles currently in view.
 * `dem.min` is the raw terrarium sample; mesh fallbacks from
 * `getMinMaxElevation` already include exaggeration.
 * Returns null when no finite sample is loaded. Offscreen cached tiles are
 * ignored so the far plane stays near the terrain on screen.
 */
export function lowestVisibleTerrainElevation(terrain: any): number | null {
  if (!terrain) return null;
  const exaggeration = typeof terrain.exaggeration === 'number' && Number.isFinite(terrain.exaggeration)
    ? terrain.exaggeration
    : 1;

  try {
    const demTiles = terrain.tileManager?.tileManager?._inViewTiles?.getAllTiles?.();
    if (demTiles && typeof demTiles[Symbol.iterator] === 'function') {
      let lowest: number | null = null;
      for (const tile of demTiles) {
        const demMin = tile?.dem?.min;
        if (typeof demMin !== 'number' || !Number.isFinite(demMin)) continue;
        const elevated = demMin * exaggeration;
        lowest = lowest === null ? elevated : Math.min(lowest, elevated);
      }
      if (lowest !== null) return lowest;
    }
  } catch {}

  if (typeof terrain.getMinMaxElevation !== 'function') return null;
  let meshTiles: any;
  try {
    meshTiles = terrain.tileManager?.getRenderableTiles?.();
  } catch {
    return null;
  }
  if (!meshTiles || typeof meshTiles[Symbol.iterator] !== 'function') return null;

  let lowest: number | null = null;
  for (const tile of meshTiles) {
    if (!tile?.tileID) continue;
    let minElevation: unknown;
    try {
      minElevation = terrain.getMinMaxElevation(tile.tileID)?.minElevation;
    } catch {
      continue;
    }
    if (typeof minElevation !== 'number' || !Number.isFinite(minElevation)) continue;
    lowest = lowest === null ? minElevation : Math.min(lowest, minElevation);
  }
  return lowest;
}

/**
 * MapLibre sizes the far plane from the DEM tile under the camera. Around
 * Hawaii that tile is often an island near sea level while neighboring tiles
 * hold the Pacific floor (about −5,000 m), so the abyss is clipped and the
 * water color stops offshore. Each render resets this value from the center
 * tile before the matrices are built. Lower it to the deepest in-view sample
 * so the seafloor, shelves, and underwater hillshade stay inside the clip.
 * Leave bathymetry in the DEM. Flattening red below 128, or `dem.min`, to
 * 0 m erases shelves and underwater hillshade. That dropout has been
 * reintroduced that way before. Camera elevation is untouched.
 * See AGENTS.md, "3D Terrain Ocean Color".
 */
function extendFarPlaneForVisibleBathymetry(transform: any, terrain: any) {
  const visibleMin = lowestVisibleTerrainElevation(terrain);
  if (visibleMin === null || !Number.isFinite(visibleMin)) return;
  const current = transform?.minElevationForCurrentTile;
  if (typeof current === 'number' && Number.isFinite(current) && visibleMin >= current) return;
  const helper = transform?._helper;
  if (helper && typeof helper.setMinElevationForCurrentTile === 'function') {
    helper.setMinElevationForCurrentTile(visibleMin);
    return;
  }
  if (typeof transform?.setMinElevationForCurrentTile === 'function') {
    transform.setMinElevationForCurrentTile(visibleMin);
    return;
  }
  if (helper) helper._minElevationForCurrentTile = visibleMin;
}

export function syncOfflineTerrain(mapInput: any, show3DTerrain: boolean) {
  if (!mapInput) return;
  const map = typeof mapInput.getMap === 'function' ? mapInput.getMap() : mapInput;
  if (!map || typeof map.setTerrain !== 'function') return;
  try {
    const hasTerrain = typeof map.getTerrain === 'function' ? !!map.getTerrain() : false;
    if (show3DTerrain) {
      if (!hasTerrain) {
        map.setTerrain({ source: 'terrainElevation', exaggeration: 1.0 });
      }
      if (map.terrain?.tileManager) {
        // Allow terrain RTT generation up to zoom 22 so vector roads and linear features
        // are rendered at full screen resolution without pixelation, blur, or stair-stepping.
        map.terrain.tileManager.maxzoom = 22;

        const ttmProto = Object.getPrototypeOf(map.terrain.tileManager);
        if (ttmProto && !ttmProto._stableReleaseRTT && typeof ttmProto.releaseRTT === 'function') {
          ttmProto._stableReleaseRTT = ttmProto.releaseRTT;
          ttmProto.releaseRTT = function (tileID: any) {
            let releasedCount = 0;
            const painter = this.tileManager?.map?.painter || map.painter;
            for (const key in this._tiles) {
              const tile = this._tiles[key];
              if (!tile?.tileID || !tileID) continue;
              const tId = tile.tileID;
              if (tId.wrap !== tileID.wrap) continue;

              // Match overlapping tiles using canonical coordinates.
              // Upstream MapLibre checks tile.tileID.equals(tileID) || tile.tileID.isChildOf(tileID) || tileID.isChildOf(tile.tileID)
              // on OverscaledTileID, which fails when terrain tile canonical.z > 15 while vector source canonical.z = 15.
              const canonicalMatch = (
                (typeof tId.canonical?.equals === 'function' && tId.canonical.equals(tileID.canonical)) ||
                (typeof tId.canonical?.isChildOf === 'function' && tId.canonical.isChildOf(tileID.canonical)) ||
                (typeof tileID.canonical?.isChildOf === 'function' && tileID.canonical.isChildOf(tId.canonical))
              );

              if (canonicalMatch || (typeof tId.equals === 'function' && tId.equals(tileID))) {
                tile.releaseRTT(painter);
                releasedCount++;
              }
            }
            if (releasedCount > 0) {
              const mapInst = this.tileManager?.map || map;
              if (typeof mapInst?.triggerRepaint === 'function') {
                mapInst.triggerRepaint();
              }
            }
          };
        }
      }

      const painter = map.painter;
      const rtt = painter?.renderToTexture;
      if (rtt) {
        const rttProto = Object.getPrototypeOf(rtt);
        if (rttProto && !rttProto._stablePrepareForRender && typeof rttProto.prepareForRender === 'function') {
          rttProto._stablePrepareForRender = rttProto.prepareForRender;
          rttProto.prepareForRender = function (style: any, zoom: number) {
            this._stablePrepareForRender.call(this, style, zoom);

            // Invalidate any terrain RTT tiles that were acquired when vector coordinates were empty/loading,
            // once vector tile coordinates or fingerprints become available.
            if (this._renderableTiles && this._rttFingerprints) {
              for (const tile of this._renderableTiles) {
                for (const source in this._rttFingerprints) {
                  const fingerprint = this._rttFingerprints[source]?.[tile.tileID?.key];
                  const currentFp = tile.rttFingerprint?.[source];
                  if (fingerprint && fingerprint !== currentFp) {
                    tile.releaseRTT(this.painter);
                  }
                }
              }
            }
          };
        }
      }
      if (map.terrain && !map.terrain._originalGetDEMTileMatrix) {
        map.terrain._originalGetDEMTileMatrix = map.terrain._getDEMTileMatrix;
        map.terrain._demMatrixCache?.clear?.();
        map.terrain._elevationSamplerCache?.clear?.();
        map.terrain._getDEMTileMatrix = function (tileID: any, sourceTile: any) {
          if (sourceTile?.dem) {
            const proto = Object.getPrototypeOf(sourceTile.dem);
            if (proto && !proto._safeSampleBilinear && typeof proto.sampleBilinear === 'function') {
              proto._safeSampleBilinear = proto.sampleBilinear;
              proto.sampleBilinear = function (x: number, y: number) {
                const dim = this.dim || 256;
                const clampedX = Math.max(-1, Math.min(dim - 1e-4, x));
                const clampedY = Math.max(-1, Math.min(dim - 1e-4, y));
                return proto._safeSampleBilinear.call(this, clampedX, clampedY);
              };
            }
          }

          const matrixKey = `${sourceTile.tileID?.key || ''}/${tileID.key || ''}`;
          const cachedMatrix = this._demMatrixCache?.get?.(matrixKey);
          if (cachedMatrix) return cachedMatrix;

          // MapLibre bug fix: dz must be the true zoom difference between the tile geometry
          // and the covering parent DEM tile (sourceTile.tileID.canonical.z).
          // MapLibre's built-in code had `if (tileID.canonical.z >= maxzoom) dz = tileID.canonical.z - maxzoom`
          // which falsely assumes sourceTile is at maxzoom (15). When zoom 15 is missing offline and
          // sourceTile is an ancestor (e.g. z=14), MapLibre sets dz=0 or the wrong dz, corrupting
          // u_terrain_matrix and projecting 3D buildings and pin symbols to the wrong elevation
          // (underground / culled by terrain depth).
          // Crucially: targetCanonicalZ and sourceCanonicalZ MUST be floored to integers.
          // In getElevationForLngLatZoom, MapLibre passes floating point zooms (e.g. 18.59, 18.62).
          // If dz is fractional, pow2dz is non-integer, causing targetCanonicalX % pow2dz to oscillate
          // chaotically across the DEM tile, resulting in 1,000+ meter elevation spikes and camera jumping.
          const sourceCanonicalZ = Math.floor(sourceTile.tileID?.canonical?.z ?? sourceTile.canonical?.z ?? 0);
          const targetCanonicalZ = Math.floor(tileID.canonical?.z ?? tileID.overscaledZ ?? 0);
          const targetCanonicalX = Math.floor(tileID.canonical?.x ?? 0);
          const targetCanonicalY = Math.floor(tileID.canonical?.y ?? 0);

          const dz = Math.max(0, targetCanonicalZ - sourceCanonicalZ);
          const pow2dz = 1 << dz;
          const dx = targetCanonicalX % pow2dz;
          const dy = targetCanonicalY % pow2dz;
          // MapLibre internal tile coordinate extent is EXTENT = 8192 (not 4096).
          // Using 4096 doubled the DEM pixel scale and caused coordinates to exceed dim (256),
          // throwing RangeError: Out of range source coordinates for DEM data in sampleBilinear.
          const EXTENT = 8192;
          const s = 1 / (EXTENT * pow2dz);
          const demMatrix = new Float64Array(16);
          demMatrix[0] = s;
          demMatrix[5] = s;
          demMatrix[12] = dx / pow2dz;
          demMatrix[13] = dy / pow2dz;
          demMatrix[15] = 1;
          this._demMatrixCache?.set?.(matrixKey, demMatrix);
          return demMatrix;
        };
      }

      if (map.terrain && !map.terrain._originalGetOverscaledTileIDFromLngLatZoom && typeof map.terrain._getOverscaledTileIDFromLngLatZoom === 'function') {
        map.terrain._originalGetOverscaledTileIDFromLngLatZoom = map.terrain._getOverscaledTileIDFromLngLatZoom;
        map.terrain._getOverscaledTileIDFromLngLatZoom = function (lnglat: any, zoom: number) {
          // MapLibre's built-in _getOverscaledTileIDFromLngLatZoom passes float zoom into OverscaledTileID constructor,
          // which corrupts canonical.z to a float and misses caches. Floor zoom to integer tile levels.
          return this._originalGetOverscaledTileIDFromLngLatZoom.call(this, lnglat, Math.floor(zoom));
        };
      }

      const terrainProto = map.terrain ? Object.getPrototypeOf(map.terrain) : null;
      if (terrainProto && terrainProto !== Object.prototype && !terrainProto._stableGetMinTileElevationForLngLatZoom && typeof terrainProto.getMinTileElevationForLngLatZoom === 'function') {
        terrainProto._stableGetMinTileElevationForLngLatZoom = terrainProto.getMinTileElevationForLngLatZoom;
        terrainProto.getMinTileElevationForLngLatZoom = function (lngLat: any, zoom: number) {
          const safeLngLat = toSafeLngLat(lngLat);
          return this._stableGetMinTileElevationForLngLatZoom.call(this, safeLngLat, zoom);
        };
      }

      // Stabilize camera against MapLibre terrain zoom jumping and pushback above zoom 16:
      const camera = (map as any)._camera;
      if (camera) {
        const cameraProto = Object.getPrototypeOf(camera);
        if (cameraProto && !cameraProto._stableElevateCameraIfInsideTerrain && typeof cameraProto._elevateCameraIfInsideTerrain === 'function') {
          cameraProto._stableElevateCameraIfInsideTerrain = cameraProto._elevateCameraIfInsideTerrain;
          cameraProto._elevateCameraIfInsideTerrain = function (tr: any) {
            // When pitch is low (< 45 deg), the user is viewing top-down.
            // In deep zoom (z > 16), MapLibre's built-in formula pushes the camera's zoom
            // backwards to ~16.98 whenever cameraAltitude approaches terrain elevation,
            // creating an aggressive tug-of-war zoom jump against the user's scroll input.
            // By returning { elevation: minAltitude }, we keep camera above ground without resetting the user's zoom.
            if (tr?.pitch < 45) {
              if (!this.terrain && tr.elevation >= 0) return {};
              const cameraLngLat = tr.getCameraLngLat?.();
              const cameraAltitude = tr.getCameraAltitude?.();
              const minAltitude = this.terrain && typeof this.terrain.getElevationForLngLatZoom === 'function' && cameraLngLat
                ? this.terrain.getElevationForLngLatZoom(cameraLngLat, Math.floor(tr.zoom))
                : 0;
              if (typeof minAltitude === 'number' && Number.isFinite(minAltitude) && typeof cameraAltitude === 'number' && cameraAltitude < minAltitude) {
                return { elevation: minAltitude };
              }
              return {};
            }
            return this._stableElevateCameraIfInsideTerrain.call(this, tr);
          };
        }
        if (cameraProto && !cameraProto._stableFinalizeElevation && typeof cameraProto._finalizeElevation === 'function') {
          cameraProto._stableFinalizeElevation = cameraProto._finalizeElevation;
          cameraProto._finalizeElevation = function () {
            if ((this.transform?.pitch ?? 0) < 60) {
              // Clearing the freeze here is what lets the render loop write the
              // arrival zoom's DEM after the camera has already stopped. An
              // animated fit holds only when that arrival tile is already loaded.
              if (!this._holdElevation) this.elevationFreeze = false;
              return;
            }
            this.elevationFreeze = false;
            return this._stableFinalizeElevation.call(this);
          };
        }
        if (cameraProto && !cameraProto._stableUpdateElevation && typeof cameraProto._updateElevation === 'function') {
          cameraProto._stableUpdateElevation = cameraProto._updateElevation;
          cameraProto._updateElevation = function (k: number) {
            const result = this._stableUpdateElevation.call(this, k);
            // applyUpdatedTransform copies the flight clone back over the live
            // height on every frame. Keep the tracked height on that clone or
            // the zoom finishes on the plane it started from.
            const tracked = readTransformElevation(this.transform);
            const requested = this._requestedCameraState;
            if (requested && typeof tracked === 'number' && Number.isFinite(tracked)) {
              writeStableElevation(requested, tracked);
            }
            return result;
          };
        }
        if (cameraProto && !cameraProto._stableApplyUpdatedTransform && typeof cameraProto.applyUpdatedTransform === 'function') {
          cameraProto._stableApplyUpdatedTransform = cameraProto.applyUpdatedTransform;
          cameraProto.applyUpdatedTransform = function (tr: any) {
            const beforeCenter = this.transform?.center
              ? toSafeLngLat(this.transform.center)
              : null;
            const res = this._stableApplyUpdatedTransform.call(this, tr);
            if ((this.transform?.pitch ?? 0) < 60 && beforeCenter && this.transform?.center) {
              const handlers = (map as any)._handlers;
              const isMoving = (
                handlers?.isMoving?.() ||
                handlers?.isZooming?.() ||
                (map as any)?.scrollZoom?.isZooming?.() ||
                handlers?._terrainMovement
              );
              // Only when genuinely idle (after gesture is completely finished), prevent tiny sub-millimeter noise drift.
              // Never revert macroscopic deltas (> 1e-7 deg ~ 1cm), as those are legitimate camera movements.
              if (!isMoving) {
                const dLng = this.transform.center.lng - beforeCenter.lng;
                const dLat = this.transform.center.lat - beforeCenter.lat;
                if (Math.hypot(dLng, dLat) > 1e-11 && Math.hypot(dLng, dLat) < 1e-7) {
                  this.transform.setCenter(beforeCenter);
                }
              }
            }
            return res;
          };
        }
      }

      const tr = (map as any)._camera?.transform || (map as any).transform;
      if (tr) {
        const trProto = Object.getPrototypeOf(tr);
        if (trProto && !trProto._stableSetCenter && typeof trProto.setCenter === 'function') {
          trProto._stableSetCenter = trProto.setCenter;
          trProto.setCenter = function (center: any) {
            const safeCenter = toSafeLngLat(center);
            return this._stableSetCenter.call(this, safeCenter);
          };
        }
        if (trProto && !trProto._stableRecalculateZoomAndCenter && typeof trProto.recalculateZoomAndCenter === 'function') {
          trProto._stableRecalculateZoomAndCenter = trProto.recalculateZoomAndCenter;
          trProto.recalculateZoomAndCenter = function (terrain?: any) {
            if (this.pitch < 60) {
              // When pitch is < 60, the camera is viewing top-down or gentle tilt.
              // MapLibre's default recalculateZoomAndCenter reads center from the GPU depth
              // framebuffer via screenPointToLocation(this.centerPoint, terrain) and recalculates
              // zoom & center, causing a visible "nudge" / repositioning ~200ms after zooming stops.
              // Instead, preserve exact center and zoom, and only update the ground elevation.
              if (terrain && typeof terrain.getElevationForLngLatZoom === 'function') {
                const tileZ = this._helper?._tileZoom ?? Math.max(0, Math.floor(this.zoom));
                const ele = terrain.getElevationForLngLatZoom(this.center, tileZ);
                if (typeof ele === 'number' && Number.isFinite(ele)) {
                  this.setElevation(ele);
                }
              }
              return;
            }
            const currentZoom = this.zoom;
            const currentCenter = this.center;
            this._stableRecalculateZoomAndCenter.call(this, terrain);
            if (typeof currentZoom === 'number' && Number.isFinite(currentZoom)) {
              this.setZoom(currentZoom);
            }
            if (currentCenter && this.pitch < 60) {
              this.setCenter(toSafeLngLat(currentCenter));
            }
          };
        }
        if (trProto && !trProto._stableSetElevation && typeof trProto.setElevation === 'function') {
          trProto._stableSetElevation = trProto.setElevation;
          trProto.setElevation = function (elevation: number) {
            const current = readTransformElevation(this);
            if (typeof current === 'number' && elevation === current) return;
            // A DEM tile that has not loaded reports 0. Do not drop a real height to sea level.
            if (rejectUnloadedSeaLevel(map, elevation, current)) return;
            // In top-down / low pitch mode (pitch < 60), if the map is idle and not in active movement,
            // avoid sudden vertical elevation jumps (> 0.05m) that scale perspective in a single frame.
            const handlers = (map as any)._handlers;
            const isIdle = !handlers?.isMoving?.() && !handlers?._terrainMovement;
            if (this.pitch < 60 && isIdle && typeof this._elevation === 'number' && Number.isFinite(this._elevation)) {
              const delta = elevation - this._elevation;
              if (Math.abs(delta) > 0.05) {
                const step = Math.sign(delta) * Math.min(Math.abs(delta) * 0.25, 0.5);
                const nextEle = this._elevation + step;
                this._stableSetElevation.call(this, nextEle);
                if (typeof map.triggerRepaint === 'function') {
                  map.triggerRepaint();
                }
                return;
              }
            }
            return this._stableSetElevation.call(this, elevation);
          };
        }
        if (trProto && typeof trProto._calculateNearFarZIfNeeded === 'function') {
          // Keep ocean color by extending the far plane to in-view bathymetry.
          // Do not remove this wrap, and do not flatten DEM samples below sea
          // level (AGENTS.md, "3D Terrain Ocean Color"). The wrap is installed
          // once on the shared prototype. Refresh the map every sync so an
          // orientation remount reads the live terrain.
          trProto._visibleBathymetryMap = map;
          if (!trProto._stableCalculateNearFarZIfNeeded) {
            trProto._stableCalculateNearFarZIfNeeded = trProto._calculateNearFarZIfNeeded;
            trProto._calculateNearFarZIfNeeded = function (cameraToSeaLevelDistance: number, limitedPitchRadians: number, offset: any) {
              try {
                extendFarPlaneForVisibleBathymetry(this, trProto._visibleBathymetryMap?.terrain);
              } catch {}
              return this._stableCalculateNearFarZIfNeeded.call(this, cameraToSeaLevelDistance, limitedPitchRadians, offset);
            };
          }
        }
      }

      const helper = (map as any)._camera?.transform?._helper || (map as any).transform?._helper;
      if (helper) {
        const helperProto = Object.getPrototypeOf(helper);
        if (helperProto && !helperProto._stableSetCenter && typeof helperProto.setCenter === 'function') {
          helperProto._stableSetCenter = helperProto.setCenter;
          helperProto.setCenter = function (center: any) {
            const safeCenter = toSafeLngLat(center);
            return this._stableSetCenter.call(this, safeCenter);
          };
        }
        if (helperProto && !helperProto._stableRecalculateZoomAndCenter && typeof helperProto.recalculateZoomAndCenter === 'function') {
          helperProto._stableRecalculateZoomAndCenter = helperProto.recalculateZoomAndCenter;
          helperProto.recalculateZoomAndCenter = function (elevation: number) {
            if (this.pitch < 60) {
              if (typeof elevation === 'number' && Number.isFinite(elevation)) {
                this.setElevation(elevation);
              }
              return;
            }
            const currentZoom = this.zoom;
            const currentCenter = this.center;
            this._stableRecalculateZoomAndCenter.call(this, elevation);
            // Preserve user's zoom on moveend / terrain finalization so ground elevation differences
            // under the center point do not cause zoom levels to snap or oscillate.
            if (typeof currentZoom === 'number' && Number.isFinite(currentZoom)) {
              this.setZoom(currentZoom);
            }
            // In top-down / gentle pitch views, elevation adjustments must not shift the map center.
            if (currentCenter && this.pitch < 60) {
              const safeCenter = toSafeLngLat(currentCenter);
              if (typeof this.setCenter === 'function') {
                this.setCenter(safeCenter);
              } else {
                this._center = safeCenter;
              }
            }
          };
        }
      }

      // Guard handleMapControlsPan against empty deltas:
      // When scroll zooming stops, MapLibre's ScrollZoomHandler fires a 200ms finish timeout.
      // In terrain mode, if handleMapControlsPan is called with no deltas, setLocationAtPoint
      // calculates an erroneous offset between the 3D terrain hit point and the flat reference plane,
      // nudging the center point ~200ms after the user stopped scrolling.
      const cameraHelper = (map as any)._camera?.cameraHelper;
      if (cameraHelper) {
        const cameraHelperProto = Object.getPrototypeOf(cameraHelper);
        if (cameraHelperProto && !cameraHelperProto._stableHandleMapControlsPan && typeof cameraHelperProto.handleMapControlsPan === 'function') {
          cameraHelperProto._stableHandleMapControlsPan = cameraHelperProto.handleMapControlsPan;
          cameraHelperProto.handleMapControlsPan = function (deltas: any, tr: any, preZoomAroundLoc: any) {
            const hasPan = (deltas?.panDelta?.mag?.() ?? 0) > 0.05;
            const hasZoom = Math.abs(deltas?.zoomDelta ?? 0) > 1e-4;
            if (!hasPan && !hasZoom) return;
            if (deltas?.around && tr?.centerPoint && deltas.around.distSqr(tr.centerPoint) < 1.0e-2) return;
            return this._stableHandleMapControlsPan.call(this, deltas, tr, preZoomAroundLoc);
          };
        }
      }

      // Guard HandlerManager._updateMapTransform against mutating the transform when no deltas exist:
      const handlers = (map as any)._handlers;
      if (handlers) {
        const handlersProto = Object.getPrototypeOf(handlers);
        if (handlersProto && !handlersProto._stableUpdateMapTransform && typeof handlersProto._updateMapTransform === 'function') {
          handlersProto._stableUpdateMapTransform = handlersProto._updateMapTransform;
          handlersProto._updateMapTransform = function (combinedResult: any, combinedEventsInProgress: any, deactivatedHandlers: any) {
            const hasDelta = (
              (combinedResult?.panDelta?.mag?.() ?? 0) > 0.05 ||
              Math.abs(combinedResult?.zoomDelta ?? 0) > 1e-4 ||
              Math.abs(combinedResult?.bearingDelta ?? 0) > 1e-4 ||
              Math.abs(combinedResult?.pitchDelta ?? 0) > 1e-4 ||
              Math.abs(combinedResult?.rollDelta ?? 0) > 1e-4
            );
            // Guard against zero-delta frames calling _camera.stop(true) inside
            // _stableUpdateMapTransform, which would kill ongoing inertia easing.
            // NOTE: The upstream terrain&&_terrainMovement passthrough is intentionally
            // NOT restored here — on zero-delta terrain frames the anchor re-application
            // in _handleMapControls is a no-op anyway (around defaults to centerPoint,
            // both handleMapControlsPan guards return early), so skipping it is safe.
            if (!hasDelta) {
              this._fireEvents(combinedEventsInProgress, deactivatedHandlers, true);
              return;
            }
            const tracked = readTransformElevation(this._camera?.transform);
            const requested = this._camera?._requestedCameraState;
            if (requested && typeof tracked === 'number' && Number.isFinite(tracked)) {
              writeStableElevation(requested, tracked);
            }
            return this._stableUpdateMapTransform.call(this, combinedResult, combinedEventsInProgress, deactivatedHandlers);
          };
        }
        if (handlersProto && !handlersProto._stableTerrainGestureElevation && typeof handlersProto._terrainGestureElevation === 'function') {
          handlersProto._stableTerrainGestureElevation = handlersProto._terrainGestureElevation;
          handlersProto._terrainGestureElevation = function (terrain: any, around: any, aroundOnSurface: any, tr: any, combinedEventsInProgress: any) {
            // For top-down / low pitch (pitch < 60), pan and zoom gestures anchor to the
            // center-elevation ground plane (undefined aroundElevation -> z=0 relative to tr.elevation).
            // This eliminates gl.readPixels stalls and prevents off-center cursor anchor parallax
            // as tr.elevation tracks the terrain continuously during the gesture.
            if ((tr?.pitch ?? 0) < 60 && (combinedEventsInProgress?.zoom || combinedEventsInProgress?.drag)) {
              return undefined;
            }
            return this._stableTerrainGestureElevation.call(this, terrain, around, aroundOnSurface, tr, combinedEventsInProgress);
          };
        }
        if (handlersProto && !handlersProto._stableHandleMapControls && typeof handlersProto._handleMapControls === 'function') {
          handlersProto._stableHandleMapControls = handlersProto._handleMapControls;
          handlersProto._handleMapControls = function (args: any) {
            const res = this._stableHandleMapControls.call(this, args);
            // In top-down / low pitch terrain mode (pitch < 60), keep elevation unfrozen during both
            // pan and zoom and update the gesture transform clone's elevation on every frame.
            // Otherwise applyUpdatedTransform copies the start-of-gesture elevation back onto
            // camera.transform every frame and snaps to the new terrain elevation on mouse release.
            if ((this._camera?.transform?.pitch ?? 0) < 60 && this._camera) {
              const events = args?.combinedEventsInProgress;
              if (events?.zoom || events?.drag) {
                this._camera._holdElevation = false;
                this._camera.elevationFreeze = false;
                const targetTr = args?.tr;
                const terrain = args?.terrain || map.terrain;
                if (targetTr && terrain && targetTr.center && typeof terrain.getElevationForLngLatZoom === 'function') {
                  const tileZ = targetTr._helper?._tileZoom ?? targetTr.tileZoom ?? Math.max(0, Math.floor(targetTr.zoom ?? 0));
                  const ele = terrain.getElevationForLngLatZoom(toSafeLngLat(targetTr.center), tileZ);
                  if (typeof ele === 'number' && Number.isFinite(ele) && !rejectUnloadedSeaLevel(map, ele, readTransformElevation(targetTr))) {
                    writeStableElevation(targetTr, ele);
                    if (this._camera.transform && this._camera.transform !== targetTr) {
                      writeStableElevation(this._camera.transform, ele);
                    }
                  }
                }
              }
            }
            return res;
          };
        }
        if (handlersProto && !handlersProto._stableFireEvents && typeof handlersProto._fireEvents === 'function') {
          handlersProto._stableFireEvents = handlersProto._fireEvents;
          handlersProto._fireEvents = function (newEventsInProgress: any, deactivatedHandlers: any, allowEndAnimation: any) {
            const isHandlerStillActive = () => {
              for (const name in this._eventsInProgress) {
                const { handlerName } = this._eventsInProgress[name] || {};
                if (!handlerName || this._handlersById?.[handlerName]?.isActive?.()) {
                  return true;
                }
              }
              for (const name in newEventsInProgress) {
                const { handlerName } = newEventsInProgress[name] || {};
                if (!handlerName || this._handlersById?.[handlerName]?.isActive?.()) {
                  return true;
                }
              }
              return false;
            };

            const stillMoving = isHandlerStillActive();

            // Finalize terrain gesture state and clear inertia when all active handlers have ended
            // so pan/zoom stops immediately on mouse release without a post-release shift or coast.
            if (!stillMoving && (this._camera?.transform?.pitch ?? 0) < 60 && this._camera) {
              this._inertia?.clear?.();
              if (this._terrainMovement) {
                this._camera.elevationFreeze = false;
                this._terrainMovement = false;
                this._terrainGestureAnchorElevation = null;
              }
              delete (this._camera as any)._requestedCameraState;
            }

            return this._stableFireEvents.call(this, newEventsInProgress, deactivatedHandlers, allowEndAnimation);
          };
        }
      }
    } else if (hasTerrain) {
      map.setTerrain(null);
    }
  } catch (err) {
    console.error('syncOfflineTerrain error:', err);
  }
}

type DemInflight = {
  promise: Promise<ArrayBuffer | null>;
  callers: Set<AbortController>;
  fetchAbort: AbortController;
};

const demInflightFetches = new globalThis.Map<string, DemInflight>();

export function resetDEMInflightForTests() {
  demInflightFetches.forEach((entry) => {
    try { entry.fetchAbort.abort(); } catch {}
  });
  demInflightFetches.clear();
}

function abortError(): DOMException {
  return new DOMException('The user aborted a request.', 'AbortError');
}

function fetchDemShared(realUrl: string, callerAbort: AbortController): Promise<ArrayBuffer | null> {
  if (callerAbort.signal.aborted) return Promise.reject(abortError());

  let entry = demInflightFetches.get(realUrl);
  if (entry?.fetchAbort.signal.aborted) {
    demInflightFetches.delete(realUrl);
    entry = undefined;
  }
  if (!entry) {
    const fetchAbort = new AbortController();
    const callers = new Set<AbortController>([callerAbort]);
    const promise = (async () => {
      try {
        const res = await fetch(realUrl, { signal: fetchAbort.signal });
        if (!res || !res.ok) return null;
        const clone = res.clone();
        const buf = await res.arrayBuffer();
        if (typeof caches !== 'undefined') {
          caches.open('elevation-tiles-cache').then((c) => c.put(realUrl, clone)).catch(() => {});
        }
        return buf;
      } catch (fetchErr: any) {
        if (fetchAbort.signal.aborted || fetchErr?.name === 'AbortError') {
          throw abortError();
        }
        return null;
      } finally {
        if (demInflightFetches.get(realUrl)?.fetchAbort === fetchAbort) {
          demInflightFetches.delete(realUrl);
        }
      }
    })();
    entry = { promise, callers, fetchAbort };
    demInflightFetches.set(realUrl, entry);
  } else {
    entry.callers.add(callerAbort);
  }

  const onAbort = () => {
    entry!.callers.delete(callerAbort);
    if (entry!.callers.size === 0) {
      demInflightFetches.delete(realUrl);
      try { entry!.fetchAbort.abort(); } catch {}
    }
  };
  callerAbort.signal.addEventListener('abort', onAbort, { once: true });

  return entry.promise.then((buf) => {
    callerAbort.signal.removeEventListener('abort', onAbort);
    if (callerAbort.signal.aborted) throw abortError();
    return buf;
  });
}

let isDEMProtocolRegistered = false;
function setupDEMProtocol() {
  if (!isDEMProtocolRegistered && typeof maplibregl !== 'undefined' && typeof maplibregl.addProtocol === 'function') {
    isDEMProtocolRegistered = true;
    maplibregl.addProtocol('dem', async (params, abortController) => {
      const realUrl = params.url.replace(/^dem:\/\//, '');

      // Parse z, x, y if available from url: e.g. /tiles/{z}/{x}/{y}.png or terrarium/{z}/{x}/{y}.png
      const match = realUrl.match(/\/(\d+)\/(\d+)\/(\d+)/);
      const z = match ? Number(match[1]) : 0;
      const x = match ? Number(match[2]) : 0;
      const y = match ? Number(match[3]) : 0;

      // DEM tiles only exist up to zoom 15 on AWS S3 Terrarium. Requests for z > 15
      // are overscaled; throw 404 so MapLibre overzooms the z=15 parent DEM tile.
      if (z > 15) {
        throwTileNotFound(z, x, y);
      }

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
      } catch (err) {
        console.warn('DEM cache check error:', err);
      }

      // 2. If online, fetch from network and cache for offline 3D use.
      // Hillshade and 3D terrain are separate sources with the same URL template;
      // coalesce in-flight GETs so the first pan does not download each tile twice.
      if (navigator.onLine) {
        if (abortController?.signal?.aborted) {
          throw abortError();
        }
        try {
          const buf = await fetchDemShared(realUrl, abortController);
          if (buf) return { data: buf };
        } catch (fetchErr: any) {
          if (abortController?.signal?.aborted || fetchErr?.name === 'AbortError') {
            throw (fetchErr?.name === 'AbortError' ? fetchErr : abortError());
          }
        }
      }

      // 3. Missing / uncached DEM tile: throw 404 status.
      // MapLibre interprets status 404 as a missing tile and automatically overzooms
      // the parent DEM tile cached in the region (or uses empty flat mesh if no DEM exists).
      // NEVER return a 0m flat dummy tile here, because returning 0m elevation in mountainous
      // terrain (e.g. Colorado at 2,500m-4,000m) tricks MapLibre into setting camera ground elevation
      // to 0m, creating a 2,500m elevation mismatch that frustum-culls all terrain and vector tiles!
      if (abortController?.signal?.aborted) {
        throw abortError();
      }
      throwTileNotFound(z, x, y);
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
            // This map's download does not include the tile (the camera left the
            // extract, for example find-my-location far from the pins).
            // Ask the live planet archive when the browser is online.
            // navigator.onLine is not proof the server is up: a failure or an
            // empty body still 404s so MapLibre can overzoom a parent from the extract.
            const outsideExtract = await readLivePlanetTile(params, abortController);
            if (outsideExtract) return outsideExtract;
            throwTileNotFound(z, x, y);
          }
        } catch (extractErr) {
          if (extractErr instanceof Error && extractErr.message.startsWith('Tile not found:')) {
            throw extractErr;
          }
          if (abortController.signal.aborted) throw extractErr;
          console.error('Failed to read offline map extract:', extractErr);
        }

        // 2. No local extract (or the extract file could not be read).
        // NEVER treat navigator.onLine as proof the server is reachable.
        const live = await readLivePlanetTile(params, abortController);
        if (live) return live;

        // CRITICAL FOR OFFLINE MODE:
        // 3. Tile missing offline -> 404 rather than returning a 0-byte tile!
        // Returning a 0-byte tile causes MapLibre to treat the tile as valid-but-empty and erase the canvas.
        // status 404 causes MapLibre to overzoom a parent tile instead of aborting the source.
        throwTileNotFound(z, x, y);
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
  showTransit?: boolean;
  isOffline?: boolean;
  onLocationTrackingChange?: (isTracking: boolean) => void;
  isMobile?: boolean;
  isPanelMinimized?: boolean;
  mobileControlsTarget?: HTMLElement | null;
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
  isSubtleHover?: boolean;
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
  isSubtleHover = false,
  isEditing,
  readOnly,
}: PinMarkerProps) => {
  const showHighlight = isSelected || isHovered;
  const showSubtleHighlight = !showHighlight && isSubtleHover;
  const colorCode = resolvePinColorCode(pin.color);
  const iconPath = pin.icon && pin.icon !== 'default' ? ICON_SVG_PATHS[pin.icon as Exclude<PinIcon, 'default'>] : null;

  const lastGeocodeCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const geocodeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      geocodeAbortRef.current?.abort();
    };
  }, []);

  const handleDragEnd = useCallback(async (e: any) => {
    const newLat = e.lngLat.lat;
    const newLng = e.lngLat.lng;
    lastGeocodeCoordsRef.current = { lat: newLat, lng: newLng };

    geocodeAbortRef.current?.abort();
    const controller = new AbortController();
    geocodeAbortRef.current = controller;

    // 1. Immediately update lat/lng so pin position moves optimistically and syncs over socket
    onUpdatePin(pin.id, {
      lat: newLat,
      lng: newLng,
      placeId: undefined,
    });

    // 2. Fetch address in background and guard against coordinate mismatch
    const newAddress = await reverseGeocode(newLat, newLng, controller.signal);
    if (controller.signal.aborted) return;
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
      style={{ zIndex: isHovered ? 1100 : (isSubtleHover ? 1050 : (isSelected ? 1000 : 1)) }}
    >
      <div
        className={`custom-pin-modern${showHighlight ? ' hovered' : ''}${showSubtleHighlight ? ' subtle-hovered' : ''}`}
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
        {showSubtleHighlight && (
          <div
            data-testid="pin-subtle-highlight"
            style={{
              position: 'absolute',
              top: '-12px',
              left: '-12px',
              width: '44px',
              height: '44px',
              background: `${colorCode}22`,
              border: `2px solid ${colorCode}88`,
              borderRadius: '50%',
              zIndex: -1,
              boxShadow: `0 0 8px ${colorCode}33`,
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
  const draggingPinId = useDraggingPinId();
  const activePrimaryHoverId = draggingPinId ?? hoveredPinId;
  const subtleHoverPinId = draggingPinId && hoveredPinId && hoveredPinId !== draggingPinId ? hoveredPinId : null;

  const overlayPins = visiblePins
    .filter((pin) => (
      pin.id === targetPinId ||
      pin.id === editingPinId ||
      pin.id === activePrimaryHoverId ||
      pin.id === subtleHoverPinId
    ))
    .sort((a, b) => {
      const rank = (id: string) => {
        if (id === activePrimaryHoverId) return 2;
        if (id === subtleHoverPinId) return 1;
        return 0;
      };
      return rank(a.id) - rank(b.id);
    });

  return (
    <>
      {overlayPins.map((pin) => {
        const isSelected = targetPinId === pin.id || editingPinId === pin.id;
        const isEditing = !readOnly && editingPinId === pin.id;
        const isHovered = activePrimaryHoverId === pin.id;
        const isSubtleHover = subtleHoverPinId === pin.id;
        return (
          <PinMarker
            key={pin.id}
            pin={pin}
            onUpdatePin={onUpdatePin}
            onHoverPin={onHoverPin}
            onPinClick={onPinClick}
            isSelected={isSelected}
            isHovered={isHovered}
            isSubtleHover={isSubtleHover}
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

export function themePaintUpdates(layer: { id?: string; type?: string }, flavor: 'light' | 'dark'): Record<string, any> | null {
  const id = layer.id || '';
  const type = layer.type;
  if (!id || id === 'esri-satellite') return null;
  const dark = flavor === 'dark';

  if (id === 'transit-rail') {
    return { 'line-color': dark ? '#94a3b8' : '#475569' };
  }
  if (id === 'transit-subway') {
    return { 'line-color': dark ? '#38bdf8' : '#0284c7' };
  }
  if (id === 'transit-tram') {
    return { 'line-color': dark ? '#fbbf24' : '#d97706' };
  }
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

// Frozen terrain flights keep one camera height for the whole move, including
// the arrival frame. MapLibre clears that freeze only when this option is set,
// and the render loop would then write the new zoom's DEM in one frame. The
// destination height is applied on the still picture first. Keeping the height
// fixed also stops street labels from sticking at a mid-flight size. A flight
// whose arrival tile is not loaded uses terrainFlightOptions and tracks height.
const FLY_TO_TERRAIN = { freezeElevation: true as const };

// Height actually stored for a transform. The public value is `elevation`.
function readTransformElevation(tr: any): number | undefined {
  if (!tr) return undefined;
  if (typeof tr.elevation === 'number' && Number.isFinite(tr.elevation)) return tr.elevation;
  const helperElevation = tr._helper?.elevation;
  if (typeof helperElevation === 'number' && Number.isFinite(helperElevation)) return helperElevation;
  const helperStored = tr._helper?._elevation;
  if (typeof helperStored === 'number' && Number.isFinite(helperStored)) return helperStored;
  if (typeof tr._elevation === 'number' && Number.isFinite(tr._elevation)) return tr._elevation;
  return undefined;
}

// True when this zoom's own DEM tile is loaded. A coarser parent still
// answers samples, but it is the wide view's ground, not the ground the
// fit is about to zoom into.
function arrivalDemReady(terrain: any, lngLat: any, zoom: number): boolean {
  if (!terrain || !Number.isFinite(zoom)) return false;
  if (typeof terrain.tileManager?.getSourceTile === 'function' && typeof terrain._getOverscaledTileIDFromLngLatZoom === 'function') {
    try {
      const spec = terrain._getOverscaledTileIDFromLngLatZoom(toSafeLngLat(lngLat), Math.max(0, Math.floor(zoom)));
      if (!spec?.tileID) return false;
      return !!terrain.tileManager.getSourceTile(spec.tileID, false)?.dem;
    } catch {
      return false;
    }
  }
  return terrainDemLoaded(terrain, lngLat, zoom);
}

// True when a DEM tile (or a loaded parent) can answer an elevation sample.
// A miss makes MapLibre return 0, which is also a real shoreline height.
function terrainDemLoaded(terrain: any, lngLat: any, zoom: number): boolean {
  if (!terrain || !Number.isFinite(zoom)) return false;
  try {
    if (typeof terrain._getOverscaledTileIDFromLngLatZoom !== 'function') return true;
    const spec = terrain._getOverscaledTileIDFromLngLatZoom(toSafeLngLat(lngLat), Math.max(0, Math.floor(zoom)));
    const tileID = spec?.tileID;
    if (!tileID) return false;
    if (typeof terrain._getElevationSampler === 'function') return !!terrain._getElevationSampler(tileID);
    if (typeof terrain.tileManager?.getSourceTile === 'function') {
      return !!terrain.tileManager.getSourceTile(tileID, true)?.dem;
    }
  } catch {}
  return true;
}

function elevationAtZoom(terrain: any, lngLat: any, zoom: number): number | null {
  if (!terrain || typeof terrain.getElevationForLngLatZoom !== 'function' || !Number.isFinite(zoom)) return null;
  const z = Math.max(0, Math.floor(zoom));
  if (!arrivalDemReady(terrain, lngLat, z)) return null;
  // A sampler cached before this tile loaded still answers with its parent.
  if (typeof terrain.resetElevationCache === 'function') terrain.resetElevationCache();
  const value = terrain.getElevationForLngLatZoom(toSafeLngLat(lngLat), z);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function writeStableElevation(tr: { _stableSetElevation?: (elevation: number) => void; setElevation?: (elevation: number) => void } | null | undefined, elevation: number) {
  if (!tr) return;
  if (typeof tr._stableSetElevation === 'function') tr._stableSetElevation(elevation);
  else if (typeof tr.setElevation === 'function') tr.setElevation(elevation);
}

// The arrival zoom is used only when that tile itself is loaded. A parent
// tile is the zoomed-out ground; holding it while the fit zooms in pushes
// higher pins off both edges. Never treat a missing tile's 0 as ground.
function groundElevation(map: any, lngLat: [number, number], zoom?: number): number | null {
  if (typeof zoom === 'number' && Number.isFinite(zoom)) {
    return elevationAtZoom(map?.terrain, lngLat, zoom);
  }
  const tr = map?._camera?.transform || map?.transform;
  const viewZoom = tr?.tileZoom;
  if (map?.terrain && typeof viewZoom === 'number' && !terrainDemLoaded(map.terrain, lngLat, viewZoom)) return null;
  if (typeof map?.queryTerrainElevation !== 'function') return null;
  const value = map.queryTerrainElevation(lngLat);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// The render loop samples 0 when the DEM under the center is not loaded yet.
// Leaving a real height in place beats a one-frame drop to sea level.
function rejectUnloadedSeaLevel(map: any, elevation: number, current: number | undefined): boolean {
  if (elevation !== 0 || typeof current !== 'number' || Math.abs(current) <= 0.05) return false;
  const tr = map?._camera?.transform || map?.transform;
  if (!map?.terrain || typeof tr?.tileZoom !== 'number' || !tr?.center) return false;
  return !terrainDemLoaded(map.terrain, tr.center, tr.tileZoom);
}

// Set the camera height to the ground at `lngLat` in one frame.
// `zoom` is the zoom the flight will arrive at, when it is already known.
export function jumpCenterElevation(
  map: {
    queryTerrainElevation?: (lngLat: [number, number]) => number | null;
    triggerRepaint?: () => void;
    terrain?: unknown;
    _camera?: {
      elevationFreeze?: boolean;
      transform?: { elevation?: number; _elevation?: number; tileZoom?: number; _stableSetElevation?: (elevation: number) => void; setElevation?: (elevation: number) => void };
      _requestedCameraState?: { _stableSetElevation?: (elevation: number) => void; setElevation?: (elevation: number) => void };
    };
    transform?: { elevation?: number; _elevation?: number; tileZoom?: number; _stableSetElevation?: (elevation: number) => void; setElevation?: (elevation: number) => void };
  } | null | undefined,
  lngLat: [number, number],
  zoom?: number,
): boolean {
  if (!map || typeof map.queryTerrainElevation !== 'function') return false;
  if (!Number.isFinite(lngLat[0]) || !Number.isFinite(lngLat[1])) return false;
  const next = groundElevation(map, lngLat, zoom);
  if (next === null) return false;
  const tr = map._camera?.transform || map.transform;
  if (!tr) return false;
  const current = readTransformElevation(tr);
  const changed = !(typeof current === 'number' && Math.abs(current - next) <= 0.05);
  if (changed) {
    if (typeof tr._stableSetElevation !== 'function' && typeof tr.setElevation !== 'function') return false;
    writeStableElevation(tr, next);
  }
  // flyTo reuses this clone for the whole frozen flight. A clone taken during
  // the zoom-out still has that plane until the jump is copied onto it.
  const clone = map._camera?._requestedCameraState;
  if (clone) writeStableElevation(clone, next);
  if (map._camera && (changed || clone)) {
    // Keep the render loop from replacing this height before the flight starts.
    map._camera.elevationFreeze = true;
  }
  if (changed && typeof map.triggerRepaint === 'function') map.triggerRepaint();
  return changed;
}

// fitBounds and flyTo clone the transform on the way in, and reuse any clone
// already stored. Write the arrival height and drop that clone in the same
// turn as the camera move, or the zoomed-out plane is the one that sticks.
export function commitArrivalElevation(
  map: object | null | undefined,
  elevation: number | null,
): void {
  const camera = (map as {
    _camera?: {
      elevationFreeze?: boolean;
      transform?: { _stableSetElevation?: (elevation: number) => void; setElevation?: (elevation: number) => void };
      _requestedCameraState?: { _stableSetElevation?: (elevation: number) => void; setElevation?: (elevation: number) => void };
    };
    transform?: { _stableSetElevation?: (elevation: number) => void; setElevation?: (elevation: number) => void };
  } | null | undefined)?._camera;
  if (!camera) return;
  if (typeof elevation === 'number' && Number.isFinite(elevation)) {
    writeStableElevation(camera.transform || (map as { transform?: { _stableSetElevation?: (elevation: number) => void; setElevation?: (elevation: number) => void } }).transform, elevation);
    writeStableElevation(camera._requestedCameraState, elevation);
    camera.elevationFreeze = true;
  }
  delete camera._requestedCameraState;
}

// Let the popped height paint and hold briefly, then run the camera move.
// A render that never arrives still moves.
const ELEVATION_POP_HOLD_MS = 120;
export function runAfterElevationPop(
  map: { once?: (event: string, cb: () => void) => void; triggerRepaint?: () => void } | null | undefined,
  run: () => void,
) {
  if (!map || typeof map.once !== 'function') {
    run();
    return;
  }
  let ran = false;
  const once = () => {
    if (ran) return;
    ran = true;
    run();
  };
  map.once('render', () => {
    window.setTimeout(once, ELEVATION_POP_HOLD_MS);
  });
  if (typeof map.triggerRepaint === 'function') map.triggerRepaint();
  window.setTimeout(once, 400);
}

function centerTuple(center: unknown): [number, number] | null {
  if (Array.isArray(center) && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
    return [center[0], center[1]];
  }
  if (!center || typeof center !== 'object') return null;
  const record = center as { lng?: unknown; lon?: unknown; lat?: unknown };
  const lng = typeof record.lng === 'number' ? record.lng : record.lon;
  if (typeof lng === 'number' && typeof record.lat === 'number' && Number.isFinite(lng) && Number.isFinite(record.lat)) {
    return [lng, record.lat];
  }
  return null;
}

// A frozen flight stays on its starting height. That is safe when the height
// is already the arrival tile. Tracking is for a zoomed-out plane: the height
// then changes with the zoom instead of after it.
function terrainFlightOptions(arrivalReady: boolean, animate: boolean): { freezeElevation: boolean } {
  if (animate && !arrivalReady) return { freezeElevation: false };
  return FLY_TO_TERRAIN;
}

function releaseStuckSymbolPlacement(map: { style?: { placement?: { commitTime?: number } }; triggerRepaint?: () => void } | null | undefined) {
  const placement = map?.style?.placement;
  if (placement && typeof placement.commitTime === 'number') placement.commitTime = 0;
  if (typeof map?.triggerRepaint === 'function') map.triggerRepaint();
}

function primeArrivalElevation(
  map: Parameters<typeof jumpCenterElevation>[0],
  lngLat: [number, number],
  zoom: number | undefined,
): { jumped: boolean; ready: boolean; elevation: number | null } {
  if (typeof zoom !== 'number' || !Number.isFinite(zoom)) return { jumped: false, ready: false, elevation: null };
  const ready = arrivalDemReady(map?.terrain, lngLat, zoom);
  if (!ready) return { jumped: false, ready: false, elevation: null };
  const elevation = groundElevation(map, lngLat, zoom);
  if (elevation === null) return { jumped: false, ready: false, elevation: null };
  return { jumped: jumpCenterElevation(map, lngLat, zoom), ready: true, elevation };
}

// The DEM tile the arrival zoom actually samples. One level coarser than the
// view zoom: terrain draws that source and scales it up.
function arrivalSourceTileID(terrain: any, lngLat: [number, number], zoom: number): { key: string; scaledTo?: (z: number) => any } | null {
  if (!terrain || typeof terrain._getOverscaledTileIDFromLngLatZoom !== 'function' || !Number.isFinite(zoom)) return null;
  try {
    const spec = terrain._getOverscaledTileIDFromLngLatZoom(toSafeLngLat(lngLat), Math.max(0, Math.floor(zoom)));
    const tileID = spec?.tileID;
    if (!tileID || typeof tileID.scaledTo !== 'function') return null;
    const delta = typeof terrain.tileManager?.deltaZoom === 'number' ? terrain.tileManager.deltaZoom : 1;
    let sourceZ = tileID.overscaledZ - delta;
    const source = terrain.tileManager?.tileManager?._source;
    if (typeof source?.maxzoom === 'number' && sourceZ > source.maxzoom) sourceZ = source.maxzoom;
    if (typeof source?.minzoom === 'number' && sourceZ < source.minzoom) return null;
    if (!(sourceZ >= 0)) return null;
    return tileID.scaledTo(sourceZ);
  } catch {
    return null;
  }
}

function arrivalDemErrored(terrain: any, lngLat: [number, number], zoom: number): boolean {
  const tileID = arrivalSourceTileID(terrain, lngLat, zoom);
  if (!tileID?.key) return false;
  const inner = terrain?.tileManager?.tileManager;
  const tile = inner?.getTileByID?.(tileID.key) || terrain?.tileManager?.findTileInCaches?.(tileID.key);
  return tile?.state === 'errored';
}

// A zoomed-out frame drops higher-zoom DEM tiles. Asking for one and then
// letting the next render discard it aborts the fetch. Hold the tile in the
// retain set until it has data, then the fit can sample it.
function keepArrivalDemTiles(retain: Record<string, unknown> | undefined, extra: Record<string, unknown> | undefined) {
  if (!extra || !retain) return;
  for (const key in extra) retain[key] = extra[key];
}

// raster-dem is cleaned up on the vector path. A tile requested ahead of the
// current zoom is aborted there unless it stays in the retain set.
function installArrivalDemRetain(tileManager: any) {
  const proto = Object.getPrototypeOf(tileManager);
  if (!proto) return;
  if (!proto._stableCleanUpVectorTiles && typeof proto._cleanUpVectorTiles === 'function') {
    proto._stableCleanUpVectorTiles = proto._cleanUpVectorTiles;
    proto._cleanUpVectorTiles = function (retain: Record<string, unknown>) {
      keepArrivalDemTiles(retain, this._arrivalDemRetain);
      return this._stableCleanUpVectorTiles.call(this, retain);
    };
  }
  if (!proto._stableCleanUpRasterTiles && typeof proto._cleanUpRasterTiles === 'function') {
    proto._stableCleanUpRasterTiles = proto._cleanUpRasterTiles;
    proto._cleanUpRasterTiles = function (retain: Record<string, unknown>) {
      keepArrivalDemTiles(retain, this._arrivalDemRetain);
      return this._stableCleanUpRasterTiles.call(this, retain);
    };
  }
}

function holdArrivalDemTiles(
  terrain: any,
  lngLats: Array<[number, number]>,
  zoom: number,
): { release: () => void } | null {
  const inner = terrain?.tileManager?.tileManager;
  if (!inner || typeof inner._addTile !== 'function') return null;
  installArrivalDemRetain(inner);
  inner._arrivalDemRetain ||= {};
  inner._arrivalDemRetainCounts ||= {};
  const added: string[] = [];
  for (const lngLat of lngLats) {
    const tileID = arrivalSourceTileID(terrain, lngLat, zoom);
    if (!tileID?.key) continue;
    try {
      inner._addTile(tileID);
    } catch {
      continue;
    }
    inner._arrivalDemRetain[tileID.key] = tileID;
    inner._arrivalDemRetainCounts[tileID.key] = (inner._arrivalDemRetainCounts[tileID.key] || 0) + 1;
    added.push(tileID.key);
  }
  if (added.length === 0) return null;
  return {
    release() {
      for (const key of added) {
        const left = (inner._arrivalDemRetainCounts[key] || 1) - 1;
        if (left <= 0) {
          delete inner._arrivalDemRetainCounts[key];
          delete inner._arrivalDemRetain[key];
        } else {
          inner._arrivalDemRetainCounts[key] = left;
        }
      }
    },
  };
}

function whenArrivalDemsSettled(
  map: { terrain?: any; on?: (event: string, cb: () => void) => void; off?: (event: string, cb: () => void) => void },
  points: Array<[number, number]>,
  zoom: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { map?.off?.('data', check); } catch {}
      try { map?.off?.('sourcedata', check); } catch {}
      window.clearInterval(poll);
      window.clearTimeout(timer);
      resolve();
    };
    const check = () => {
      const terrain = map?.terrain;
      if (!terrain) {
        finish();
        return;
      }
      const waiting = points.some((point) => !arrivalDemReady(terrain, point, zoom) && !arrivalDemErrored(terrain, point, zoom));
      if (!waiting) finish();
    };
    try { map?.on?.('data', check); } catch {}
    try { map?.on?.('sourcedata', check); } catch {}
    const poll = window.setInterval(check, 50);
    const timer = window.setTimeout(finish, timeoutMs);
    check();
  });
}

type PinSpan = { minLat: number; maxLat: number; minLng: number; maxLng: number };

function pinInSpan(pin: { lat: number; lng: number }, span: PinSpan): boolean {
  return (
    Number.isFinite(pin.lat) &&
    Number.isFinite(pin.lng) &&
    pin.lat >= span.minLat &&
    pin.lat <= span.maxLat &&
    pin.lng >= span.minLng &&
    pin.lng <= span.maxLng
  );
}

function northernPinLngLat(
  pins: Array<{ lat: number; lng: number }>,
  span: PinSpan,
): [number, number] | null {
  let best: [number, number] | null = null;
  for (const pin of pins) {
    if (!pinInSpan(pin, span)) continue;
    if (!best || pin.lat > best[1]) best = [pin.lng, pin.lat];
  }
  return best;
}

function beginCameraMove(
  seqRef: { current: number },
  map: { once?: (event: string, cb: () => void) => void; triggerRepaint?: () => void } | null | undefined,
  jumped: boolean,
  animate: boolean,
  arrivalReady: boolean,
  elevation: number | null,
  run: () => void,
) {
  const seq = ++seqRef.current;
  const start = () => {
    if (seq !== seqRef.current) return;
    // The pop above may have waited out a render. Put the arrival height back
    // and drop the gesture clone now, immediately before the camera move.
    commitArrivalElevation(map, arrivalReady ? elevation : null);
    const camera = (map as { _camera?: { _holdElevation?: boolean } } | null | undefined)?._camera;
    // A previous fit may still be holding. Drop that when this arrival tile
    // is not loaded, or the zoomed-out height stays locked.
    if (camera) camera._holdElevation = !!(animate && arrivalReady);
    if (animate && !arrivalReady && map && typeof map.once === 'function') {
      map.once('moveend', () => {
        if (seq !== seqRef.current) return;
        // The arrival tile was still missing when the zoom finished. Let the
        // next loaded DEM update the camera, or the mesh rises under a frozen
        // low plane and both pin edges leave the view.
        const camera = (map as { _camera?: { elevationFreeze?: boolean } })._camera;
        if (camera) camera.elevationFreeze = false;
        releaseStuckSymbolPlacement(map);
        if (typeof map.triggerRepaint === 'function') map.triggerRepaint();
      });
    }
    run();
  };
  if (jumped && animate) runAfterElevationPop(map, start);
  else start();
}

// Edge padding set to 4% of visible map width and height (excluding sidebar and sheet)
export function getMapEdgePadding(leftPadding = 0, bottomPadding = 0) {
  if (typeof window === 'undefined') {
    const visibleWidth = Math.max(0, 1000 - leftPadding);
    const visibleHeight = Math.max(0, 800 - bottomPadding);
    return {
      x: Math.round(visibleWidth * 0.04),
      y: Math.round(visibleHeight * 0.04),
    };
  }
  const visibleWidth = Math.max(0, window.innerWidth - leftPadding);
  const visibleHeight = Math.max(0, window.innerHeight - bottomPadding);
  return {
    x: Math.round(visibleWidth * 0.04),
    y: Math.round(visibleHeight * 0.04),
  };
}

// Pin icons are 28px tall anchored at the bottom tip.
// Enforce a minimum top clearance of 36px so the northern-most pin is never clipped.
export const PIN_HEAD_CLEARANCE = 36;
const PIN_MARKER_HEIGHT = 28;
// A head that lands exactly on the map edge still looks clipped after rasterization.
const RASTER_HEAD_MARGIN = 2;
// One degree of latitude. Used to compare pin relief with the fitted ground span.
const METERS_PER_DEGREE_LAT = 111320;
// MapLibre's default field of view places the camera this many screen-heights away.
const CAMERA_DISTANCE_IN_HEIGHTS = 1.5;

export function paddedMapView(leftPadding: number, bottomPadding: number) {
  const edge = getMapEdgePadding(leftPadding, bottomPadding);
  return {
    top: Math.max(PIN_HEAD_CLEARANCE, edge.y),
    left: leftPadding + edge.x,
    right: edge.x,
    bottom: edge.y + bottomPadding,
  };
}

type ViewPadding = { top: number; left: number; right: number; bottom: number };

type MapCameraSnapshot = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

function cameraFromMap(map: {
  getCenter?: () => { lng: number; lat: number };
  getZoom?: () => number;
  getPitch?: () => number;
  getBearing?: () => number;
} | null | undefined): MapCameraSnapshot | null {
  if (!map || typeof map.getCenter !== 'function') return null;
  const c = map.getCenter();
  return {
    longitude: c.lng,
    latitude: c.lat,
    zoom: typeof map.getZoom === 'function' ? map.getZoom() : 10,
    pitch: typeof map.getPitch === 'function' ? map.getPitch() : 0,
    bearing: typeof map.getBearing === 'function' ? map.getBearing() : 0,
  };
}

// Spread Math.min/Math.max, so one NaN poisons the span. Callers already skip empty lists.
function pinSpanBounds(pins: Array<{ lat: number; lng: number }>): [[number, number], [number, number]] {
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  return [
    [Math.min(...lats), Math.min(...lngs)],
    [Math.max(...lats), Math.max(...lngs)],
  ];
}

// fitBounds adds the argument to transform.padding. Pass only the part not already stored.
function paddingBeyondCurrent(current: Partial<ViewPadding> | null | undefined, desired: ViewPadding): ViewPadding {
  return {
    top: desired.top - (current?.top ?? 0),
    left: desired.left - (current?.left ?? 0),
    right: desired.right - (current?.right ?? 0),
    bottom: desired.bottom - (current?.bottom ?? 0),
  };
}

// Extra top inset so an elevated northern tip still clears the 28px marker.
// When the arrival DEM is already loaded, the fit keeps that height through
// arrival. The pin has to clear whichever is lower: that plane, or the
// span-center ground. Zero unless terrain can sample the northern pin and
// that slide exceeds the spare in `padding.top`.
export function terrainTopOverflow(
  map: {
    queryTerrainElevation?: (lngLat: [number, number]) => number | null;
    getCenterElevation?: () => number;
    getContainer?: () => { clientHeight?: number; clientWidth?: number } | null;
    terrain?: any;
  } | null | undefined,
  pins: Array<{ lat: number; lng: number }>,
  span: PinSpan,
  padding: ViewPadding,
  sampleZoom?: number,
): number {
  if (!map || typeof map.queryTerrainElevation !== 'function') return 0;
  const sample = (lngLat: [number, number]): number | null => {
    if (typeof sampleZoom === 'number') {
      const atZoom = elevationAtZoom(map.terrain, lngLat, sampleZoom);
      if (atZoom !== null) return atZoom;
    }
    const value = map.queryTerrainElevation?.(lngLat);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const spanMeters = (span.maxLat - span.minLat) * METERS_PER_DEGREE_LAT;
  if (!(spanMeters > 0)) return 0;
  const container = map.getContainer?.();
  const mapHeight = container?.clientHeight ?? 0;
  if (!(mapHeight > 0)) return 0;
  const availableHeight = mapHeight - padding.top - padding.bottom;
  if (!(availableHeight > 0)) return 0;

  let northLat = -Infinity;
  for (const pin of pins) {
    if (pinInSpan(pin, span) && pin.lat > northLat) northLat = pin.lat;
  }
  if (!Number.isFinite(northLat)) return 0;

  let northElev: number | null = null;
  for (const pin of pins) {
    if (pin.lat !== northLat || !pinInSpan(pin, span)) continue;
    const elev = sample([pin.lng, pin.lat]);
    if (elev == null || !Number.isFinite(elev)) continue;
    if (northElev == null || elev > northElev) northElev = elev;
  }

  // Pad for the lower plane. The zoom keeps the current camera elevation, and
  // the following ease drops onto the span center when that ground is lower.
  let reference: number | null = null;
  if (typeof map.getCenterElevation === 'function') {
    const camera = map.getCenterElevation();
    if (typeof camera === 'number' && Number.isFinite(camera)) reference = camera;
  }
  const centerElev = sample([
    (span.minLng + span.maxLng) / 2,
    (span.minLat + span.maxLat) / 2,
  ]);
  if (typeof centerElev === 'number' && Number.isFinite(centerElev)) {
    reference = reference == null ? centerElev : Math.min(reference, centerElev);
  }
  if (northElev == null || reference == null) return 0;

  const relief = northElev - reference;
  if (!(relief > 0)) return 0;

  const midLat = (span.minLat + span.maxLat) / 2;
  const lngMeters = Math.abs(span.maxLng - span.minLng) * METERS_PER_DEGREE_LAT * Math.cos((midLat * Math.PI) / 180);
  const availableWidth = (container?.clientWidth ?? 0) - padding.left - padding.right;
  let metersPerPixel = spanMeters / availableHeight;
  // Width-limited fits keep their zoom, so extra top only shifts the center halfway.
  let slidePerTopPixel = 1;
  if (availableWidth > 0 && lngMeters > 0) {
    const lngMetersPerPixel = lngMeters / availableWidth;
    if (lngMetersPerPixel > metersPerPixel) {
      metersPerPixel = lngMetersPerPixel;
      slidePerTopPixel = 0.5;
    }
  }

  const distancePx = ((northLat - midLat) * METERS_PER_DEGREE_LAT) / metersPerPixel;
  if (!(distancePx > 0)) return 0;
  const altitudePx = CAMERA_DISTANCE_IN_HEIGHTS * mapHeight;
  const zPx = relief / metersPerPixel;
  const depth = altitudePx - zPx;
  const shift = depth > 1 ? (distancePx * zPx) / depth : distancePx;
  const spare = padding.top - PIN_MARKER_HEIGHT;
  const deficit = shift - spare;
  if (!(deficit > 0)) return 0;
  return Math.min(mapHeight, Math.ceil(deficit / slidePerTopPixel) + RASTER_HEAD_MARGIN);
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
  showTransit = false,
  isOffline = false,
  onLocationTrackingChange,
  isMobile = false,
  isPanelMinimized = false,
  mobileControlsTarget,
}: MapViewProps) => {

  const mapRef = useRef<MapRef | null>(null);
  const cameraMoveSeqRef = useRef(0);
  const mapThemeRef = useRef(mapTheme);
  mapThemeRef.current = mapTheme;
  const show3DTerrainRef = useRef(show3DTerrain);
  show3DTerrainRef.current = show3DTerrain;

  const [domTarget, setDomTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (isMobile) {
      const el = mobileControlsTarget || (typeof document !== 'undefined' ? document.getElementById('mobile-map-controls') : null);
      setDomTarget(el);
    } else {
      setDomTarget(null);
    }
  }, [isMobile, mobileControlsTarget]);

  const activeTarget = (isMobile && (mobileControlsTarget || domTarget)) || null;
  const isPortaled = Boolean(activeTarget);

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
  const pinsRef = useRef(pins);
  pinsRef.current = pins;

  const [mapSessionKey, setMapSessionKey] = useState(0);
  const contextLostRef = useRef(false);
  const mapCleanupRef = useRef<(() => void) | null>(null);

  const currentViewStateRef = useRef<{
    longitude: number;
    latitude: number;
    zoom: number;
    pitch: number;
    bearing: number;
    padding?: { top: number; right: number; left: number; bottom: number };
  } | null>(null);
  const mapSessionKeyRef = useRef(0);

  const [isMapLoaded, setIsMapLoaded] = useState(false);
  mapSessionKeyRef.current = mapSessionKey;

  const triggerMapRemount = useCallback(() => {
    if (!currentViewStateRef.current && mapRef.current) {
      try {
        const shot = cameraFromMap(mapRef.current.getMap());
        if (shot) currentViewStateRef.current = shot;
      } catch {}
    }
    contextLostRef.current = false;
    clearRegisteredImages();
    setIsMapLoaded(false);
    setMapSessionKey((k) => k + 1);
  }, []);

  const setMapRef = useCallback((instance: MapRef | null) => {
    if (mapCleanupRef.current) {
      mapCleanupRef.current();
      mapCleanupRef.current = null;
    }

    mapRef.current = instance;
    if (!instance) return;
    const mapInstance = instance.getMap();
    const spriteTheme = (): 'light' | 'dark' => (mapThemeRef.current === 'dark' ? 'dark' : 'light');
    attachMissingImageResolver(mapInstance, spriteTheme);

    const onContextLost = (e?: any) => {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      contextLostRef.current = true;
    };

    const onContextRestored = () => {
      if (document.visibilityState === 'visible') {
        triggerMapRemount();
      }
    };

    const onMapResize = () => {
      try { mapInstance.triggerRepaint(); } catch {}
    };

    let canvas: HTMLCanvasElement | null = null;
    let containerResizeObserver: ResizeObserver | null = null;
    let onStyleLoad: (() => void) | null = null;

    if (mapInstance && typeof mapInstance.on === 'function') {
      mapInstance.on('webglcontextlost', onContextLost);
      mapInstance.on('webglcontextrestored', onContextRestored);
      mapInstance.on('resize', onMapResize);

      try {
        const container = typeof mapInstance.getContainer === 'function' ? mapInstance.getContainer() : null;
        if (container && typeof ResizeObserver !== 'undefined') {
          containerResizeObserver = new ResizeObserver(() => {
            try {
              if (typeof mapInstance.resize === 'function') mapInstance.resize();
            } catch {}
            onMapResize();
          });
          containerResizeObserver.observe(container);
        }
      } catch {}

      try {
        canvas = typeof mapInstance.getCanvas === 'function' ? mapInstance.getCanvas() : null;
        if (canvas) {
          canvas.addEventListener('webglcontextlost', onContextLost);
          canvas.addEventListener('webglcontextrestored', onContextRestored);
        }
      } catch {}

      onStyleLoad = () => {
        setIsMapLoaded(true);
        void applyBundledSprites(mapInstance, spriteTheme()).then(() => {
          if (visiblePinsRef.current.length > 0) {
            ensurePinImages(mapInstance, visiblePinsRef.current);
          }
          mapInstance.triggerRepaint();
        });
      };
      mapInstance.on('style.load', onStyleLoad);
      // The ref can attach after style.load, so the listener above would not run.
      if (typeof mapInstance.isStyleLoaded === 'function' && mapInstance.isStyleLoaded()) {
        onStyleLoad();
      }
      mapInstance.once('load', () => {
        setIsMapLoaded(true);
        syncOfflineTerrain(mapInstance, show3DTerrainRef.current);
        // Ensure the attribution/version dialog starts collapsed — MapLibre's
        // AttributionControl adds maplibregl-compact-show on init which expands
        // it automatically. We always want it closed until the user taps it.
        mapInstance.getContainer()
          .querySelectorAll<HTMLElement>('.maplibregl-compact-show')
          .forEach(el => el.classList.remove('maplibregl-compact-show'));
        mapInstance.triggerRepaint();
      });
      mapInstance.once('idle', () => {
        setIsMapLoaded(true);
        mapInstance.triggerRepaint();
      });
    }

    mapCleanupRef.current = () => {
      if (mapInstance && typeof mapInstance.off === 'function') {
        try {
          if (onStyleLoad) mapInstance.off('style.load', onStyleLoad);
          mapInstance.off('webglcontextlost', onContextLost);
          mapInstance.off('webglcontextrestored', onContextRestored);
          mapInstance.off('resize', onMapResize);
        } catch {}
      }
      if (canvas) {
        try {
          canvas.removeEventListener('webglcontextlost', onContextLost);
          canvas.removeEventListener('webglcontextrestored', onContextRestored);
        } catch {}
      }
      try { containerResizeObserver?.disconnect(); } catch {}
    };

    // Immediately enable map load and trigger initial frame render
    setIsMapLoaded(true);
    if (mapInstance) {
      mapInstance.triggerRepaint();
    }
  }, [triggerMapRemount]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const map = mapRef.current?.getMap?.();
        const canvas = map?.getCanvas?.();
        let isContextLost = contextLostRef.current;

        if (!isContextLost && map && typeof (map as any).isWebGLContextLost === 'function') {
          try {
            isContextLost = (map as any).isWebGLContextLost();
          } catch {}
        }

        if (!isContextLost && canvas) {
          try {
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (gl && typeof gl.isContextLost === 'function' && gl.isContextLost()) {
              isContextLost = true;
            }
          } catch {}
        }

        if (isContextLost) {
          triggerMapRemount();
        } else if (map) {
          try {
            if (typeof map.resize === 'function') map.resize();
            if (typeof map.triggerRepaint === 'function') map.triggerRepaint();
          } catch {}
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handleVisibilityChange);
      if (mapCleanupRef.current) {
        mapCleanupRef.current();
        mapCleanupRef.current = null;
      }
    };
  }, [triggerMapRemount]);

  const lastTargetPinId = useRef<string | null>(null);
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
            const target = showSatellite ? 'visible' : 'none';
            const current = typeof map.getLayoutProperty === 'function' ? map.getLayoutProperty('esri-satellite', 'visibility') : undefined;
            if (current !== target) {
              map.setLayoutProperty('esri-satellite', 'visibility', target);
            }
          }
        }
      } catch {}
    };

    if (typeof map.getLayer === 'function' && map.getLayer('esri-satellite')) {
      syncSatellite();
    } else if (typeof map.once === 'function') {
      map.once('styledata', syncSatellite);
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
            const target = showHillshade && !showSatellite ? 'visible' : 'none';
            const current = typeof map.getLayoutProperty === 'function' ? map.getLayoutProperty('hills', 'visibility') : undefined;
            if (current !== target) {
              map.setLayoutProperty('hills', 'visibility', target);
            }
          }
        }
      } catch {}
    };

    if (typeof map.getLayer === 'function' && map.getLayer('hills')) {
      syncHillshade();
    } else if (typeof map.once === 'function') {
      map.once('styledata', syncHillshade);
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
            const target3D = show3DBuildings ? 'visible' : 'none';
            const current3D = typeof map.getLayoutProperty === 'function' ? map.getLayoutProperty('3d-buildings', 'visibility') : undefined;
            if (current3D !== target3D) {
              map.setLayoutProperty('3d-buildings', 'visibility', target3D);
            }
          }
          if (map.getLayer('buildings')) {
            const target2D = show3DBuildings ? 'none' : 'visible';
            const current2D = typeof map.getLayoutProperty === 'function' ? map.getLayoutProperty('buildings', 'visibility') : undefined;
            if (current2D !== target2D) {
              map.setLayoutProperty('buildings', 'visibility', target2D);
            }
          }
        }
      } catch {}
    };

    if (typeof map.getLayer === 'function' && (map.getLayer('3d-buildings') || map.getLayer('buildings'))) {
      sync3DBuildings();
    } else if (typeof map.once === 'function') {
      map.once('styledata', sync3DBuildings);
    } else {
      sync3DBuildings();
    }
  }, [show3DBuildings]);

  // Dynamically toggle transit layers vs roads_rail visibility without rebuilding MapLibre style
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

          const transitLayers = ['transit-rail', 'transit-subway', 'transit-tram', 'transit-route-casing', 'transit-route'];
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
        // 3D Terrain is routed via dem:// protocol which:
        // 1. Returns cached DEM tiles offline (full 3D terrain rendered offline when cached)
        // 2. Returns HTTP status 404 for missing tiles to trigger parent DEM overzooming
        // 3. Fetches and caches DEM tiles from AWS S3 when online
        syncOfflineTerrain(m, show3DTerrainRef.current);
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
      if (l.id === 'roads_rail') {
        l.layout['visibility'] = showTransit ? 'none' : 'visible';
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
      // Do not set maxzoom here. A layer maxzoom hides the raster instead of
      // letting MapLibre scale the source tiles up to the map's max zoom.
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

    // Transit infrastructure layers (active when showTransit is toggled on)
    const transitRailLayer = {
      id: 'transit-rail',
      type: 'line',
      source: 'protomaps',
      'source-layer': 'roads',
      filter: [
        'all',
        ['==', ['get', 'kind'], 'rail'],
        ['in', ['get', 'kind_detail'], ['literal', ['rail', 'narrow_gauge', 'preserved', 'monorail', 'funicular']]],
        ['!', ['in', ['get', 'service'], ['literal', ['siding', 'crossover', 'yard']]]],
      ],
      layout: {
        visibility: showTransit ? 'visible' : 'none',
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': validFlavor === 'dark' ? '#94a3b8' : '#475569',
        'line-dasharray': [2, 2],
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 12, 2.0, 16, 3.5],
      },
    };

    const transitSubwayLayer = {
      id: 'transit-subway',
      type: 'line',
      source: 'protomaps',
      'source-layer': 'roads',
      filter: [
        'all',
        ['==', ['get', 'kind'], 'rail'],
        ['==', ['get', 'kind_detail'], 'subway'],
      ],
      layout: {
        visibility: showTransit ? 'visible' : 'none',
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': validFlavor === 'dark' ? '#38bdf8' : '#0284c7',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 13, 2.5, 16, 4.5],
      },
    };

    const transitTramLayer = {
      id: 'transit-tram',
      type: 'line',
      source: 'protomaps',
      'source-layer': 'roads',
      filter: [
        'all',
        ['==', ['get', 'kind'], 'rail'],
        ['in', ['get', 'kind_detail'], ['literal', ['tram', 'light_rail']]],
      ],
      layout: {
        visibility: showTransit ? 'visible' : 'none',
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': validFlavor === 'dark' ? '#fbbf24' : '#d97706',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.0, 14, 2.0, 16, 3.5],
      },
    };

    // Several routes can share one way. Slot offsets those copies so the strokes stay apart.
    const transitRouteFilter = [
      'all',
      ['in', ['get', 'route'], ['literal', ['subway', 'light_rail', 'tram', 'monorail', 'funicular']]],
      ['<', ['get', 'slot'], 4],
    ];
    const transitRouteOffset = ['*', ['get', 'slot'], 1.5];
    const transitRouteColor = ['coalesce', ['get', 'colour'], ['get', 'colour_fallback']];

    const transitRouteCasingLayer = {
      id: 'transit-route-casing',
      type: 'line',
      source: 'protomaps',
      'source-layer': 'transit',
      filter: transitRouteFilter,
      layout: {
        visibility: showTransit ? 'visible' : 'none',
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': validFlavor === 'dark' ? '#182230' : '#e0ded7',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3.2, 13, 4.5, 16, 6.5],
        'line-offset': transitRouteOffset,
      },
    };

    const transitRouteLayer = {
      id: 'transit-route',
      type: 'line',
      source: 'protomaps',
      'source-layer': 'transit',
      filter: transitRouteFilter,
      layout: {
        visibility: showTransit ? 'visible' : 'none',
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': transitRouteColor,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 13, 2.5, 16, 4.5],
        'line-offset': transitRouteOffset,
      },
    };

    const transitStack = [
      transitRailLayer,
      transitSubwayLayer,
      transitTramLayer,
      transitRouteCasingLayer,
      transitRouteLayer,
    ];
    const railIndex = customLayers.findIndex((l: any) => l.id === 'roads_rail');
    if (railIndex !== -1) {
      customLayers.splice(railIndex + 1, 0, ...transitStack);
    } else {
      const labelIdx = customLayers.findIndex((l: any) => l.type === 'symbol');
      if (labelIdx !== -1) {
        customLayers.splice(labelIdx, 0, ...transitStack);
      } else {
        customLayers.push(...transitStack);
      }
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
          minzoom: 0,
          maxzoom: 15,
          attribution: `&copy; <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> &copy; <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>`,
        },
        esriSatellite: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          // Stay at 19. Higher Esri levels are often an HTTP 200 "no data" JPEG,
          // which MapLibre would paint instead of scaling the last real imagery.
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
          targetBounds = pinSpanBounds(pinsToUse);
        }
      }

      if (targetBounds) {
        const [first, second] = targetBounds;
        const minLat = Math.min(first[0], second[0]);
        const maxLat = Math.max(first[0], second[0]);
        const minLng = Math.min(first[1], second[1]);
        const maxLng = Math.max(first[1], second[1]);

        if (Math.abs(maxLat - minLat) < 0.0001 && Math.abs(maxLng - minLng) < 0.0001) {
          return {
            bounds: [minLng - 0.0001, minLat - 0.0001, maxLng + 0.0001, maxLat + 0.0001] as [number, number, number, number],
            fitBoundsOptions: {
              padding: paddedMapView(leftPadding, bottomPadding),
              maxZoom: 6,
            },
          };
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

  useLayoutEffect(() => {
    updateCompassDirect();
  }, [isPortaled, updateCompassDirect]);

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

  const handleMapMove = useCallback((evt?: any) => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    touchStartRef.current = null;
    if (evt?.viewState) {
      currentViewStateRef.current = {
        longitude: evt.viewState.longitude,
        latitude: evt.viewState.latitude,
        zoom: evt.viewState.zoom,
        pitch: evt.viewState.pitch ?? 0,
        bearing: evt.viewState.bearing ?? 0,
        padding: evt.viewState.padding || currentViewStateRef.current?.padding,
      };
    } else if (mapRef.current) {
      try {
        const shot = cameraFromMap(mapRef.current.getMap());
        if (shot) {
          currentViewStateRef.current = {
            ...shot,
            padding: currentViewStateRef.current?.padding,
          };
        }
      } catch {}
    }
    updateCompassDirect();
    clearHoverDuringPan();
  }, [updateCompassDirect, clearHoverDuringPan]);

  const handleMapLoad = useCallback((e: any) => {
    setIsMapLoaded(true);
    const map = e.target || mapRef.current?.getMap();
    attachMissingImageResolver(map, () => (mapThemeRef.current === 'dark' ? 'dark' : 'light'));
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
      const padding = paddedMapView(leftPadding, bottomPadding);

      const map = mapRef.current.getMap();
      if (Math.abs(maxLat - minLat) < 0.0001 && Math.abs(maxLng - minLng) < 0.0001) {
        const arrival = primeArrivalElevation(map, [minLng, minLat], 6);
        beginCameraMove(cameraMoveSeqRef, map, arrival.jumped, duration > 0, arrival.ready, arrival.elevation, () => {
          mapRef.current?.flyTo({
            center: [minLng, minLat],
            zoom: 6,
            bearing: 0,
            pitch: 0,
            duration,
            padding,
            ...terrainFlightOptions(arrival.ready, duration > 0),
          });
        });
      } else {
        const span = { minLat, maxLat, minLng, maxLng };
        const sourcePins = visiblePinsRef.current.length > 0 ? visiblePinsRef.current : pinsRef.current;
        const boundsLngLat: [[number, number], [number, number]] = [[minLng, minLat], [maxLng, maxLat]];
        const predictCamera = (fitPadding: ViewPadding) => (
          typeof map.cameraForBounds === 'function'
            ? map.cameraForBounds(boundsLngLat, {
              padding: paddingBeyondCurrent(map.getPadding(), fitPadding),
              maxZoom: 13,
              bearing: 0,
              pitch: 0,
            })
            : null
        );
        const fitPaddingFor = (sampleZoom?: number) => {
          const topOverflow = terrainTopOverflow(map, sourcePins, span, padding, sampleZoom);
          return topOverflow > 0 ? { ...padding, top: padding.top + topOverflow } : padding;
        };
        const midpoint: [number, number] = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
        const predictTarget = (fitPadding: ViewPadding) => {
          const predicted = predictCamera(fitPadding);
          return {
            center: centerTuple(predicted?.center) ?? midpoint,
            zoom: typeof predicted?.zoom === 'number' ? predicted.zoom : 13,
          };
        };
        // A zoomed-out parent is the wide view's ground. Zooming in on that
        // plane pushes both pin edges off once the detailed mesh loads.
        // Load the arrival tile and adopt its height before the zoom starts.
        const flyPrepared = (pass: number) => {
          let fitPadding = fitPaddingFor();
          const first = predictTarget(fitPadding);
          let arrival = primeArrivalElevation(map, first.center, first.zoom);
          if (arrival.ready) {
            fitPadding = fitPaddingFor(first.zoom);
            const refined = predictTarget(fitPadding);
            if (pass < 1 && duration > 0 && map.terrain && !arrivalDemReady(map.terrain, refined.center, refined.zoom)) {
              loadThenFly(pass + 1, refined);
              return;
            }
            const again = primeArrivalElevation(map, refined.center, refined.zoom);
            if (again.ready) fitPadding = fitPaddingFor(refined.zoom);
            arrival = {
              jumped: arrival.jumped || again.jumped,
              ready: again.ready,
              elevation: again.elevation,
            };
          }
          const fitPaddingArg = paddingBeyondCurrent(map.getPadding(), fitPadding);
          beginCameraMove(cameraMoveSeqRef, map, arrival.jumped, duration > 0, arrival.ready, arrival.elevation, () => {
            mapRef.current?.fitBounds(boundsLngLat, {
              padding: fitPaddingArg,
              maxZoom: 13,
              bearing: 0,
              pitch: 0,
              duration,
              ...terrainFlightOptions(arrival.ready, duration > 0),
            });
          });
        };
        const loadThenFly = (pass: number, forced?: { center: [number, number]; zoom: number }) => {
          if (!(duration > 0) || !map.terrain) {
            flyPrepared(pass);
            return;
          }
          const target = forced ?? predictTarget(fitPaddingFor());
          if (arrivalDemReady(map.terrain, target.center, target.zoom)) {
            flyPrepared(pass);
            return;
          }
          const north = northernPinLngLat(sourcePins, span);
          const points = north ? [target.center, north] : [target.center];
          const hold = holdArrivalDemTiles(map.terrain, points, target.zoom);
          if (!hold) {
            flyPrepared(pass);
            return;
          }
          const seq = ++cameraMoveSeqRef.current;
          if (typeof map.triggerRepaint === 'function') map.triggerRepaint();
          void whenArrivalDemsSettled(map, [target.center], target.zoom, 1500).then(() => {
            if (seq !== cameraMoveSeqRef.current || !mapRef.current) {
              hold.release();
              return;
            }
            flyPrepared(pass);
            hold.release();
          });
        };
        loadThenFly(0);
      }
    },
    [leftPadding, bottomPadding]
  );

  const fitAllPins = useCallback(() => {
    const pinsToUse = visiblePins.length > 0 ? visiblePins : pins;
    if (pinsToUse && pinsToUse.length > 0) {
      applyBoundsToFit(pinSpanBounds(pinsToUse), true);
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
    const pin = pins?.find((p) => p.id === targetPinId);
    if (!pin || !mapRef.current) return;

    if (hiddenLayerIds?.has(pin.layerId || null)) {
      lastTargetPinId.current = null;
      return;
    }

    if (targetPinId === lastTargetPinId.current) return;
    lastTargetPinId.current = targetPinId;

    const map = mapRef.current.getMap();
    const left = leftPaddingRef.current;
    const bottom = bottomPaddingRef.current;
    if (!isPinInPaddedViewport(map, pin, left, bottom)) {
      const zoom = map.getZoom();
      const pinPadding = paddedMapView(left, bottom);
      const arrival = primeArrivalElevation(map, [pin.lng, pin.lat], zoom);
      beginCameraMove(cameraMoveSeqRef, map, arrival.jumped, true, arrival.ready, arrival.elevation, () => {
        mapRef.current?.flyTo({
          center: [pin.lng, pin.lat],
          zoom,
          padding: pinPadding,
          duration: 1200,
          ...terrainFlightOptions(arrival.ready, true),
        });
      });
    }
  }, [targetPinId, pins, hiddenLayerIds]);

  // Camera movements for boundsToFit or initial pins focus
  useEffect(() => {
    if (!isMapLoaded) return;

    let targetBounds = boundsToFit;
    if ((!targetBounds || !Array.isArray(targetBounds) || targetBounds.length !== 2) && !hasFitInitialBoundsRef.current) {
      const pinsToUse = visiblePins.length > 0 ? visiblePins : pins;
      if (pinsToUse && pinsToUse.length > 0) {
        targetBounds = pinSpanBounds(pinsToUse);
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
    onLocationTrackingChange?.(isTrackingLocation);
  }, [isTrackingLocation, onLocationTrackingChange]);

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
            const map = mapRef.current?.getMap?.();
            const locatePadding = paddedMapView(leftPaddingRef.current, bottomPaddingRef.current);
            const arrival = map ? primeArrivalElevation(map, [lng, lat], 16) : { jumped: false, ready: false, elevation: null };
            beginCameraMove(cameraMoveSeqRef, map, arrival.jumped, true, arrival.ready, arrival.elevation, () => {
              mapRef.current?.flyTo({
                center: [lng, lat],
                zoom: 16,
                duration: 1500,
                padding: locatePadding,
                ...terrainFlightOptions(arrival.ready, true),
              });
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
          key={mapSessionKey}
          id={`map-session-${mapSessionKey}`}
          attributionControl={false}
          localIdeographFontFamily="'Noto Sans CJK JP', 'Hiragino Kaku Gothic ProN', 'Meiryo', 'Yu Gothic', sans-serif"
          ref={setMapRef}
          initialViewState={currentViewStateRef.current || initialViewState}
          mapStyle={mapStyle}
          style={{ width: '100%', height: '100%' }}
          doubleClickZoom={false}
          maxZoom={22}
          minZoom={0}
          maxPitch={85}
          // Allow MapLibre to slice vector tiles up to zoom 18 (22 - 4) and overscale
          // above that to prevent exponential tile explosion and WebGL context loss at deep zoom levels.
          zoomLevelsToOverscale={4}
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
          onResize={updateBounds}
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
          <Source id="pins-source" type="geojson" data={pinsGeoJson} maxzoom={24}>
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
            <Marker longitude={previewLocation.lng} latitude={previewLocation.lat} anchor="bottom" style={{ zIndex: 1200 }}>
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

      {/* Combined Compass & Tilt Indicator Control and Location Tracking */}
      {(() => {
        // Portaled buttons share the 28px search row. The mobile sidebar zoom
        // brings that back up to about the same on-screen size as the 42px map buttons.
        const controlSize = isPortaled ? 28 : 42;
        const compassIconSize = isPortaled ? 22 : 34;
        const locateIconSize = isPortaled ? 16 : 24;
        const mapControls = (
          <>
            <button
              onClick={handleToggleLocationTracking}
              style={{
                position: isPortaled ? 'relative' : 'absolute',
                bottom: isPortaled ? undefined : '60px',
                right: isPortaled ? undefined : '12px',
                width: `${controlSize}px`,
                height: `${controlSize}px`,
                boxSizing: 'border-box',
                flexShrink: 0,
                borderRadius: isPortaled ? '8px' : '12px',
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
                pointerEvents: 'auto',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-color)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface-color)')}
              title={!isTrackingLocation ? 'Find my location' : userLocation ? 'Stop location tracking' : 'Locating...'}
              aria-label={!isTrackingLocation ? 'Find my location' : userLocation ? 'Stop location tracking' : 'Locating...'}
              aria-pressed={isTrackingLocation}
            >
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Locate size={locateIconSize} />
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

            <button
              ref={compassButtonRef}
              onClick={handleCombinedCompassTilt}
              onPointerDown={handleCompassPointerDown}
              onPointerUp={handleCompassPointerUp}
              onPointerCancel={handleCompassPointerUp}
              onPointerLeave={handleCompassPointerUp}
              style={{
                position: isPortaled ? 'relative' : 'absolute',
                bottom: isPortaled ? undefined : '10px',
                right: isPortaled ? undefined : '12px',
                width: `${controlSize}px`,
                height: `${controlSize}px`,
                boxSizing: 'border-box',
                flexShrink: 0,
                borderRadius: isPortaled ? '8px' : '12px',
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
                pointerEvents: 'auto',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-color)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface-color)')}
              title="Heading: 0°, Tilt: 0° (Click to reset)"
              aria-label="Compass - Reset bearing to North"
            >
              <svg
                ref={compassSvgRef}
                width={compassIconSize}
                height={compassIconSize}
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
          </>
        );

        return activeTarget ? createPortal(mapControls, activeTarget) : mapControls;
      })()}

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
          margin: 0 ${!isMobile ? '60px' : isPanelMinimized ? '108px' : '10px'} 10px 0 !important;
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
