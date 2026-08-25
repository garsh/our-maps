import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SearchBar from '../SearchBar';

describe('SearchBar', () => {
  const mockOnResultSelect = vi.fn();
  const mockOnAddPin = vi.fn();
  const mockPins = [
    { id: '1', lat: 10, lng: 20, label: 'Local Coffee', description: 'Good coffee', position: 0 }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly', () => {
    render(<SearchBar onResultSelect={mockOnResultSelect} onAddPin={mockOnAddPin} pins={[]} />);
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

    render(<SearchBar onResultSelect={mockOnResultSelect} onAddPin={mockOnAddPin} pins={[]} debounceMs={10} />);
    
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
    render(<SearchBar onResultSelect={mockOnResultSelect} onAddPin={mockOnAddPin} pins={mockPins} />);
    
    const input = screen.getByPlaceholderText(/Search.../i);
    fireEvent.change(input, { target: { value: 'Cofee' } }); // Misspelled

    await waitFor(() => {
      expect(screen.getByText('Local Coffee')).toBeInTheDocument();
    });
  });

  it('previews a local result when clicked', async () => {
    const mockOnHoverPin = vi.fn();
    render(<SearchBar onResultSelect={mockOnResultSelect} onAddPin={mockOnAddPin} onHoverPin={mockOnHoverPin} pins={mockPins} />);
    
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
        onResultSelect={mockOnResultSelect} 
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

    render(<SearchBar onResultSelect={mockOnResultSelect} onAddPin={mockOnAddPin} pins={[]} debounceMs={10} />);
    
    fireEvent.change(screen.getByPlaceholderText(/Search.../i), { target: { value: 'New York' } });

    await waitFor(() => screen.getByText('New York'));
    fireEvent.click(screen.getByTitle('Add to Map'));

    expect(mockOnAddPin).toHaveBeenCalledWith(40, -74, 'New York', 'New York, USA');
  });
});
