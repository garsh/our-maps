import React, { createContext, useContext, useState, useEffect } from 'react';
import { googleLogout } from '@react-oauth/google';
import type { User } from '@shared/interfaces';
import { apiService } from '../services/api';

interface AuthContextType {
  user: User | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  logoutEverywhere: () => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
  handleCredentialResponse: (credential: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearLocalSession = () => {
    googleLogout();
    setUser(null);
    setIsLoading(false);
  };

  const logout = async () => {
    try {
      await apiService.logout();
    } catch {
      // Cookie/session may already be gone
    }
    clearLocalSession();
  };

  const logoutEverywhere = async () => {
    try {
      await apiService.logoutEverywhere();
    } catch {
      // Still clear this browser
    }
    clearLocalSession();
  };

  useEffect(() => {
    apiService.setLogoutCallback(() => {
      clearLocalSession();
    });
  }, []);

  const handleCredentialResponse = async (credential: string) => {
    setIsLoading(true);
    try {
      const data = await apiService.loginWithGoogle(credential);
      setUser(data.user);
    } catch (err) {
      console.error('[AUTH] Login with custom JWT failed:', err);
      clearLocalSession();
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Delete after 2027-01-01: leftover JWTs from the pre-cookie auth era.
    localStorage.removeItem('token');

    const loadSession = async () => {
      try {
        const data = await apiService.me();
        if (data?.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };
    loadSession();
  }, []);

  const mockLogin = async () => {
    if (import.meta.env.VITE_MOCK_AUTH === 'true' || !import.meta.env.VITE_GOOGLE_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID === 'MOCK_CLIENT_ID') {
      setIsLoading(true);
      try {
        const data = await apiService.mockLogin();
        setUser(data.user);
      } catch (err) {
        console.error('[AUTH] Mock login failed:', err);
        clearLocalSession();
        throw err;
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      login: mockLogin, 
      logout,
      logoutEverywhere,
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
