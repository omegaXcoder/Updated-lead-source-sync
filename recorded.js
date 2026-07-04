import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://my.serviceautopilot.com/');
  await page.locator('span').filter({ hasText: /^Quote$/ }).click();
  await page.locator('#eoDetailsGridTable span').filter({ hasText: 'Lost' }).click();
  await page.locator('.float_left.padding-top-5px').first().click();
  await page.getByText('81.00').nth(1).click();
});