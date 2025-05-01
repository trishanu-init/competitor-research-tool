const xml2js = require('xml2js');
const unirest = require('unirest');
const cheerio = require('cheerio');

// Cache mechanism
const requestCache = new Map(); 

//news from google news search
class NewsScraperModule {
  constructor() {
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.54 Safari/537.36' // Added a common user agent
    ];

    
    this.newsSources = [{
      name: 'Google News Search', 
      searchUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}&gl=us&tbm=nws`,
      selector: '.SoaBEf',
      titleSelector: 'div.n0jPhd',
      snippetSelector: '.GI74Re', 
      dateSelector: '.OSrXXb span',
      linkSelector: 'a',
      linkAttribute: 'href',
      linkPrefix: 'https://www.google.com'
    }, {
      name: 'Yahoo Finance Search', 
      searchUrl: (query) => `https://finance.yahoo.com/news/search?p=${encodeURIComponent(query)}`, // Adjusted search URL
      selector: 'li.js-stream-content', 
      titleSelector: 'h3', 
      snippetSelector: 'p', 
      dateSelector: 'span[data-test="ContentMetaAttribute-timestamp"]', 
      linkSelector: 'h3 a', 
      linkAttribute: 'href',
      linkPrefix: 'https://finance.yahoo.com'
    },
    
    {
      name: 'MarketWatch',
      searchUrl: (query) => `https://www.marketwatch.com/search?q=${encodeURIComponent(query)}&tab=All%20News`,
      selector: '.searchresult',
      titleSelector: '.article__headline a',
      snippetSelector: '.article__summary',
      dateSelector: '.article__timestamp',
      linkSelector: '.article__headline a',
      linkAttribute: 'href',
      linkPrefix: ''
    }
    ];
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  /**
   * Search news sources for company collaborations (web scraping only)
   * @param {string} targetCompany - Target company name
   * @param {string} competitor - Competitor company name
   * @returns {Promise<Array>} - Array of news articles with titles, links, and snippets
   */
  async searchAllNewsSources(targetCompany, competitor) {
    console.log(`Searching news sources (web) for ${targetCompany} and ${competitor}`);

    const searchPromises = this.newsSources.map(source => {
      if (source.name === 'Google News Search' || source.name === 'Yahoo Finance Search') {
        return this.searchNewsSourceUnirest(source, targetCompany, competitor);
      } else {
        console.warn(`Skipping unsupported news source for unirest: ${source.name}`);
        return Promise.resolve([]);
      }
    });

    const results = await Promise.allSettled(searchPromises);
    return results
      .filter(result => result.status === 'fulfilled')
      .flatMap(result => result.value);
  }

  /**
   * Search a specific news source using unirest and cheerio (web scraping)
   * @param {Object} source - Source configuration
   * @param {string} targetCompany - Target company name
   * @param {string} competitor - Competitor company name
   * @returns {Promise<Array>} - News articles from this source with titles, links, and snippets
   */
  async searchNewsSourceUnirest(source, targetCompany, competitor) {
    try {
      const searchQueries = [
        `"${targetCompany}" "${competitor}"`, // Exact match
        `"${targetCompany}" "${competitor}" partnership`,
        `"${targetCompany}" "${competitor}" collaboration`,
        `"${targetCompany}" "${competitor}" joint venture`,
        `"${targetCompany}" "${competitor}" agreement`
      ];

      let articles = [];

      for (const query of searchQueries) {
        const url = source.searchUrl(query);
        console.log(`Searching ${source.name} with query: "${query}" at URL: ${url}`);

        try {
          const response = await unirest
            .get(url)
            .headers({
              "User-Agent": this.getRandomUserAgent(),
            });

          if (response.error) {
            console.error(`Error fetching ${source.name} for query "${query}": ${response.error}`);
            continue;
          }

          const $ = cheerio.load(response.body);
          let news_results = [];

          $(source.selector).each((i, el) => {
            const linkElement = $(el).find(source.linkSelector);
            const titleElement = $(el).find(source.titleSelector);
            const snippetElement = $(el).find(source.snippetSelector);
            const dateElement = $(el).find(source.dateSelector);

            const link = linkElement.attr(source.linkAttribute);
            const title = titleElement.text().trim();
            const snippet = snippetElement ? snippetElement.text().trim() : '';
            const dateText = dateElement ? dateElement.text().trim() : '';

            if (title && link) {
              let fullLink = link;
              if (link.startsWith('/url?q=') && source.name === 'Google News Search') {
                try {
                  const urlParams = new URLSearchParams(link.split('?')[1]);
                  fullLink = urlParams.get('q');
                  if (fullLink) {
                    fullLink = decodeURIComponent(fullLink);
                  }
                } catch (e) {
                  console.error(`Error parsing Google redirect URL ${link}: ${e.message}`);
                  fullLink = null;
                }
              } else if (link.startsWith('/') && source.linkPrefix) {
                try {
                  fullLink = new URL(link, source.linkPrefix).href;
                } catch (e) {
                  console.error(`Error constructing URL from relative link ${link} and prefix ${source.linkPrefix}: ${e.message}`);
                  fullLink = null;
                }
              } else if (!link.startsWith('http') && source.linkPrefix) {
                try {
                  fullLink = new URL(link, source.linkPrefix).href;
                } catch (e) {
                  console.error(`Error constructing URL from link ${link} and prefix ${source.linkPrefix}: ${e.message}`);
                  fullLink = null;
                }
              }


              if (fullLink) {
                news_results.push({
                  title: title,
                  link: fullLink,
                  snippet: snippet,
                  date: dateText,
                  source: source.name
                });
              } else {
                console.warn(`Skipping result due to invalid or unparseable link: ${link}`);
              }
            } else {
              console.warn(`Skipping result due to missing title or link for element index: ${i}`);
            }
          });

          articles = [...articles, ...news_results];

          await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));

        } catch (fetchError) {
          console.error(`HTTP request error for ${source.name} query "${query}": ${fetchError.message}`);
        }
      }

      const uniqueArticles = Array.from(new Map(articles.map(article => [article.link, article])).values());

      console.log(`Found ${uniqueArticles.length} unique articles from ${source.name} before filtering.`);

      const filteredArticles = uniqueArticles.filter(article => {
        const textToCheck = `${(article.title || '')} ${(article.snippet || '')}`.toLowerCase();
        const isRelevant = textToCheck.includes(targetCompany.toLowerCase()) &&
          textToCheck.includes(competitor.toLowerCase());
        return isRelevant;
      });

      console.log(`Found ${filteredArticles.length} relevant articles from ${source.name} after company filtering.`);
      return filteredArticles;

    } catch (error) {
      console.error(`Error searching ${source.name} with unirest: ${error.message}`, error.stack);
      return [];
    }
  }
}
// yahoo finance scraper module
class YahooFinanceScraperModule {
  constructor() {
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.54 Safari/537.36' // Added a common user agent
    ];
    this.rssUrl = 'http://finance.yahoo.com/rss/topstories';
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  /**
   * Fetch news from the Yahoo Finance RSS feed and apply filtering
   * @param {string} targetCompany - Target company name for filtering
   * @param {string} competitor - Competitor company name for filtering
   * @returns {Promise<Array>} - Array of filtered news articles from the RSS feed
   */
  async fetchNews(targetCompany, competitor) {
    console.log(`Workspaceing news from Yahoo Finance RSS feed: ${this.rssUrl}`);
    try {
      const response = await unirest
        .get(this.rssUrl)
        .headers({
          "User-Agent": this.getRandomUserAgent(),
          "Accept": "application/xml, text/xml" 
        });

      if (response.error) {
        console.error(`Error fetching Yahoo Finance RSS feed ${this.rssUrl}: ${response.error}`);
        return [];
      }

      const xmlContent = response.body;

      const parser = new xml2js.Parser();
      let result = await parser.parseStringPromise(xmlContent);

      const newsItems = result.rss.channel[0].item;

      const extractedNews = newsItems.map(item => {
        const title = item.title ? item.title[0] : 'No Title';
        const link = item.link ? item.link[0] : '#';
        const pubDate = item.pubDate ? item.pubDate[0] : '';
        const source = item.source ? item.source[0]._ : 'Yahoo Finance'; // Use source tag if available


        return {
          title: title,
          link: link,
          date: pubDate,
          source: source,
          snippet: ''
        };
      });

      console.log(`Found ${extractedNews.length} articles from Yahoo Finance RSS feed before filtering.`);

      
      const filteredNews = extractedNews.filter(article => {
        
        const textToCheck = (article.title || '').toLowerCase();
        const isRelevant = textToCheck.includes(targetCompany.toLowerCase()) &&
          textToCheck.includes(competitor.toLowerCase());
        return isRelevant;
      });


      console.log(`Found ${filteredNews.length} relevant articles from Yahoo Finance RSS feed after filtering.`);
      return filteredNews;

    } catch (error) {
      console.error(`Error processing Yahoo Finance RSS feed ${this.rssUrl}: ${error.message}`, error.stack);
      return [];
    }
  }
}

class GoogleRSSNews {
    constructor() {
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.54 Safari/537.36' // Added a common user agent
        ];
    }

    // random user agent to rotate for requests
    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    /**
     * Fetch news from a Google News RSS feed and apply filtering
     * @param {string} rssUrl - URL of the Google News RSS feed (should be query-specific)
     * @param {string} targetCompany - Target company name for filtering
     * @param {string} competitor - Competitor company name for filtering
     * @returns {Promise<Array>} - Array of filtered news articles from the RSS feed
     */
    async fetchNews(rssUrl, targetCompany, competitor) {
        console.log(`Workspaceing news from Google News RSS feed: ${rssUrl}`);
        try {
            const response = await unirest
                .get(rssUrl)
                .headers({
                    "User-Agent": this.getRandomUserAgent(), // user rotation
                    "Accept": "application/xml, text/xml" // Request XML content
                });

            if (response.error) {
                console.error(`Error fetching Google News RSS feed ${rssUrl}: ${response.error}`);
                return [];
            }

            const xmlContent = response.body;

            const parser = new xml2js.Parser();
            let result = await parser.parseStringPromise(xmlContent);

            const newsItems = result.rss.channel[0].item;

            const extractedNews = newsItems.map(item => {
                // Based on the provided Google News RSS structure
                const title = item.title ? item.title[0] : 'No Title';
                const link = item.link ? item.link[0] : '#';
                const pubDate = item.pubDate ? item.pubDate[0] : '';
                
                let snippet = '';
                if (item.description && item.description[0]) {
                    const $ = cheerio.load(item.description[0]);
                    snippet = $('body').text().trim().replace(/\s{2,}/g, ' ');
                }

                return {
                    title: title,
                    link: link,
                    date: pubDate,
                    snippet: snippet,
                    source: item.source ? item.source[0]._ : 'Google News RSS'
                };
            });

            console.log(`Found ${extractedNews.length} articles from Google News RSS feed before filtering.`);

            // apply filtering
            const filteredNews = extractedNews.filter(article => {
                const textToCheck = `${(article.title || '')} ${(article.snippet || '')}`.toLowerCase();
                const isRelevant = textToCheck.includes(targetCompany.toLowerCase()) &&
                                   textToCheck.includes(competitor.toLowerCase());
                return isRelevant;
            });

            console.log(`Found ${filteredNews.length} relevant articles from Google News RSS feed after filtering.`);
            return filteredNews;

        } catch (error) {
            console.error(`Error processing Google News RSS feed ${rssUrl}: ${error.message}`, error.stack);
            return [];
        }
    }
}


module.exports = {
  NewsScraperModule,
  YahooFinanceScraperModule,
  GoogleRSSNews,
};