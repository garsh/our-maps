import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';

export default function LoginPage() {
  const { handleCredentialResponse, isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  const isMockMode = import.meta.env.VITE_MOCK_AUTH === 'true' || !import.meta.env.VITE_GOOGLE_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID === 'MOCK_CLIENT_ID';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f0f2f5' }}>
      <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1.5rem', color: '#2c3e50' }}>Welcome to Our Maps</h1>
        <p style={{ marginBottom: '2rem', color: '#666' }}>Sign in to create, share, and explore maps.</p>
        
        {error && <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {!isMockMode ? (
            <GoogleLogin
              onSuccess={credentialResponse => {
                if (credentialResponse.credential) {
                  handleCredentialResponse(credentialResponse.credential);
                }
              }}
              onError={() => {
                console.log('Login Failed');
                setError('Login failed. Please try again.');
              }}
              useOneTap
            />
          ) : (
            <button 
              onClick={() => login()}
              style={{ 
                padding: '0.75rem 1.5rem', 
                fontSize: '1rem', 
                background: '#4285F4', 
                color: 'white', 
                border: 'none', 
                borderRadius: '4px', 
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              Sign in with Mock Account (Dev)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
