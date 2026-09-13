const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const targetUrl = 'https://divar.ir/s/gorgan/buy-residential';
  console.log(`Navigating to ${targetUrl}...`);
  
  // Set a longer timeout and wait until the DOM is loaded to prevent the 30s timeout error
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  
  console.log('Waiting for ads to load...');
  await page.waitForTimeout(5000); 
  
  let adLinks = new Set();
  
  console.log('Scrolling to find 20 ads...');
  let previousSize = 0;
  let retries = 0;

  while (adLinks.size < 20) {
    // Find all links that point to an ad (contain '/v/')
    const elements = await page.$$('a[href*="/v/"]');
    
    for (const el of elements) {
      const href = await el.getAttribute('href');
      if (href && adLinks.size < 20) {
        // Handle relative URLs if any
        const fullLink = href.startsWith('http') ? href : `https://divar.ir${href}`;
        adLinks.add(fullLink);
      }
    }
    
    if (adLinks.size < 20) {
      if (elements.length > 0) {
        // Scroll the last found ad into view. 
        // This is much better than window.scrollBy because the ads might be inside a scrolling sidebar.
        const lastElement = elements[elements.length - 1];
        await lastElement.scrollIntoViewIfNeeded();
      } else {
        // If no elements found yet, just try scrolling the window as a fallback
        await page.evaluate(() => window.scrollBy(0, 500));
      }
      
      await page.waitForTimeout(2000); // Wait for new ads to load after scrolling
      
      if (adLinks.size === previousSize) {
        retries++;
        if (retries > 10) {
          console.log("Can't find any more ads after multiple attempts. Proceeding with what we have.");
          break;
        }
      } else {
        retries = 0; 
      }
      previousSize = adLinks.size;
    }
  }

  const adLinksArray = Array.from(adLinks);
  console.log(`Successfully found ${adLinksArray.length} ads. Starting to take screenshots...`);
  
  // Create output directory
  const outputDir = path.join(__dirname, 'divar_ads_screenshots');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const results = [];

  for (let i = 0; i < adLinksArray.length; i++) {
    const link = adLinksArray[i];
    console.log(`[${i + 1}/${adLinksArray.length}] Opening ad: ${link}`);
    
    const adPage = await context.newPage();
    try {
      // Navigate to the ad page with a longer timeout
      await adPage.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
      // Wait for images to load on the individual ad page
      await adPage.waitForTimeout(4000); 
      
      const screenshotFilename = `ad_${i + 1}.png`;
      const screenshotPath = path.join(outputDir, screenshotFilename);
      
      // Take a screenshot of the full page
      await adPage.screenshot({ path: screenshotPath, fullPage: true });
      
      results.push({
        id: i + 1,
        url: link,
        screenshot: screenshotFilename
      });
      console.log(`Screenshot saved to ${screenshotPath}`);
    } catch (error) {
      console.error(`Failed to process ${link}:`, error.message);
    } finally {
      await adPage.close();
    }
  }
  
  // Save the JSON file mapping the screenshot to the link
  const resultsFilePath = path.join(outputDir, 'results.json');
  fs.writeFileSync(resultsFilePath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nAll done! Links and screenshot references are saved in ${resultsFilePath}`);

  await browser.close();
})();
