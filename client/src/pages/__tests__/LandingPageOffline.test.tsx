import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from '../LandingPage';
import { apiService } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import * as tileUtils from '../../utils/tileUtils';

vi.mock('../../services/api');
vi.mock('../../contexts/AuthContext');
vi.mock('../../utils/tileUtils', async () => {
  const actual = await vi.importActual('../../utils/tileUtils');
  return {
    ...actual,
    getMapDownloadStatuses: vi.fn(),
  };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('LandingPage Offline Map Access', () => {
  const mockUser = { id: 'user-1', email: 'test@test.com', name: 'Test User' };
  const mockMaps = [
    { id: 'map-downloaded', name: 'Downloaded Map', ownerId: 'user-1', ownerName: 'Test User', ownerEmail: 'test@test.com' },
    { id: 'map-not-downloaded', name: 'Online Only Map', ownerId: 'user-1', ownerName: 'Test User', ownerEmail: 'test@test.com' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({
      user: mockUser,
      token: 'mock-token',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    (apiService.getMaps as any).mockResolvedValue(mockMaps);

    const downloadStatuses = new Map();
    downloadStatuses.set('map-downloaded', { isComplete: true, isPartial: false });
    (tileUtils.getMapDownloadStatuses as any).mockResolvedValue(downloadStatuses);
  });

  it('allows opening maps with download when offline', async () => {
    (apiService.getMaps as any).mockRejectedValue(new Error('Network Error'));
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Downloaded Map')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Downloaded Map'));
    expect(mockNavigate).toHaveBeenCalledWith('/map/map-downloaded');
  });

  it('displays interstitial pop up and prevents opening undownloaded maps when offline', async () => {
    (apiService.getMaps as any).mockRejectedValue(new Error('Network Error'));
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Online Only Map')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Online Only Map'));

    expect(mockNavigate).not.toHaveBeenCalledWith('/map/map-not-downloaded');
    expect(screen.getByText('This map is not available in offline mode')).toBeInTheDocument();
  });

  it('displays Offline badge for undownloaded maps when offline', async () => {
    (apiService.getMaps as any).mockRejectedValue(new Error('Network Error'));
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Offline')).toBeInTheDocument();
      expect(screen.getByText('Downloaded')).toBeInTheDocument();
    });
  });

  it('shows owner name without Shared by prefix for shared maps', async () => {
    const sharedMaps = [
      { id: 'map-shared', name: 'Shared Map', ownerId: 'user-other', ownerName: 'Alice Smith', ownerEmail: 'alice@test.com' },
    ];
    (apiService.getMaps as any).mockResolvedValue(sharedMaps);

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.queryByText(/Shared by/i)).not.toBeInTheDocument();
    });
  });
});
