import { useState, useEffect, useMemo } from 'react';
import type { Pin } from '@shared/interfaces';
import Fuse from 'fuse.js';
import { Search, MapPin, Loader2, X, Plus } from 'lucide-react';
import { apiService } from '../services/api';

interface SearchResult {
  place_id: string | number;
  title: string;
  address: string;
  lat: string;
  lon: string;
  type: 'global' | 'local';
  pinId?: string;
}

interface SearchBarProps {
  onResultSelect: (lat: number, lng: number) => void;
  onAddPin: (lat: number, lng: number, label: string, address?: string) => void;
  pins: Pin[];
  disabled?: boolean;
  debounceMs?: number;
  mapBounds?: string | null;
  onHoverSearchResult?: (lat: number | null, lng: number | null) => void;
  onHoverPin?: (id: string | null) => void;
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

const SearchBar = ({ onResultSelect, onAddPin, pins, disabled, debounceMs = 500, mapBounds, onHoverSearchResult, onHoverPin }: SearchBarProps) => {
  const [query, setQuery] = useState('');
  const [globalResults, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Initialize Fuse for fuzzy search on local pins
  const fuse = useMemo(() => {
    return new Fuse(pins, {
      keys: ['label', 'description'],
      threshold: 0.4,
      includeScore: true,
    });
  }, [pins]);

  const localResults = useMemo((): SearchResult[] => {
    if (!query.trim()) return [];
    return fuse.search(query).slice(0, 5).map(result => {
      const label = result.item.label || 'Unnamed Pin';
      const address = result.item.address || '';
      return {
        place_id: `local-${result.item.id}`,
        title: label,
        address: address,
        lat: result.item.lat.toString(),
        lon: result.item.lng.toString(),
        type: 'local',
        pinId: result.item.id
      };
    });
  }, [query, fuse]);

  // Debounced global search
  useEffect(() => {
    if (query.length < 3) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const handler = setTimeout(async () => {
      setIsSearching(true);
      try {
        const formatted = await apiService.search(query, mapBounds);
        
        // Filter out global results that are too close to existing pins (approx 10m)
        const filteredGlobal = formatted.filter(globalResult => {
          const gLat = parseFloat(globalResult.lat);
          const gLon = parseFloat(globalResult.lon);
          return !pins.some(pin => 
            Math.abs(pin.lat - gLat) < 0.0001 && 
            Math.abs(pin.lng - gLon) < 0.0001
          );
        });
        
        setResults(filteredGlobal);
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsSearching(false);
      }
    }, debounceMs);

    return () => clearTimeout(handler);
  }, [query, debounceMs, mapBounds, pins]);

  const handleResultClick = (result: SearchResult) => {
    onResultSelect(parseFloat(result.lat), parseFloat(result.lon));
    // Clear search on local select to clean up UI
    if (result.type === 'local') setQuery('');
  };

  return (
    <div className="search-container" style={{ marginBottom: '0.8rem', position: 'relative' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: '12px', color: 'var(--primary-color)', display: 'flex' }}>
          {isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search..."
          disabled={disabled}
          className="input-field"
          style={{ 
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
             onClick={() => setQuery('')}
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
                  onClick={() => handleResultClick(result)}
                  style={{ padding: '0.4rem 0.2rem', borderBottom: '1px solid #f1f1f1', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-color)';
                    onHoverPin?.(result.pinId || null);
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    onHoverPin?.(null);
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
                  style={{ padding: '0.4rem 0.2rem', borderBottom: '1px solid #f1f1f1', fontSize: '0.85rem', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-color)';
                    onHoverSearchResult?.(parseFloat(result.lat), parseFloat(result.lon));
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    onHoverSearchResult?.(null, null);
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
                    {!disabled && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddPin(parseFloat(result.lat), parseFloat(result.lon), result.title || result.address.split(',')[0], result.address || undefined);
                          setQuery('');
                        }}
                        style={{ 
                          background: '#27ae60', 
                          color: 'white', 
                          border: 'none', 
                          borderRadius: '3px', 
                          width: '14px',
                          height: '14px',
                          padding: '0', 
                          cursor: 'pointer', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          flexShrink: 0
                        }}
                        title="Add to Map"
                      >
                        <Plus size={10} />
                      </button>
                    )}
                    <div 
                      style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                      onClick={() => handleResultClick(result)}
                    >
                      {renderAddressParts(result.title, result.address)}
                    </div>
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
