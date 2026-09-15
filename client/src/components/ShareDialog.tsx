import { useState, useRef, useEffect } from 'react';
import { Share2, Trash2, X, User as UserIcon, ShieldCheck, Users, Loader2, Link2, Check, ChevronDown } from 'lucide-react';
import type { MapPermission } from '@shared/interfaces';
import { useGoogleLogin } from '@react-oauth/google';
import { apiService } from '../services/api';

interface Contact {
  name: string;
  email: string;
  photoUrl?: string;
  type?: 'favorite' | 'frequent' | 'other';
}

const fetchMockContacts = async (): Promise<Contact[]> => {
  const isTest = (globalThis as any).process?.env?.NODE_ENV === 'test' || (import.meta as any).env?.MODE === 'test';
  return new Promise(resolve => {
    setTimeout(() => {
      resolve([
        { name: 'Alice Adams', email: 'alice@example.com', photoUrl: 'https://i.pravatar.cc/150?u=a042581f4e29026704d', type: 'favorite' },
        { name: 'Bob Barker', email: 'bob@example.com', photoUrl: 'https://i.pravatar.cc/150?u=a042581f4e29026024d', type: 'frequent' },
        { name: 'Charlie Chaplin', email: 'charlie@example.com', photoUrl: 'https://i.pravatar.cc/150?u=a04258114e29026702d', type: 'other' },
        { name: 'Diana Prince', email: 'diana@example.com', photoUrl: 'https://i.pravatar.cc/150?u=a04258114e29026708c', type: 'other' }
      ]);
    }, isTest ? 0 : 1000);
  });
};

const fetchGoogleContacts = async (accessToken: string): Promise<Contact[]> => {
  const contacts: Contact[] = [];
  
  try {
    const res = await fetch('https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,photos,memberships&pageSize=1000', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.connections) {
        data.connections.forEach((conn: any) => {
          const email = conn.emailAddresses?.[0]?.value;
          if (email) {
            let isFavorite = false;
            if (conn.memberships) {
              isFavorite = conn.memberships.some((m: any) => 
                m.contactGroupMembership?.contactGroupResourceName === 'contactGroups/starred' ||
                m.contactGroupMembership?.contactGroupId === 'starred'
              );
            }
            contacts.push({
              name: conn.names?.[0]?.displayName || email,
              email: email,
              photoUrl: conn.photos?.[0]?.url,
              type: isFavorite ? 'favorite' : 'frequent'
            });
          }
        });
      }
    }
  } catch (err) {
    console.warn('Failed to fetch primary contacts', err);
  }

  try {
    const resOther = await fetch('https://people.googleapis.com/v1/otherContacts?readMask=names,emailAddresses,photos&pageSize=1000', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (resOther.ok) {
      const dataOther = await resOther.json();
      if (dataOther.otherContacts) {
        dataOther.otherContacts.forEach((conn: any) => {
          const email = conn.emailAddresses?.[0]?.value;
          if (email && !contacts.some(c => c.email === email)) {
            contacts.push({
              name: conn.names?.[0]?.displayName || email,
              email: email,
              photoUrl: conn.photos?.[0]?.url,
              type: 'other'
            });
          }
        });
      }
    }
  } catch (err) {
    console.warn('Failed to fetch other contacts', err);
  }
  
  if (contacts.length === 0) throw new Error('No contacts found');
  
  contacts.sort((a, b) => {
    const order = { 'favorite': 0, 'frequent': 1, 'other': 2 };
    const typeA = a.type || 'other';
    const typeB = b.type || 'other';
    if (order[typeA] !== order[typeB]) {
      return order[typeA] - order[typeB];
    }
    return a.name.localeCompare(b.name);
  });
  
  return contacts;
};

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onShare: (email: string, role: 'view' | 'edit' | 'owner') => Promise<void>;
  onRemoveShare: (userId: string) => Promise<void>;
  permissions: MapPermission[];
  owner?: { id: string, name?: string, email?: string, picture?: string } | null;
  currentUserId: string;
  userRole?: 'owner' | 'edit' | 'view';
  isPublic?: boolean;
  onTogglePublic?: (isPublic: boolean) => Promise<void>;
  mapId?: string | null;
}

export default function ShareDialog({ 
  isOpen, 
  onClose, 
  onShare, 
  onRemoveShare, 
  permissions, 
  owner, 
  currentUserId,
  userRole,
  isPublic = false,
  onTogglePublic,
  mapId
}: ShareDialogProps) {
  const isOwner = userRole === 'owner' || owner?.id === currentUserId;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'view' | 'edit' | 'owner' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isUpdatingPublic, setIsUpdatingPublic] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmTransferEmail, setConfirmTransferEmail] = useState<string | null>(null);
  const [userToRemove, setUserToRemove] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [isConnectingContacts, setIsConnectingContacts] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      searchAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      searchAbortControllerRef.current?.abort();
      setFilteredContacts([]);
      setShowDropdown(false);
      return;
    }

    if (contacts && email) {
      const lower = email.toLowerCase();
      setFilteredContacts(contacts.filter(c => c.name.toLowerCase().includes(lower) || c.email.toLowerCase().includes(lower)));
    } else if (contacts) {
      setFilteredContacts(contacts);
    } else {
      searchAbortControllerRef.current?.abort();
      const controller = new AbortController();
      searchAbortControllerRef.current = controller;

      const searchTimer = setTimeout(async () => {
        try {
          const { users } = await apiService.searchUsers(email, controller.signal);
          if (!controller.signal.aborted) {
            setFilteredContacts(users);
            if (users.length > 0) {
              if (email.length > 0 && !(users.length === 1 && users[0].email === email)) {
                setShowDropdown(true);
              } else if (typeof document !== 'undefined' && document.activeElement === inputRef.current) {
                setShowDropdown(true);
              }
            }
          }
        } catch (e: any) {
          if (e?.name !== 'AbortError' && !controller.signal.aborted) {
            console.error('Failed to search users', e);
          }
        }
      }, 300);
      return () => {
        clearTimeout(searchTimer);
        controller.abort();
      };
    }
  }, [isOpen, email, contacts]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const hasClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID && import.meta.env.VITE_GOOGLE_CLIENT_ID !== 'MOCK_CLIENT_ID';
  const forceMock = import.meta.env.VITE_MOCK_AUTH === 'true';
  
  const login = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly',
    onSuccess: async (tokenResponse) => {
      try {
        const fetchedContacts = await fetchGoogleContacts(tokenResponse.access_token);
        const emails = fetchedContacts.map((c) => c.email);
        const { existingEmails } = await apiService.filterContacts(emails);
        const existingSet = new Set(existingEmails.map((email) => email.toLowerCase()));
        const validContacts = fetchedContacts.filter(c => existingSet.has(c.email.toLowerCase()));
        
        setContacts(validContacts);
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
      try {
        const mockContacts = await fetchMockContacts();
        const emails = mockContacts.map((c) => c.email);
        const { existingEmails } = await apiService.filterContacts(emails);
        const existingSet = new Set(existingEmails.map((email) => email.toLowerCase()));
        const validContacts = mockContacts.filter(c => existingSet.has(c.email.toLowerCase()));
        
        setContacts(validContacts);
        setShowDropdown(true);
      } catch (err) {
        console.error('Failed to load mock contacts', err);
      } finally {
        setIsConnectingContacts(false);
      }
    } else {
      login();
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) return;
    
    if (role === 'owner') {
      setConfirmTransferEmail(email);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      await onShare(email, role);
      setEmail('');
      setRole(null);
    } catch (err: any) {
      setError(err.message || 'Failed to share');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = async () => {
    const url = mapId ? `${window.location.origin}/map/${mapId}` : window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy URL', err);
    }
  };

  const handleRadioToggle = async () => {
    if (!isOwner || !onTogglePublic || isUpdatingPublic) return;
    setIsUpdatingPublic(true);
    setError(null);
    try {
      await onTogglePublic(!isPublic);
    } catch (err: any) {
      setError(err.message || 'Failed to update link sharing settings');
    } finally {
      setIsUpdatingPublic(false);
    }
  };

  const handleRoleChange = async (targetEmail: string, targetUserId: string, newRole: 'view' | 'edit') => {
    setError(null);
    setUpdatingUserId(targetUserId);
    try {
      await onShare(targetEmail, newRole);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to update access level');
    } finally {
      setUpdatingUserId(null);
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
          background: 'var(--surface-color)', 
          border: '1px solid var(--border-color)',
          padding: '2rem', 
          borderRadius: 'var(--radius-lg)', 
          width: '500px', 
          maxWidth: '92%',
          boxShadow: 'var(--shadow-lg)',
          color: 'var(--text-primary)'
        }} 
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>
            <Share2 size={24} color="var(--primary-accent, var(--primary-color))" /> Share Map
          </h3>
          <button 
            onClick={onClose} 
            aria-label="Close"
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'var(--text-secondary)', 
              cursor: 'pointer', 
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
          >
            <X size={24} />
          </button>
        </div>
        
        {isOwner && (
          <form onSubmit={handleSubmit} style={{ marginBottom: '2.5rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-end', marginBottom: '12px' }}>
                {!contacts && (
                  <button
                    type="button"
                    onClick={handleConnectContacts}
                    disabled={isConnectingContacts}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      background: 'transparent', 
                      border: 'none', 
                      color: 'var(--primary-accent, var(--primary-color))', 
                      fontSize: '0.95rem', 
                      fontWeight: '700', 
                      cursor: isConnectingContacts ? 'not-allowed' : 'pointer', 
                      padding: '4px 0' 
                    }}
                  >
                    {isConnectingContacts ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
                    {isConnectingContacts ? 'Connecting...' : 'Load Your Contacts'}
                  </button>
                )}
              </div>
              
              <div style={{ position: 'relative' }} ref={dropdownRef}>
                <input 
                  ref={inputRef}
                  type="email" 
                  placeholder="user@example.com" 
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => {
                    if (contacts || filteredContacts.length > 0) setShowDropdown(true);
                  }}
                  required
                  className="input-field"
                  style={{ marginBottom: '12px', width: '100%', boxSizing: 'border-box' }}
                  autoComplete="off"
                />
                {showDropdown && (contacts || filteredContacts.length > 0) && (
                  <div style={{ 
                    position: 'absolute', 
                    top: '40px', 
                    left: 0, 
                    right: 0, 
                    background: 'var(--surface-color)', 
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
                        style={{ 
                          padding: '8px 12px', 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '10px', 
                          cursor: 'pointer', 
                          borderBottom: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                          transition: 'background-color 0.15s ease'
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-color)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        {contact.photoUrl ? (
                          <img src={contact.photoUrl} alt={contact.name} style={{ width: '28px', height: '28px', borderRadius: '50%' }} />
                        ) : (
                          <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--bg-color)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                            <UserIcon size={14} />
                          </div>
                        )}
                        <div>
                          <div style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)' }}>{contact.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{contact.email}</div>
                        </div>
                      </div>
                    )) : (
                      <div style={{ padding: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center' }}>No contacts found</div>
                    )}
                  </div>
                )}
              </div>
              
              <div style={{ display: 'flex', gap: '1rem', padding: '4px 0' }}>
                <button 
                  type="button"
                  onClick={() => setRole('view')}
                  style={{ 
                    flex: 1, 
                    padding: '10px', 
                    borderRadius: 'var(--radius-sm)', 
                    border: role === 'view' ? '2px solid var(--primary-accent, var(--primary-color))' : '1px solid var(--border-color)', 
                    background: role === 'view' ? 'color-mix(in srgb, var(--primary-accent, var(--primary-color)) 15%, transparent)' : 'var(--surface-color)',
                    color: role === 'view' ? 'var(--primary-accent, var(--primary-color))' : 'var(--text-secondary)',
                    fontWeight: '700',
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  Viewer
                </button>
                <button 
                  type="button"
                  onClick={() => setRole('edit')}
                  style={{ 
                    flex: 1, 
                    padding: '10px', 
                    borderRadius: 'var(--radius-sm)', 
                    border: role === 'edit' ? '2px solid var(--primary-accent, var(--primary-color))' : '1px solid var(--border-color)', 
                    background: role === 'edit' ? 'color-mix(in srgb, var(--primary-accent, var(--primary-color)) 15%, transparent)' : 'var(--surface-color)',
                    color: role === 'edit' ? 'var(--primary-accent, var(--primary-color))' : 'var(--text-secondary)',
                    fontWeight: '700',
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  Editor
                </button>
                {isOwner && (
                  <button 
                    type="button"
                    onClick={() => setRole('owner')}
                    style={{ 
                      flex: 1, 
                      padding: '10px', 
                      borderRadius: 'var(--radius-sm)', 
                      border: role === 'owner' ? '2px solid var(--primary-accent, var(--primary-color))' : '1px solid var(--border-color)', 
                      background: role === 'owner' ? 'color-mix(in srgb, var(--primary-accent, var(--primary-color)) 15%, transparent)' : 'var(--surface-color)',
                      color: role === 'owner' ? 'var(--primary-accent, var(--primary-color))' : 'var(--text-secondary)',
                      fontWeight: '700',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    Owner
                  </button>
                )}
              </div>
            </div>
            {error && <div style={{ color: 'var(--error-color)', fontSize: '0.85rem', marginBottom: '12px', background: 'rgba(203, 43, 62, 0.1)', padding: '8px', borderRadius: '4px' }}>{error}</div>}
            <button 
              type="submit" 
              disabled={loading || !email || !role}
              style={{ 
                width: '100%', 
                padding: '12px', 
                border: 'none',
                borderRadius: 'var(--radius-md)',
                color: (loading || !email || !role) ? 'var(--text-secondary)' : 'white',
                fontWeight: '600',
                background: (loading || !email || !role) ? 'var(--border-color)' : 'var(--primary-color)',
                cursor: (loading || !email || !role) ? 'not-allowed' : 'pointer' 
              }}
            >
              {loading ? 'Sharing...' : 'Share'}
            </button>
          </form>
        )}

        {error && !isOwner && <div style={{ color: 'var(--error-color)', fontSize: '0.85rem', marginBottom: '12px', background: 'rgba(203, 43, 62, 0.1)', padding: '8px', borderRadius: '4px' }}>{error}</div>}
        <h4 style={{ marginBottom: '1rem', fontSize: '0.8rem', fontWeight: '800', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Who Has Access</h4>
        <div style={{ maxHeight: '250px', overflowY: 'auto', margin: '0 -10px', padding: '0 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-color)', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {owner?.picture ? (
                <img src={owner.picture} alt="Owner" style={{ width: '34px', height: '34px', borderRadius: '50%' }} />
              ) : (
                <div style={{ background: 'color-mix(in srgb, var(--primary-accent, var(--primary-color)) 15%, transparent)', padding: '8px', borderRadius: '50%', color: 'var(--primary-accent, var(--primary-color))' }}>
                  <ShieldCheck size={18} />
                </div>
              )}
              <div>
                <div style={{ fontWeight: '700', fontSize: '0.95rem', color: 'var(--text-primary)' }}>{isOwner ? 'You' : (owner?.name || owner?.email || 'Owner')}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '800' }}>Owner</div>
              </div>
            </div>
          </div>
          {permissions.map(perm => (
            <div key={perm.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-color)', gap: '12px' }}>
              {userToRemove === perm.userId ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-primary)' }}>Remove {perm.userName || perm.userEmail} from this map?</div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={async () => { await onRemoveShare(perm.userId); setUserToRemove(null); }}
                      style={{ padding: '6px 12px', background: 'var(--error-color)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                    >Remove</button>
                    <button 
                      onClick={() => setUserToRemove(null)}
                      style={{ padding: '6px 12px', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                    >Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                    {perm.userPicture ? (
                      <img src={perm.userPicture} alt={perm.userName || perm.userEmail} style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0 }} />
                    ) : (
                      <div style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', padding: '6px', borderRadius: '50%', color: 'var(--text-secondary)', flexShrink: 0 }}>
                        <UserIcon size={16} />
                      </div>
                    )}
                    <div style={{ minWidth: 0, overflow: 'hidden' }}>
                      <div 
                        title={perm.userName || perm.userEmail}
                        style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {perm.userName || perm.userEmail}
                      </div>
                      {perm.userName && perm.userName !== perm.userEmail && (
                        <div 
                          title={perm.userEmail}
                          style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {perm.userEmail}
                        </div>
                      )}
                      {!isOwner && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '800' }}>
                          {perm.role === 'edit' ? 'Editor' : 'Viewer'}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                    {isOwner && (
                      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                        <select 
                          aria-label={`Access level for ${perm.userName || perm.userEmail}`}
                          value={perm.role}
                          disabled={updatingUserId === perm.userId}
                          onChange={async (e) => {
                            const newRole = e.target.value as 'view' | 'edit' | 'owner';
                            if (newRole === perm.role) return;
                            if (newRole === 'owner') {
                              setConfirmTransferEmail(perm.userEmail);
                              return;
                            }
                            await handleRoleChange(perm.userEmail, perm.userId, newRole);
                          }}
                          style={{
                            appearance: 'none',
                            WebkitAppearance: 'none',
                            background: 'var(--bg-color)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '4px 18px 4px 8px',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            color: 'var(--text-secondary)',
                            cursor: updatingUserId === perm.userId ? 'not-allowed' : 'pointer',
                            outline: 'none',
                            width: '74px',
                            boxSizing: 'border-box',
                            transition: 'border-color 0.15s ease, background-color 0.15s ease'
                          }}
                        >
                          <option value="view" style={{ color: 'var(--text-secondary)', background: 'var(--surface-color)' }}>Viewer</option>
                          <option value="edit" style={{ color: 'var(--text-secondary)', background: 'var(--surface-color)' }}>Editor</option>
                          <option value="owner" style={{ color: 'var(--text-secondary)', background: 'var(--surface-color)' }}>Transfer Ownership</option>
                        </select>
                        {updatingUserId === perm.userId ? (
                          <Loader2 size={12} className="animate-spin" style={{ position: 'absolute', right: '5px', pointerEvents: 'none', color: 'var(--text-secondary)' }} />
                        ) : (
                          <ChevronDown size={12} style={{ position: 'absolute', right: '5px', pointerEvents: 'none', color: 'var(--text-secondary)' }} />
                        )}
                      </div>
                    )}
                    {isOwner && (
                      <button 
                        onClick={() => setUserToRemove(perm.userId)}
                        style={{ 
                          background: 'transparent', 
                          border: 'none', 
                          color: 'var(--text-secondary)', 
                          padding: '5px', 
                          borderRadius: 'var(--radius-sm)', 
                          cursor: 'pointer', 
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = 'var(--error-color)';
                          e.currentTarget.style.background = 'color-mix(in srgb, var(--error-color) 12%, transparent)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = 'var(--text-secondary)';
                          e.currentTarget.style.background = 'transparent';
                        }}
                        title="Remove access"
                        aria-label={`Remove ${perm.userName || perm.userEmail}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: '1.25rem', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', background: 'var(--bg-color)' }}>
          <label 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '10px', 
              cursor: isOwner && !isUpdatingPublic ? 'pointer' : 'default',
              userSelect: 'none',
              fontWeight: '600',
              fontSize: '0.9rem',
              color: 'var(--text-primary)',
              margin: 0
            }}
            onClick={(e) => {
              e.preventDefault();
              handleRadioToggle();
            }}
          >
            <input 
              type="radio" 
              checked={isPublic} 
              onChange={() => {}}
              disabled={!isOwner || isUpdatingPublic}
              aria-label="Allow anybody with the link to view"
              style={{ cursor: isOwner && !isUpdatingPublic ? 'pointer' : 'default', width: '16px', height: '16px', accentColor: 'var(--primary-accent, var(--primary-color))' }}
            />
            <span>Allow anybody with the link to view</span>
            {isUpdatingPublic && <Loader2 size={14} className="animate-spin" />}
          </label>
        </div>

        <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px' }}>
          {isPublic && (
            <button 
              type="button"
              onClick={handleCopyLink}
              style={{ 
                background: 'var(--surface-color)', 
                border: '1px solid var(--border-color)', 
                padding: '10px 18px', 
                borderRadius: 'var(--radius-sm)', 
                cursor: 'pointer', 
                fontWeight: '600', 
                color: copied ? 'var(--success-color, #10b981)' : 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '0.85rem',
                transition: 'background-color 0.15s ease, color 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-color)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--surface-color)';
              }}
            >
              {copied ? <Check size={16} /> : <Link2 size={16} />}
              {copied ? 'Link Copied!' : 'Copy Link'}
            </button>
          )}

          <button 
            onClick={onClose} 
            style={{ 
              background: 'var(--bg-color)', 
              border: '1px solid var(--border-color)', 
              padding: '10px 24px', 
              borderRadius: 'var(--radius-sm)', 
              cursor: 'pointer', 
              fontWeight: '700', 
              color: 'var(--text-secondary)',
              transition: 'background-color 0.15s ease, color 0.15s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--surface-color)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-color)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >Done</button>
        </div>
      </div>
      
      {confirmTransferEmail && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2100, backdropFilter: 'blur(4px)' }} onClick={() => setConfirmTransferEmail(null)}>
          <div 
            style={{ 
              background: 'var(--surface-color)', 
              border: '1px solid var(--border-color)',
              padding: '2.5rem', 
              borderRadius: 'var(--radius-lg)', 
              maxWidth: '400px', 
              width: '90%', 
              boxShadow: 'var(--shadow-lg)' 
            }} 
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Transfer Ownership?</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: '1rem 0 2rem 0' }}>
              Are you sure you want to transfer ownership of this map to <strong style={{ color: 'var(--text-primary)' }}>{confirmTransferEmail}</strong>? 
              <br/><br/>
              You will automatically be downgraded to an Editor, and you will no longer have the ability to delete this map or manage permissions.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setConfirmTransferEmail(null)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
              <button 
                onClick={async () => {
                  setLoading(true);
                  try {
                    await onShare(confirmTransferEmail, 'owner');
                    setEmail('');
                    setRole(null);
                    setConfirmTransferEmail(null);
                  } catch (err: any) {
                    setError(err.response?.data?.error || err.message || 'Failed to transfer ownership');
                    setConfirmTransferEmail(null);
                  } finally {
                    setLoading(false);
                  }
                }} 
                disabled={loading}
                style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--error-color)', color: 'white', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer' }}
              >
                {loading ? 'Transferring...' : 'Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
