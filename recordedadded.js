import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://my.serviceautopilot.com/');
  await page.locator('#leadEstimateTemplate').click();
  await page.locator('span').filter({ hasText: /^Quote$/ }).click();
});