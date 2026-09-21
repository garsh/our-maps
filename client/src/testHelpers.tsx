import React from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';

export const MOCK_USER = {
  id: 'user-1',
  email: 'test@test.com',
  name: 'Test User',
  picture: '',
};

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  initialEntries?: string[];
  routePath?: string;
  clientId?: string;
}

export function renderWithProviders(
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {}
): RenderResult {
  const {
    initialEntries = ['/'],
    routePath,
    clientId = 'test-client-id',
    ...renderOptions
  } = options;

  const content = routePath ? (
    <Routes>
      <Route path={routePath} element={ui} />
    </Routes>
  ) : (
    ui
  );

  return render(
    <GoogleOAuthProvider clientId={clientId}>
      <MemoryRouter initialEntries={initialEntries}>
        {content}
      </MemoryRouter>
    </GoogleOAuthProvider>,
    renderOptions
  );
}
