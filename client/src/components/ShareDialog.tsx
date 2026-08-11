import { useState, useRef, useEffect } from 'react';
import { Share2, Trash2, X, User as UserIcon, ShieldCheck, Users, Loader2 } from 'lucide-react';
import type { MapPermission } from '@shared/interfaces';
import { useGoogleLogin } from '@react-oauth/google';

interface Contact {
  name: string;
  email: string;
  photoUrl?: string;
}

const fetchMockContacts = async (): Promise<Contact[]> => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve([
        { name: 'Alice Adams', email: 'alice@example.com', photoUrl: 'https://i.pravatar.cc/150?u=a042581f4e29026704d' },
        { name: 'Bob Barker', email: 'bob@example.com', photoUrl: 'https://i.pravatar.cc/150?u=a042581f4e29026024d' },
        { name: 'Charlie Chaplin', email: 'charlie@example.com', photoUrl: 'https://i.pravatar.cc/150?u=a04258114e29026702d' },
        { name: 'Diana Prince', email: 'diana@example.com', photoUrl: 'https://i.pravatar.cc/150?u=a04258114e29026708c' }
      ]);
    }, 1000);
  });
};

const fetchGoogleContacts = async (accessToken: string): Promise<Contact[]> => {
  const res = await fetch('https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,photos', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('Failed to fetch contacts');
  const data = await res.json();
  const contacts: Contact[] = [];
  if (data.connections) {
    data.connections.forEach((conn: any) => {
      const email = conn.emailAddresses?.[0]?.value;
      if (email) {
        contacts.push({
          name: conn.names?.[0]?.displayName || email,
          email: email,
          photoUrl: conn.photos?.[0]?.url
        });
      }
    });
  }
  return contacts;
};

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
  
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [isConnectingContacts, setIsConnectingContacts] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contacts && email) {
      const lower = email.toLowerCase();
      setFilteredContacts(contacts.filter(c => c.name.toLowerCase().includes(lower) || c.email.toLowerCase().includes(lower)));
    } else {
      setFilteredContacts(contacts || []);
    }
  }, [email, contacts]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID && import.meta.env.VITE_GOOGLE_CLIENT_ID !== 'MOCK_CLIENT_ID';
  const forceMock = import.meta.env.VITE_MOCK_AUTH === 'true';
  
  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/contacts.readonly',
    onSuccess: async (tokenResponse) => {
      try {
        const fetchedContacts = await fetchGoogleContacts(tokenResponse.access_token);
        setContacts(fetchedContacts);
        setShowDropdown(true);
      } catch (err) {
        console.error('Failed to load contacts', err);
      } finally {
        setIsConnectingContacts(false);
      }
    },
    onError: () => {
      console.error('Google login failed');
      setIsConnectingContacts(false);
    }
  });

  const handleConnectContacts = async () => {
    setIsConnectingContacts(true);
    if (!hasClientId || forceMock) {
      const mockContacts = await fetchMockContacts();
      setContacts(mockContacts);
      setIsConnectingContacts(false);
      setShowDropdown(true);
    } else {
      login();
    }
  };

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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
              <label style={{ fontWeight: '700', fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Invite Someone</label>
              {!contacts && (
                <button
                  type="button"
                  onClick={handleConnectContacts}
                  disabled={isConnectingContacts}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: 'var(--primary-color)', fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer', padding: 0 }}
                >
                  {isConnectingContacts ? <Loader2 size={12} className="animate-spin" /> : <Users size={12} />}
                  {isConnectingContacts ? 'Connecting...' : 'Connect Contacts'}
                </button>
              )}
            </div>
            
            <div style={{ position: 'relative' }} ref={dropdownRef}>
              <input 
                type="email" 
                placeholder="user@example.com" 
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => {
                  if (contacts) setShowDropdown(true);
                }}
                required
                className="input-field"
                style={{ marginBottom: '12px', width: '100%', boxSizing: 'border-box' }}
                autoComplete="off"
              />
              {showDropdown && contacts && (
                <div style={{ 
                  position: 'absolute', 
                  top: '40px', 
                  left: 0, 
                  right: 0, 
                  background: 'white', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: 'var(--radius-sm)', 
                  boxShadow: 'var(--shadow-lg)', 
                  maxHeight: '200px', 
                  overflowY: 'auto', 
                  zIndex: 10 
                }}>
                  {filteredContacts.length > 0 ? filteredContacts.map(contact => (
                    <div 
                      key={contact.email} 
                      onClick={() => { setEmail(contact.email); setShowDropdown(false); }}
                      style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', borderBottom: '1px solid #f1f1f1' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-color)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {contact.photoUrl ? (
                        <img src={contact.photoUrl} alt={contact.name} style={{ width: '28px', height: '28px', borderRadius: '50%' }} />
                      ) : (
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
                          <UserIcon size={14} />
                        </div>
                      )}
                      <div>
                        <div style={{ fontWeight: '700', fontSize: '0.85rem' }}>{contact.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{contact.email}</div>
                      </div>
                    </div>
                  )) : (
                    <div style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center' }}>No contacts found</div>
                  )}
                </div>
              )}
            </div>
            
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
