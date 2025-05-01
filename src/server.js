const express = require('express');
const path = require('path');

const {
  NewsScraperModule,
  YahooFinanceScraperModule,
  GoogleRSSNews,
} = require('./ScrapingModule');

const app = express();
const port = 3000;

app.use(express.json());


app.use(express.static(path.join(__dirname, '../public')));

const newsScraper = new NewsScraperModule(); 
const yahooRss = new YahooFinanceScraperModule();
const googleRss = new GoogleRSSNews();

let lastResearchResults = [];

// API endpoint
app.post('/api/research', async (req, res) => {
  console.log('Received research request');
  const {
    targetCompany,
    competitors,
    customerCompany, 
    sources 
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
      
      if (sources.gnews) { 
        console.log(`Searching Google News (Web) for ${targetCompany} and ${competitor}`);
        const newsArticles = await newsScraper.searchAllNewsSources(targetCompany, competitor);
        const processedNews = newsArticles.map(article => ({
          targetCompany: targetCompany,
          competitor: competitor,
          collaborationType: 'Potential Partnership/Collaboration',
          impactLevel: 'Medium', 
          sourceType: article.source, 
          evidenceLinks: [{
            url: article.link,
            title: article.title,
            source: article.source,
            date: article.date
          }],
          notes: `Found in ${article.source}: "${article.snippet}"` 
        }));
        allResults = allResults.concat(processedNews);
      } else {
          console.log(`Google News (Web) source not selected.`);
      }


      if (sources.yahooRss) { 
        console.log(`Workspaceing Yahoo Finance RSS for ${targetCompany} and ${competitor}`);
        const yahooNewsArticles = await yahooRss.fetchNews(targetCompany, competitor);
        const processedYahooNews = yahooNewsArticles.map(article => ({
           targetCompany: targetCompany,
           competitor: competitor,
           collaborationType: 'Potential Partnership/Collaboration',
           impactLevel: 'Medium', 
           sourceType: article.source, 
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

      if (sources.gnewsRss) { 
        console.log(`Workspaceing Google News RSS for ${targetCompany} and ${competitor}`);
        
        const googleNewsRssUrl = `https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US%3Aen&oc=11&q=%22${encodeURIComponent(targetCompany)}%22%20AND%20%22${encodeURIComponent(competitor)}%22`;
        const googleRssArticles = await googleRss.fetchNews(googleNewsRssUrl, targetCompany, competitor);
        const processedGoogleRssNews = googleRssArticles.map(article => ({
            targetCompany: targetCompany,
            competitor: competitor,
            collaborationType: 'Potential Partnership/Collaboration',
            impactLevel: 'Medium', 
            sourceType: article.source, 
            evidenceLinks: [{
                url: article.link,
                title: article.title,
                source: article.source,
                date: article.date
            }],
            notes: `Found in ${article.source}: "${article.snippet}"` 
        }));
        allResults = allResults.concat(processedGoogleRssNews);
      } else {
          console.log(`Google News (All Time/RSS) source not selected.`);
      }


      
      await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));


    } catch (error) {
      console.error(`Error during research for ${targetCompany} and ${competitor}: ${error.message}`);
      // Continue to the next competitor
    }
  }

  // Store the results for export
  lastResearchResults = allResults;
  console.log(`Research complete. Found ${allResults.length} results.`);


  
  res.json({
    results: allResults
  });
});

// API endpoint for csv
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