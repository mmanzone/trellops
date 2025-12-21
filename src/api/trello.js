import { TRELLO_API_BASE, TRELLO_API_KEY } from '../utils/constants';

export const trelloAuth = {
    login: () => {
        const appName = "Trello Stats Dashboard";
        // Remove hash from current location
        const returnUrl = window.location.href.split('#')[0];
        const authUrl = `https://trello.com/1/authorize?expiration=never&name=${encodeURIComponent(appName)}&scope=read&response_type=token&key=${TRELLO_API_KEY}&return_url=${encodeURIComponent(returnUrl)}`;
        window.location.href = authUrl;
    },
    getTokenFromUrl: () => {
        const hash = window.location.hash.substring(1);
        if (hash.startsWith('token=')) {
            const token = hash.substring(6);
            // Clean the URL
            history.pushState("", document.title, window.location.pathname + window.location.search);
            return token;
        }
        return null;
    },
    logout: (callback) => {
        // For OAuth, logout is primarily a client-side action (clearing token)
        if (callback) callback();
    }
};

export const trelloFetch = async (path, token, options = {}) => {
    if (!token) {
        throw new Error("Trello authentication token not provided.");
    }
    const url = `${TRELLO_API_BASE}${path}${path.includes('?') ? '&' : '?'}key=${TRELLO_API_KEY}&token=${token}`;

    console.log(`[TrelloAPI] ${options.method || 'GET'} ${path}`, { options, url });

    const response = await fetch(url, options);

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TrelloAPI] Error ${response.status}:`, errorText);
        let errorMessage = errorText;
        try {
            const errorJson = JSON.parse(errorText);
            if (errorJson && errorJson.message) {
                errorMessage = errorJson.message;
            }
        } catch (e) {
            // Not a JSON response, just use the raw text.
        }

        // Check specifically for Rate Limit error (429)
        if (response.status === 429) {
            throw new Error(`Rate limit exceeded (429): Trello API requests too fast/frequent.`);
        }
        // Handle invalid token error (401)
        if (response.status === 401) {
            throw new Error(`Invalid or expired token. Please log in again. (Details: ${errorMessage})`);
        }
        throw new Error(errorMessage || `Trello API error: ${response.status}`);
    }
    return response.json();
};
