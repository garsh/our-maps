import { useState } from 'react';
import { Share2, Trash2, X, User as UserIcon, ShieldCheck } from 'lucide-react';
import type { MapPermission } from '@shared/interfaces';

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onShare: (email: string, role: 'view' | 'edit') => Promise<void>;
  onRemoveShare: (userId: string) => Promise<void>;
  permissions: MapPermission[];
  ownerId: string;
  currentUserId: string;
}

export default function ShareDialog({ isOpen, onClose, onShare, onRemoveShare, permissions, ownerId, currentUserId }: ShareDialogProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'view' | 'edit'>('view');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onShare(email, role);
      setEmail('');
    } catch (err: any) {
      setError(err.message || 'Failed to share');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      position: 'fixed', 
      top: 0, 
      left: 0, 
      right: 0, 
      bottom: 0, 
      background: 'rgba(0,0,0,0.6)', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      zIndex: 2000,
      backdropFilter: 'blur(4px)'
    }} onClick={onClose}>
      <div 
        style={{ 
          background: 'white', 
          padding: '2rem', 
          borderRadius: 'var(--radius-lg)', 
          width: '450px', 
          maxWidth: '90%',
          boxShadow: 'var(--shadow-lg)' 
        }} 
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>
            <Share2 size={24} color="var(--primary-color)" /> Share Map
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', padding: '4px' }}>
            <X size={24} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} style={{ marginBottom: '2.5rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontWeight: '700', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase' }}>Invite Someone</label>
            <input 
              type="email" 
              placeholder="user@example.com" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input-field"
              style={{ marginBottom: '12px' }}
            />
            <div style={{ display: 'flex', gap: '1rem', background: 'var(--bg-color)', padding: '4px', borderRadius: 'var(--radius-sm)' }}>
              <button 
                type="button"
                onClick={() => setRole('view')}
                style={{ 
                  flex: 1, 
                  padding: '8px', 
                  borderRadius: '6px', 
                  border: 'none', 
                  background: role === 'view' ? 'white' : 'transparent',
                  color: role === 'view' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  fontWeight: '700',
                  fontSize: '0.85rem',
                  boxShadow: role === 'view' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                }}
              >
                Viewer
              </button>
              <button 
                type="button"
                onClick={() => setRole('edit')}
                style={{ 
                  flex: 1, 
                  padding: '8px', 
                  borderRadius: '6px', 
                  border: 'none', 
                  background: role === 'edit' ? 'white' : 'transparent',
                  color: role === 'edit' ? 'var(--primary-color)' : 'var(--text-secondary)',
                  fontWeight: '700',
                  fontSize: '0.85rem',
                  boxShadow: role === 'edit' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                }}
              >
                Editor
              </button>
            </div>
          </div>
          {error && <div style={{ color: 'var(--error-color)', fontSize: '0.85rem', marginBottom: '12px', background: 'rgba(203, 43, 62, 0.1)', padding: '8px', borderRadius: '4px' }}>{error}</div>}
          <button 
            type="submit" 
            disabled={loading}
            className="btn-primary"
            style={{ width: '100%', padding: '12px' }}
          >
            {loading ? 'Sending invitation...' : 'Send Invitation'}
          </button>
        </form>

        <h4 style={{ marginBottom: '1rem', fontSize: '0.8rem', fontWeight: '800', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Who Has Access</h4>
        <div style={{ maxHeight: '250px', overflowY: 'auto', margin: '0 -10px', padding: '0 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #f1f1f1', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ background: 'rgba(72, 61, 139, 0.1)', padding: '8px', borderRadius: '50%', color: 'var(--primary-color)' }}>
                <ShieldCheck size={18} />
              </div>
              <div>
                <div style={{ fontWeight: '700', fontSize: '0.95rem' }}>You</div>
                <div style={{ fontSize: '0.75rem', color: '#aaa', textTransform: 'uppercase', fontWeight: '800' }}>Owner</div>
              </div>
            </div>
          </div>
          {permissions.map(perm => (
            <div key={perm.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f1f1f1' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ background: '#f1f1f1', padding: '8px', borderRadius: '50%', color: '#666' }}>
                  <UserIcon size={18} />
                </div>
                <div>
                  <div style={{ fontWeight: '700', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{perm.userName || perm.userEmail}</div>
                  <div style={{ fontSize: '0.75rem', color: '#aaa', textTransform: 'uppercase', fontWeight: '800' }}>{perm.role}</div>
                </div>
              </div>
              {ownerId === currentUserId && (
                <button 
                  onClick={() => onRemoveShare(perm.userId)}
                  style={{ background: 'rgba(203, 43, 62, 0.1)', border: 'none', color: 'var(--error-color)', padding: '8px', borderRadius: '50%', cursor: 'pointer', display: 'flex' }}
                  title="Remove access"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: '2rem', textAlign: 'right' }}>
          <button onClick={onClose} style={{ background: 'var(--bg-color)', border: 'none', padding: '10px 24px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: '700', color: 'var(--text-secondary)' }}>Done</button>
        </div>
      </div>
    </div>
  );
}
