# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: divar.spec.js >> collect 20 divar ads
- Location: tests/divar.spec.js:4:1

# Error details

```
Error: Channel closed
```

```
Error: page.waitForTimeout: Target page, context or browser has been closed
```

# Test source

```ts
  1  | // @ts-check
  2  | const { test, expect } = require('@playwright/test');
  3  | 
  4  | test('collect 20 divar ads', async ({ page }) => {
  5  |   await page.goto('https://divar.ir/s/gorgan/buy-residential', {
  6  |     waitUntil: 'domcontentloaded',
  7  |     timeout: 30000,
  8  |   });
  9  | 
  10 |   await page.waitForTimeout(3000);
  11 | 
  12 |   // Get the scrollable container
  13 |   const container = page.locator('.browse__aside-ee1e7');
  14 | 
  15 |   for (let i = 0; i < 60; i++) {
  16 |     await container.evaluate((el) => el.scrollBy(0, 100 + Math.floor(Math.random() * 80)));
> 17 |     await page.waitForTimeout(200 + Math.floor(Math.random() * 300));
     |                ^ Error: page.waitForTimeout: Target page, context or browser has been closed
  18 |   }
  19 | 
  20 |   await page.waitForTimeout(2000);
  21 | 
  22 |   const ads = await page.locator('a[href*="/v/"]').count();
  23 |   console.log(`Found ${ads} ad links`);
  24 | 
  25 |   await page.screenshot({ path: 'divar-20ads.png', fullPage: true });
  26 |   await page.screenshot({ path: 'divar-20ads-viewport.png' });
  27 |   console.log('Screenshots saved');
  28 | });
  29 | 
```