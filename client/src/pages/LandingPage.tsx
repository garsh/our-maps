import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiService } from '../services/api';
import { Map, Clock, Plus, LogOut } from 'lucide-react';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    const fetchMaps = async () => {
      try {
        const data = await apiService.getMaps();
        setMaps(data);
      } catch (error) {
        console.error('Failed to fetch maps', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMaps();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await apiService.deleteMap(id);
      setMaps(prev => prev.filter(m => m.id !== id));
    } catch (error) {
      console.error('Failed to delete map', error);
      alert('Failed to delete map');
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleCreateMap = () => {
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
    <div style={{ minHeight: '100vh', background: '#f8f9fa', padding: '2rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem', maxWidth: '1200px', margin: '0 auto 3rem auto' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#2c3e50', margin: 0 }}>
          <Map size={32} /> Our Maps
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {user?.picture && <img src={user.picture} alt={user.name} style={{ width: '32px', height: '32px', borderRadius: '50%' }} />}
            <span style={{ fontWeight: 'bold', color: '#555' }}>{user?.name}</span>
          </div>
          <button 
            onClick={logout}
            style={{ background: 'transparent', border: '1px solid #ccc', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: '#666' }}
          >
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2 style={{ color: '#333', margin: 0 }}>Your Maps</h2>
          <div style={{ display: 'flex', gap: '1rem', flex: 1, justifyContent: 'flex-end', minWidth: '300px' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
              <input 
                type="text" 
                placeholder="Search maps..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', padding: '10px 15px', borderRadius: '6px', border: '1px solid #ced4da', boxSizing: 'border-box' }}
              />
            </div>
            <button 
              onClick={handleCreateMap}
              style={{ background: '#27ae60', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', whiteSpace: 'nowrap' }}
            >
              <Plus size={20} /> Create New Map
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#666' }}>Loading maps...</div>
        ) : maps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', background: 'white', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
            <Map size={48} color="#ccc" style={{ marginBottom: '1rem' }} />
            <h3 style={{ color: '#555', marginTop: 0 }}>No maps yet</h3>
            <p style={{ color: '#888', marginBottom: '2rem' }}>Create your first map to get started!</p>
            <button 
              onClick={handleCreateMap}
              style={{ background: '#3498db', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '4px', cursor: 'pointer' }}
            >
              Create Map
            </button>
          </div>
        ) : filteredMaps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', background: 'white', borderRadius: '8px', color: '#999' }}>
            No maps found matching "{searchQuery}"
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
            {filteredMaps.map(map => (
              <div 
                key={map.id}
                style={{ background: 'white', borderRadius: '8px', padding: '1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s', border: '1px solid #eee', position: 'relative' }}
                onClick={() => navigate(`/map/${map.id}`)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 12px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)';
                }}
              >
                {map.ownerId === user?.id && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(map.id); }}
                    style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                )}
                <h3 style={{ margin: '0 0 0.5rem 0', color: '#2c3e50', fontSize: '1.2rem' }}>{map.name}</h3>
                <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
                  {map.ownerId === user?.id ? 'Owner' : `Shared by ${map.ownerName}`}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#999' }}>
                  <Clock size={14} />
                  Accessed {formatDate(map.lastAccessedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {deleteConfirm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setDeleteConfirm(null)}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', maxWidth: '400px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Delete Map?</h3>
            <p>Are you sure you want to delete this map? This action cannot be undone.</p>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ flex: 1, padding: '10px', borderRadius: '4px', border: 'none', background: '#e74c3c', color: 'white', cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
