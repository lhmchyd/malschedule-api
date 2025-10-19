// Vercel API route using Hono - properly structured for Vercel
import { Hono } from 'hono';
import { fetch } from 'undici';
import { load } from 'cheerio';

const app = new Hono();

// Function to scrape anime schedule from MyAnimeList
async function scrapeAnimeSchedule() {
  try {
    const response = await fetch('https://myanimelist.net/anime/season/schedule', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch schedule: ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);

    // Extract day names from the CSS classes of the container elements
    const dayMappings = {
      'monday': 'Monday',
      'tuesday': 'Tuesday', 
      'wednesday': 'Wednesday',
      'thursday': 'Thursday',
      'friday': 'Friday',
      'saturday': 'Saturday',
      'sunday': 'Sunday',
      'other': 'Other',
      'unknown': 'Unknown'
    };

    const schedule = [];

    // Find all day containers (class contains 'js-seasonal-anime-list-key-')
    Object.keys(dayMappings).forEach(dayKey => {
      const selector = `.js-seasonal-anime-list-key-${dayKey}`;
      const dayContainer = $(selector);
      
      if (dayContainer.length > 0) {
        const dayName = dayMappings[dayKey];
        const animeList = [];
        
        // Find all anime items within this day
        dayContainer.find('.seasonal-anime').each((index, element) => {
          const animeElement = $(element);
          
          // Extract anime ID from title link using the actual href attribute format you provided
          const titleLink = animeElement.find('.title .link-title').first();
          const href = titleLink.attr('href') || '';
          const malId = href.match(/\/anime\/(\d+)\//)?.[1] || null;
          
          // Extract title - look for the actual title element as you showed
          let title = titleLink.text().trim() || animeElement.find('.js-title').first().text().trim();
          
          // Extract score - use the js-score element you showed
          const scoreText = animeElement.find('.js-score').first().text().trim() || 
                            animeElement.find('.score').first().text().trim();
          const score = scoreText && scoreText !== 'N/A' && scoreText !== '?' && scoreText.length > 0
            ? parseFloat(scoreText) 
            : null;
          
          // Extract members - use the js-members element you showed
          const membersText = animeElement.find('.js-members').first().text().trim();
          const members = membersText && membersText.length > 0 
            ? parseInt(membersText.replace(/,/g, '')) 
            : null;
          
          // Extract image URL - ensure webp format
          const imgElement = animeElement.find('.image img').first();
          let imageUrl = imgElement.attr('data-src') || imgElement.attr('src') || imgElement.attr('data-lazy-src');
          
          // Ensure we have a full URL for the image
          if (imageUrl) {
            if (!imageUrl.startsWith('http')) {
              if (imageUrl.startsWith('//')) {
                imageUrl = 'https:' + imageUrl;
              } else if (imageUrl.startsWith('/')) {
                imageUrl = 'https://myanimelist.net' + imageUrl;
              }
            }
            
            // Convert to webp format if it's not already
            if (!imageUrl.includes('.webp')) {
              // Replace the image extension with webp
              imageUrl = imageUrl.replace(/\.(jpg|jpeg|png|gif)(\?.*)?$/, '.webp');
            }
          }
          
          // Extract aired date and episode info from the info element
          const infoElement = animeElement.find('.info').first();
          const infoText = infoElement.text().trim();
          
          // Try to extract aired date and episode count from the info element
          let aired = null;
          let episodes = null;
          let duration = null;
          
          if (infoText) {
            // Look for date and episode information in the text
            // Pattern like "Oct 6, 2025\n 11 eps, 23 min"
            const lines = infoText.split('\n').map(line => line.trim()).filter(line => line);
            
            for (const line of lines) {
              // Check if this line contains 'eps' (for episodes and duration)
              if (line.includes('eps')) {
                // Extract episode count, e.g. "11 eps"
                const epMatch = line.match(/([\d?]+)\s+eps/);
                if (epMatch) {
                  episodes = epMatch[1];
                }
                
                // Extract duration, e.g. "23 min"
                const durMatch = line.match(/(\d+)\s+min/);
                if (durMatch) {
                  duration = `${durMatch[1]} min`;
                }
              } else {
                // Check if this looks like a date
                const dateMatch = line.match(/^[A-Za-z]{3}\s+\d{1,2},\s+\d{4}/); // e.g. "Oct 6, 2025"
                if (dateMatch) {
                  aired = line;
                }
              }
            }
          }
          
          const animeData = {
            id: malId, // Using the MAL ID as requested
            title: title || 'Unknown Title',
            score: score,
            members: members,
            imageUrl: imageUrl || null,
            day: dayName,
            aired: aired,
            episodes: episodes,
            duration: duration
          };
          
          // Only add if we have at least a title
          if (animeData.title && animeData.title !== 'Unknown Title') {
            animeList.push(animeData);
          }
        });
        
        schedule.push({
          day: dayName,
          anime: animeList
        });
      }
    });
    
    // Filter out days that have no anime
    return schedule.filter(daySchedule => daySchedule.anime.length > 0);
  } catch (error) {
    console.error('Error in scrapeAnimeSchedule:', error);
    throw error;
  }
}

// Welcome route with API information
app.get('/', (c) => {
  const info = {
    message: 'MyAnimeList Schedule Scraper API',
    endpoints: {
      'GET /': 'This information page',
      'GET /api/anime-schedule': 'Get the weekly anime schedule with ID, score, members, image, and day',
    },
    description: 'This API scrapes MyAnimeList to get the weekly anime schedule data.',
    lastUpdated: Math.floor(Date.now() / 1000) // Unix timestamp
  };
  
  return c.json(info);
});

// Anime scraper route - now with on-demand scraping
app.get('/api/anime-schedule', async (c) => {
  // Set CORS headers
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  
  try {
    // On-demand scraping: fetch fresh data with each request
    const schedule = await scrapeAnimeSchedule();
    
    // Count total anime entries across all days
    const totalEntries = schedule.reduce((total, daySchedule) => total + daySchedule.anime.length, 0);
    
    // Return data with lastUpdated at the top level and total count
    const response = {
      lastUpdated: Math.floor(Date.now() / 1000), // Unix timestamp at top level
      total: totalEntries, // Total count of all anime entries
      schedule: schedule
    };
    
    return c.json(response);
  } catch (error) {
    console.error('Error scraping anime schedule:', error);
    return c.json({ error: 'Failed to fetch anime schedule', details: error.message }, 500);
  }
});

// Handle preflight requests for CORS
app.options('/api/anime-schedule', (c) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
  return c.text('');
});

// Export the handler for Vercel
export default app;