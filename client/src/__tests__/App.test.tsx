import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../App';
import { apiService } from '../services/api';

// Mock the dependencies
vi.mock('../services/api');
vi.mock('../components/MapView', () => ({
  default: () => <div data-testid="map-view" />
}));

describe('App Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock behavior
    (apiService.getHello as any).mockResolvedValue({ message: 'Mock Hello' });
  });

  it('shows error message when server is unreachable', async () => {
    (apiService.getHello as any).mockRejectedValue(new Error('Network Error'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/could not connect to server/i)).toBeInTheDocument();
    });
  });

  it('shows error message when map fails to load', async () => {
    // Simulate mapId in URL
    const url = new URL('http://localhost:5173/?mapId=invalid-id');
    Object.defineProperty(window, 'location', {
      value: url,
      writable: true
    });

    (apiService.getMap as any).mockRejectedValue(new Error('Not Found'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/map not found/i)).toBeInTheDocument();
    });
  });

  it('shows error message when saving fails', async () => {
    render(<App />);
    
    (apiService.createMap as any).mockRejectedValue(new Error('Save Failed'));

    const saveButton = screen.getByRole('button', { name: /save map/i });
    saveButton.click();

    await waitFor(() => {
      expect(screen.getByText(/failed to save map/i)).toBeInTheDocument();
    });
  });
});
