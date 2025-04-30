// src/server.js
const express = require('express');
const path = require('path');
// Import your scraping modules from the src folder
const {
  NewsScraperModule,
  PressReleaseScraperModule,
  FinancialFilingsScraperModule,
  SocialMediaScraperModule
} = require('./ScrapingModule');

const app = express();
const port = 3000; // Choose a port for your server

// Middleware to parse JSON request bodies
app.use(express.json());

// Serve static files from the 'public' directory
// This tells Express to look for static files (like index.html, CSS, JS)
// in the directory one level up from 'src' and then into 'public'.
app.use(express.static(path.join(__dirname, '../public')));

// Initialize scraper modules
const newsScraper = new NewsScraperModule();
const pressReleaseScraper = new PressReleaseScraperModule();
const financialFilingsScraper = new FinancialFilingsScraperModule();
// const socialMediaScraper = new SocialMediaScraperModule();

// API endpoint for research
app.post('/api/research', async (req, res) => {
  console.log('Received research request');
  const {
    targetCompany,
    competitors,
    customerCompany, // Optional
    sources // Assuming frontend sends selected sources
  } = req.body;

  if (!targetCompany || !competitors || !Array.isArray(competitors) || competitors.length === 0) {
    return res.status(400).json({
      error: 'Invalid request body. Please provide targetCompany and at least one competitor.'
    });
  }

  let allResults = [];

  // Iterate through competitors and selected sources
  for (const competitor of competitors) {
    console.log(`Researching collaboration between ${targetCompany} and ${competitor}`);

    // You would typically check the 'sources' object here to decide which scrapers to run
    // For simplicity, this example runs all available scrapers for each competitor.
    // You can add conditional logic based on the 'sources' object received from the frontend.

    try {
      // Search News
      const newsArticles = await newsScraper.searchAllNewsSources(targetCompany, competitor);
      // Process newsArticles and add to allResults
      const processedNews = newsArticles.map(article => ({
        targetCompany: targetCompany,
        competitor: competitor,
        collaborationType: 'Potential Partnership/Collaboration', // Or analyze content for specific type
        impactLevel: 'Medium', // Needs analysis
        sourceType: 'News Article',
        evidenceLinks: [{
          url: article.url,
          title: article.title,
          source: article.source,
          date: article.date
        }],
        notes: `Found in news: "${article.snippet}"` // Use snippet or fetch full content
      }));
      allResults = allResults.concat(processedNews);


      // Search Press Releases
      const pressReleases = await pressReleaseScraper.searchAllPressReleaseSources(targetCompany, competitor);
      // Process pressReleases and add to allResults
      const processedReleases = pressReleases.map(release => ({
        targetCompany: targetCompany,
        competitor: competitor,
        collaborationType: 'Official Announcement', // Press releases are often official
        impactLevel: 'High', // Press releases usually indicate significant events
        sourceType: 'Press Release',
        evidenceLinks: [{
          url: release.url,
          title: release.title,
          source: release.source,
          date: release.date
        }],
        notes: `Found in press release: "${release.title}"` // Use title or fetch full content
      }));
      allResults = allResults.concat(processedReleases);


      // Search Financial Filings (requires CIK lookup and content fetching/analysis)
      // This is a more complex process as implemented in your module.
      // The searchFinancialFilings function already returns structured data.
      const financialFilings = await financialFilingsScraper.searchFinancialFilings(targetCompany, competitor);
      // Add financialFilings directly to results as they are already processed
      allResults = allResults.concat(financialFilings.map(filing => ({
          targetCompany: filing.targetCompany,
          competitor: filing.competitor,
          collaborationType: 'Regulatory Disclosure',
          impactLevel: 'High', // Filings are official and legally binding
          sourceType: 'Financial Filing (SEC)',
          evidenceLinks: [{
              url: filing.url, // Link to index page
              title: filing.documentType + ' Filing',
              source: 'SEC EDGAR',
              date: filing.documentDate
          }],
          notes: `Found in filing (${filing.documentType}): ${filing.snippets.join('... ')}` // Join snippets
      })));


    //   // Search Social Media (unreliable, handle potential errors)
    //    try {
    //        const socialPosts = await socialMediaScraper.searchSocialMedia(targetCompany, competitor);
    //         // Process socialPosts and add to allResults
    //         const processedPosts = socialPosts.map(post => ({
    //             targetCompany: targetCompany,
    //             competitor: competitor,
    //             collaborationType: 'Social Media Mention', // Less formal
    //             impactLevel: 'Low', // Usually less impactful than official sources
    //             sourceType: 'Social Media',
    //              evidenceLinks: [{
    //                 url: post.url,
    //                 title: post.text.substring(0, 100) + '...', // Use snippet of text as title
    //                 source: post.source,
    //                 date: post.date
    //             }],
    //             notes: `Found on ${post.source}: "${post.text}" by ${post.user}`
    //         }));
    //         allResults = allResults.concat(processedPosts);
    //    } catch (socialError) {
    //        console.warn(`Social media scraping failed for ${competitor}: ${socialError.message}`);
    //        // Continue without social media results for this competitor
    //    }


      // Add delays between scraper calls for politeness and to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds between competitors/sources

    } catch (error) {
      console.error(`Error during research for ${targetCompany} and ${competitor}: ${error.message}`);
      // Continue to the next competitor even if one fails
    }
  }


  // Send the results back to the frontend
  res.json({
    results: allResults
  });
});

// Simple endpoint to demonstrate export (in a real app, you'd generate CSV here)
app.get('/api/export', (req, res) => {
    // In a real application, you would store the research results server-side
    // and generate a CSV file here based on the last research query.
    // For this example, we'll just send a placeholder message or a simple dummy CSV.
    console.log('Export endpoint called. (CSV generation not fully implemented)');
    res.status(501).send('CSV Export Not Fully Implemented Yet');
    // To implement:
    // 1. Store results of the last research POST request server-side (e.g., in a variable or temporary file).
    // 2. On a GET to /api/export, format those results as CSV.
    // 3. Set headers: res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', 'attachment; filename="research_results.csv"');
    // 4. Send the CSV data: res.send(csvData);
});


// Start the server
app.listen(port, () => {
  console.log(`Backend server listening at http://localhost:${port}`);
  console.log(`Open your index.html file in a browser by navigating to http://localhost:${port}/`); // index.html is the default file in the static directory
});
