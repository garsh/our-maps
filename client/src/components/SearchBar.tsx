import { useState, useEffect, useMemo } from 'react';
import type { Pin } from '@shared/interfaces';
import Fuse from 'fuse.js';
import { Search, MapPin, Globe, Loader2 } from 'lucide-react';

interface SearchResult {
  place_id: string | number;
  display_name: string;
  lat: string;
  lon: string;
  type: 'global' | 'local';
  pinId?: string;
}

interface SearchBarProps {
  onResultSelect: (lat: number, lng: number) => void;
  onAddPin: (lat: number, lng: number, label: string) => void;
  pins: Pin[];
  disabled?: boolean;
  debounceMs?: number;
}

const SearchBar = ({ onResultSelect, onAddPin, pins, disabled, debounceMs = 500 }: SearchBarProps) => {
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

  // Local fuzzy search results
  const localResults = useMemo((): SearchResult[] => {
    if (!query.trim()) return [];
    return fuse.search(query).map(result => ({
      place_id: `local-${result.item.id}`,
      display_name: result.item.label || 'Unnamed Pin',
      lat: result.item.lat.toString(),
      lon: result.item.lng.toString(),
      type: 'local',
      pinId: result.item.id
    }));
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
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`
        );
        const data = await response.json();
        const formatted: SearchResult[] = data.map((item: any) => ({
          place_id: item.place_id,
          display_name: item.display_name,
          lat: item.lat,
          lon: item.lon,
          type: 'global'
        }));
        setResults(formatted);
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsSearching(false);
      }
    }, debounceMs);

    return () => clearTimeout(handler);
  }, [query, debounceMs]);

  const handleResultClick = (result: SearchResult) => {
    onResultSelect(parseFloat(result.lat), parseFloat(result.lon));
    // Clear search on local select to clean up UI
    if (result.type === 'local') setQuery('');
  };

  return (
    <div className="search-container" style={{ marginBottom: '1.5rem', position: 'relative' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: '10px', color: '#999' }}>
          {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pins or places..."
          disabled={disabled}
          style={{ 
            width: '100%', 
            padding: '0.6rem 0.6rem 0.6rem 2.2rem', 
            borderRadius: '6px', 
            border: '1px solid #ced4da',
            boxSizing: 'border-box',
            fontSize: '0.9rem'
          }}
        />
      </div>

      {query.trim() !== '' && (localResults.length > 0 || globalResults.length > 0) && (
        <div style={{ 
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          maxHeight: '300px', 
          overflowY: 'auto', 
          background: 'white', 
          border: '1px solid #dee2e6', 
          borderRadius: '4px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          zIndex: 1500,
          marginTop: '4px'
        }}>
          {/* Local Results */}
          {localResults.length > 0 && (
            <div>
              <div style={{ background: '#f8f9fa', padding: '4px 10px', fontSize: '0.7rem', fontWeight: 'bold', color: '#666', borderBottom: '1px solid #eee' }}>
                YOUR PINS
              </div>
              {localResults.map((result) => (
                <div
                  key={result.place_id}
                  onClick={() => handleResultClick(result)}
                  style={{ padding: '0.6rem 1rem', borderBottom: '1px solid #eee', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f0f7ff'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <MapPin size={14} color="#3498db" />
                  <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {result.display_name}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Global Results */}
          {globalResults.length > 0 && (
            <div>
              <div style={{ background: '#f8f9fa', padding: '4px 10px', fontSize: '0.7rem', fontWeight: 'bold', color: '#666', borderBottom: '1px solid #eee' }}>
                GLOBAL LOCATIONS
              </div>
              {globalResults.map((result) => (
                <div
                  key={result.place_id}
                  style={{ padding: '0.6rem 1rem', borderBottom: '1px solid #eee', fontSize: '0.85rem' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f0fdf4'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div 
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.4rem' }}
                    onClick={() => handleResultClick(result)}
                  >
                    <Globe size={14} color="#27ae60" />
                    <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {result.display_name}
                    </div>
                  </div>
                  {!disabled && (
                    <button
                      onClick={() => {
                        onAddPin(parseFloat(result.lat), parseFloat(result.lon), result.display_name.split(',')[0]);
                        setQuery('');
                      }}
                      style={{ fontSize: '0.7rem', background: '#27ae60', color: 'white', border: 'none', borderRadius: '3px', padding: '3px 8px', cursor: 'pointer', marginLeft: '22px' }}
                    >
                      + Add to Map
                    </button>
                  )}
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
