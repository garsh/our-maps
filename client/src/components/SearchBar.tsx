import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import type { Pin } from '@shared/interfaces';
import Fuse from 'fuse.js';
import { Search, MapPin, Loader2, X, Plus } from 'lucide-react';
import { apiService } from '../services/api';
import { parseAndClampBounds, isWithinBounds } from '@shared/geoUtils';
import { getMapViewportBounds, subscribeMapViewportBounds } from '../utils/mapViewport';
import { hasFinePointer } from '../utils/pinHover';

interface SearchResult {
  place_id: string | number;
  title: string;
  address: string;
  lat: string;
  lon: string;
  type: 'global' | 'local';
  pinId?: string;
}

export interface SearchAreaState {
  showPill: boolean;
  onSearchThisArea: () => void;
  isSearching: boolean;
}

interface SearchBarProps {
  onAddPin: (lat: number, lng: number, label: string, address?: string) => void;
  pins: Pin[];
  disabled?: boolean;
  debounceMs?: number;
  mapBounds?: string | null;
  onHoverSearchResult?: (lat: number | null, lng: number | null) => void;
  onHoverPin?: (id: string | null, leavingPinId?: string) => void;
  onSearchAreaStateChange?: (state: SearchAreaState | null) => void;
  isPanelMinimized?: boolean;
}

const RESULTS_GAP_PX = 8;

// The sheet/sidebar clips overflow. A viewport max-height taller than that clip
// is not a scrollport, so a touch cannot move rows that are only clipped.
export function measureSearchResultsMaxHeight(anchor: HTMLElement): number {
  const anchorRect = anchor.getBoundingClientRect();
  const clip = anchor.closest('aside');
  const clipRect = clip?.getBoundingClientRect();
  const scaleSource = clip && clip.offsetHeight > 0 ? clip : anchor;
  const scaleRect = scaleSource === clip && clipRect ? clipRect : anchorRect;
  const scale = scaleSource.offsetHeight > 0 && scaleRect.height > 0
    ? scaleRect.height / scaleSource.offsetHeight
    : 1;
  const viewport = window.visualViewport;
  const viewportBottom = viewport && viewport.height > 0
    ? viewport.offsetTop + viewport.height
    : window.innerHeight;
  const clipBottom = clipRect ? Math.min(clipRect.bottom, viewportBottom) : viewportBottom;
  return Math.max(0, Math.floor((clipBottom - anchorRect.bottom) / scale - RESULTS_GAP_PX));
}

const renderAddressParts = (title: string, address: string = '') => {
  if (!address && !title) return null;
  const addressParts = address ? address.split(',').map(s => s.trim()).filter(Boolean) : [];
  const street = addressParts.length > 0 ? addressParts[0] : null;
  const rest = addressParts.length > 1 ? addressParts.slice(1).join(', ') : null;
  
  return (
    <>
      {title && (
        <div style={{ fontWeight: '600', fontSize: '0.75rem', lineHeight: '1.2' }}>
          {title}
        </div>
      )}
      {street && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.2', marginTop: title ? '2px' : 0 }}>
          {street}
        </div>
      )}
      {rest && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: '1.2', marginTop: '2px' }}>
          {rest}
        </div>
      )}
    </>
  );
};

const SearchBar = ({ onAddPin, pins, disabled, debounceMs = 500, mapBounds, onHoverSearchResult, onHoverPin, onSearchAreaStateChange, isPanelMinimized = false }: SearchBarProps) => {
  const [query, setQuery] = useState('');
  const [globalResults, setResults] = useState<SearchResult[]>([]);
  const [localResults, setLocalResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [lastSearchedBounds, setLastSearchedBounds] = useState<string | null>(null);
  const [storeBounds, setStoreBounds] = useState<string | null>(() => getMapViewportBounds());
  const effectiveBounds = mapBounds ?? storeBounds ?? getMapViewportBounds();
  const mapBoundsRef = useRef(effectiveBounds);
  mapBoundsRef.current = effectiveBounds;
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [resultsMaxHeight, setResultsMaxHeight] = useState<number | null>(null);
  const onHoverSearchResultRef = useRef(onHoverSearchResult);
  onHoverSearchResultRef.current = onHoverSearchResult;
  const onHoverPinRef = useRef(onHoverPin);
  onHoverPinRef.current = onHoverPin;
  const prevQueryRef = useRef(query);
  const activePreviewIdRef = useRef<string | number | null>(null);

  if (isPanelMinimized && query !== '') {
    setQuery('');
    setLocalResults([]);
    setResults([]);
    setLastSearchedBounds(null);
    setIsSearching(false);
    prevQueryRef.current = '';
  }

  const clearPreview = useCallback(() => {
    activePreviewIdRef.current = null;
    onHoverPinRef.current?.(null);
    onHoverSearchResultRef.current?.(null, null);
  }, []);

  const handleClear = () => {
    setQuery('');
    setLocalResults([]);
    setResults([]);
    setLastSearchedBounds(null);
    setIsSearching(false);
    abortControllerRef.current?.abort();
    prevQueryRef.current = '';
    clearPreview();
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (!isPanelMinimized) return;
    abortControllerRef.current?.abort();
    clearPreview();
  }, [isPanelMinimized, clearPreview]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (mapBounds != null) return;
    const initial = getMapViewportBounds();
    if (initial) {
      mapBoundsRef.current = initial;
      setStoreBounds(initial);
    }
    return subscribeMapViewportBounds((next) => {
      mapBoundsRef.current = next;
      setStoreBounds(next);
    });
  }, [mapBounds]);

  // Initialize Fuse for fuzzy search on local pins (memoized on pins array only)
  const fuse = useMemo(() => {
    return new Fuse(pins, {
      keys: ['label', 'description'],
      threshold: 0.4,
      includeScore: true,
    });
  }, [pins]);

  const computeLocalResults = useCallback((searchQuery: string, boundsToUse?: string | null): SearchResult[] => {
    if (!searchQuery.trim()) return [];
    let searchResults = fuse.search(searchQuery);

    const clamped = parseAndClampBounds(boundsToUse);
    if (clamped) {
      searchResults = searchResults.filter((result) =>
        isWithinBounds(result.item.lat, result.item.lng, clamped)
      );
    }

    return searchResults.slice(0, 5).map(result => {
      const label = result.item.label || 'Unnamed Pin';
      const address = result.item.address || '';
      return {
        place_id: `local-${result.item.id}`,
        title: label,
        address: address,
        lat: result.item.lat.toString(),
        lon: result.item.lng.toString(),
        type: 'local' as const,
        pinId: result.item.id
      };
    });
  }, [fuse]);

  const executeGlobalSearch = useCallback(async (searchQuery: string, boundsToUse?: string | null) => {
    if (searchQuery.trim().length < 3) {
      abortControllerRef.current?.abort();
      setResults([]);
      setIsSearching(false);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    const bounds = boundsToUse ?? mapBoundsRef.current ?? getMapViewportBounds();
    try {
      const formatted = await apiService.search(searchQuery.trim(), bounds, controller.signal);
      if (!controller.signal.aborted) {
        setResults(formatted);
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError' && !controller.signal.aborted) {
        console.error('Search failed:', error);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    const trimmed = val.trim();
    if (!trimmed) {
      setLocalResults([]);
      setResults([]);
      setIsSearching(false);
      setLastSearchedBounds(null);
      clearPreview();
      return;
    }

    const bounds = mapBoundsRef.current ?? getMapViewportBounds();
    setLocalResults(computeLocalResults(trimmed, bounds));
    setLastSearchedBounds(bounds || null);
  };

  const handleSearchThisArea = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const bounds = mapBoundsRef.current ?? getMapViewportBounds();
    setLocalResults(computeLocalResults(trimmed, bounds));
    setLastSearchedBounds(bounds || null);
    if (trimmed.length >= 3) {
      executeGlobalSearch(trimmed, bounds);
    }
  }, [query, computeLocalResults, executeGlobalSearch]);

  const handleSearchThisAreaRef = useRef(handleSearchThisArea);
  handleSearchThisAreaRef.current = handleSearchThisArea;
  const onSearchAreaStateChangeRef = useRef(onSearchAreaStateChange);
  onSearchAreaStateChangeRef.current = onSearchAreaStateChange;
  const lastSearchAreaNoticeRef = useRef<{ showPill: boolean; isSearching: boolean } | null>(null);
  const stableSearchThisArea = useCallback(() => {
    handleSearchThisAreaRef.current();
  }, []);

  // Debounced global search triggered solely on query text changes
  useEffect(() => {
    if (prevQueryRef.current === query) return;
    prevQueryRef.current = query;

    if (query.trim().length < 3) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const handler = setTimeout(() => {
      executeGlobalSearch(query.trim(), mapBoundsRef.current);
    }, debounceMs);

    return () => clearTimeout(handler);
  }, [query, debounceMs, executeGlobalSearch]);

  const prevPinsRef = useRef(pins);
  // If pins change while a query is active, recompute local results using the last searched bounds
  useEffect(() => {
    if (prevPinsRef.current !== pins) {
      prevPinsRef.current = pins;
      if (query.trim() && lastSearchedBounds) {
        setLocalResults(computeLocalResults(query.trim(), lastSearchedBounds));
      }
    }
  }, [pins, computeLocalResults, query, lastSearchedBounds]);

  // Notify parent of "Search this area" pill availability when user pans/zooms after an initial search.
  // Only push a new object when showPill or the searching spinner actually flips — not on every pan.
  useEffect(() => {
    const showPill = Boolean(
      query.trim().length >= 3 &&
      effectiveBounds &&
      lastSearchedBounds &&
      effectiveBounds !== lastSearchedBounds
    );
    const searching = showPill && isSearching;
    const prev = lastSearchAreaNoticeRef.current;
    if (prev && prev.showPill === showPill && prev.isSearching === searching) return;
    lastSearchAreaNoticeRef.current = { showPill, isSearching: searching };
    if (showPill) {
      onSearchAreaStateChangeRef.current?.({
        showPill: true,
        onSearchThisArea: stableSearchThisArea,
        isSearching: searching,
      });
    } else {
      onSearchAreaStateChangeRef.current?.(null);
    }
  }, [query, effectiveBounds, lastSearchedBounds, isSearching, stableSearchThisArea]);

  useEffect(() => {
    return () => {
      onSearchAreaStateChange?.(null);
    };
  }, [onSearchAreaStateChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim()) {
      e.preventDefault();
      handleSearchThisArea();
    }
  };

  const resultsOpen = query.trim() !== '' && (localResults.length > 0 || globalResults.length > 0);

  const updateResultsMaxHeight = useCallback(() => {
    const anchor = containerRef.current;
    if (!anchor) return;
    const next = measureSearchResultsMaxHeight(anchor);
    setResultsMaxHeight((prev) => (prev === next ? prev : next));
  }, []);

  useLayoutEffect(() => {
    if (!resultsOpen) return;
    updateResultsMaxHeight();
    const anchor = containerRef.current;
    const clip = anchor?.closest('aside') ?? anchor;
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => updateResultsMaxHeight())
      : null;
    if (clip) observer?.observe(clip);
    if (anchor && anchor !== clip) observer?.observe(anchor);
    window.addEventListener('resize', updateResultsMaxHeight);
    window.visualViewport?.addEventListener('resize', updateResultsMaxHeight);
    window.visualViewport?.addEventListener('scroll', updateResultsMaxHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateResultsMaxHeight);
      window.visualViewport?.removeEventListener('resize', updateResultsMaxHeight);
      window.visualViewport?.removeEventListener('scroll', updateResultsMaxHeight);
    };
  }, [resultsOpen, updateResultsMaxHeight]);

  // Touch also emits mouseenter/mouseleave. Ignore those so a second tap can clear the pin.
  const handleResultPreview = (result: SearchResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    if (hasFinePointer()) {
      if (result.type === 'local' && result.pinId) {
        onHoverPin?.(result.pinId);
      } else {
        onHoverSearchResult?.(lat, lng);
      }
      return;
    }
    if (activePreviewIdRef.current === result.place_id) {
      clearPreview();
      return;
    }
    activePreviewIdRef.current = result.place_id;
    if (result.type === 'local' && result.pinId) {
      onHoverSearchResult?.(null, null);
      onHoverPin?.(result.pinId);
    } else {
      onHoverPin?.(null);
      onHoverSearchResult?.(lat, lng);
    }
  };

  return (
    <div ref={containerRef} className="search-container" style={{ marginBottom: 0, position: 'relative', height: '28px' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: '28px' }}>
        <div style={{ position: 'absolute', left: '12px', color: 'var(--primary-color)', display: 'flex' }}>
          {isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search..."
          disabled={disabled}
          className="input-field"
          style={{ 
            height: '28px',
            boxSizing: 'border-box',
            paddingTop: '6px',
            paddingBottom: '6px',
            paddingLeft: '32px',
            paddingRight: query ? '32px' : '12px',
            background: 'var(--bg-color)',
            border: 'none',
            fontWeight: '600',
            fontSize: '0.8rem'
          }}
        />
        {query && (
          <button 
            type="button"
            aria-label="Clear search"
            onMouseDown={(e) => {
              // Prevent input from losing focus when clicking the clear button
              e.preventDefault();
            }}
            onClick={handleClear}
            style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', display: 'flex', padding: 0 }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {resultsOpen && (
        <div
          data-testid="search-results"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            maxHeight: resultsMaxHeight ?? 0,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
            background: 'white',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 1500,
            marginTop: `${RESULTS_GAP_PX}px`,
          }}
        >
          {/* Local Results */}
          {localResults.length > 0 && (
            <div>
              {localResults.map((result) => (
                <div
                  key={result.place_id}
                  onClick={() => handleResultPreview(result)}
                  style={{ padding: '0.4rem 0.2rem', borderBottom: '1px solid #f1f1f1', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-color)';
                    if (!hasFinePointer()) return;
                    onHoverPin?.(result.pinId || null);
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    if (!hasFinePointer()) return;
                    onHoverPin?.(null, result.pinId);
                  }}
                >
                  <div style={{ 
                    background: 'rgba(72, 61, 139, 0.1)', 
                    borderRadius: '3px', 
                    width: '14px', 
                    height: '14px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    flexShrink: 0 
                  }}>
                    <MapPin size={10} color="var(--primary-color)" />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {renderAddressParts(result.title, result.address)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Global Results */}
          {globalResults.length > 0 && (
            <div>
              {globalResults.map((result) => (
                <div
                  key={result.place_id}
                  style={{ padding: '0.4rem 0.4rem', borderBottom: '1px solid #f1f1f1', fontSize: '0.85rem', transition: 'background 0.2s', cursor: 'pointer' }}
                  onClick={() => handleResultPreview(result)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-color)';
                    if (!hasFinePointer()) return;
                    onHoverSearchResult?.(parseFloat(result.lat), parseFloat(result.lon));
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    if (!hasFinePointer()) return;
                    onHoverSearchResult?.(null, null);
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {renderAddressParts(result.title, result.address)}
                    </div>
                    {!disabled && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddPin(parseFloat(result.lat), parseFloat(result.lon), result.title || result.address.split(',')[0], result.address || undefined);
                          clearPreview();
                          setQuery('');
                        }}
                        style={{ 
                          background: 'white',
                          color: '#27ae60',
                          border: '2px solid #27ae60',
                          borderRadius: '50%',
                          width: '22px',
                          height: '22px',
                          padding: '0',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'background 0.15s, color 0.15s'
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = '#27ae60';
                          (e.currentTarget as HTMLButtonElement).style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.background = 'white';
                          (e.currentTarget as HTMLButtonElement).style.color = '#27ae60';
                        }}
                        title="Add to Map"
                      >
                        <Plus size={13} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
