/**
 * Backend API function to update Trello card coordinates
 * Vercel Serverless Function
 * 
 * Request body: { cardId, lat, lng }
 * Environment variables: TRELLO_WRITE_KEY, TRELLO_WRITE_TOKEN
 */

const TRELLO_API_BASE = 'https://api.trello.com/1';

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cardId, lat, lng } = req.body;

  // Validate required fields
  if (!cardId || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'Missing required fields: cardId, lat, lng' });
  }

  // Validate coordinates are numbers
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Coordinates must be numbers' });
  }

  // Validate latitude and longitude ranges
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Invalid coordinate ranges' });
  }

  const TRELLO_KEY = process.env.TRELLO_WRITE_KEY;
  const TRELLO_TOKEN = process.env.TRELLO_WRITE_TOKEN;

  // Verify credentials are configured
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    console.error('Missing Trello credentials in environment variables');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  try {
    // Make PUT request to Trello API to update card coordinates
    // Trello expects the `coordinates` parameter as a comma-separated query string
    const coordsStr = `${lat},${lng}`;
    const updateUrl = `${TRELLO_API_BASE}/cards/${cardId}?key=${TRELLO_KEY}&token=${TRELLO_TOKEN}&coordinates=${encodeURIComponent(coordsStr)}`;

    const response = await fetch(updateUrl, {
      method: 'PUT'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Trello API error: ${response.status} - ${errorText}`);
      return res.status(response.status).json({
        error: `Failed to update card: ${response.statusText}`,
        details: errorText
      });
    }

    const data = await response.json();

    return res.status(200).json({
      success: true,
      message: `Card ${cardId} updated with coordinates [${lat}, ${lng}]`,
      data: data
    });

  } catch (error) {
    console.error('Error updating Trello card:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
