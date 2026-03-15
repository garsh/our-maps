import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SearchBar from '../SearchBar';

describe('SearchBar', () => {
  const mockOnResultSelect = vi.fn();
  const mockOnAddPin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly', () => {
    render(<SearchBar onResultSelect={mockOnResultSelect} onAddPin={mockOnAddPin} />);
    expect(screen.getByPlaceholderText(/search for a place/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });

  it('performs search and displays results', async () => {
    const mockResults = [
      { place_id: 1, display_name: 'Test Location', lat: '10', lon: '20' }
    ];
    
    (global.fetch as any).mockResolvedValueOnce({
      json: async () => mockResults
    });

    render(<SearchBar onResultSelect={mockOnResultSelect} onAddPin={mockOnAddPin} />);
    
    const input = screen.getByPlaceholderText(/search for a place/i);
    fireEvent.change(input, { target: { value: 'Test' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      expect(screen.getByText('Test Location')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('q=Test')
    );
  });

  it('calls onResultSelect when a result is clicked', async () => {
    const mockResults = [
      { place_id: 1, display_name: 'Test Location', lat: '10', lon: '20' }
    ];
    
    (global.fetch as any).mockResolvedValueOnce({
      json: async () => mockResults
    });

    render(<SearchBar onResultSelect={mockOnResultSelect} onAddPin={mockOnAddPin} />);
    
    fireEvent.change(screen.getByPlaceholderText(/search for a place/i), { target: { value: 'Test' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => screen.getByText('Test Location'));
    fireEvent.click(screen.getByText('Test Location'));

    expect(mockOnResultSelect).toHaveBeenCalledWith(10, 20);
  });

  it('calls onAddPin when + Add Pin is clicked', async () => {
    const mockResults = [
      { place_id: 1, display_name: 'Test Location, Region', lat: '10', lon: '20' }
    ];
    
    (global.fetch as any).mockResolvedValueOnce({
      json: async () => mockResults
    });

    render(<SearchBar onResultSelect={mockOnResultSelect} onAddPin={mockOnAddPin} />);
    
    fireEvent.change(screen.getByPlaceholderText(/search for a place/i), { target: { value: 'Test' } });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => screen.getByText('Test Location, Region'));
    fireEvent.click(screen.getByText('+ Add Pin'));

    expect(mockOnAddPin).toHaveBeenCalledWith(10, 20, 'Test Location');
  });
});
