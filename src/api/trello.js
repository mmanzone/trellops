import { TRELLO_API_BASE, TRELLO_API_KEY } from '../utils/constants';

export const trelloAuth = {
    login: (scope = 'read') => {
        const appName = "Trello Stats Dashboard";
        // Remove hash from current location
        const returnUrl = window.location.href.split('#')[0];
        const authUrl = `https://trello.com/1/authorize?expiration=never&name=${encodeURIComponent(appName)}&scope=${scope}&response_type=token&key=${TRELLO_API_KEY}&return_url=${encodeURIComponent(returnUrl)}`;
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
    },
    checkTokenScopes: async (token) => {
        if (!token) return [];
        try {
            const response = await fetch(`${TRELLO_API_BASE}/tokens/${token}?key=${TRELLO_API_KEY}&token=${token}`);
            if (response.ok) {
                const data = await response.json();
                return data.permissions ? data.permissions.map(p => p.read === true ? 'read' : '').concat(data.permissions.map(p => p.write === true ? 'write' : '')).filter(Boolean) : [];
            }
        } catch (e) {
            console.warn("Failed to check token scopes", e);
        }
        return [];
    }
};

export const trelloFetch = async (path, token, options = {}) => {
    if (!token) {
        throw new Error("Trello authentication token not provided.");
    }
    const apiKey = options.apiKey || TRELLO_API_KEY;
    const url = `${TRELLO_API_BASE}${path}${path.includes('?') ? '&' : '?'}key=${apiKey}&token=${token}`;

    console.log(`[TrelloAPI] ${options.method || 'GET'} ${path}`, { options, url });

    const response = await fetch(url, options);

    if (response.ok) {
        console.log(`[TrelloAPI] Response OK ${response.status} for ${path}`);
    } else {
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

export const fetchAllTasksData = async (token) => {
    if (!token) throw new Error("No token provided");

    // 1. Fetch Organizations (Workspaces)
    const orgsPromise = trelloFetch('/members/me/organizations?fields=id,displayName,name', token);

    // 2. Fetch Boards (needed to map Board -> Org, as Card -> Board might not have Org info populated or we want all boards structure)
    // We want open boards mostly? Or all? User said "across all workspaces and boards".
    // Let's fetch all open boards.
    const boardsPromise = trelloFetch('/members/me/boards?filter=open&fields=id,name,idOrganization,shortUrl,prefs', token);

    // 3. Fetch Cards (member of)
    // We want cards where user is memeber.
    // Trello API: members/me/cards returns cards the member is on.
    // Include checklists to find assigned tasks.
    // Include board to get board name if needed, but we have boardsPromise. 
    // We need board ID to map. works default.
    const cardsPromise = trelloFetch('/members/me/cards?filter=visible&fields=id,name,due,dueComplete,idBoard,idList,url,shortUrl,desc&checklists=all&checklist_fields=all', token);

    const [orgs, boards, cards] = await Promise.all([orgsPromise, boardsPromise, cardsPromise]);

    return { orgs, boards, cards };
};
