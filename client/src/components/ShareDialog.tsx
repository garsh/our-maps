import { useState } from 'react';
import { Share2, Trash2 } from 'lucide-react';
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
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ background: 'white', padding: '20px', borderRadius: '8px', width: '400px', maxWidth: '90%' }}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Share2 size={20} /> Share Map
        </h3>
        
        <form onSubmit={handleSubmit} style={{ marginBottom: '20px' }}>
          <div style={{ marginBottom: '10px' }}>
            <input 
              type="email" 
              placeholder="User email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: '8px', boxSizing: 'border-box', marginBottom: '8px' }}
            />
            <select 
              value={role} 
              onChange={(e) => setRole(e.target.value as 'view' | 'edit')}
              style={{ width: '100%', padding: '8px' }}
            >
              <option value="view">Viewer (Read Only)</option>
              <option value="edit">Editor (Can make changes)</option>
            </select>
          </div>
          {error && <div style={{ color: 'red', fontSize: '0.9rem', marginBottom: '10px' }}>{error}</div>}
          <button 
            type="submit" 
            disabled={loading}
            style={{ width: '100%', padding: '8px', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            {loading ? 'Sharing...' : 'Share'}
          </button>
        </form>

        <h4 style={{ marginBottom: '10px', fontSize: '0.9rem', textTransform: 'uppercase', color: '#666' }}>Who has access</h4>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '200px', overflowY: 'auto' }}>
          <li style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>You</div>
              <div style={{ fontSize: '0.8rem', color: '#666' }}>Owner</div>
            </div>
          </li>
          {permissions.map(perm => (
            <li key={perm.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{perm.userName || perm.userEmail}</div>
                <div style={{ fontSize: '0.8rem', color: '#666' }}>{perm.role}</div>
              </div>
              {ownerId === currentUserId && (
                <button 
                  onClick={() => onRemoveShare(perm.userId)}
                  style={{ background: 'transparent', border: 'none', color: '#e74c3c', cursor: 'pointer' }}
                  title="Remove access"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>

        <div style={{ marginTop: '20px', textAlign: 'right' }}>
          <button onClick={onClose} style={{ background: '#eee', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    </div>
  );
}
