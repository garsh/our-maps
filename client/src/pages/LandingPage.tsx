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

  const handleCreateMap = () => {
    navigate('/map/new');
  };

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <h2 style={{ color: '#333', margin: 0 }}>Your Maps</h2>
          <button 
            onClick={handleCreateMap}
            style={{ background: '#27ae60', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
          >
            <Plus size={20} /> Create New Map
          </button>
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
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
            {maps.map(map => (
              <div 
                key={map.id}
                onClick={() => navigate(`/map/${map.id}`)}
                style={{ background: 'white', borderRadius: '8px', padding: '1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s', border: '1px solid #eee' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 12px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)';
                }}
              >
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
    </div>
  );
}
