import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Pin } from '@shared/interfaces';
import Fuse from 'fuse.js';
import { Search, MapPin, Loader2, X, Plus } from 'lucide-react';
import { apiService } from '../services/api';
import { parseAndClampBounds, isWithinBounds } from '@shared/geoUtils';
import { getMapViewportBounds, subscribeMapViewportBounds } from '../utils/mapViewport';

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

const SearchBar = ({ onAddPin, pins, disabled, debounceMs = 500, mapBounds, onHoverSearchResult, onHoverPin, onSearchAreaStateChange }: SearchBarProps) => {
  const [query, setQuery] = useState('');
  const [globalResults, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [lastSearchedBounds, setLastSearchedBounds] = useState<string | null>(null);
  const [storeBounds, setStoreBounds] = useState<string | null>(() => getMapViewportBounds());
  const effectiveBounds = mapBounds ?? storeBounds ?? getMapViewportBounds();
  const mapBoundsRef = useRef(effectiveBounds);
  mapBoundsRef.current = effectiveBounds;
  const abortControllerRef = useRef<AbortController | null>(null);

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

  const localResults = useMemo((): SearchResult[] => {
    if (!query.trim()) return [];
    let searchResults = fuse.search(query);

    const clamped = parseAndClampBounds(effectiveBounds);
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
  }, [query, fuse, effectiveBounds]);

  const executeGlobalSearch = useCallback(async (searchQuery: string, boundsToUse?: string | null) => {
    if (searchQuery.trim().length < 3) {
      abortControllerRef.current?.abort();
      setResults([]);
      setIsSearching(false);
      setLastSearchedBounds(null);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    const bounds = boundsToUse ?? mapBoundsRef.current ?? getMapViewportBounds();
    try {
      const formatted = await apiService.search(searchQuery, bounds, controller.signal);
      if (!controller.signal.aborted) {
        setResults(formatted);
        setLastSearchedBounds(bounds || null);
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

  // Debounced global search triggered solely on query text changes
  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      setIsSearching(false);
      setLastSearchedBounds(null);
      return;
    }

    const handler = setTimeout(() => {
      executeGlobalSearch(query, mapBoundsRef.current);
    }, debounceMs);

    return () => clearTimeout(handler);
  }, [query, debounceMs, executeGlobalSearch]);

  // Notify parent of "Search this area" pill availability when user pans/zooms after an initial search
  useEffect(() => {
    if (onSearchAreaStateChange) {
      if (
        query.trim().length >= 3 &&
        effectiveBounds &&
        lastSearchedBounds &&
        effectiveBounds !== lastSearchedBounds
      ) {
        onSearchAreaStateChange({
          showPill: true,
          onSearchThisArea: () => {
            executeGlobalSearch(query, mapBoundsRef.current);
          },
          isSearching,
        });
      } else {
        onSearchAreaStateChange(null);
      }
    }
  }, [query, effectiveBounds, lastSearchedBounds, isSearching, onSearchAreaStateChange, executeGlobalSearch]);

  useEffect(() => {
    return () => {
      onSearchAreaStateChange?.(null);
    };
  }, [onSearchAreaStateChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim().length >= 3) {
      e.preventDefault();
      const bounds = mapBounds ?? getMapViewportBounds() ?? mapBoundsRef.current;
      executeGlobalSearch(query, bounds);
    }
  };

  // Show a hover preview pin without closing the search results (for tap/click)
  const handleResultPreview = (result: SearchResult) => {
    if (result.type === 'local' && result.pinId) {
      onHoverPin?.(result.pinId);
    } else {
      onHoverSearchResult?.(parseFloat(result.lat), parseFloat(result.lon));
    }
  };

  return (
    <div className="search-container" style={{ marginBottom: 0, position: 'relative', height: '28px' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', height: '28px' }}>
        <div style={{ position: 'absolute', left: '12px', color: 'var(--primary-color)', display: 'flex' }}>
          {isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
             onClick={() => {
               setQuery('');
               setResults([]);
               setLastSearchedBounds(null);
             }}
             style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', display: 'flex', padding: 0 }}
           >
             <X size={14} />
           </button>
        )}
      </div>

      {query.trim() !== '' && (localResults.length > 0 || globalResults.length > 0) && (
        <div style={{ 
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          maxHeight: 'calc(100vh - 180px)', 
          overflowY: 'auto', 
          background: 'white', 
          border: '1px solid var(--border-color)', 
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 1500,
          marginTop: '8px'
        }}>
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
                    onHoverPin?.(result.pinId || null);
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
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
                    onHoverSearchResult?.(parseFloat(result.lat), parseFloat(result.lon));
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
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
                          onHoverSearchResult?.(null, null);
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
