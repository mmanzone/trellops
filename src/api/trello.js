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

    // 2. Fetch Boards
    const boardsPromise = trelloFetch('/members/me/boards?filter=open&fields=id,name,idOrganization,shortUrl,prefs', token);

    // 3. Fetch Member Cards (Reliable for cards I am a member of)
    const memberCardsPromise = trelloFetch('/members/me/cards?filter=visible&fields=id,name,due,dueComplete,idBoard,idList,url,shortUrl,desc,idMembers,labels&checklists=all&checklist_fields=all', token);

    // 4. Fetch Assigned Checklist Items (via Search)
    // "checklist:me" finds cards with items assigned to me. "is:open" filters for active cards.
    // limit=1000 to be safe (default is usually small).
    const searchPromise = trelloFetch('/search?query=checklist:me is:open&modelTypes=cards&cards_limit=1000&card_fields=id', token);

    const [orgs, boards, memberCards, searchResult] = await Promise.all([
        orgsPromise,
        boardsPromise,
        memberCardsPromise,
        searchPromise
    ]);

    // 5. Merge Strategy
    // memberCards contains full data.
    // searchResult.cards contains IDs of cards with assignments.
    const memberCardIds = new Set(memberCards.map(c => c.id));
    const searchCards = searchResult.cards || [];

    // Identify cards found in search that we DON'T have data for yet
    const missingCardIds = searchCards
        .map(c => c.id)
        .filter(id => !memberCardIds.has(id));

    let additionalCards = [];

    // 6. Fetch details for missing cards
    if (missingCardIds.length > 0) {
        // We need full details: fields + checklists
        // Use Batch API for efficiency
        const BATCH_SIZE = 10;
        const chunks = [];
        for (let i = 0; i < missingCardIds.length; i += BATCH_SIZE) {
            chunks.push(missingCardIds.slice(i, i + BATCH_SIZE));
        }

        const cardFields = 'id,name,due,dueComplete,idBoard,idList,url,shortUrl,desc,idMembers,labels';
        const checklistParams = 'checklists=all&checklist_fields=all';

        const batchPromises = chunks.map(chunk => {
            const batchUrls = chunk.map(id => `/cards/${id}?fields=${cardFields}&${checklistParams}`).join(',');
            return trelloFetch(`/batch?urls=${batchUrls}`, token);
        });

        const batchResults = await Promise.all(batchPromises);

        batchResults.forEach(batch => {
            if (Array.isArray(batch)) {
                batch.forEach(item => {
                    // Start looking for success responses (200)
                    if (item['200']) {
                        additionalCards.push(item['200']);
                    }
                });
            }
        });
    }

    const allCards = [...memberCards, ...additionalCards];

    // 7. Missing Organizations Fix (Round 16)
    // Collect all org IDs from Boards and Cards
    const knownOrgIds = new Set(orgs.map(o => o.id));
    const potentialOrgIds = new Set();

    boards.forEach(b => { if (b.idOrganization) potentialOrgIds.add(b.idOrganization); });
    // Cards usually rely on Board's org, but sometimes might have it? Usually no.
    // But we map Org via Board. So ensuring Board->Org mapping is covered is enough.
    // Boards fetched via `members/me/boards` include `idOrganization`.

    // Identify missing Orgs
    const missingOrgIds = [...potentialOrgIds].filter(id => !knownOrgIds.has(id));

    if (missingOrgIds.length > 0) {
        const BATCH_SIZE = 10;
        const chunks = [];
        for (let i = 0; i < missingOrgIds.length; i += BATCH_SIZE) {
            chunks.push(missingOrgIds.slice(i, i + BATCH_SIZE));
        }

        const batchPromises = chunks.map(chunk => {
            const batchUrls = chunk.map(id => `/organizations/${id}?fields=id,displayName,name`).join(',');
            return trelloFetch(`/batch?urls=${batchUrls}`, token);
        });

        const batchResults = await Promise.all(batchPromises);

        batchResults.forEach(batch => {
            if (Array.isArray(batch)) {
                batch.forEach(item => {
                    if (item['200']) {
                        orgs.push(item['200']);
                    }
                });
            }
        });
    }

    return { orgs, boards, cards: allCards };
};
