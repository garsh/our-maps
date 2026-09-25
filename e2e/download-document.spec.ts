import type { Page } from '@playwright/test';
import { test, expect, login, waitForAutoSave, deleteCurrentMap, getMapIdFromUrl } from './helpers';

const DB_NAME = 'MapTilesDB_v2';

async function readDownloadRecord(page: Page, mapId: string): Promise<any> {
  return page.evaluate(accessMapRecord, { dbName: DB_NAME, mapId, mapData: null });
}

async function writeExplicitDownload(page: Page, mapId: string, mapData: Record<string, unknown>): Promise<void> {
  await page.evaluate(accessMapRecord, { dbName: DB_NAME, mapId, mapData });
}

async function accessMapRecord({ dbName, mapId, mapData }: {
  dbName: string;
  mapId: string;
  mapData: Record<string, unknown> | null;
}): Promise<any> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName);
    const timer = setTimeout(() => reject(new Error('IndexedDB open timed out')), 4000);
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error);
    };
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('maps', mapData ? 'readwrite' : 'readonly');
      const store = tx.objectStore('maps');
      const getReq = store.get(mapId);
      getReq.onerror = () => reject(getReq.error);
      getReq.onsuccess = () => {
        if (!mapData) {
          resolve(getReq.result ?? null);
          return;
        }
        const existing = getReq.result || { id: mapId, layers: [], pins: [] };
        const putReq = store.put({
          ...existing,
          ...mapData,
          id: mapId,
          isExplicitDownload: true,
          totalTiles: existing.totalTiles ?? 12,
          completedTiles: existing.completedTiles ?? 12,
          extractTotalBytes: existing.extractTotalBytes ?? 999,
        });
        putReq.onerror = () => reject(putReq.error);
      };
      tx.oncomplete = () => {
        if (mapData) resolve(null);
      };
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function keptDownloadFields(record: any) {
  return {
    etag: record?.etag ?? null,
    totalTiles: record?.totalTiles ?? null,
    completedTiles: record?.completedTiles ?? null,
    extractTotalBytes: record?.extractTotalBytes ?? null,
    isExplicitDownload: Boolean(record?.isExplicitDownload),
  };
}

async function fetchMap(page: Page, mapId: string): Promise<Record<string, unknown>> {
  return page.evaluate(async (id) => {
    const res = await fetch(`/api/maps/${id}`, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(`map fetch failed: ${res.status}`);
    return res.json();
  }, mapId);
}

test('explicit download stores pin, layer, and name edits', async ({ page, browser }) => {
  test.setTimeout(60000);
  let collaborator: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await login(page);
    await page.route('**/places/search*', async (route) => {
      const query = new URL(route.request().url()).searchParams.get('q') || '';
      if (query.includes('Remote')) {
        await route.fulfill({
          json: [{ place_id: '2', title: 'Remote Harbor', address: 'Far Away', lat: '64', lon: '25', type: 'global' }],
        });
        return;
      }
      await route.fulfill({
        json: [{ place_id: '1', title: 'Seed City', address: 'Seed Address', lat: '10', lon: '10', type: 'global' }],
      });
    });

    await page.getByRole('button', { name: /New Map/i }).click();
    await page.waitForURL(/\/map\//);
    await expect(page.getByText('Loading your map...')).not.toBeVisible();

    const searchInput = page.getByPlaceholder('Search...');
    await searchInput.fill('Seed City');
    await expect(page.getByText('Seed City').first()).toBeVisible({ timeout: 10000 });
    await page.locator('button[title="Add to Map"]').first().click();
    await waitForAutoSave(page);
    await page.waitForURL((url) => url.pathname !== '/map/new' && url.pathname.includes('/map/'));
    const mapId = getMapIdFromUrl(page.url());
    expect(mapId).toBeTruthy();

    await writeExplicitDownload(page, mapId!, await fetchMap(page, mapId!));
    const frozenDownload = keptDownloadFields(await readDownloadRecord(page, mapId!));
    expect(frozenDownload).toMatchObject({
      totalTiles: 12,
      completedTiles: 12,
      extractTotalBytes: 999,
      isExplicitDownload: true,
    });

    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByText('Rename Map').click();
    await page.getByLabel('New Map Name').fill('Downloaded Map');
    await page.getByRole('button', { name: 'Save' }).click();
    await waitForAutoSave(page);

    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByText('New Layer').click();
    await expect(page.getByText(/Layer 1/)).toBeVisible();
    await waitForAutoSave(page);

    await expect.poll(async () => {
      const record = await readDownloadRecord(page, mapId!);
      const layerNames = record?.layers?.map((layer: { name: string }) => layer.name) ?? [];
      return record?.name === 'Downloaded Map' && layerNames.includes('Layer 1');
    }).toBe(true);
    const afterLocalEdits = await readDownloadRecord(page, mapId!);
    expect(afterLocalEdits.pins.map((pin: { label: string }) => pin.label)).toContain('Seed City');
    expect(keptDownloadFields(afterLocalEdits)).toEqual(frozenDownload);

    const snapshot = await fetchMap(page, mapId!);
    collaborator = await browser.newContext({
      baseURL: 'http://127.0.0.1:5173',
      serviceWorkers: 'block',
    });
    const other = await collaborator.newPage();
    await other.route(`**/api/maps/${mapId}`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(snapshot),
      });
    });
    await login(other);
    await other.goto(`/map/${mapId}`);
    await expect(other.getByText('Loading your map...')).not.toBeVisible({ timeout: 15000 });
    await expect(other.locator('h1')).toContainText('Downloaded Map', { timeout: 15000 });
    await expect(other.locator('aside')).toContainText('Seed City', { timeout: 15000 });
    await expect(other.locator('aside')).toContainText('Layer 1', { timeout: 15000 });
    await waitForAutoSave(other);
    await writeExplicitDownload(other, mapId!, snapshot);
    const otherFrozen = keptDownloadFields(await readDownloadRecord(other, mapId!));
    expect(otherFrozen.isExplicitDownload).toBe(true);

    await searchInput.fill('Remote Harbor');
    await expect(page.getByText('Remote Harbor').first()).toBeVisible({ timeout: 10000 });
    await page.locator('button[title="Add to Map"]').first().click();
    await waitForAutoSave(page);
    await expect(other.locator('aside')).toContainText('Remote Harbor', { timeout: 15000 });

    await expect.poll(async () => {
      const record = await readDownloadRecord(page, mapId!);
      return record?.pins?.some((pin: { label: string; lat: number }) => pin.label === 'Remote Harbor' && pin.lat === 64);
    }).toBe(true);
    await expect.poll(async () => {
      const record = await readDownloadRecord(other, mapId!);
      return record?.pins?.some((pin: { label: string; lat: number }) => pin.label === 'Remote Harbor' && pin.lat === 64);
    }).toBe(true);

    expect(keptDownloadFields(await readDownloadRecord(page, mapId!))).toEqual(frozenDownload);
    const otherAfter = await readDownloadRecord(other, mapId!);
    expect(keptDownloadFields(otherAfter)).toEqual(otherFrozen);
    expect(otherAfter.name).toBe('Downloaded Map');
    expect(otherAfter.layers.map((layer: { name: string }) => layer.name)).toContain('Layer 1');
  } finally {
    await collaborator?.close();
    await deleteCurrentMap(page);
  }
});
