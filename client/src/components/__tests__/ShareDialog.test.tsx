import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ShareDialog from '../ShareDialog';

vi.mock('@react-oauth/google', () => ({
  useGoogleLogin: vi.fn(() => vi.fn()),
}));

vi.mock('../../services/api', () => ({
  apiService: {
    searchUsers: vi.fn().mockResolvedValue({ users: [] }),
    sharedContacts: vi.fn().mockResolvedValue({ emails: [] }),
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
});
