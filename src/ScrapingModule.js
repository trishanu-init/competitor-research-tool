// scrapingModules.js
// Specialized modules for web scraping different sources to detect company collaborations

const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const natural = require('natural');
const fs = require('fs').promises;
const path = require('path');

// Initialize NLP tools
const tokenizer = new natural.WordTokenizer();
const TfIdf = natural.TfIdf;
const tfidf = new TfIdf();

// Cache mechanism to avoid duplicate requests
const requestCache = new Map();

/**
 * News Scraper Module
 * Handles scraping of news sources for company collaboration information
 */
class NewsScraperModule {
  constructor() {
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36'
    ];

    // News sources to search
    this.newsSources = [
      {
        name: 'Google News',
        searchUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=us&tbm=nws`,
        selector: '.SoaBEf',
        titleSelector: 'div.n0jPhd',
        snippetSelector: '.GI74Re', // Adjust if Google News changes layout
        dateSelector: '.OSrXXb span',
        linkSelector: 'a',
        linkAttribute: 'href',
        linkPrefix: 'https://www.google.com'
      },
      {
        name: 'Yahoo Finance',
        searchUrl: (query) => `https://finance.yahoo.com/news/search?p=${encodeURIComponent(query)}`, // Adjusted search URL
        selector: 'li.js-stream-content',
        titleSelector: 'h3',
        snippetSelector: 'p',
        dateSelector: 'span[data-test="ContentMetaAttribute-timestamp"]', // Updated selector
        linkSelector: 'h3 a', // Corrected selector
        linkAttribute: 'href',
        linkPrefix: 'https://finance.yahoo.com' // Assume relative links start with /
      },
      {
        name: 'MarketWatch',
        searchUrl: (query) => `https://www.marketwatch.com/search?q=${encodeURIComponent(query)}&ts=0&tab=All%20News`,
        selector: '.searchresult', // Updated selector
        titleSelector: '.article__headline a', // Updated selector
        snippetSelector: '.article__summary',
        dateSelector: '.article__timestamp',
        linkSelector: '.article__headline a', // Updated selector
        linkAttribute: 'href',
        linkPrefix: '' // MarketWatch uses full URLs
      }
    ];
  }

  /**
   * Get a random user agent to rotate for requests
   */
  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  /**
   * Search news sources for company collaborations
   * @param {string} targetCompany - Target company name
   * @param {string} competitor - Competitor company name
   * @returns {Promise<Array>} - Array of news articles
   */
  async searchAllNewsSources(targetCompany, competitor) {
    console.log(`Searching news sources for ${targetCompany} and ${competitor}`);

    const searchPromises = this.newsSources.map(source =>
      this.searchNewsSource(source, targetCompany, competitor)
    );

    const results = await Promise.allSettled(searchPromises);
    return results
      .filter(result => result.status === 'fulfilled')
      .flatMap(result => result.value);
  }

  /**
   * Search a specific news source
   * @param {Object} source - Source configuration
   * @param {string} targetCompany - Target company name
   * @param {string} competitor - Competitor company name
   * @returns {Promise<Array>} - News articles from this source
   */
  async searchNewsSource(source, targetCompany, competitor) {
    let browser = null;
    try {
      const searchQueries = [
        `"${targetCompany}" "${competitor}"`, // Exact match
        `"${targetCompany}" "${competitor}" partnership`, // Use quotes for exact matching
        `"${targetCompany}" "${competitor}" collaboration`,
        `"${targetCompany}" "${competitor}" joint venture`,
        `"${targetCompany}" "${competitor}" agreement`
      ];

      let articles = [];

      for (const query of searchQueries) {
        browser = await puppeteer.launch({
          headless: true, // Consider 'new' for newer Puppeteer versions
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();

        // Set user agent
        await page.setUserAgent(this.getRandomUserAgent());

        // --- Add console logging from the page ---
        page.on('console', msg => {
          // Filter logs to only show messages from page.evaluate
          if (msg.type() === 'log') {
             console.log(`PAGE LOG [${source.name}, "${query}"] :`, msg.text());
          }
        });
        // --- End console logging setup ---


        // Set request interception to handle cookies and prevent certain resources from loading
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
            request.abort();
          } else {
            request.continue();
          }
        });

        // Navigate to search URL
        const url = source.searchUrl(query);
        console.log(`Searching ${source.name} with query: ${query} at URL: ${url}`);

        try {
             await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); // Increased timeout
             // Optional: Add a small wait here if content takes a moment after DOM is loaded
             // await page.waitForTimeout(2000);
        } catch (navError) {
            console.error(`Navigation error for ${source.name} query "${query}": ${navError.message}`);
             if (browser) { await browser.close(); browser = null; } // Ensure browser is closed
            continue; // Continue to the next query
        }


        // Wait for content to load
        try {
          await page.waitForSelector(source.selector, { timeout: 15000 }); // Increased timeout
           console.log(`Selector "${source.selector}" found on ${source.name} for query: ${query}`);
        } catch (err) {
          console.log(`No results or selector "${source.selector}" not found on ${source.name} for query: ${query}. Error: ${err.message}`);
          if (browser) { await browser.close(); browser = null; } // Ensure browser is closed
          continue; // Continue to the next query
        }

        // Extract articles
        const sourceArticles = await page.evaluate((cfg) => {
          const results = [];
          const articleElements = document.querySelectorAll(cfg.selector);

          console.log(`[Evaluate] Found ${articleElements.length} elements matching selector "${cfg.selector}"`); // Log count inside evaluate

          articleElements.forEach((article, index) => {
            const titleElement = article.querySelector(cfg.titleSelector);
            const snippetElement = article.querySelector(cfg.snippetSelector);
            const dateElement = article.querySelector(cfg.dateSelector);
            const linkElement = article.querySelector(cfg.linkSelector);

            console.log(`[Evaluate] Processing article element ${index}:`); // Log processing each element
            console.log(`[Evaluate]   Title element found: ${!!titleElement}`);
            console.log(`[Evaluate]   Link element found: ${!!linkElement}`);


            if (titleElement && linkElement) {
              let link = linkElement.getAttribute(cfg.linkAttribute);
              const title = titleElement.textContent.trim();
              const snippet = snippetElement ? snippetElement.textContent.trim() : '';
              const dateText = dateElement ? dateElement.textContent.trim() : '';

              console.log(`[Evaluate]   Title: "${title.substring(0, 50)}..."`); // Log snippet of title
              console.log(`[Evaluate]   Raw Link: "${link}"`); // Log raw link

              // Fix relative links
              if (link && !link.startsWith('http') && cfg.linkPrefix) {
                 // Handle cases like //example.com/link
                if (link.startsWith('//')) {
                    link = 'https:' + link;
                } else if (link.startsWith('/')) {
                    // Use the page's base URI for robust relative link resolution
                    try {
                        link = new URL(link, document.baseURI).href;
                    } catch(e) {
                         console.error(`[Evaluate] Error constructing URL from relative link "${link}" and base "${document.baseURI}": ${e.message}`);
                         link = '#'; // Invalidate link if construction fails
                    }
                } else {
                    // If it's not absolute and doesn't start with /, it might be relative to the current page path
                    // Use page's base URI
                     try {
                        link = new URL(link, document.baseURI).href;
                    } catch(e) {
                         console.error(`[Evaluate] Error constructing URL from potentially problematic link "${link}" and base "${document.baseURI}": ${e.message}`);
                         link = '#'; // Invalidate link if construction fails
                    }
                }
              } else if (link && cfg.linkPrefix && !link.startsWith('http')) {
                   // This case might still be relevant if linkPrefix is just the domain
                   try {
                       link = new URL(link, cfg.linkPrefix).href;
                   } catch(e) {
                        console.error(`[Evaluate] Error constructing URL from link "${link}" and prefix "${cfg.linkPrefix}": ${e.message}`);
                        link = '#'; // Invalidate link if construction fails
                   }
              } else if (!link && linkElement && linkElement.href) {
                  // Fallback if getAttribute didn't work but .href property exists (for <a> tags)
                   link = linkElement.href;
                   console.log(`[Evaluate]   Used .href fallback for link: "${link}"`);
              }

               console.log(`[Evaluate]   Processed Link: "${link}"`); // Log processed link


              // Clean date text if necessary
              // You might add date parsing/normalization here if needed

              results.push({
                title: title,
                snippet: snippet,
                date: dateText,
                url: link || '#', // Ensure URL is captured or defaulted
                source: cfg.name
              });
            } else {
                console.warn(`[Evaluate] Skipping article element ${index} due to missing title or link element.`);
                 // Log the outer HTML of the problematic element for inspection
                 // console.warn(`[Evaluate] Problematic element HTML: ${article.outerHTML.substring(0, 500)}...`); // Be cautious with large HTML
            }
          });

          console.log(`[Evaluate] Finished processing elements. Extracted ${results.length} articles.`); // Log count extracted inside evaluate

          return results;
        }, source); // Pass the source config correctly

        console.log(`Puppeteer evaluated. Extracted ${sourceArticles.length} articles from ${source.name} for query "${query}" before filtering.`); // Log count after evaluate

        articles = [...articles, ...sourceArticles];
        await browser.close();
        browser = null;

        // Throttle requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000)); // Add jitter
      } // End of query loop

      // Deduplicate articles based on URL
      const uniqueArticles = Array.from(new Map(articles.map(article => [article.url, article])).values());

       console.log(`Found ${uniqueArticles.length} unique articles before company filtering.`);


      // Filter results to ensure both companies are mentioned (case-insensitive)
      const filteredArticles = uniqueArticles.filter(article => {
          // Ensure title and snippet are strings before lowercasing
          const textToCheck = `${(article.title || '')} ${(article.snippet || '')}`.toLowerCase();
          const isRelevant = textToCheck.includes(targetCompany.toLowerCase()) &&
                             textToCheck.includes(competitor.toLowerCase());
           // Log whether each unique article is kept or filtered out
           console.log(`Filtering article "${(article.title || '').substring(0, 50)}...": ${isRelevant ? 'KEEP' : 'FILTER'}`);
          return isRelevant;
      });

      console.log(`Found ${filteredArticles.length} relevant articles from ${source.name} after company filtering.`);
      return filteredArticles;

    } catch (error) {
      console.error(`Error searching ${source.name}: ${error.message}`, error.stack);
      if (browser) {
        try { await browser.close(); } catch (closeError) { console.error("Error closing browser:", closeError); }
      }
      return [];
    }
  }

  /**
   * Fetch and extract content from a news article
   * @param {string} url - URL of the news article
   * @returns {Promise<string>} - Article content
   */
  async fetchArticleContent(url) {
    // Check cache first
    if (requestCache.has(url)) {
       console.log(`Cache hit for article: ${url}`); // Changed to console.log
      return requestCache.get(url);
    }

    let browser = null;
    try {
      console.log(`Fetching article content from: ${url}`); // Changed "Workspaceing" to "Fetching"

      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      const page = await browser.newPage();
      await page.setUserAgent(this.getRandomUserAgent());
      await page.setRequestInterception(true);
        page.on('request', (request) => {
          if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
            request.abort();
          } else {
            request.continue();
          }
        });


      // Set timeout for page load
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); // Increased timeout

      // Try different content selectors based on common news site layouts
      const contentSelectors = [
        'article',
        '.article-content',
        '.article-body',
        '.story-content',
        '.story-body',
        '.news-article',
        'main',
        '.post-content',
        '.entry-content',
        '.content',
        '[itemprop="articleBody"]', // Schema.org microdata
        'div[role="main"]', // ARIA role
        '#main-content' // Common ID
      ];

      let content = '';

      // Attempt to extract content using the defined selectors
      for (const selector of contentSelectors) {
         try {
            const elementHandle = await page.$(selector);
            if (elementHandle) {
                // Extract text from common text-holding elements within the container
                content = await elementHandle.$$eval('p, h1, h2, h3, h4, h5, h6, li, span', elements => {
                    // Filter elements to avoid extracting tiny pieces of text or navigation
                    return elements.map(el => el.textContent.trim())
                                   .filter(text => text.length > 10) // Filter short text snippets
                                   .join(' '); // Join with space
                });

                 if (content && content.length > 150) { // Check if enough substantial content was extracted (increased length check)
                     console.log(`Extracted content using selector: ${selector}`);
                     break; // Stop after finding content with a selector
                 } else {
                     // If specific element extraction failed or was too short, try getting all text from the container
                     const fallbackContent = await elementHandle.evaluate(el => el.textContent);
                     if (fallbackContent && fallbackContent.length > 150) { // Increased length check
                         content = fallbackContent;
                         console.log(`Extracted content using selector (container text fallback): ${selector}`);
                         break; // Stop after finding content
                     }
                 }
            }
        } catch (evalError) {
           console.warn(`Error evaluating selector ${selector} on ${url}: ${evalError.message}`);
           // Do not reset content here, allow the next selector to be tried
        }
      }

      // If no content was found with specific selectors, try extracting from main article/body tags
      if (!content || content.length < 150) { // Increased length check
          console.log(`Falling back to extracting text from common article/body elements for ${url}`);
          content = await page.evaluate(() => {
              // Try common article containers directly
              const articleBody = document.querySelector('article, main, [role="main"], #main-content');
              if (articleBody) {
                   return Array.from(articleBody.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span'))
                                .map(el => el.textContent.trim())
                                .filter(text => text.length > 10)
                                .join(' ');
              } else {
                  // Final fallback: get all text from the body, excluding common non-content tags
                  const body = document.body;
                  if (body) {
                      // Clone body to remove elements without affecting the live page
                      const bodyClone = body.cloneNode(true);
                      // Remove script, style, nav, header, footer, etc.
                      bodyClone.querySelectorAll('script, style, nav, header, footer, aside, iframe, noscript').forEach(el => el.remove());

                      return Array.from(bodyClone.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span'))
                                   .map(el => el.textContent.trim())
                                   .filter(text => text.length > 10)
                                   .join(' ');
                  }
              }
              return ''; // Return empty if body not found
          });
           if (content && content.length > 150) {
               console.log(`Extracted content using fallback method (Length: ${content.length})`);
           } else {
               console.warn(`Fallback extraction yielded insufficient content for ${url}`);
               content = ''; // Ensure content is empty if fallback failed
           }
      }


      await browser.close();
      browser = null;

      // Clean up the content
      // Use a more robust regex for cleaning whitespace and remove common HTML entities
      content = content.replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
                       .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces and BOM
                       .replace(/\s{2,}/g, ' ') // Replace multiple spaces with a single space
                       .replace(/(\r\n|\n|\r)/gm, ' ') // Replace various line breaks with spaces
                       .replace(/[\u{0080}-\u{FFFF}]/gu, "") // Remove non-basic characters
                       .trim();


      // Cache the result only if content is substantial
      if (content && content.length > 100) { // Adjusted minimum length for caching
          requestCache.set(url, content);
           console.log(`Cached content for article: ${url} (Length: ${content.length})`); // Changed to console.log
      } else {
          console.warn(`Failed to extract substantial content from ${url}`);
          content = ''; // Return empty if extraction failed
      }


      return content;
    } catch (error) {
      console.error(`Error fetching article content from ${url}: ${error.message}`, error.stack); // Log stack trace on error
       if (browser) {
        try { await browser.close(); } catch (closeError) { console.error("Error closing browser:", closeError); } // Ensure browser is closed even on error
      }
      // Optionally cache failure or empty result to prevent retries
      // requestCache.set(url, ''); // Decide if you want to cache failures
      return ''; // Return empty string on error
    }
  }
}

/**
 * Press Release Scraper Module
 * Handles scraping of company press releases for collaboration information
 */
class PressReleaseScraperModule {
  constructor() {
    this.pressReleaseSources = [
      {
        name: 'PR Newswire',
        searchUrl: (query) => `https://www.prnewswire.com/search/news/?keyword=${encodeURIComponent(query)}&page=1&pagesize=100`, // Increase page size
        selector: 'a.news-release', // Main link is the container
        titleSelector: 'h3', // Title is inside h3 within the link
        dateSelector: '.meta .date', // Date is in a span within .meta
        linkSelector: null, // Link is the main element itself
        linkAttribute: 'href' // Get href from the main 'a' tag
      },
      {
        name: 'Business Wire',
        searchUrl: (query) => `https://www.businesswire.com/portal/site/home/search/?searchType=all&searchTerm=${encodeURIComponent(query)}&displayLang=en`,
        selector: 'ul.bw-news-list li', // List item contains the release info
        titleSelector: 'h3 a',
        dateSelector: 'time', // Time element holds the date
        linkSelector: 'h3 a',
        linkAttribute: 'href',
        linkPrefix: 'https://www.businesswire.com' // Links are relative
      },
      {
        name: 'GlobeNewswire',
        searchUrl: (query) => `https://www.globenewswire.com/search/keyword/${encodeURIComponent(query)}?page=1`,
        selector: 'div[data-autid="container-news-card"]', // Container for each result card
        titleSelector: 'a[data-autid="news-card-headline-link"]',
        dateSelector: 'span[data-autid="news-card-date"]',
        linkSelector: 'a[data-autid="news-card-headline-link"]',
        linkAttribute: 'href',
        linkPrefix: 'https://www.globenewswire.com' // Links are relative
      }
    ];
  }

  /**
   * Search press release sources for company collaborations
   * @param {string} targetCompany - Target company name
   * @param {string} competitor - Competitor company name
   * @returns {Promise<Array>} - Array of press releases
   */
  async searchAllPressReleaseSources(targetCompany, competitor) {
    console.log(`Searching press releases for ${targetCompany} and ${competitor}`);

    const searchPromises = this.pressReleaseSources.map(source =>
      this.searchPressReleaseSource(source, targetCompany, competitor)
    );

    const results = await Promise.allSettled(searchPromises);
    return results
      .filter(result => result.status === 'fulfilled')
      .flatMap(result => result.value);
  }

  /**
   * Search a specific press release source
   * @param {Object} source - Source configuration
   * @param {string} targetCompany - Target company name
   * @param {string} competitor - Competitor company name
   * @returns {Promise<Array>} - Press releases from this source
   */
  async searchPressReleaseSource(source, targetCompany, competitor) {
    let browser = null;
    try {
      // Create more specific queries for press releases
       const queries = [
        `"${targetCompany}" "${competitor}"`,
        `"${targetCompany}" AND "${competitor}" partnership`, // Use boolean operators if supported
        `"${targetCompany}" AND "${competitor}" collaboration`,
        `"${targetCompany}" AND "${competitor}" agreement`,
        `"${targetCompany}" AND "${competitor}" joint venture`
        // Maybe add queries focusing on one company first if results are sparse
      ];

      let releases = [];

      for (const query of queries) {
           browser = await puppeteer.launch({
              headless: true,
              args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });

            const page = await browser.newPage();
             await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.71 Safari/537.36'
             );

            // --- Add console logging from the page ---
            page.on('console', msg => {
              if (msg.type() === 'log') {
                 console.log(`PAGE LOG [${source.name}, "${query}"] :`, msg.text());
              }
            });
            // --- End console logging setup ---

             await page.setRequestInterception(true);
             page.on('request', (request) => {
              if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
                request.abort();
              } else {
                request.continue();
              }
            });


            // Navigate to search URL
            const url = source.searchUrl(query);
            console.log(`Searching ${source.name} for press releases with query: ${query} at URL: ${url}`);

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                // Optional: Add a small wait here
                // await page.waitForTimeout(2000);
            } catch (navError) {
                 console.error(`Navigation error for ${source.name} query "${query}": ${navError.message}`);
                 if (browser) { await browser.close(); browser = null; }
                 continue;
            }


            // Wait for content to load
            try {
              await page.waitForSelector(source.selector, { timeout: 15000 });
              console.log(`Selector "${source.selector}" found on ${source.name} for query: ${query}`);
            } catch (err) {
              console.log(`No results or selector "${source.selector}" not found on ${source.name} for query: ${query}. Error: ${err.message}`);
              if (browser) { await browser.close(); browser = null; }
              continue; // Try next query
            }

            // Extract press releases
            const sourceReleases = await page.evaluate((cfg) => {
              const results = [];
              const releaseElements = document.querySelectorAll(cfg.selector);

              console.log(`[Evaluate] Found ${releaseElements.length} elements matching selector "${cfg.selector}"`); // Log count inside evaluate


              releaseElements.forEach((release, index) => {
                const titleElement = cfg.titleSelector ? release.querySelector(cfg.titleSelector) : null;
                const dateElement = cfg.dateSelector ? release.querySelector(cfg.dateSelector) : null;
                // If linkSelector is null, use the main release element itself
                const linkElement = cfg.linkSelector ? release.querySelector(cfg.linkSelector) : release;

                const title = titleElement ? titleElement.textContent.trim() : (cfg.titleSelector ? '' : release.textContent.trim()); // Fallback title if no specific selector

                console.log(`[Evaluate] Processing release element ${index}:`);
                console.log(`[Evaluate]   Title element found: ${!!titleElement}`);
                console.log(`[Evaluate]   Link element found: ${!!linkElement}`);


                if (title && linkElement) {
                  let link = linkElement.getAttribute(cfg.linkAttribute);

                   console.log(`[Evaluate]   Title: "${title.substring(0, 50)}..."`);
                   console.log(`[Evaluate]   Raw Link: "${link}"`);

                  // Fix relative links
                  if (link && !link.startsWith('http') && cfg.linkPrefix) {
                     if (link.startsWith('//')) {
                        link = 'https:' + link;
                     } else if (link.startsWith('/')) {
                         try {
                            link = new URL(link, document.baseURI).href; // Use page's base URI
                         } catch(e) {
                             console.error(`[Evaluate] Error constructing URL from relative link "${link}" and base "${document.baseURI}": ${e.message}`);
                             link = null; // Invalidate link
                         }
                     }
                     // Handle cases where link is directly on the domain, e.g., PR Newswire uses full URLs
                  } else if (!link && linkElement.tagName === 'A') {
                      // If attribute fetch failed but element exists and has href, use it
                      link = linkElement.href;
                       console.log(`[Evaluate]   Used .href fallback for link: "${link}"`);
                  }

                   // Ensure we have a full URL if linkPrefix is defined and link is still relative
                  if (link && !link.startsWith('http') && cfg.linkPrefix) {
                      try {
                          link = new URL(link, cfg.linkPrefix).href;
                      } catch(e) {
                          console.error(`[Evaluate] Could not construct URL from link: ${link} and prefix: ${cfg.linkPrefix}`);
                          link = null; // Invalidate link if construction fails
                      }
                  }

                   console.log(`[Evaluate]   Processed Link: "${link}"`);


                  if(link) { // Only add if we successfully got a link
                    results.push({
                      title: title,
                      date: dateElement ? dateElement.textContent.trim() : '',
                      url: link,
                      source: cfg.name
                    });
                  } else {
                      console.warn(`[Evaluate] Skipping release element ${index} due to invalid or missing link.`);
                  }
                } else {
                     console.warn(`[Evaluate] Skipping release element ${index} due to missing title or link element.`);
                     // console.warn(`[Evaluate] Problematic element HTML: ${release.outerHTML.substring(0, 500)}...`);
                }
              });

              console.log(`[Evaluate] Finished processing elements. Extracted ${results.length} releases.`); // Log count extracted inside evaluate

              return results;
            }, source); // Pass source config

            console.log(`Puppeteer evaluated. Extracted ${sourceReleases.length} releases from ${source.name} for query "${query}" before filtering.`); // Log count after evaluate


            releases = [...releases, ...sourceReleases];
            await browser.close();
            browser = null;
            await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1500)); // Throttle
      } // End of query loop


      // Deduplicate based on URL
      const uniqueReleases = Array.from(new Map(releases.map(release => [release.url, release])).values());

       console.log(`Found ${uniqueReleases.length} unique releases before company filtering.`);


      // Filter results to only include those mentioning both companies (case-insensitive)
      const filteredReleases = uniqueReleases.filter(release => {
        const lowerTitle = (release.title || '').toLowerCase(); // Ensure title is string
         const isRelevant = lowerTitle.includes(targetCompany.toLowerCase()) &&
                            lowerTitle.includes(competitor.toLowerCase());
         // Log whether each unique release is kept or filtered out
         console.log(`Filtering release "${(release.title || '').substring(0, 50)}...": ${isRelevant ? 'KEEP' : 'FILTER'}`);
        return isRelevant;
      });

      console.log(`Found ${filteredReleases.length} relevant press releases from ${source.name} after company filtering.`);
      return filteredReleases;

    } catch (error) {
      console.error(`Error searching ${source.name}: ${error.message}`, error.stack);
       if (browser) {
        try { await browser.close(); } catch (closeError) { console.error("Error closing browser:", closeError); }
      }
      return [];
    }
  }

  /**
   * Fetch and extract content from a press release
   * @param {string} url - URL of the press release
   * @returns {Promise<string>} - Press release content
   */
  async fetchPressReleaseContent(url) {
    // Check cache first
    if (requestCache.has(url)) {
        console.log(`Cache hit for press release: ${url}`); // Changed to console.log
      return requestCache.get(url);
    }

    let browser = null;
    try {
      console.log(`Fetching press release content from: ${url}`); // Changed "Workspaceing" to "Fetching"

      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      const page = await browser.newPage();
       await page.setUserAgent(this.getRandomUserAgent()); // Use random agent
       await page.setRequestInterception(true);
        page.on('request', (request) => {
          if (['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
            request.abort();
          } else {
            request.continue();
          }
        });


      // Set timeout for page load
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); // Increased timeout

      // Common press release content selectors
      const contentSelectors = [
        '.release-body',
        '.news-release-body',
        '.bw-release-story',
        '.article-body',
        '.press-release-body',
        '.release-content',
        '#release-body', // Common IDs
        'div.xn-content', // GlobeNewswire specific?
        'article', // Generic article tag
        'main' // Generic main tag
      ];

      let content = '';

      for (const selector of contentSelectors) {
         try {
            const elementHandle = await page.$(selector);
            if (elementHandle) {
                // Prioritize common text-holding elements within the container
                content = await elementHandle.$$eval('p, h1, h2, h3, h4, h5, h6, li, span', elements => {
                     return elements.map(el => el.textContent.trim())
                                   .filter(text => text.length > 5) // Filter short text snippets
                                   .join(' '); // Join with space
                });

                 if (content && content.length > 150) { // Increased length check
                     console.log(`Extracted press release content using selector: ${selector}`);
                     break; // Stop after finding content
                 } else {
                     // Fallback to all text if specific element extraction failed/insufficient
                     const fallbackContent = await elementHandle.evaluate(el => el.textContent);
                      if (fallbackContent && fallbackContent.length > 150) { // Increased length check
                         content = fallbackContent;
                         console.log(`Extracted press release content using selector (container text fallback): ${selector}`);
                         break; // Stop after finding content
                     }
                 }
            }
        } catch (evalError) {
           console.warn(`Error evaluating selector ${selector} on ${url}: ${evalError.message}`);
           // Do not reset content, allow next selector to be tried
        }
      }

      // If no content was found with specific selectors, try extracting from main article/body tags
      if (!content || content.length < 150) { // Increased length check
          console.log(`Falling back to extracting text from common article/body elements for press release ${url}`);
           content = await page.evaluate(() => {
              const articleBody = document.querySelector('article, main, [role="main"], #main-content, .release-body, .news-release-body'); // Include common PR selectors
              if (articleBody) {
                   return Array.from(articleBody.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span'))
                                .map(el => el.textContent.trim())
                                .filter(text => text.length > 5)
                                .join(' ');
              } else {
                  // Final fallback: get all text from the body, excluding common non-content tags
                  const body = document.body;
                   if (body) {
                      const bodyClone = body.cloneNode(true);
                      bodyClone.querySelectorAll('script, style, nav, header, footer, aside, iframe, noscript').forEach(el => el.remove());

                      return Array.from(bodyClone.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, span'))
                                   .map(el => el.textContent.trim())
                                   .filter(text => text.length > 5)
                                   .join(' ');
                   }
              }
              return '';
          });
           if (content && content.length > 150) {
               console.log(`Extracted content using fallback method (Length: ${content.length})`);
           } else {
               console.warn(`Fallback extraction yielded insufficient content for press release ${url}`);
               content = '';
           }
      }


      await browser.close();
      browser = null;

      // Clean up the content
       content = content.replace(/&nbsp;/g, ' ')
                       .replace(/[\u200B-\u200D\uFEFF]/g, '')
                       .replace(/\s{2,}/g, ' ')
                       .replace(/(\r\n|\n|\r)/gm, ' ')
                       .replace(/[\u{0080}-\u{FFFF}]/gu, "")
                       .trim();

      // Cache the result
      if (content && content.length > 100) { // Adjusted minimum length for caching
          requestCache.set(url, content);
           console.log(`Cached content for press release: ${url} (Length: ${content.length})`); // Changed to console.log
      } else {
          console.warn(`Failed to extract substantial content from press release ${url}`);
          content = '';
      }


      return content;
    } catch (error) {
      console.error(`Error fetching press release content from ${url}: ${error.message}`, error.stack); // Log stack trace
       if (browser) {
        try { await browser.close(); } catch (closeError) { console.error("Error closing browser:", closeError); } // Ensure browser is closed
      }
      // requestCache.set(url, ''); // Cache failure
      return ''; // Return empty string on error
    }
  }
}

/**
 * Financial Filings Scraper Module
 * Handles scraping of SEC EDGAR and other financial filing databases
 */
class FinancialFilingsScraperModule {
  constructor() {
    this.secBaseUrl = 'https://www.sec.gov';
    // Using the newer JSON API for submissions is generally more reliable than scraping HTML
    this.secSubmissionsUrl = (cik) => `https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`;
    this.secFilingFileUrl = (cik, accessionNum, primaryDoc) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNum.replace(/-/g, '')}/${primaryDoc}`;

    // Fallback search URL if needed, but JSON API is preferred
    this.edgarSearchUrl = 'https://www.sec.gov/cgi-bin/browse-edgar';
  }

  /**
   * Search for financial filings mentioning company collaborations using the SEC JSON API
   * @param {string} targetCompany - Target company name (used for CIK lookup)
   * @param {string} competitor - Competitor company name (used for searching within filings)
   * @returns {Promise<Array>} - Array of relevant filings
   */
  async searchFinancialFilings(targetCompany, competitor) {
    console.log(`Searching SEC filings for ${targetCompany} collaborations involving ${competitor}`);

    try {
      // Get the CIK number for the target company
      const cik = await this.findCompanyCIK(targetCompany);

      if (!cik) {
        console.warn(`Could not find CIK for ${targetCompany}. Skipping SEC filing search.`);
        return [];
      }

      console.log(`Found CIK for ${targetCompany}: ${cik}`);

      // Fetch recent filings using the JSON API
      const filings = await this.getCompanyFilingsFromJSON(cik);

      // Analyze relevant filings for competitor mentions
      const relevantFilings = [];
      const collaborationIndicators = ['partner', 'agreement', 'collaboration', 'joint venture', 'alliance', 'strategic relationship', 'license agreement', 'co-develop'];

      // Limit the number of filings to analyze to avoid excessive requests
      const filingsToAnalyze = filings.slice(0, 25); // Analyze the 25 most recent relevant filings

      for (const filing of filingsToAnalyze) {
        console.log(`Analyzing ${filing.type} filing from ${filing.date} (Acc#: ${filing.accessionNumber})`);

        const content = await this.getFilingContentFromJSON(cik, filing.accessionNumber, filing.primaryDocument);

        if (!content || content.length < 100) {
           console.log(`Skipping filing ${filing.accessionNumber} due to missing or short content.`);
           continue;
        }

        // Check if competitor is mentioned in the filing (case-insensitive)
        const competitorLower = competitor.toLowerCase();
        if (content.toLowerCase().includes(competitorLower)) {
          console.log(`Found mention of ${competitor} in filing ${filing.accessionNumber}`);

          // Find the context of the mention
          const contextSnippets = this.findMentionContext(content, competitor);

          // Check if these mentions suggest a collaboration using keywords
          const isCollaboration = contextSnippets.some(snippet => {
            const snippetLower = snippet.toLowerCase();
            // Check if the snippet contains the competitor AND a collaboration keyword
            return snippetLower.includes(competitorLower) &&
                   collaborationIndicators.some(indicator => snippetLower.includes(indicator));
          });

          if (isCollaboration) {
            console.log(`Collaboration mention potentially found in filing ${filing.accessionNumber}`); // Fixed typo accessionNumber

            relevantFilings.push({
              targetCompany,
              competitor,
              documentType: filing.type,
              documentDate: filing.date,
              // Construct the public URL for viewing the filing index page
              url: `https://www.sec.gov/Archives/edgar/data/${cik}/${filing.accessionNumber.replace(/-/g, '')}/-index.htm`,
              // Direct link to the primary document might also be useful: filing.primaryDocumentUrl
              primaryDocumentUrl: filing.primaryDocumentUrl,
              snippets: contextSnippets.filter(snippet => { // Filter snippets for relevance
                 const snippetLower = snippet.toLowerCase();
                 return snippetLower.includes(competitorLower) &&
                        collaborationIndicators.some(indicator => snippetLower.includes(indicator));
              })
            });
          }
        }
         // Add a small delay between fetching/analyzing filings
         await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
      }

      console.log(`Found ${relevantFilings.length} potentially relevant SEC filings.`);
      return relevantFilings;

    } catch (error) {
      console.error(`Error searching financial filings: ${error.message}`, error.stack);
      return [];
    }
  }


  /**
   * Find the Central Index Key (CIK) for a company using SEC lookup (Puppeteer fallback)
   * @param {string} companyName - Company name to search for
   * @returns {Promise<string|null>} - CIK if found, null otherwise
   */
  async findCompanyCIK(companyName) {
     // Attempt to find CIK via SEC lookup first (more robust)
    const cik = await this.findCompanyCIKViaLookup(companyName);
    if (cik) return cik;

    // Fallback to scraping the search page if lookup fails
    console.warn(`CIK lookup failed for "${companyName}". Falling back to Puppeteer search.`);
    let browser = null;
    try {
      // Use the SEC's company lookup feature via browse-edgar
      const searchUrl = `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(companyName)}&owner=exclude&action=getcompany`;

      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });

      const page = await browser.newPage();
      await page.setUserAgent(this.getRandomUserAgent());
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Check if company was found directly or if it's a list of results
      let cikValue = null;

       // Try to find CIK directly on the company page
       cikValue = await page.evaluate(() => {
           const cikElement = document.querySelector('.companyInfo a[href*="CIK="]');
           if (cikElement) {
               const cikMatch = cikElement.href.match(/CIK=(\d+)/);
               return cikMatch ? cikMatch[1].padStart(10, '0') : null; // Pad CIK
           }
           return null;
       });


      if (!cikValue) {
           // If not found directly, check if it's a search results page
           cikValue = await page.evaluate((name) => {
               const resultsTable = document.querySelector('#seriesDiv table');
               if (!resultsTable) return null;
               const rows = resultsTable.querySelectorAll('tr');
               const nameLower = name.toLowerCase();
               for (let i = 1; i < rows.length; i++) { // Skip header row
                   const cells = rows[i].querySelectorAll('td');
                   if (cells.length >= 2) {
                       const cikLink = cells[0].querySelector('a');
                       const companyNameCell = cells[1].textContent.toLowerCase();
                       // Try to find an exact or very close match
                       if (cikLink && companyNameCell.includes(nameLower)) {
                           const cikMatch = cikLink.href.match(/CIK=(\d+)/);
                           if (cikMatch) return cikMatch[1].padStart(10, '0'); // Pad CIK
                       }
                   }
               }
               return null; // No suitable match found in results
           }, companyName);
      }


       // Check for the "No matching companies" message
      if (!cikValue) {
           // Note: :contains is a jQuery extension, might not work directly in page.evaluate.
           // Checking textContent of a likely container element is more reliable.
           const notFoundElement = await page.$('body'); // Check the body or a main content area
           const pageText = notFoundElement ? await notFoundElement.evaluate(el => el.textContent) : '';
           if (pageText.includes('No matching companies found')) {
               console.log(`No matching companies found for "${companyName}" via Puppeteer search.`);
               await browser.close();
               return null;
           }
           // If still no CIK and no "not found" message, log a warning
           console.warn(`Could not extract CIK for "${companyName}" from page ${searchUrl}, structure might have changed.`);
      }


      await browser.close();
      return cikValue; // Returns padded CIK or null

    } catch (error) {
      console.error(`Error finding CIK via Puppeteer for ${companyName}: ${error.message}`);
      if (browser) {
        await browser.close();
      }
      return null;
    }
  }

   /**
   * Find the Central Index Key (CIK) for a company using SEC's company ticker mapping
   * @param {string} companyNameOrTicker - Company name or ticker symbol
   * @returns {Promise<string|null>} - Padded CIK if found, null otherwise
   */
    async findCompanyCIKViaLookup(companyNameOrTicker) {
        const lookupUrl = 'https://www.sec.gov/files/company_tickers.json';
        const cacheKey = `sec_cik_lookup_${companyNameOrTicker}`;

        if (requestCache.has(cacheKey)) {
            return requestCache.get(cacheKey);
        }

        try {
            console.log(`Attempting CIK lookup for: ${companyNameOrTicker}`);
            const response = await axios.get(lookupUrl, {
                headers: { 'User-Agent': this.getRandomUserAgent() } // SEC requires User-Agent
            });

            const companies = response.data; // Data is directly the array/object
            const searchTerm = companyNameOrTicker.toLowerCase();
            let foundCik = null;

            // The data is an object where keys are indices, and values are company objects
            for (const key in companies) {
                const company = companies[key];
                const cikStr = company.cik_str.toString().padStart(10, '0');
                const titleLower = company.title.toLowerCase();
                const tickerLower = company.ticker.toLowerCase();

                // Match by ticker (exact match)
                if (tickerLower === searchTerm) {
                    console.log(`CIK found via ticker match: ${cikStr} for ${company.title}`);
                    foundCik = cikStr;
                    break;
                }

                // Match by title (exact or close match)
                if (titleLower === searchTerm || titleLower.includes(searchTerm)) {
                    // Prioritize exact match or matches starting with the term
                     if (titleLower === searchTerm || titleLower.startsWith(searchTerm)) {
                          console.log(`CIK found via title match: ${cikStr} for ${company.title}`);
                          foundCik = cikStr;
                          break; // Take the first good match
                     }
                     // Keep track of partial matches if no exact match is found yet
                     if (!foundCik) {
                         console.log(`Potential partial CIK match: ${cikStr} for ${company.title}`);
                         foundCik = cikStr; // Store potential match
                     }

                }
            }

            if (foundCik) {
                requestCache.set(cacheKey, foundCik);
                return foundCik;
            } else {
                console.log(`CIK not found for ${companyNameOrTicker} in SEC lookup data.`);
                requestCache.set(cacheKey, null); // Cache miss
                return null;
            }

        } catch (error) {
            console.error(`Error fetching or processing SEC CIK lookup data: ${error.message}`);
            if (error.response) {
                console.error(`SEC API Response Status: ${error.response.status}`);
            }
            requestCache.set(cacheKey, null); // Cache failure
            return null;
        }
    }


  /**
   * Get recent important filings for a company by CIK using the SEC JSON API
   * @param {string} cik - Company CIK number (should be 10 digits, zero-padded)
   * @returns {Promise<Array>} - Array of filing objects
   */
  async getCompanyFilingsFromJSON(cik) {
    const url = this.secSubmissionsUrl(cik);
    const cacheKey = `sec_filings_${cik}`;

    if (requestCache.has(cacheKey)) {
        console.log(`Cache hit for SEC filings for CIK: ${cik}`); // Changed to console.log
        return requestCache.get(cacheKey);
    }

    try {
      console.log(`Fetching recent filings for CIK ${cik} from ${url}`); // Changed "Workspaceing" to "Fetching"
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'YourAppName/1.0 YourContactEmail@example.com', // SEC requests a descriptive User-Agent
          'Accept-Encoding': 'gzip, deflate'
        },
        timeout: 30000 // 30 second timeout
      });

      const data = response.data;
      if (!data || !data.filings || !data.filings.recent) {
        console.warn(`No recent filings found or unexpected format for CIK ${cik}`);
        requestCache.set(cacheKey, []);
        return [];
      }

      const recentFilings = data.filings.recent;
      const filings = [];

      // Extract relevant info for desired filing types
      const desiredTypes = ['10-K', '10-Q', '8-K'];
      const accessionNumbers = recentFilings.accessionNumber || [];

      for (let i = 0; i < accessionNumbers.length; i++) {
        const filingType = recentFilings.form[i];
        if (desiredTypes.includes(filingType)) {
             const filingDate = recentFilings.filingDate[i];
             const reportDate = recentFilings.reportDate[i]; // Date event relates to (esp. for 8-K)
             const accNum = accessionNumbers[i];
             const primaryDoc = recentFilings.primaryDocument[i];
             const primaryDocDesc = recentFilings.primaryDocDescription[i];

             // Filter out non-HTML primary documents if necessary, though content fetching handles it
             if (primaryDoc && primaryDoc.toLowerCase().endsWith('.htm') || primaryDoc.toLowerCase().endsWith('.html')) {
                 filings.push({
                    type: filingType,
                    date: filingDate,
                    reportDate: reportDate,
                    accessionNumber: accNum,
                    primaryDocument: primaryDoc,
                    primaryDocumentDescription: primaryDocDesc,
                    // Construct the URL to fetch the actual document later
                    primaryDocumentUrl: this.secFilingFileUrl(cik, accNum, primaryDoc)
                 });
             } else {
                 console.log(`Skipping non-HTML primary document: ${primaryDoc} for filing ${accNum}`);
             }

        }
      }

      // Filter for recent filings (e.g., last 2 years) - API might return older ones too
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

      const recentFilteredFilings = filings.filter(filing => {
        try {
            const filingDate = new Date(filing.date);
            return !isNaN(filingDate) && filingDate >= twoYearsAgo;
        } catch (dateError) {
            console.warn(`Could not parse filing date: ${filing.date}`);
            return false;
        }
      });

       console.log(`Found ${recentFilteredFilings.length} relevant filings (10-K, 10-Q, 8-K) within the last 2 years for CIK ${cik}`);
      requestCache.set(cacheKey, recentFilteredFilings); // Cache the filtered results
      return recentFilteredFilings;

    } catch (error) {
      console.error(`Error getting company filings from SEC JSON API for CIK ${cik}: ${error.message}`);
       if (error.response) {
           console.error(`SEC API Response Status: ${error.response.status}`);
           console.error(`SEC API Response Data: ${JSON.stringify(error.response.data)}`);
       }
      requestCache.set(cacheKey, []); // Cache failure indication
      return [];
    }
  }

  /**
   * Get the content of a specific filing document using its direct URL from JSON API
   * @param {string} cik - Company CIK
   * @param {string} accessionNumber - Filing accession number
   * @param {string} primaryDocument - Filename of the primary document (e.g., d123456.htm)
   * @returns {Promise<string>} - Filing content (HTML source or extracted text)
   */
   async getFilingContentFromJSON(cik, accessionNumber, primaryDocument) {
      const filingUrl = this.secFilingFileUrl(cik, accessionNumber, primaryDocument);
      const cacheKey = `sec_content_${accessionNumber}`;

      if (requestCache.has(cacheKey)) {
          console.log(`Cache hit for SEC content: ${accessionNumber}`); // Changed to console.log
          return requestCache.get(cacheKey);
      }

      // SEC often redirects or requires specific headers, use Axios first
      try {
          console.log(`Fetching filing content from: ${filingUrl}`); // Changed "Workspaceing" to "Fetching"
          const response = await axios.get(filingUrl, {
              headers: {
                  'User-Agent': 'YourAppName/1.0 YourContactEmail@example.com',
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                   'Accept-Encoding': 'gzip, deflate'
              },
              timeout: 45000 // 45 sec timeout for potentially large filings
          });

          let content = response.data; // This should be the HTML source

           // Basic cleaning - remove script/style tags and excessive whitespace from HTML source
          if (typeof content === 'string') {
              // Use Cheerio for more robust text extraction from the HTML
              const $ = cheerio.load(content);

              // Remove script, style, nav, header, footer, etc. before extracting text
              $('script, style, nav, header, footer, aside, iframe, noscript').remove();

              // Extract text from the body, attempting to preserve some structure
              let extractedText = $('body').text();

              if (!extractedText) {
                  // Fallback if body tag is missing or empty, extract from the whole document
                  extractedText = $.text();
              }

              // Further cleaning of extracted text
              const cleanedContent = extractedText
                  .replace(/&nbsp;/g, ' ')
                  .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width spaces and BOM
                  .replace(/\s{2,}/g, ' ') // Replace multiple spaces with a single space
                  .replace(/(\r\n|\n|\r)/gm, ' ') // Replace various line breaks with spaces
                  .replace(/[\u{0080}-\u{FFFF}]/gu, "") // Remove non-basic characters
                  .trim();


              if (cleanedContent.length > 150) { // Check if substantial content was extracted (increased length check)
                  console.log(`Successfully extracted text content for ${accessionNumber} (Length: ${cleanedContent.length})`);
                  requestCache.set(cacheKey, cleanedContent);
                  return cleanedContent;
              } else {
                  console.warn(`Extracted very short content for ${accessionNumber}. Content might be non-standard HTML or empty.`);
                   // Cache the short/empty content to avoid retrying
                   requestCache.set(cacheKey, cleanedContent);
                   return cleanedContent;
              }

          } else {
              console.warn(`Received non-string response for filing content ${accessionNumber}`);
              requestCache.set(cacheKey, '');
              return '';
          }

      } catch (error) {
          console.error(`Error fetching filing content using Axios for ${accessionNumber} from ${filingUrl}: ${error.message}`);
           if (error.response) {
              console.error(`Status: ${error.response.status}`);
           }
           // Optional: Fallback to Puppeteer if Axios fails? Might be overkill.
           // console.log(`Attempting Puppeteer fallback for ${filingUrl}`);
           // const puppeteerContent = await this.getFilingContentViaPuppeteer(filingUrl); // Need to implement this helper
           // requestCache.set(cacheKey, puppeteerContent);
           // return puppeteerContent;

           requestCache.set(cacheKey, ''); // Cache failure
          return '';
      }
  }

    /**
     * [Optional] Helper to fetch SEC filing content using Puppeteer as a fallback
     * @param {string} filingDocUrl - Direct URL to the .htm filing document
     * @returns {Promise<string>} - Extracted text content
     */
    async getFilingContentViaPuppeteer(filingDocUrl) {
        let browser = null;
        try {
            console.log(`Puppeteer Fallback: Fetching ${filingDocUrl}`);
            browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            const page = await browser.newPage();
            await page.goto(filingDocUrl, { waitUntil: 'networkidle0', timeout: 60000 });

            const content = await page.evaluate(() => {
                // Remove script/style elements first
                document.querySelectorAll('script, style, noscript, iframe, header, footer, nav, aside').forEach(el => el.remove());
                // Extract text primarily from body, fallback to documentElement
                return (document.body || document.documentElement).innerText;
            });

            await browser.close();

            const cleanedContent = content.replace(/\s+/g, ' ').trim();
            console.log(`Puppeteer extracted content length: ${cleanedContent.length}`);
            return cleanedContent;

        } catch (puppeteerError) {
            console.error(`Puppeteer fallback failed for ${filingDocUrl}: ${puppeteerError.message}`);
            if (browser) {
                await browser.close();
            }
            return '';
        }
    }


  /**
   * Find context around mentions of a company name in text
   * @param {string} text - Full text to search in
   * @param {string} companyName - Company name to find
   * @returns {Array<string>} - Array of context snippets
   */
  findMentionContext(text, companyName) {
    const snippets = [];
    // Escape special regex characters in company name and ensure word boundaries
    const escapedCompanyName = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const companyRegex = new RegExp(`\\b${escapedCompanyName}\\b`, 'gi'); // Case-insensitive, global
    const contextWindow = 200; // Characters before and after the mention

    let match;
    while ((match = companyRegex.exec(text)) !== null) {
      const matchStartIndex = match.index;
      const matchEndIndex = matchStartIndex + match[0].length; // Use length of the actual match

      const startPos = Math.max(0, matchStartIndex - contextWindow);
      const endPos = Math.min(text.length, matchEndIndex + contextWindow);

      let snippet = text.substring(startPos, endPos).trim();

      // Add ellipses if we cut off text
      if (startPos > 0) snippet = '...' + snippet;
      if (endPos < text.length) snippet += '...';

      // Highlight the matched company name within the snippet (optional)
      // snippet = snippet.replace(match[0], `**${match[0]**`); // Example using markdown bold

      snippets.push(snippet);

       // Prevent infinite loops with zero-length matches (shouldn't happen with \b)
       if (match[0].length === 0) {
          companyRegex.lastIndex++;
       }
    }

    // Deduplicate snippets if necessary (though context usually makes them unique)
    return Array.from(new Set(snippets));
  }
}

/**
 * Social Media Scraper Module
 * Handles scraping of social media for company collaboration mentions
 * NOTE: Social media scraping is highly volatile and prone to breaking due to site changes,
 * login requirements, and anti-scraping measures. Using official APIs is strongly recommended.
 * This implementation uses Puppeteer and may require frequent updates.
 */
// class SocialMediaScraperModule {
//   constructor() {
//     this.socialMediaPlatforms = [
//       {
//         name: 'X (Twitter)', // Renamed
//         // Using nitter instance as direct Twitter scraping is extremely difficult/blocked
//         // Find a reliable public Nitter instance or host your own. This is an example.
//         searchUrl: (query) => `https://nitter.net/search?f=tweets&q=${encodeURIComponent(query)}`, // Example Nitter instance
//         selector: '.timeline-item', // Nitter selector for a tweet container
//         textSelector: '.tweet-content', // Nitter selector for tweet text
//         userSelector: '.fullname', // Nitter selector for username
//         dateSelector: '.tweet-date a', // Nitter selector for date link
//         linkSelector: '.tweet-date a', // Nitter selector for tweet permalink
//         linkAttribute: 'href',
//         linkPrefix: 'https://nitter.net' // Nitter links are relative to the instance
//       },
//       // LinkedIn scraping is generally not feasible without logging in or using the API.
//       // The previous selectors are unlikely to work reliably without authentication.
//       // This section is commented out as it's highly likely to fail.
//       /*
//       {
//          name: 'LinkedIn',
//          // LinkedIn search requires login and structure changes often.
//          // This URL likely won't work without authentication cookies.
//          searchUrl: (query) => `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}&origin=GLOBAL_SEARCH_HEADER`,
//          selector: '.reusable-search__result-container', // Example selector, likely outdated
//          textSelector: '.feed-shared-update-v2__description-wrapper', // Example selector
//          userSelector: '.update-components-actor__name', // Example selector
//          dateSelector: '.update-components-text-view', // Example selector (often relative time)
//          linkSelector: '.update-components-actor__meta-link', // Example selector
//          linkAttribute: 'href',
//          linkPrefix: 'https://www.linkedin.com'
//       }
//       */
//     ];
//   }

//    /**
//     * Helper function to scroll down the page in Puppeteer
//     * @param {puppeteer.Page} page - The Puppeteer page instance
//     * @param {number} maxScrolls - Maximum number of scrolls to prevent infinite loops
//     */
//     async autoScroll(page, maxScrolls = 5) {
//         await page.evaluate(async (max) => {
//             await new Promise((resolve) => {
//                 let totalHeight = 0;
//                 const distance = 1000; // Scroll distance per interval
//                 let scrolls = 0; // Scroll counter
//                 const timer = setInterval(() => {
//                     const scrollHeight = document.body.scrollHeight;
//                     window.scrollBy(0, distance);
//                     totalHeight += distance;
//                     scrolls++;

//                     // Stop scrolling if reached the bottom, timeout, or max scrolls
//                     if (totalHeight >= scrollHeight - window.innerHeight || scrolls >= max) {
//                         clearInterval(timer);
//                         resolve();
//                     }
//                 }, 300); // Interval between scrolls
//             });
//         }, maxScrolls); // Pass maxScrolls to the browser context
//     }

//   /**
//    * Search social media platforms for company collaborations
//    * @param {string} targetCompany - Target company name
//    * @param {string} competitor - Competitor company name
//    * @returns {Promise<Array>} - Array of social media posts
//    */
//   async searchSocialMedia(targetCompany, competitor) {
//     console.log(`Searching social media for ${targetCompany} and ${competitor}`);
//     console.warn("Social media scraping is unreliable. Expect potential failures or incomplete results.");

//     const searchPromises = this.socialMediaPlatforms.map(platform =>
//       this.searchPlatform(platform, targetCompany, competitor)
//     );

//     const results = await Promise.allSettled(searchPromises);
//     return results
//       .filter(result => result.status === 'fulfilled')
//       .flatMap(result => result.value);
//   }

//   /**
//    * Search a specific social media platform
//    * @param {Object} platform - Platform configuration
//    * @param {string} targetCompany - Target company name
//    * @param {string} competitor - Competitor company name
//    * @returns {Promise<Array>} - Social media posts from this platform
//    */
//   async searchPlatform(platform, targetCompany, competitor) {
//     let browser = null;
//     try {
//        // More focused social media queries
//        const searchQueries = [
//          `"${targetCompany}" "${competitor}" partnership`,
//          `"${targetCompany}" "${competitor}" collaboration`,
//          `"${targetCompany}" AND "${competitor}"`, // Use AND for platforms supporting it
//          `#${targetCompany} #${competitor}`, // Hashtags
//          `from:${targetCompany} ${competitor}`, // Tweets from target mentioning competitor (platform specific syntax)
//          `from:${competitor} ${targetCompany}` // Tweets from competitor mentioning target
//        ];

//       let posts = [];

//       for (const query of searchQueries) {
//         // Skip LinkedIn if commented out or add specific handling if attempting
//         if (platform.name === 'LinkedIn' && !platform.selector) continue;

//         browser = await puppeteer.launch({
//           headless: true, // Headless might be detected, 'new' or false might be needed sometimes
//           args: [
//               '--no-sandbox',
//               '--disable-setuid-sandbox',
//               '--disable-dev-shm-usage',
//               '--disable-accelerated-2d-canvas',
//               '--no-zygote',
//               '--disable-gpu'
//           ]
//         });

//         const page = await browser.newPage();

//         // Set a realistic user agent
//         await page.setUserAgent(
//            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
//         );
//          // Set viewport
//          await page.setViewport({ width: 1280, height: 800 });

//          // Add stealth plugin to make Puppeteer less detectable (requires npm install puppeteer-extra puppeteer-extra-plugin-stealth)
//          // const puppeteer = require('puppeteer-extra');
//          // const StealthPlugin = require('puppeteer-extra-plugin-stealth');
//          // puppeteer.use(StealthPlugin());
//          // browser = await puppeteer.launch({...}); // Use puppeteer-extra launch

//         // --- Add console logging from the page ---
//         page.on('console', msg => {
//           if (msg.type() === 'log') {
//              console.log(`PAGE LOG [${platform.name}, "${query}"] :`, msg.text());
//           }
//         });
//         // --- End console logging setup ---


//         // Navigate to search URL
//         const url = platform.searchUrl(query);
//         console.log(`Searching ${platform.name} with query: ${query} at URL: ${url}`);

//         try {
//              await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // Wait longer for dynamic content
//         } catch(navError) {
//             console.error(`Navigation error for ${platform.name} query "${query}": ${navError.message}`);
//             await browser.close();
//             browser = null;
//             continue; // Try next query
//         }


//         // Social media sites often require scrolling to load content
//         console.log(`Scrolling ${platform.name} page...`);
//         await this.autoScroll(page, 5); // Scroll down a few times
//         await page.waitForTimeout(2000); // Wait a bit after scrolling

//         // Wait for content selector to appear
//         try {
//           await page.waitForSelector(platform.selector, { timeout: 20000 }); // Increased timeout
//            console.log(`Selector "${platform.selector}" found on ${platform.name} for query: ${query}`);
//         } catch (err) {
//           // This is the continuation of the catch block from the user's code
//           console.log(`No results or selector "${platform.selector}" not found on ${platform.name} for query: ${query}. Error: ${err.message}`);
//            // Check for common blocking/login elements (example for Twitter/X login wall)
//            const loginWall = await page.$('a[href="/login"]'); // Example selector
//            if (loginWall) {
//                console.warn(`Possible login wall detected on ${platform.name}. Scraping blocked.`);
//            }
//           await browser.close();
//           browser = null; // Reset browser variable
//           continue; // Continue to the next query
//         }

//         // Extract posts
//         const platformPosts = await page.evaluate((cfg) => {
//           const results = [];
//           const postElements = document.querySelectorAll(cfg.selector);

//            console.log(`[Evaluate] Found ${postElements.length} elements matching selector "${cfg.selector}"`); // Log count inside evaluate

//           postElements.forEach((post, index) => {
//             const textElement = post.querySelector(cfg.textSelector);
//             const userElement = post.querySelector(cfg.userSelector);
//             const dateElement = post.querySelector(cfg.dateSelector);
//             const linkElement = post.querySelector(cfg.linkSelector);

//              console.log(`[Evaluate] Processing post element ${index}:`);
//              console.log(`[Evaluate]   Text element found: ${!!textElement}`);
//              console.log(`[Evaluate]   Link element found: ${!!linkElement}`);


//             if (textElement) { // Require text content at minimum
//                let link = linkElement ? linkElement.getAttribute(cfg.linkAttribute) : null;
//                const text = textElement.textContent.trim();
//                const user = userElement ? userElement.textContent.trim() : 'Unknown User';
//                const date = dateElement ? (dateElement.getAttribute('title') || dateElement.textContent.trim()) : '';

//                 console.log(`[Evaluate]   Text: "${text.substring(0, 50)}..."`);
//                 console.log(`[Evaluate]   Raw Link: "${link}"`);


//                 // Fix relative links for the platform (e.g., Nitter)
//                 if (link && !link.startsWith('http') && cfg.linkPrefix) {
//                     try {
//                          // Nitter links might already be absolute relative to the instance
//                          if (link.startsWith('/')) {
//                             link = new URL(link, cfg.linkPrefix).href;
//                          } else {
//                              // Assume it's relative to the current page path - less common for tweet links
//                              link = new URL(link, document.baseURI).href;
//                          }

//                     } catch (e) {
//                          console.error(`[Evaluate] Could not construct URL for link ${link} on ${cfg.name}: ${e.message}`);
//                          link = '#'; // Default to hash if construction fails
//                     }

//                 } else if (!link && linkElement && linkElement.href) {
//                     // If attribute fetch failed but element exists and has href, use it
//                     link = linkElement.href;
//                      console.log(`[Evaluate]   Used .href fallback for link: "${link}"`);
//                 }

//                  console.log(`[Evaluate]   Processed Link: "${link}"`);


//               results.push({
//                 text: text,
//                 user: user,
//                 date: date,
//                 url: link || '#', // Provide a fallback URL
//                 source: cfg.name
//               });
//             } else {
//                  console.warn(`[Evaluate] Skipping post element ${index} due to missing text element.`);
//                  // console.warn(`[Evaluate] Problematic element HTML: ${post.outerHTML.substring(0, 500)}...`);
//             }
//           });

//            console.log(`[Evaluate] Finished processing elements. Extracted ${results.length} posts.`); // Log count extracted inside evaluate

//           return results;
//         }, platform); // Pass platform config

//         console.log(`Puppeteer evaluated. Extracted ${platformPosts.length} posts from ${platform.name} for query "${query}" before filtering.`); // Log count after evaluate


//         posts = [...posts, ...platformPosts];
//         await browser.close();
//         browser = null;

//         // Throttle requests heavily for social media
//         await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 3000));
//       } // End of query loop

//        // Deduplicate posts based on text content or URL if available
//        // Use URL for deduplication if available and not '#', otherwise use text
//        const uniquePosts = Array.from(new Map(posts.map(post => [post.url && post.url !== '#' ? post.url : post.text, post])).values());


//        console.log(`Found ${uniquePosts.length} unique posts before company filtering.`);


//       // Filter results for relevance (mentioning both companies)
//       const filteredPosts = uniquePosts.filter(post => {
//           const lowerText = (post.text || '').toLowerCase(); // Ensure text is string
//           const isRelevant = lowerText.includes(targetCompany.toLowerCase()) &&
//                              lowerText.includes(competitor.toLowerCase());
//           // Log whether each unique post is kept or filtered out
//           console.log(`Filtering post "${(post.text || '').substring(0, 50)}...": ${isRelevant ? 'KEEP' : 'FILTER'}`);
//           return isRelevant;
//       });

//       console.log(`Found ${filteredPosts.length} potentially relevant posts from ${platform.name} after company filtering.`);
//       return filteredPosts;

//     } catch (error) {
//       console.error(`Error searching ${platform.name}: ${error.message}`, error.stack);
//        if (browser) {
//         try { await browser.close(); } catch (closeError) { console.error("Error closing browser:", closeError); }
//       }
//       return []; // Return empty array on error
//     }
//   } // End of searchPlatform method
// } // End of SocialMediaScraperModule class

// Export the modules for use in other files
module.exports = {
  NewsScraperModule,
  PressReleaseScraperModule,
  FinancialFilingsScraperModule,
//   SocialMediaScraperModule
};
