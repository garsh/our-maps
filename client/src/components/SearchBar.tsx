import { useState } from 'react';

interface SearchResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

interface SearchBarProps {
  onResultSelect: (lat: number, lng: number) => void;
  onAddPin: (lat: number, lng: number, label: string) => void;
}

const SearchBar = ({ onResultSelect, onAddPin }: SearchBarProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`
      );
      const data = await response.json();
      setResults(data);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="search-container" style={{ marginBottom: '1.5rem' }}>
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a place..."
          style={{ flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid #ced4da' }}
        />
        <button
          type="submit"
          disabled={isSearching}
          style={{ padding: '0.5rem 1rem', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          {isSearching ? '...' : 'Search'}
        </button>
      </form>

      {results.length > 0 && (
        <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'white', border: '1px solid #dee2e6', borderRadius: '4px' }}>
          {results.map((result) => (
            <div
              key={result.place_id}
              style={{ padding: '0.5rem', borderBottom: '1px solid #eee', fontSize: '0.85rem' }}
            >
              <div 
                style={{ cursor: 'pointer', color: '#3498db', marginBottom: '0.3rem' }}
                onClick={() => onResultSelect(parseFloat(result.lat), parseFloat(result.lon))}
              >
                {result.display_name}
              </div>
              <button
                onClick={() => onAddPin(parseFloat(result.lat), parseFloat(result.lon), result.display_name.split(',')[0])}
                style={{ fontSize: '0.7rem', background: '#27ae60', color: 'white', border: 'none', borderRadius: '3px', padding: '2px 6px', cursor: 'pointer' }}
              >
                + Add Pin
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
