import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from '../LandingPage';
import { apiService } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import * as tileUtils from '../../utils/tileUtils';

vi.mock('../../services/api');
vi.mock('../../contexts/AuthContext');
vi.mock('../../utils/legacyStorage', () => ({
  findUnrecognizedStorage: vi.fn(async () => []),
  deleteUnrecognizedStorage: vi.fn(async () => {}),
}));
vi.mock('../../utils/tileUtils', async () => {
  const actual = await vi.importActual('../../utils/tileUtils');
  return {
    ...actual,
    getMapDownloadStatuses: vi.fn(),
    unionCachedMapsWithDownloads: vi.fn(async (cached: { id: string }[]) => cached),
  };
});

describe('LandingPage label persistence', () => {
  const mockUser = { id: 'user-1', email: 'test@test.com', name: 'Test User' };
  const mockMaps = [
    { id: 'map-1', name: 'Map One', ownerId: 'user-1', ownerName: 'Test User' },
    { id: 'map-2', name: 'Map Two', ownerId: 'user-2', ownerName: 'Other User' },
  ];
  const mockLabels = [
    { id: 'label-123', name: 'Road Trips', sortMode: 'last_accessed', position: 0 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    (useAuth as any).mockReturnValue({
      user: mockUser,
      token: 'mock-token',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      logoutEverywhere: vi.fn(),
    });
    (apiService.getMaps as any).mockResolvedValue(mockMaps);
    (apiService.getLabels as any).mockResolvedValue({
      labels: mockLabels,
      assignments: [{ labelId: 'label-123', mapId: 'map-1' }],
      systemSettings: [],
      systemOrder: [],
    });
    (tileUtils.getMapDownloadStatuses as any).mockResolvedValue(new Map());
    (tileUtils.unionCachedMapsWithDownloads as any).mockImplementation(async (cached: typeof mockMaps) => cached);
  });

  it('defaults to "all" when no label has been previously selected', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    const select = await screen.findByLabelText('Filter maps by label') as HTMLSelectElement;
    expect(select.value).toBe('all');
  });

  it('restores the last selected label from localStorage on initial render', async () => {
    localStorage.setItem('cached_selected_label', JSON.stringify('owned'));

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    const select = await screen.findByLabelText('Filter maps by label') as HTMLSelectElement;
    expect(select.value).toBe('owned');
  });

  it('updates localStorage when a new label is selected', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    const select = await screen.findByLabelText('Filter maps by label') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'shared' } });

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('cached_selected_label') || '""')).toBe('shared');
    });
  });

  it('does not overwrite remembered label when switching to search mode', async () => {
    localStorage.setItem('cached_selected_label', JSON.stringify('offline'));

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    const select = await screen.findByLabelText('Filter maps by label') as HTMLSelectElement;
    expect(select.value).toBe('offline');

    // Switch to search
    fireEvent.change(select, { target: { value: 'search' } });

    // The saved label in localStorage should remain 'offline'
    expect(JSON.parse(localStorage.getItem('cached_selected_label') || '""')).toBe('offline');
  });

  it('falls back to "all" if stored label is user-specific and user is logged out', async () => {
    localStorage.setItem('cached_selected_label', JSON.stringify('owned'));
    (useAuth as any).mockReturnValue({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      logoutEverywhere: vi.fn(),
    });

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    const select = await screen.findByLabelText('Filter maps by label') as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe('all');
    });
  });

  it('filters maps correctly when "Unlabelled Maps" is selected', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    const select = await screen.findByLabelText('Filter maps by label') as HTMLSelectElement;
    // Before filter: Map One (has label-123) and Map Two (no label) are present
    expect(await screen.findByText('Map One')).toBeInTheDocument();
    expect(await screen.findByText('Map Two')).toBeInTheDocument();

    // Select Unlabelled Maps
    fireEvent.change(select, { target: { value: 'unlabelled' } });

    await waitFor(() => {
      expect(screen.queryByText('Map One')).not.toBeInTheDocument();
      expect(screen.getByText('Map Two')).toBeInTheDocument();
    });
    expect(screen.getByText('Unlabelled Maps')).toBeInTheDocument();
  });

  it('shows edit button when user label is active and opens edit modal with prefilled name', async () => {
    localStorage.setItem('cached_selected_label', JSON.stringify('label-123'));

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    const editBtn = await screen.findByTitle('Edit this label');
    expect(editBtn).toBeInTheDocument();
    // Trash icon should no longer be present directly in toolbar
    expect(screen.queryByTitle('Delete this label')).not.toBeInTheDocument();

    fireEvent.click(editBtn);

    expect(screen.getByText('Edit Label')).toBeInTheDocument();
    const input = screen.getByPlaceholderText('e.g. Road Trips, Wishlist') as HTMLInputElement;
    expect(input.value).toBe('Road Trips');
  });

  it('renames a label and persists changes', async () => {
    localStorage.setItem('cached_selected_label', JSON.stringify('label-123'));
    (apiService.updateLabel as any).mockResolvedValue({
      id: 'label-123',
      name: 'Road Trips 2026',
      sortMode: 'last_accessed',
      position: 0,
    });

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    const editBtn = await screen.findByTitle('Edit this label');
    fireEvent.click(editBtn);

    const input = screen.getByPlaceholderText('e.g. Road Trips, Wishlist') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Road Trips 2026' } });

    const saveBtn = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(apiService.updateLabel).toHaveBeenCalledWith('label-123', { name: 'Road Trips 2026' });
    });
  });

  it('allows deleting a label from within the edit modal', async () => {
    localStorage.setItem('cached_selected_label', JSON.stringify('label-123'));
    (apiService.deleteLabel as any).mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    const editBtn = await screen.findByTitle('Edit this label');
    fireEvent.click(editBtn);

    const deleteBtn = screen.getByRole('button', { name: 'Delete label' });
    fireEvent.click(deleteBtn);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(apiService.deleteLabel).toHaveBeenCalledWith('label-123');
    });
  });

  it('assigns a label from the map card while online', async () => {
    (apiService.assignMapLabel as any).mockResolvedValue({
      success: true,
      labelId: 'label-123',
      mapId: 'map-2',
      position: 0,
    });

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    const card = (await screen.findByText('Map Two')).closest('.card') as HTMLElement;
    fireEvent.click(card.querySelector('[aria-label="Manage labels"]') as HTMLElement);
    fireEvent.click(await screen.findByText('Road Trips'));

    await waitFor(() => {
      expect(apiService.assignMapLabel).toHaveBeenCalledWith('label-123', 'map-2');
    });
  });
});
