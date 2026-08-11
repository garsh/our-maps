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

  it('calls onResultSelect when a local result is clicked', async () => {
    render(<SearchBar onResultSelect={mockOnResultSelect} onAddPin={mockOnAddPin} pins={mockPins} />);
    
    fireEvent.change(screen.getByPlaceholderText(/Search.../i), { target: { value: 'Coffee' } });

    await waitFor(() => screen.getByText('Local Coffee'));
    fireEvent.click(screen.getByText('Local Coffee'));

    expect(mockOnResultSelect).toHaveBeenCalledWith(10, 20);
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
