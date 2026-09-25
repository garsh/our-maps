import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SearchBar, { measureSearchResultsMaxHeight } from '../SearchBar';
import { setMapViewportBounds, resetMapViewportBoundsForTests } from '../../utils/mapViewport';
import { setLastPointerTypeForTests } from '../../utils/pinHover';

function searchResultRow(label: string): HTMLElement {
  let node: HTMLElement | null = screen.getByText(label);
  while (node && !node.getAttribute('style')?.includes('cursor: pointer')) {
    node = node.parentElement;
  }
  if (!node) throw new Error(`no search result row for ${label}`);
  return node;
}

describe('SearchBar', () => {
  const mockOnAddPin = vi.fn();
  const mockPins = [
    { id: '1', lat: 10, lng: 20, label: 'Local Coffee', description: 'Good coffee', position: 0 }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    resetMapViewportBoundsForTests();
    setLastPointerTypeForTests('mouse');
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

  it('drops the preview pin when the same result is tapped again on touch', async () => {
    const mockOnHoverSearchResult = vi.fn();
    const mockOnHoverPin = vi.fn();
    (window.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ([
        { place_id: 1, address: 'London, UK', title: '', lat: '51.5', lon: '-0.1' },
        { place_id: 2, address: 'Paris, France', title: '', lat: '48.8', lon: '2.3' },
      ]),
    });

    render(
      <SearchBar
        onAddPin={mockOnAddPin}
        onHoverSearchResult={mockOnHoverSearchResult}
        onHoverPin={mockOnHoverPin}
        pins={mockPins}
        debounceMs={10}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Search.../i), { target: { value: 'London' } });
    await screen.findByText('London');
    const londonRow = searchResultRow('London');
    setLastPointerTypeForTests('touch');

    fireEvent.mouseEnter(londonRow);
    fireEvent.click(londonRow);
    fireEvent.mouseLeave(londonRow);
    expect(mockOnHoverSearchResult).toHaveBeenCalledTimes(1);
    expect(mockOnHoverSearchResult).toHaveBeenCalledWith(51.5, -0.1);

    fireEvent.click(searchResultRow('Paris'));
    expect(mockOnHoverSearchResult).toHaveBeenLastCalledWith(48.8, 2.3);

    fireEvent.click(searchResultRow('Paris'));
    expect(mockOnHoverSearchResult).toHaveBeenLastCalledWith(null, null);
    expect(mockOnHoverPin).toHaveBeenLastCalledWith(null);

    fireEvent.click(searchResultRow('Paris'));
    expect(mockOnHoverSearchResult).toHaveBeenLastCalledWith(48.8, 2.3);
  });

  it('keeps the preview pin when a fine pointer clicks the same result twice', async () => {
    const mockOnHoverSearchResult = vi.fn();
    (window.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ([
        { place_id: 1, address: 'London, UK', title: '', lat: '51.5', lon: '-0.1' },
      ]),
    });

    render(
      <SearchBar
        onAddPin={mockOnAddPin}
        onHoverSearchResult={mockOnHoverSearchResult}
        pins={[]}
        debounceMs={10}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Search.../i), { target: { value: 'London' } });
    await screen.findByText('London');
    const row = searchResultRow('London');
    fireEvent.click(row);
    fireEvent.click(row);
    expect(mockOnHoverSearchResult).toHaveBeenNthCalledWith(1, 51.5, -0.1);
    expect(mockOnHoverSearchResult).toHaveBeenNthCalledWith(2, 51.5, -0.1);

    fireEvent.mouseEnter(row);
    expect(mockOnHoverSearchResult).toHaveBeenLastCalledWith(51.5, -0.1);
    fireEvent.mouseLeave(row);
    expect(mockOnHoverSearchResult).toHaveBeenLastCalledWith(null, null);
  });

  it('clears a local pin highlight when the same result is tapped again on touch', async () => {
    const mockOnHoverPin = vi.fn();
    const mockOnHoverSearchResult = vi.fn();
    setLastPointerTypeForTests('touch');
    render(
      <SearchBar
        onAddPin={mockOnAddPin}
        onHoverPin={mockOnHoverPin}
        onHoverSearchResult={mockOnHoverSearchResult}
        pins={mockPins}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Search.../i), { target: { value: 'Coffee' } });
    await screen.findByText('Local Coffee');
    const row = searchResultRow('Local Coffee');
    fireEvent.mouseEnter(row);
    fireEvent.click(row);
    fireEvent.mouseLeave(row);
    expect(mockOnHoverPin).toHaveBeenCalledTimes(1);
    expect(mockOnHoverPin).toHaveBeenCalledWith('1');

    fireEvent.click(row);
    expect(mockOnHoverPin).toHaveBeenLastCalledWith(null);
    expect(mockOnHoverSearchResult).toHaveBeenLastCalledWith(null, null);
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

    // Ensure no additional fetch calls were made on bounds change without query change
    await new Promise(r => setTimeout(r, 0));
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

    mockOnSearchAreaStateChange.mockClear();
    rerender(
      <SearchBar
        onAddPin={mockOnAddPin}
        pins={[]}
        debounceMs={10}
        mapBounds="137.0,38.0,138.0,37.0"
        onSearchAreaStateChange={mockOnSearchAreaStateChange}
      />
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(mockOnSearchAreaStateChange).not.toHaveBeenCalled();
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

  it('keeps local search results frozen during viewport panning until Search this area is triggered', async () => {
    const mixedPins = [
      { id: '1', lat: 10.8, lng: 20.8, label: 'Coffee Spot', description: 'In bounds', position: 0 },
      { id: '4', lat: 50.0, lng: 80.0, label: 'Distant Coffee', description: 'Out of bounds', position: 3 }
    ];

    let searchAreaHandler: (() => void) | undefined;
    const mockOnSearchAreaStateChange = vi.fn((state) => {
      if (state?.onSearchThisArea) {
        searchAreaHandler = state.onSearchThisArea;
      }
    });

    setMapViewportBounds('19,11,21,9');
    render(
      <SearchBar 
        onAddPin={mockOnAddPin} 
        pins={mixedPins} 
        debounceMs={10} 
        onSearchAreaStateChange={mockOnSearchAreaStateChange} 
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/Search.../i), { target: { value: 'Coffee' } });

    await waitFor(() => {
      expect(screen.getByText('Coffee Spot')).toBeInTheDocument();
      expect(screen.queryByText('Distant Coffee')).not.toBeInTheDocument();
    });

    // Move viewport to new area
    act(() => {
      setMapViewportBounds('79,51,81,49');
    });

    // Local results must remain frozen on the previous area
    expect(screen.getByText('Coffee Spot')).toBeInTheDocument();
    expect(screen.queryByText('Distant Coffee')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockOnSearchAreaStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ showPill: true })
      );
    });

    // Trigger search in the new area
    act(() => {
      searchAreaHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText('Distant Coffee')).toBeInTheDocument();
      expect(screen.queryByText('Coffee Spot')).not.toBeInTheDocument();
    });
  });

  it('clears query and maintains focus on search input when clear button is clicked', () => {
    render(<SearchBar onAddPin={mockOnAddPin} pins={[]} />);

    const input = screen.getByPlaceholderText(/Search.../i);
    fireEvent.change(input, { target: { value: 'Coffee' } });
    input.focus();
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Coffee');

    const clearButton = screen.getByRole('button', { name: /clear search/i });
    fireEvent.mouseDown(clearButton);
    fireEvent.click(clearButton);

    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('focuses search input when clear button is clicked even if input was not focused', () => {
    render(<SearchBar onAddPin={mockOnAddPin} pins={[]} />);

    const input = screen.getByPlaceholderText(/Search.../i);
    fireEvent.change(input, { target: { value: 'Coffee' } });
    input.blur();
    expect(input).not.toHaveFocus();

    const clearButton = screen.getByRole('button', { name: /clear search/i });
    fireEvent.click(clearButton);

    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('clears search text and results when the panel is minimized', async () => {
    const mockOnHoverPin = vi.fn();
    const mockOnHoverSearchResult = vi.fn();
    const { rerender } = render(
      <SearchBar
        onAddPin={mockOnAddPin}
        onHoverPin={mockOnHoverPin}
        onHoverSearchResult={mockOnHoverSearchResult}
        pins={mockPins}
      />
    );

    const input = screen.getByPlaceholderText(/Search.../i);
    fireEvent.change(input, { target: { value: 'Coffee' } });

    await waitFor(() => {
      expect(screen.getByText('Local Coffee')).toBeInTheDocument();
    });
    expect(input).toHaveValue('Coffee');

    rerender(
      <SearchBar
        onAddPin={mockOnAddPin}
        onHoverPin={mockOnHoverPin}
        onHoverSearchResult={mockOnHoverSearchResult}
        pins={mockPins}
        isPanelMinimized
      />
    );

    expect(input).toHaveValue('');
    expect(screen.queryByText('Local Coffee')).not.toBeInTheDocument();
    expect(mockOnHoverSearchResult).toHaveBeenCalledWith(null, null);
    expect(mockOnHoverPin).toHaveBeenCalledWith(null);
    expect(input).not.toHaveFocus();
  });

  it('caps the results list to the visible panel so touch can scroll it', async () => {
    render(<SearchBar onAddPin={mockOnAddPin} pins={mockPins} />);
    fireEvent.change(screen.getByPlaceholderText(/Search.../i), { target: { value: 'Coffee' } });

    const list = await screen.findByTestId('search-results');
    expect(list.style.maxHeight).toBe(`${window.innerHeight - 8}px`);
    expect(list.style.overflowY).toBe('auto');
    expect(list.style.touchAction).toBe('pan-y');
  });

  it('measures results height inside a zoomed sheet instead of the viewport', () => {
    const aside = document.createElement('aside');
    const anchor = document.createElement('div');
    aside.appendChild(anchor);
    document.body.appendChild(aside);
    const box = (partial: Partial<DOMRect>): DOMRect => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON() { return {}; },
      ...partial,
    });
    Object.defineProperty(aside, 'offsetHeight', { configurable: true, value: 200 });
    aside.getBoundingClientRect = () => box({ top: 100, bottom: 500, height: 400, left: 0, right: 300, width: 300 });
    anchor.getBoundingClientRect = () => box({ top: 100, bottom: 180, height: 80, left: 10, right: 290, width: 280 });

    // scale = 400/200. Visible room below the field is (500-180)/2 - 8 = 152.
    expect(measureSearchResultsMaxHeight(anchor)).toBe(152);
    aside.remove();
  });
});

