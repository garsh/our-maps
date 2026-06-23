import React, { createContext, useContext, useState, useEffect } from 'react';
import { googleLogout } from '@react-oauth/google';
import type { User } from '@shared/interfaces';
import { apiService } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: () => void; // Keep for legacy/fallback
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  handleCredentialResponse: (credential: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true);

  // Helper to decode JWT without a library
  const decodeJwt = (token: string) => {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    } catch (e) {
      return null;
    }
  };

  const logout = () => {
    googleLogout();
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    setIsLoading(false);
  };

  useEffect(() => {
    apiService.setLogoutCallback(logout);
  }, []);

  const handleCredentialResponse = (credential: string) => {
    setIsLoading(true);
    setToken(credential);
    localStorage.setItem('token', credential);

    const payload = decodeJwt(credential);
    if (payload) {
      setUser({
        id: payload.sub,
        email: payload.email,
        name: payload.name || payload.email,
        picture: payload.picture,
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    const checkToken = () => {
      if (token) {
        if (token.includes('.')) {
          const payload = decodeJwt(token);
          if (payload) {
            const isExpired = payload.exp * 1000 < Date.now();
            if (isExpired) {
              console.warn('[AUTH] Token expired, logging out');
              logout();
              return;
            }
            
            setUser({
              id: payload.sub,
              email: payload.email,
              name: payload.name || payload.email,
              picture: payload.picture,
            });
          } else {
            logout();
          }
        } else {
          // Fallback to mock token
          try {
            const decoded = decodeURIComponent(escape(atob(token)));
            const user = JSON.parse(decoded);
            if (user.id && user.email) {
              setUser(user);
            }
          } catch (e) {
            logout();
          }
        }
      }
      setIsLoading(false);
    };

    checkToken();
    
    // Periodically check for token expiration (every minute)
    const interval = setInterval(checkToken, 60000);
    return () => clearInterval(interval);
  }, [token]);

  const mockLogin = () => {
    if (import.meta.env.VITE_MOCK_AUTH === 'true' || !import.meta.env.VITE_GOOGLE_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID === 'MOCK_CLIENT_ID') {
        const mockUser = {
            id: 'mock-user-id',
            email: 'mock@example.com',
            name: 'Mock User',
            picture: ''
        };
        const json = JSON.stringify(mockUser);
        const mockToken = btoa(unescape(encodeURIComponent(json))); 
        setToken(mockToken);
        localStorage.setItem('token', mockToken);
        setUser(mockUser);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      token, 
      login: mockLogin, 
      logout, 
      isAuthenticated: !!user, 
      isLoading,
      handleCredentialResponse 
    }}>
      {children}
    </AuthContext.Provider>
  );
};


export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
