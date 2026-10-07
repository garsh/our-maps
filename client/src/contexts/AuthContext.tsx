import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { googleLogout } from '@react-oauth/google';
import type { User } from '@shared/interfaces';
import { apiService } from '../services/api';
import { installAccountScopeFromStorage, noteSessionUnreachable, noteSignedInAccount, noteSignedOut } from '../utils/accountScope';
import { claimUnownedMapDocuments } from '../utils/tileUtils';

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
  const userRef = useRef<User | null>(null);
  // Before children read caches. Online stays hidden until me() confirms.
  useState(() => {
    installAccountScopeFromStorage();
    return null;
  });

  const adoptUser = (next: User | null) => {
    userRef.current = next;
    if (next?.id) {
      const previous = noteSignedInAccount(next.id);
      void claimUnownedMapDocuments(next.id, previous);
    } else {
      noteSignedOut();
    }
    setUser(next);
  };

  const clearLocalSession = () => {
    googleLogout();
    adoptUser(null);
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
      adoptUser(data.user);
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
        if (userRef.current) return;
        if (data?.user) adoptUser(data.user);
        else adoptUser(null);
      } catch {
        if (!userRef.current) noteSessionUnreachable();
      } finally {
        setIsLoading(false);
      }
    };
    loadSession();
  }, []);

  const login = async () => {
    if (import.meta.env.VITE_MOCK_AUTH === 'true' || !import.meta.env.VITE_GOOGLE_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID === 'MOCK_CLIENT_ID') {
      setIsLoading(true);
      try {
        const data = await apiService.mockLogin();
        adoptUser(data.user);
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
      login,
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
