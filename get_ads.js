const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const targetUrl = 'https://divar.ir/s/gorgan/buy-residential';
  await page.goto(targetUrl);
  
  console.log('Waiting for ads to load...');
  await page.waitForTimeout(3000);
  
  let adLinks = new Set();
  
  // Scroll and collect links until we have 20
  while (adLinks.size < 20) {
    const links = await page.$$eval('a', (elements) => {
      return elements.map(el => el.href).filter(href => href.includes('/v/'));
    });
    
    for (const link of links) {
      if (adLinks.size < 20) {
        adLinks.add(link);
      }
    }
    
    if (adLinks.size < 20) {
      // Scroll down
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(1500); // Wait for new ads to load
    }
  }

  const adLinksArray = Array.from(adLinks);
  console.log(`Found ${adLinksArray.length} ads. Starting to scrape...`);
  
  const outputDir = path.join(__dirname, 'divar_ads_output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const results = [];

  for (let i = 0; i < adLinksArray.length; i++) {
    const link = adLinksArray[i];
    console.log(`[${i + 1}/20] Opening ad: ${link}`);
    
    const adPage = await context.newPage();
    try {
      await adPage.goto(link, { waitUntil: 'load', timeout: 60000 });
      // wait a bit for dynamic content / images
      await adPage.waitForTimeout(3000); 
      
      const screenshotFilename = `ad_${i + 1}.png`;
      const screenshotPath = path.join(outputDir, screenshotFilename);
      
      await adPage.screenshot({ path: screenshotPath, fullPage: true });
      
      results.push({
        id: i + 1,
        url: link,
        screenshot: screenshotFilename
      });
      console.log(`Screenshot saved: ${screenshotPath}`);
    } catch (error) {
      console.error(`Failed to process ${link}:`, error.message);
    } finally {
      await adPage.close();
    }
  }
  
  const resultsFilePath = path.join(outputDir, 'results.json');
  fs.writeFileSync(resultsFilePath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nAll done! Links and screenshot references are saved in ${resultsFilePath}`);

  await browser.close();
})();
