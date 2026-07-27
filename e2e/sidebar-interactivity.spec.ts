import { test, expect } from '@playwright/test';

// Helper to login
async function login(page: any) {
  // Capture console logs from browser
  page.on('console', (msg: any) => {
    if (msg.type() === 'error') console.log(`BROWSER ERROR: ${msg.text()}`);
    else console.log(`BROWSER: ${msg.text()}`);
  });
  
  await page.goto('/login');
  await page.getByRole('button', { name: /Sign in with Mock Account/i }).click();
  await expect(page).toHaveURL('/');
}

test('sidebar items are interactible', async ({ page }) => {
  // Mock places reverse geocode
  await page.route('**/places/reverse-geocode*', route => route.fulfill({ 
    json: { address: '123 Test St, Interactivity City, IC 12345' } 
  }));

  await login(page);

  // Navigate to new map page
  await page.getByRole('button', { name: 'Create New Map' }).click();
  
  // 1. Add a pin
  await page.route('**/search*', route => route.fulfill({ json: [{ place_id: 1, display_name: 'Interactivity City, 123 Test St', lat: '10', lon: '10' }] }));
  await page.getByPlaceholder('Find pins or new places...').fill('Interactivity City');
  await expect(page.getByText('Interactivity City, 123 Test St')).toBeVisible();
  await page.getByRole('button', { name: '+ Add to Map' }).click();

  // 2. Click "Close" in sidebar to close edit mode
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).not.toBeVisible();

  // 3. Click the pin in the sidebar list
  const sidebarItem = page.locator('li[id^="pin-"]').filter({ hasText: 'Interactivity City' });
  await expect(sidebarItem).toBeVisible();
  
  // Clicking it should open the popup on the map
  await sidebarItem.click();
  
  // 4. Verify popup is open on the map and shows address
  const popup = page.locator('.leaflet-popup-content');
  await expect(popup).toBeVisible({ timeout: 5000 });
  await expect(popup).toContainText('Interactivity City');
  await expect(popup).toContainText('123 Test St');
  
  // 5. Test "Edit" button in sidebar
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('NAME', { exact: true })).toBeVisible();
  await expect(page.getByLabel('IMAGE URL', { exact: true })).toBeVisible();
  
  // 6. Test "Close" button
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByLabel('NAME', { exact: true })).not.toBeVisible();
});
