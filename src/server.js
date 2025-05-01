const express = require('express');
const path = require('path');

const {
  NewsScraperModule,
  YahooFinanceScraperModule,
  GoogleRSSNews, // Import the new GoogleRSSNews module
  // Add other modules here if you create them
} = require('./ScrapingModule'); // Ensure the path is correct

const app = express();
const port = 3000;

app.use(express.json());


app.use(express.static(path.join(__dirname, '../public')));

// Initialize scraper modules
const newsScraper = new NewsScraperModule(); // For web scraping (Google News Search, Yahoo Finance Search, MarketWatch)
const yahooRss = new YahooFinanceScraperModule(); // For Yahoo Finance RSS
const googleRss = new GoogleRSSNews(); // For Google News RSS

let lastResearchResults = [];

// API endpoint for research
app.post('/api/research', async (req, res) => {
  console.log('Received research request');
  const {
    targetCompany,
    competitors,
    customerCompany, // Optional
    sources // Receive the sources object from the frontend
  } = req.body;

  if (!targetCompany || !competitors || !Array.isArray(competitors) || competitors.length === 0) {
    return res.status(400).json({
      error: 'Invalid request body. Please provide targetCompany and at least one competitor.'
    });
  }

  let allResults = [];

  for (const competitor of competitors) {
    console.log(`Researching collaboration between ${targetCompany} and ${competitor}`);

    try {
      // Conditionally call scraper modules based on selected sources
      if (sources.gnews) { // Check if Google News (Recent/Web) is selected
        console.log(`Searching Google News (Web) for ${targetCompany} and ${competitor}`);
        const newsArticles = await newsScraper.searchAllNewsSources(targetCompany, competitor);
        const processedNews = newsArticles.map(article => ({
          targetCompany: targetCompany,
          competitor: competitor,
          collaborationType: 'Potential Partnership/Collaboration',
          impactLevel: 'Medium', // Default or determine based on content
          sourceType: article.source, // Use the source name from the module
          evidenceLinks: [{
            url: article.link,
            title: article.title,
            source: article.source,
            date: article.date
          }],
          notes: `Found in ${article.source}: "${article.snippet}"` // Include source in notes
        }));
        allResults = allResults.concat(processedNews);
      } else {
          console.log(`Google News (Web) source not selected.`);
      }


      if (sources.yahooRss) { // Check if Yahoo Finance RSS is selected
        console.log(`Workspaceing Yahoo Finance RSS for ${targetCompany} and ${competitor}`);
        const yahooNewsArticles = await yahooRss.fetchNews(targetCompany, competitor);
        const processedYahooNews = yahooNewsArticles.map(article => ({
           targetCompany: targetCompany,
           competitor: competitor,
           collaborationType: 'Potential Partnership/Collaboration',
           impactLevel: 'Medium', // Default or determine based on content
           sourceType: article.source, // Specify source type
           evidenceLinks: [{
             url: article.link,
             title: article.title,
             source: article.source,
             date: article.date
           }],
           notes: `Found in ${article.source} title: "${article.title}"` // Note based on available info
        }));
        allResults = allResults.concat(processedYahooNews);
      } else {
          console.log(`Yahoo Finance RSS source not selected.`);
      }

      if (sources.gnewsRss) { // Check if Google News (All Time/RSS) is selected
        console.log(`Workspaceing Google News RSS for ${targetCompany} and ${competitor}`);
        // Construct the Google News RSS URL dynamically for the query
        const googleNewsRssUrl = `https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US%3Aen&oc=11&q=%22${encodeURIComponent(targetCompany)}%22%20AND%20%22${encodeURIComponent(competitor)}%22`;
        const googleRssArticles = await googleRss.fetchNews(googleNewsRssUrl, targetCompany, competitor);
        const processedGoogleRssNews = googleRssArticles.map(article => ({
            targetCompany: targetCompany,
            competitor: competitor,
            collaborationType: 'Potential Partnership/Collaboration',
            impactLevel: 'Medium', // Default or determine based on content
            sourceType: article.source, // Specify source type
            evidenceLinks: [{
                url: article.link,
                title: article.title,
                source: article.source,
                date: article.date
            }],
            notes: `Found in ${article.source}: "${article.snippet}"` // Use snippet from Google RSS
        }));
        allResults = allResults.concat(processedGoogleRssNews);
      } else {
          console.log(`Google News (All Time/RSS) source not selected.`);
      }


      // Add search from other modules here if needed

      // Add a delay to avoid overwhelming sources
      await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));


    } catch (error) {
      console.error(`Error during research for ${targetCompany} and ${competitor}: ${error.message}`);
      // Continue to the next competitor
    }
  }

  // Store the results for export
  lastResearchResults = allResults;
  console.log(`Research complete. Found ${allResults.length} results.`);


  // Send the results back to the frontend
  res.json({
    results: allResults
  });
});

// API endpoint to generate and download CSV
app.get('/api/export', (req, res) => {
  console.log('Export endpoint called.');

  if (!lastResearchResults || lastResearchResults.length === 0) {
    console.log('No data available for export.');
    return res.status(404).send('No research data available to export. Please perform a search first.');
  }


  const csvHeaders = ["Target", "Competitor", "Type", "Impact", "Source", "Evidence Date", "Link"];


  const csvRows = lastResearchResults.map(result => {

    const evidence = result.evidenceLinks && result.evidenceLinks.length > 0 ? result.evidenceLinks[0] : {};


    const escapeCsvField = (field) => {
        if (field === null || field === undefined) {
            return '';
        }
        let stringField = String(field);

        if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
            // Escape double quotes
            stringField = stringField.replace(/"/g, '""');

            return `"${stringField}"`;
        }
        return stringField;
    };


    return [
      escapeCsvField(result.targetCompany),
      escapeCsvField(result.competitor),
      escapeCsvField(result.collaborationType),
      escapeCsvField(result.impactLevel),
      escapeCsvField(evidence.source),
      escapeCsvField(evidence.date),
      escapeCsvField(evidence.url)
    ].join(',');
  });


  const csvString = [csvHeaders.join(','), ...csvRows].join('\n');


  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="research_results.csv"');


  res.send(csvString);
  console.log('CSV file generated and sent.');
});



app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
  console.log(`Open your index.html file in a browser by navigating to http://localhost:${port}/`); // index.html is the default file in the static directory
});