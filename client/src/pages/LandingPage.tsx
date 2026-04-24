import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiService } from '../services/api';
import { Map, Clock, Plus, LogOut, WifiOff, CloudSync, Loader2, Trash2 } from 'lucide-react';

interface MapSummary {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  lastAccessedAt?: string;
}

export default function LandingPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchMaps = async () => {
    setLoading(true);
    try {
      const data = await apiService.getMaps();
      setMaps(data);
      setIsOffline(false);
      localStorage.setItem('cached_maps', JSON.stringify(data));
    } catch (error) {
      console.error('Failed to fetch maps', error);
      setIsOffline(true);
      const cached = localStorage.getItem('cached_maps');
      if (cached) {
        setMaps(JSON.parse(cached));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMaps();
    
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    if (!navigator.onLine) setIsOffline(true);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleDelete = async (id: string) => {
    if (isOffline) {
      alert('Cannot delete maps while offline.');
      return;
    }
    try {
      await apiService.deleteMap(id);
      setMaps(prev => prev.filter(m => m.id !== id));
      localStorage.setItem('cached_maps', JSON.stringify(maps.filter(m => m.id !== id)));
    } catch (error) {
      console.error('Failed to delete map', error);
      alert('Failed to delete map');
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleCreateMap = () => {
    if (isOffline) {
      alert('Cannot create maps while offline.');
      return;
    }
    navigate('/map/new');
  };

  const filteredMaps = maps.filter(map => 
    map.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (map.ownerName || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString(undefined, { 
      month: 'short', day: 'numeric', year: 'numeric' 
    });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-color)', paddingBottom: '4rem' }}>
      <header style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '1rem 2rem', 
        background: 'var(--primary-color)', 
        color: 'white',
        boxShadow: 'var(--shadow-md)',
        marginBottom: '2.5rem'
      }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0, fontSize: '1.5rem', fontWeight: 'bold' }}>
          <Map size={28} /> Our Maps
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          {isOffline && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.2)', padding: '4px 12px', borderRadius: '50px', fontSize: '0.8rem', fontWeight: 'bold' }}>
              <WifiOff size={14} /> Offline Mode
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.1)', padding: '4px 12px', borderRadius: '50px' }}>
            {user?.picture && <img src={user.picture} alt={user.name} style={{ width: '24px', height: '24px', borderRadius: '50%' }} />}
            <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{user?.name}</span>
          </div>
          <button 
            onClick={logout}
            style={{ 
              background: 'transparent', 
              border: '1px solid rgba(255,255,255,0.3)', 
              padding: '6px 12px', 
              borderRadius: 'var(--radius-sm)', 
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              color: 'white',
              fontSize: '0.85rem'
            }}
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2 style={{ color: 'var(--text-primary)', margin: 0, fontWeight: '800', fontSize: '1.8rem' }}>Your Maps</h2>
          <div style={{ display: 'flex', gap: '1rem', flex: 1, justifyContent: 'flex-end', minWidth: '300px' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
              <input 
                type="text" 
                placeholder="Search maps..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-field"
                style={{ paddingLeft: '40px' }}
              />
              <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#aaa' }}>
                <Map size={18} />
              </div>
            </div>
            {!isOffline && (
              <button 
                onClick={handleCreateMap}
                className="btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(72, 61, 139, 0.2)' }}
              >
                <Plus size={20} /> Create New Map
              </button>
            )}
            {isOffline && (
              <button 
                onClick={fetchMaps}
                className="btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--text-secondary)' }}
              >
                <CloudSync size={20} /> Retry Sync
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '8rem 0', color: 'var(--text-secondary)' }}>
            <Loader2 className="animate-spin" size={40} style={{ margin: '0 auto 1rem auto', color: 'var(--primary-color)' }} />
            <p>Loading your maps...</p>
          </div>
        ) : maps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '6rem 2rem', background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-color)' }}>
            <div style={{ background: 'var(--bg-color)', width: '80px', height: '80px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
              <Map size={40} color="var(--primary-color)" />
            </div>
            <h3 style={{ color: 'var(--text-primary)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>No maps yet</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2.5rem', maxWidth: '400px', margin: '0 auto 2.5rem auto' }}>Start creating your personal map collections or import KML files to get started!</p>
            <button 
              onClick={handleCreateMap}
              className="btn-primary"
              disabled={isOffline}
            >
              Create Your First Map
            </button>
          </div>
        ) : filteredMaps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)' }}>
            No maps found matching "{searchQuery}"
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '24px' }}>
            {filteredMaps.map(map => (
              <div 
                key={map.id}
                className="card"
                style={{ 
                  padding: '1.75rem', 
                  cursor: 'pointer', 
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)', 
                  position: 'relative',
                  overflow: 'hidden'
                }}
                onClick={() => navigate(`/map/${map.id}`)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                  e.currentTarget.style.borderColor = 'var(--primary-color)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              >
                <div style={{ 
                  position: 'absolute', 
                  top: 0, 
                  left: 0, 
                  width: '4px', 
                  height: '100%', 
                  background: map.ownerId === user?.id ? 'var(--primary-color)' : 'var(--success-color)' 
                }} />
                
                {map.ownerId === user?.id && !isOffline && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(map.id); }}
                    style={{ position: 'absolute', top: '16px', right: '16px', background: 'rgba(231, 76, 60, 0.1)', border: 'none', color: 'var(--error-color)', padding: '6px', borderRadius: '50%', cursor: 'pointer', display: 'flex' }}
                    title="Delete Map"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                
                <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)', fontSize: '1.3rem', fontWeight: '700', paddingRight: '24px' }}>{map.name}</h3>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                   <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: map.ownerId === user?.id ? 'var(--primary-color)' : 'var(--success-color)' }}></div>
                  {map.ownerId === user?.id ? 'Owner' : `Shared by ${map.ownerName}`}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#999', borderTop: '1px solid #f1f1f1', paddingTop: '1rem' }}>
                  <Clock size={14} />
                  <span>Last opened {formatDate(map.lastAccessedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {deleteConfirm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' }} onClick={() => setDeleteConfirm(null)}>
          <div style={{ background: 'white', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '450px', width: '90%', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Delete Map?</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0 2rem 0' }}>
              Are you sure you want to delete <strong>{maps.find(m => m.id === deleteConfirm)?.name}</strong>? This action is permanent and cannot be reversed.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)' }}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--error-color)', color: 'white', fontWeight: '600' }}>Delete Map</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
