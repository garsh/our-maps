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

  const hasClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID && import.meta.env.VITE_GOOGLE_CLIENT_ID !== 'MOCK_CLIENT_ID';
  const forceMock = import.meta.env.VITE_MOCK_AUTH === 'true';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-color)' }}>
      <div style={{ background: 'var(--surface-color)', padding: '3rem', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', textAlign: 'center', maxWidth: '450px', width: '90%' }}>
        <h1 style={{ marginBottom: '1rem', color: 'var(--primary-color)', fontSize: '2.5rem', fontWeight: '800' }}>Our Maps</h1>
        <p style={{ marginBottom: '2.5rem', color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: '1.5' }}>
          Create, share, and manage your custom locations with ease.
        </p>

        {!hasClientId && !forceMock && (
            <div style={{ marginBottom: '1.5rem', padding: '10px', background: '#fff5f5', border: '1px solid #feb2b2', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: '#c53030' }}>
                <strong>Configuration Error:</strong> VITE_GOOGLE_CLIENT_ID is missing. The app is falling back to mock mode.
            </div>
        )}
        
        {error && (
          <div style={{ 
            background: 'rgba(203, 43, 62, 0.1)', 
            color: 'var(--error-color)', 
            padding: '12px', 
            borderRadius: 'var(--radius-sm)', 
            marginBottom: '1.5rem',
            fontSize: '0.9rem',
            border: '1px solid rgba(203, 43, 62, 0.2)'
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {hasClientId && !forceMock ? (
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
              shape="pill"
              theme="filled_blue"
              size="large"
            />
          ) : (
            <button 
              onClick={() => login()}
              style={{ 
                padding: '0.75rem 2rem', 
                fontSize: '1rem', 
                background: '#4285F4', 
                color: 'white', 
                border: 'none', 
                borderRadius: '50px', 
                cursor: 'pointer',
                fontWeight: 'bold',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}
            >
              Sign in with Mock Account (Dev)
            </button>
          )}
        </div>
        
        <div style={{ marginTop: '3rem', fontSize: '0.8rem', color: '#aaa' }}>
          By signing in, you agree to our terms and privacy policy.
        </div>
      </div>
    </div>
  );
}
