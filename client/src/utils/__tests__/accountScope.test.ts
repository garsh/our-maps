import { afterEach, describe, expect, it } from 'vitest';
import {
  accountStorageKey,
  getAccountScope,
  installAccountScopeFromStorage,
  noteSessionUnreachable,
  noteSignedInAccount,
  noteSignedOut,
  readAccountJson,
  resetAccountScopeForTests,
  writeAccountJson,
} from '../accountScope';

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online });
}

describe('accountScope', () => {
  afterEach(() => {
    resetAccountScopeForTests();
    localStorage.clear();
    setOnline(true);
  });

  it('hides account caches after sign-out and shows them again for the same account', () => {
    noteSignedInAccount('user-a');
    writeAccountJson('cached_maps', [{ id: 'map-1', name: 'Trip' }]);
    writeAccountJson('cached_selected_label', 'owned');

    noteSignedOut();
    expect(getAccountScope()).toEqual({ mode: 'hidden' });
    expect(readAccountJson('cached_maps', [])).toEqual([]);
    expect(writeAccountJson('cached_maps', [{ id: 'other', name: 'Nope' }])).toBe(false);
    expect(localStorage.getItem(accountStorageKey('cached_maps', 'user-a'))).toContain('Trip');
    expect(localStorage.getItem('ourmaps_account_id')).toBe('user-a');
    expect(localStorage.getItem('ourmaps_signed_out')).toBe('1');

    noteSignedInAccount('user-a');
    expect(readAccountJson('cached_maps', [])).toEqual([{ id: 'map-1', name: 'Trip' }]);
    expect(readAccountJson('cached_selected_label', null)).toBe('owned');
  });

  it('does not show one account the maps saved by another', () => {
    noteSignedInAccount('user-a');
    writeAccountJson('cached_maps', [{ id: 'map-a', name: 'A' }]);
    noteSignedInAccount('user-b');
    expect(readAccountJson('cached_maps', [])).toEqual([]);
    writeAccountJson('cached_maps', [{ id: 'map-b', name: 'B' }]);
    noteSignedInAccount('user-a');
    expect(readAccountJson('cached_maps', [])).toEqual([{ id: 'map-a', name: 'A' }]);
  });

  it('moves a legacy unscoped cache onto the first signed-in account', () => {
    localStorage.setItem('cached_maps', JSON.stringify([{ id: 'old', name: 'Legacy' }]));
    noteSignedInAccount('user-a');
    expect(localStorage.getItem('cached_maps')).toBeNull();
    expect(readAccountJson('cached_maps', [])).toEqual([{ id: 'old', name: 'Legacy' }]);
  });

  it('keeps a legacy cache with the previous account when someone else signs in', () => {
    localStorage.setItem('ourmaps_account_id', 'user-a');
    localStorage.setItem('cached_user_labels', JSON.stringify([{ id: 'label-1', name: 'Trips' }]));
    noteSignedInAccount('user-b');
    expect(localStorage.getItem('cached_user_labels')).toBeNull();
    expect(readAccountJson('cached_user_labels', [])).toEqual([]);
    noteSignedInAccount('user-a');
    expect(readAccountJson('cached_user_labels', [])).toEqual([{ id: 'label-1', name: 'Trips' }]);
  });

  it('stays hidden on an online load until the session is confirmed', () => {
    localStorage.setItem('ourmaps_account_id', 'user-a');
    localStorage.setItem(accountStorageKey('cached_maps', 'user-a'), JSON.stringify([{ id: 'map-1', name: 'Trip' }]));
    setOnline(true);
    installAccountScopeFromStorage();
    expect(getAccountScope()).toEqual({ mode: 'hidden' });
    expect(readAccountJson('cached_maps', [])).toEqual([]);
  });

  it('shows the last account while offline when they did not sign out', () => {
    localStorage.setItem('ourmaps_account_id', 'user-a');
    localStorage.setItem(accountStorageKey('cached_maps', 'user-a'), JSON.stringify([{ id: 'map-1', name: 'Trip' }]));
    setOnline(false);
    installAccountScopeFromStorage();
    expect(getAccountScope()).toEqual({ mode: 'account', userId: 'user-a' });
    expect(readAccountJson('cached_maps', [])).toEqual([{ id: 'map-1', name: 'Trip' }]);
  });

  it('stays hidden after sign-out even if the browser is offline', () => {
    localStorage.setItem('ourmaps_account_id', 'user-a');
    localStorage.setItem('ourmaps_signed_out', '1');
    setOnline(false);
    installAccountScopeFromStorage();
    expect(getAccountScope()).toEqual({ mode: 'hidden' });
    noteSessionUnreachable();
    expect(getAccountScope()).toEqual({ mode: 'hidden' });
  });

  it('keeps the last account when the session request cannot be reached', () => {
    localStorage.setItem('ourmaps_account_id', 'user-a');
    noteSessionUnreachable();
    expect(getAccountScope()).toEqual({ mode: 'account', userId: 'user-a' });
  });

  it('leaves pre-migration caches readable when offline and no account is known', () => {
    localStorage.setItem('cached_maps', JSON.stringify([{ id: 'old', name: 'Legacy' }]));
    setOnline(false);
    installAccountScopeFromStorage();
    expect(getAccountScope()).toEqual({ mode: 'open' });
    expect(readAccountJson('cached_maps', [])).toEqual([{ id: 'old', name: 'Legacy' }]);
    noteSessionUnreachable();
    expect(getAccountScope()).toEqual({ mode: 'open' });
  });
});
