import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SearchBar from '../SearchBar';

describe('SearchBar', () => {
  const mockOnAddPin = vi.fn();
  const mockPins = [
    { id: '1', lat: 10, lng: 20, label: 'Local Coffee', description: 'Good coffee', position: 0 }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly', () => {
    render(<SearchBar onAddPin={mockOnAddPin} pins={[]} />);
    expect(screen.getByPlaceholderText(/Search.../i)).toBeInTheDocument();
  });

  it('performs live global search after debounce', async () => {
    const mockResults = [
      { place_id: 1, address: 'London, UK', title: '', lat: '51.5', lon: '-0.1' }
    ];
    
    (window.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResults
    });

    render(<SearchBar onAddPin={mockOnAddPin} pins={[]} debounceMs={10} />);
    
    const input = screen.getByPlaceholderText(/Search.../i);
    fireEvent.change(input, { target: { value: 'London' } });

    await waitFor(() => {
      expect(screen.getByText('London')).toBeInTheDocument();
    });

    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining('q=London'),
      expect.any(Object)
    );
  });

  it('performs fuzzy search on local pins', async () => {
    render(<SearchBar onAddPin={mockOnAddPin} pins={mockPins} />);
    
    const input = screen.getByPlaceholderText(/Search.../i);
    fireEvent.change(input, { target: { value: 'Cofee' } }); // Misspelled

    await waitFor(() => {
      expect(screen.getByText('Local Coffee')).toBeInTheDocument();
    });
  });

  it('previews a local result when clicked', async () => {
    const mockOnHoverPin = vi.fn();
    render(<SearchBar onAddPin={mockOnAddPin} onHoverPin={mockOnHoverPin} pins={mockPins} />);
    
    fireEvent.change(screen.getByPlaceholderText(/Search.../i), { target: { value: 'Coffee' } });

    await waitFor(() => screen.getByText('Local Coffee'));
    fireEvent.click(screen.getByText('Local Coffee'));

    expect(mockOnHoverPin).toHaveBeenCalledWith('1');
  });

  it('filters local pins by mapBounds while preserving best match order', async () => {
    const mixedPins = [
      { id: '1', lat: 10.8, lng: 20.8, label: 'Coffee Spot', description: 'Best match in bounds', position: 0 },
      { id: '2', lat: 10.0, lng: 20.0, label: 'Nice Place with Coffee', description: 'Secondary match in bounds', position: 1 },
      { id: '3', lat: 11.3, lng: 20.0, label: 'Coffee Outside', description: 'Slightly outside bounds', position: 2 },
      { id: '4', lat: 50.0, lng: 80.0, label: 'Distant Coffee', description: 'Out of bounds', position: 3 }
    ];

    // Bounds around lat: 10, lng: 20 -> west: 19, north: 11, east: 21, south: 9.
    render(
      <SearchBar 
        onAddPin={mockOnAddPin} 
        pins={mixedPins} 
        mapBounds="19,11,21,9" 
      />
    );
    
    const input = screen.getByPlaceholderText(/Search.../i);
    fireEvent.change(input, { target: { value: 'Coffee Spot' } });

    await waitFor(() => {
      expect(screen.getByText('Coffee Spot')).toBeInTheDocument();
      expect(screen.queryByText('Coffee Outside')).not.toBeInTheDocument();
      expect(screen.queryByText('Distant Coffee')).not.toBeInTheDocument();
    });
  });

  it('calls onAddPin when + Add to Map is clicked', async () => {
    const mockResults = [
      { place_id: 1, address: 'New York, USA', title: '', lat: '40', lon: '-74' }
    ];
    
    (window.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResults
    });

    render(<SearchBar onAddPin={mockOnAddPin} pins={[]} debounceMs={10} />);
    
    fireEvent.change(screen.getByPlaceholderText(/Search.../i), { target: { value: 'New York' } });

    await waitFor(() => screen.getByText('New York'));
    fireEvent.click(screen.getByTitle('Add to Map'));

    expect(mockOnAddPin).toHaveBeenCalledWith(40, -74, 'New York', 'New York, USA');
  });

  it('does not re-trigger global search when mapBounds changes without text changes', async () => {
    const mockResults = [
      { place_id: 1, address: 'Paris, France', title: 'Paris', lat: '48.85', lon: '2.35' }
    ];
    
    (window.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResults
    });

    const { rerender } = render(
      <SearchBar 
        onAddPin={mockOnAddPin} 
        pins={[]} 
        debounceMs={10} 
        mapBounds="2.2,48.9,2.4,48.8" 
      />
    );

    const input = screen.getByPlaceholderText(/Search.../i);
    fireEvent.change(input, { target: { value: 'Paris' } });

    await waitFor(() => {
      expect(screen.getByText('France')).toBeInTheDocument();
    });

    const callCountAfterSearch = (window.fetch as any).mock.calls.length;

    // Simulate panning the map (bounds change)
    rerender(
      <SearchBar 
        onAddPin={mockOnAddPin} 
        pins={[]} 
        debounceMs={10} 
        mapBounds="10.0,50.0,12.0,49.0" 
      />
    );

    // Wait and ensure no additional fetch calls were made
    await new Promise(r => setTimeout(r, 50));
    expect((window.fetch as any).mock.calls.length).toBe(callCountAfterSearch);
  });

  it('signals onSearchAreaStateChange when mapBounds changes after an initial search', async () => {
    const mockOnSearchAreaStateChange = vi.fn();
    const mockResults = [
      { place_id: 1, address: 'Tokyo, Japan', title: 'Tokyo', lat: '35.6', lon: '139.6' }
    ];
    
    (window.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResults
    });

    const { rerender } = render(
      <SearchBar 
        onAddPin={mockOnAddPin} 
        pins={[]} 
        debounceMs={10} 
        mapBounds="139.0,36.0,140.0,35.0" 
        onSearchAreaStateChange={mockOnSearchAreaStateChange}
      />
    );

    const input = screen.getByPlaceholderText(/Search.../i);
    fireEvent.change(input, { target: { value: 'Tokyo' } });

    await waitFor(() => {
      expect(screen.getByText('Japan')).toBeInTheDocument();
    });

    // Simulate panning the map
    rerender(
      <SearchBar 
        onAddPin={mockOnAddPin} 
        pins={[]} 
        debounceMs={10} 
        mapBounds="138.0,37.0,139.0,36.0" 
        onSearchAreaStateChange={mockOnSearchAreaStateChange}
      />
    );

    await waitFor(() => {
      expect(mockOnSearchAreaStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ showPill: true })
      );
    });
  });

  it('executes search immediately on Enter key press', async () => {
    const mockResults = [
      { place_id: 1, address: 'Berlin, Germany', title: 'Berlin', lat: '52.5', lon: '13.4' }
    ];
    
    (window.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResults
    });

    render(<SearchBar onAddPin={mockOnAddPin} pins={[]} debounceMs={5000} />);
    
    const input = screen.getByPlaceholderText(/Search.../i);
    fireEvent.change(input, { target: { value: 'Berlin' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Germany')).toBeInTheDocument();
    });

    expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining('q=Berlin'),
      expect.any(Object)
    );
  });
});
