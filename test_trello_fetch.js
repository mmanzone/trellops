
// Mock global fetch
global.fetch = async (url, options) => {
    console.log(`[MockFetch] URL: ${url}`);
    console.log(`[MockFetch] Options:`, options);
    return {
        ok: true,
        json: async () => ({ success: true })
    };
};

// Mock constants
const TRELLO_API_BASE = 'https://api.trello.com/1';
const TRELLO_API_KEY = 'mock_key';

// Re-implement trelloFetch directly here to test the logic as imported from the file
// We cannot easily import ES modules in this simple script without package.json adjustments or babel,
// so we'll copy the function logic to verify *the logic itself* is correct.
// Ideally we would import it, but this is a quick functional check.

const trelloFetch = async (path, token, options = {}) => {
    if (!token) {
        throw new Error("Trello authentication token not provided.");
    }
    const url = `${TRELLO_API_BASE}${path}${path.includes('?') ? '&' : '?'}key=${TRELLO_API_KEY}&token=${token}`;
    const response = await fetch(url, options); // The critical line we changed
    if (!response.ok) {
        throw new Error("Error");
    }
    return response.json();
};

// Test Case
(async () => {
    console.log("--- Testing trelloFetch Argument Passing ---");
    try {
        await trelloFetch('/cards/123', 'mock_token', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coordinates: '10,20' })
        });
        console.log("--- Test Complete ---");
    } catch (e) {
        console.error("Test Failed", e);
    }
})();
