const { chromium } = require("playwright");

(async () => {
  // We use headless: false so you can watch the robot act like a human!
  const browser = await chromium.launch({ headless: false, slowMo: 1000 }); // slowMo adds a 1s delay between actions so you can see it
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("1. Open Divar");
  await page.goto("https://divar.ir");
  await page.waitForTimeout(3000);

  console.log("2. Look at current page");
  // Just waiting to simulate looking
  await page.waitForTimeout(2000);

  console.log("3. Select Gorgan (City Selection)");
  // Depending on whether cookies are set, Divar might show a city selection modal immediately.
  // We try to click the city button (usually in the header) and select Gorgan.
  try {
    const citySelectButton = await page.locator('button:has-text("تهران")'); // Default is usually Tehran or "انتخاب شهر"
    if (await citySelectButton.isVisible()) {
      await citySelectButton.click();
      await page.fill('input[placeholder="جستجوی شهر"]', "گرگان");
      await page.click('text="گرگان"');
      await page.waitForTimeout(2000);
    }
  } catch (e) {
    console.log("City selection skipped or already selected.");
  }

  console.log('4. Find search box & 5. Type "آپارتمان"');
  // Find the main search box
  const searchBox = await page.locator('input[placeholder*="جستجو"]');
  await searchBox.fill("آپارتمان");

  console.log("6. Search");
  await searchBox.press("Enter");
  await page.waitForTimeout(4000);

  console.log("7. Look at results");
  await page.waitForTimeout(2000);

  console.log("8. Scroll & 9. See more results");
  await page.evaluate(() => window.scrollBy(0, 1000));
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollBy(0, 1000));
  await page.waitForTimeout(3000);

  console.log("10. Open interesting ad");
  // Click the first ad link we find
  const firstAd = await page.locator('a[href*="/v/"]').first();

  // To avoid opening in a new tab if Divar does that, we get the URL and go to it
  const adUrl = await firstAd.getAttribute("href");
  const fullAdUrl = adUrl.startsWith("http")
    ? adUrl
    : `https://divar.ir${adUrl}`;

  await page.goto(fullAdUrl);

  console.log("11. Read ad");
  await page.waitForTimeout(5000); // Wait 5 seconds simulating reading

  console.log("12. Back");
  await page.goBack();
  await page.waitForTimeout(3000);

  console.log("13. Continue...");
  await page.evaluate(() => window.scrollBy(0, 1500));
  await page.waitForTimeout(3000);

  console.log("Done with human-like flow!");
  await browser.close();
})();
