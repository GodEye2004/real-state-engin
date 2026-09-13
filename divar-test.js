const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  await page.goto('https://divar.ir/s/gorgan/buy-residential');
  
  console.log('Page title:', await page.title());
  console.log('Page URL:', page.url());
  
  // Wait for page to load
  await page.waitForLoadState('networkidle');
  
  // Take a screenshot
  await page.screenshot({ path: 'divar-screenshot.png', fullPage: true });
  console.log('Screenshot saved as divar-screenshot.png');
  
  // Keep browser open for 5 seconds to see the page
  await page.waitForTimeout(5000);
  
  await browser.close();
  console.log('Browser closed');
})();
