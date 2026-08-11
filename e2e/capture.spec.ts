import { test, expect } from '@playwright/test';

test('capture sidebar edit', async ({ page }) => {
  await page.goto('http://localhost:5173/map/new');
  await page.waitForTimeout(2000); // let map load

  // Add a pin
  await page.mouse.click(500, 500, { button: 'right' });
  await page.waitForTimeout(1000);

  // Close the pin edit form in sidebar first
  await page.locator('button:has-text("Close")').click();
  await page.waitForTimeout(500);

  // Create a new group
  await page.locator('button[title="New Group"]').click();
  await page.waitForTimeout(500);

  // Drag the pin into the group (too complex in PW) 
  // Instead, open the pin in edit mode and change its layer
  await page.locator('button:has-text("Edit")').click();
  await page.waitForTimeout(500);
  
  // Select the group from the dropdown
  await page.locator('select').selectOption({ label: 'Group 1' });
  await page.waitForTimeout(500);
  
  // Close the edit mode in the sidebar
  await page.locator('button:has-text("Close")').click();
  await page.waitForTimeout(500);

  // Collapse the group
  // Clicking the ChevronDown icon
  await page.locator('svg.lucide-chevron-down').click();
  await page.waitForTimeout(500);

  // Now the group is collapsed.
  // Click the pin on the map to open the popup
  await page.locator('.leaflet-marker-icon').click();
  await page.waitForTimeout(1000);

  // Click the EDIT button in the popup
  await page.locator('button', { hasText: 'EDIT' }).click();
  await page.waitForTimeout(1000);

  // Take a screenshot
  await page.screenshot({ path: '/home/bgarcia/.gemini/antigravity/brain/559085e4-6cfc-4ce3-95c5-7a79ac38ab5d/scratch/screenshot.png' });
});
