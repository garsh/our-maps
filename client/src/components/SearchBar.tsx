import { useState, useEffect, useMemo } from 'react';
import type { Pin } from '@shared/interfaces';
import Fuse from 'fuse.js';
import { Search, MapPin, Globe, Loader2, X } from 'lucide-react';

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
  onAddPin: (lat: number, lng: number, label: string, address?: string) => void;
  pins: Pin[];
  disabled?: boolean;
  debounceMs?: number;
  mapBounds?: string | null;
}

const SearchBar = ({ onResultSelect, onAddPin, pins, disabled, debounceMs = 500, mapBounds }: SearchBarProps) => {
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
        let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;
        if (mapBounds) {
          url += `&viewbox=${mapBounds}`;
        }
        const response = await fetch(url);
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
  }, [query, debounceMs, mapBounds]);

  const handleResultClick = (result: SearchResult) => {
    onResultSelect(parseFloat(result.lat), parseFloat(result.lon));
    // Clear search on local select to clean up UI
    if (result.type === 'local') setQuery('');
  };

  return (
    <div className="search-container" style={{ marginBottom: '1.5rem', position: 'relative' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', left: '12px', color: 'var(--primary-color)', display: 'flex' }}>
          {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find pins or new places..."
          disabled={disabled}
          className="input-field"
          style={{ 
            paddingLeft: '40px',
            paddingRight: query ? '40px' : '12px',
            background: 'var(--bg-color)',
            border: 'none',
            fontWeight: '600',
            fontSize: '0.9rem'
          }}
        />
        {query && (
           <button 
             onClick={() => setQuery('')}
             style={{ position: 'absolute', right: '12px', background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', display: 'flex', padding: 0 }}
           >
             <X size={18} />
           </button>
        )}
      </div>

      {query.trim() !== '' && (localResults.length > 0 || globalResults.length > 0) && (
        <div style={{ 
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          maxHeight: '400px', 
          overflowY: 'auto', 
          background: 'white', 
          border: '1px solid var(--border-color)', 
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 1500,
          marginTop: '8px',
          overflow: 'hidden'
        }}>
          {/* Local Results */}
          {localResults.length > 0 && (
            <div>
              <div style={{ background: 'rgba(72, 61, 139, 0.05)', padding: '8px 16px', fontSize: '0.7rem', fontWeight: '800', color: 'var(--primary-color)', letterSpacing: '0.05em' }}>
                YOUR PINS
              </div>
              {localResults.map((result) => (
                <div
                  key={result.place_id}
                  onClick={() => handleResultClick(result)}
                  style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #f1f1f1', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ background: 'rgba(72, 61, 139, 0.1)', padding: '6px', borderRadius: '8px' }}>
                    <MapPin size={16} color="var(--primary-color)" />
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '600' }}>
                    {result.display_name}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Global Results */}
          {globalResults.length > 0 && (
            <div>
              <div style={{ background: 'rgba(39, 174, 96, 0.05)', padding: '8px 16px', fontSize: '0.7rem', fontWeight: '800', color: '#27ae60', letterSpacing: '0.05em' }}>
                GLOBAL LOCATIONS
              </div>
              {globalResults.map((result) => (
                <div
                  key={result.place_id}
                  style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #f1f1f1', fontSize: '0.85rem', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div 
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '0.5rem' }}
                    onClick={() => handleResultClick(result)}
                  >
                    <div style={{ background: 'rgba(39, 174, 96, 0.1)', padding: '6px', borderRadius: '8px' }}>
                      <Globe size={16} color="#27ae60" />
                    </div>
                    <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '600' }}>
                      {result.display_name}
                    </div>
                  </div>
                  {!disabled && (
                    <button
                      onClick={() => {
                        onAddPin(parseFloat(result.lat), parseFloat(result.lon), result.display_name.split(',')[0], result.display_name);
                        setQuery('');
                      }}
                      style={{ fontSize: '0.75rem', background: '#27ae60', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 12px', cursor: 'pointer', marginLeft: '40px', fontWeight: '700' }}
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
