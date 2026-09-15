import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ShareDialog from '../ShareDialog';

vi.mock('@react-oauth/google', () => ({
  useGoogleLogin: vi.fn(() => vi.fn()),
}));

vi.mock('../../services/api', () => ({
  apiService: {
    searchUsers: vi.fn().mockResolvedValue({ users: [] }),
    sharedContacts: vi.fn().mockResolvedValue({ emails: [] }),
    filterContacts: vi.fn().mockResolvedValue({ existingEmails: [] }),
  },
}));

describe('ShareDialog Dark Mode & Styling', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onShare: vi.fn(),
    onRemoveShare: vi.fn(),
    permissions: [
      { userId: 'user-2', userName: 'Collab User', userEmail: 'collab@example.com', role: 'edit' as const },
    ],
    owner: { id: 'user-1', name: 'Owner User', email: 'owner@example.com' },
    currentUserId: 'user-1',
  };

  it('renders with theme CSS variables instead of hardcoded white backgrounds', () => {
    render(<ShareDialog {...defaultProps} />);

    const dialogTitle = screen.getByText('Share Map');
    expect(dialogTitle).toBeInTheDocument();

    // The dialog modal card container
    const dialogCard = dialogTitle.closest('div[style*="padding: 2rem"]') as HTMLElement;
    expect(dialogCard).toBeInTheDocument();
    expect(dialogCard.style.background).toBe('var(--surface-color)');
    expect(dialogCard.style.border).toBe('1px solid var(--border-color)');
  });

  it('uses theme variables for role selection buttons without hardcoded white backgrounds', () => {
    render(<ShareDialog {...defaultProps} />);

    const viewerBtn = screen.getByRole('button', { name: 'Viewer' });
    const editorBtn = screen.getByRole('button', { name: 'Editor' });
    const ownerBtn = screen.getByRole('button', { name: 'Owner' });

    // Unselected state should use var(--surface-color), not 'white'
    expect(viewerBtn.style.background).toBe('var(--surface-color)');
    expect(viewerBtn.style.border).toBe('1px solid var(--border-color)');

    // Select Viewer
    fireEvent.click(viewerBtn);
    expect(viewerBtn.style.border).toContain('var(--primary-accent');
    expect(viewerBtn.style.background).toContain('color-mix');

    // Editor still unselected
    expect(editorBtn.style.background).toBe('var(--surface-color)');
  });

  it('uses theme variables for the access list borders and secondary text', () => {
    render(<ShareDialog {...defaultProps} />);

    const accessHeading = screen.getByText('Who Has Access');
    expect(accessHeading).toBeInTheDocument();
    expect(accessHeading.style.color).toBe('var(--text-secondary)');

    const ownerLabels = screen.getAllByText('Owner');
    const ownerBadge = ownerLabels.find(el => el.tagName.toLowerCase() !== 'button');
    expect(ownerBadge).toBeDefined();
    expect(ownerBadge?.style.color).toBe('var(--text-secondary)');

    const editorLabels = screen.getAllByText('Editor');
    const editorBadge = editorLabels.find(el => el.tagName.toLowerCase() !== 'button');
    expect(editorBadge).toBeDefined();
    expect(editorBadge?.style.color).toBe('var(--text-secondary)');
  });

  it('uses theme variables for Transfer Ownership confirmation dialog', () => {
    render(<ShareDialog {...defaultProps} />);

    // Select Owner role and fill email to trigger transfer confirmation
    const emailInput = screen.getByPlaceholderText('user@example.com');
    fireEvent.change(emailInput, { target: { value: 'transfer@example.com' } });

    const ownerBtn = screen.getByRole('button', { name: 'Owner' });
    fireEvent.click(ownerBtn);

    const shareBtn = screen.getByRole('button', { name: 'Share' });
    fireEvent.click(shareBtn);

    const transferHeading = screen.getByText('Transfer Ownership?');
    expect(transferHeading).toBeInTheDocument();

    const transferModal = transferHeading.closest('div[style*="padding: 2.5rem"]') as HTMLElement;
    expect(transferModal).toBeInTheDocument();
    expect(transferModal.style.background).toBe('var(--surface-color)');
    expect(transferModal.style.border).toBe('1px solid var(--border-color)');
  });

  it('renders radio button "Allow anybody with the link to view" and toggles when clicked', () => {
    const onTogglePublic = vi.fn();
    render(<ShareDialog {...defaultProps} isPublic={false} onTogglePublic={onTogglePublic} mapId="map-123" />);

    const radio = screen.getByLabelText('Allow anybody with the link to view') as HTMLInputElement;
    expect(radio).toBeInTheDocument();
    expect(radio.checked).toBe(false);

    // Copy Link button should not appear when radio button is not set
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();

    fireEvent.click(radio);
    expect(onTogglePublic).toHaveBeenCalledWith(true);
  });

  it('renders Copy Link button only when radio button is set and copies link to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ShareDialog {...defaultProps} isPublic={true} mapId="map-abc" />);

    const radio = screen.getByLabelText('Allow anybody with the link to view') as HTMLInputElement;
    expect(radio.checked).toBe(true);

    const copyBtn = screen.getByRole('button', { name: /copy link/i });
    expect(copyBtn).toBeInTheDocument();

    const doneBtn = screen.getByRole('button', { name: 'Done' });
    expect(doneBtn).toBeInTheDocument();
    // Copy Link should be next to Done button in the same container
    expect(copyBtn.parentElement).toBe(doneBtn.parentElement);

    fireEvent.click(copyBtn);
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/map/map-abc'));
  });

  it('allows owner to change access level of an existing collaborator from Editor to Viewer', () => {
    const onShare = vi.fn().mockResolvedValue(undefined);
    render(<ShareDialog {...defaultProps} onShare={onShare} />);

    const accessSelect = screen.getByLabelText('Access level for Collab User') as HTMLSelectElement;
    expect(accessSelect).toBeInTheDocument();
    expect(accessSelect.value).toBe('edit');

    fireEvent.change(accessSelect, { target: { value: 'view' } });
    expect(onShare).toHaveBeenCalledWith('collab@example.com', 'view');
  });

  it('allows owner to change access level from Viewer to Editor', () => {
    const onShare = vi.fn().mockResolvedValue(undefined);
    const viewerProps = {
      ...defaultProps,
      permissions: [
        { userId: 'user-3', userName: 'Viewer User', userEmail: 'viewer@example.com', role: 'view' as const },
      ],
      onShare,
    };
    render(<ShareDialog {...viewerProps} />);

    const accessSelect = screen.getByLabelText('Access level for Viewer User') as HTMLSelectElement;
    expect(accessSelect).toBeInTheDocument();
    expect(accessSelect.value).toBe('view');

    fireEvent.change(accessSelect, { target: { value: 'edit' } });
    expect(onShare).toHaveBeenCalledWith('viewer@example.com', 'edit');
  });

  it('opens transfer confirmation dialog when Transfer Ownership is selected in the collaborator dropdown', () => {
    const onShare = vi.fn().mockResolvedValue(undefined);
    render(<ShareDialog {...defaultProps} onShare={onShare} />);

    const accessSelect = screen.getByLabelText('Access level for Collab User') as HTMLSelectElement;
    fireEvent.change(accessSelect, { target: { value: 'owner' } });

    // onShare should not be called immediately
    expect(onShare).not.toHaveBeenCalled();

    // Confirmation dialog should be visible
    const transferHeading = screen.getByText('Transfer Ownership?');
    expect(transferHeading).toBeInTheDocument();
    const transferModal = transferHeading.closest('div[style*="padding: 2.5rem"]') as HTMLElement;
    expect(transferModal).toBeInTheDocument();
    expect(within(transferModal).getByText('collab@example.com')).toBeInTheDocument();

    const transferBtn = screen.getByRole('button', { name: 'Transfer' });
    fireEvent.click(transferBtn);
    expect(onShare).toHaveBeenCalledWith('collab@example.com', 'owner');
  });

  it('lets an owner toggle link sharing from userRole before owner profile loads', () => {
    render(
      <ShareDialog
        {...defaultProps}
        owner={null}
        userRole="owner"
        onTogglePublic={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Allow anybody with the link to view')).not.toBeDisabled();
  });

  it('does not allow non-owners to change access levels', () => {
    const nonOwnerProps = {
      ...defaultProps,
      currentUserId: 'user-2', // Collab User, not Owner
    };
    render(<ShareDialog {...nonOwnerProps} />);

    // Access level select should not exist for non-owners
    expect(screen.queryByLabelText('Access level for Collab User')).not.toBeInTheDocument();

    // Static text should be present
    expect(screen.getByText('Editor')).toBeInTheDocument();
  });

  it('loads contacts and filters candidate emails against all registered Our Maps users', async () => {
    const { apiService } = await import('../../services/api');
    vi.mocked(apiService.filterContacts).mockResolvedValue({
      existingEmails: ['alice@example.com']
    });

    render(<ShareDialog {...defaultProps} />);

    const loadContactsBtn = screen.getByRole('button', { name: /Load Your Contacts/i });
    expect(loadContactsBtn).toBeInTheDocument();

    fireEvent.click(loadContactsBtn);

    const contactName = await screen.findByText('Alice Adams');
    expect(contactName).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.queryByText('Bob Barker')).not.toBeInTheDocument();
    expect(apiService.filterContacts).toHaveBeenCalledWith(
      expect.arrayContaining(['alice@example.com', 'bob@example.com'])
    );
  });
});
