// @ts-check
const { test, expect } = require('@playwright/test');

test('collect 20 divar ads', async ({ page }) => {
  await page.goto('https://divar.ir/s/gorgan/buy-residential', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await page.waitForTimeout(3000);

  // Get the scrollable container
  const container = page.locator('.browse__aside-ee1e7');

  for (let i = 0; i < 60; i++) {
    await container.evaluate((el) => el.scrollBy(0, 100 + Math.floor(Math.random() * 80)));
    await page.waitForTimeout(200 + Math.floor(Math.random() * 300));
  }

  await page.waitForTimeout(2000);

  const ads = await page.locator('a[href*="/v/"]').count();
  console.log(`Found ${ads} ad links`);

  await page.screenshot({ path: 'divar-20ads.png', fullPage: true });
  await page.screenshot({ path: 'divar-20ads-viewport.png' });
  console.log('Screenshots saved');
});
