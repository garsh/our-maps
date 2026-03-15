import { test, expect } from '@playwright/test';

test('check for console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', exception => {
    errors.push(exception.message);
  });

  await page.goto('http://localhost:5173');
  
  // Wait a bit for the map and other resources to load
  await page.waitForTimeout(2000);

  if (errors.length > 0) {
    throw new Error("Console errors detected: " + errors.join("\n"));
  }
});
