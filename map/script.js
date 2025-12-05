/**
 * Trellops Map View - Frontend Logic
 * Fetches Trello cards, geocodes them if needed, and displays on an interactive map
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  MAP: {
    DEFAULT_CENTER: [51.505, -0.09], // Default map center (London)
    DEFAULT_ZOOM: 2
  },
  GEOCODING: {
    MAX_CONCURRENT: 1,
    DELAY_MS: 1100 // 1.1 seconds to respect Nominatim rate limiting
  },
  LABEL_COLORS: {
    'Routine': { icon: 'info-circle', color: 'yellow', prefix: 'fa' },
    'Important': { icon: 'exclamation-circle', color: 'orange', prefix: 'fa' },
    'Priority': { icon: 'exclamation-triangle', color: 'red', prefix: 'fa' },
    'En route': { icon: 'truck', color: 'blue', prefix: 'fa' },
    'On Scene': { icon: 'wrench', color: 'blue', prefix: 'fa' },
    'Completed': { icon: 'check-circle', color: 'green', prefix: 'fa' },
  },
  STORAGE_KEYS: {
    BLOCK_VISIBILITY: 'mapViewBlockVisibility_',
    SHOW_COMPLETED: 'mapViewShowCompleted',
    SHOW_TEMPLATES: 'mapViewShowTemplates'
  }
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let appState = {
  map: null,
  cards: [],
  blocks: [],
  markers: new Map(), // cardId -> marker
  visibleBlocks: new Set(), // blockIds that are visible
  showCompleted: true,
  showTemplates: true,
  geocodingQueue: [],
  isProcessingGeocodeQueue: false,
  selectedBoardId: null,
  selectedBoardName: null,
  userToken: null,
  userId: null
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('[Map] Initializing...');
    
    // Get board data FIRST before initializing map
    const boardData = getBoardData();
    console.log('[Map] Board data:', boardData);
    
    if (!boardData) {
      showError('No board configured. Please set up a dashboard first.');
      return;
    }

    appState.selectedBoardId = boardData.boardId;
    appState.selectedBoardName = boardData.boardName;

    // Update sidebar header with board name
    const headerTitle = document.querySelector('.sidebar-header h2');
    if (headerTitle) {
      headerTitle.textContent = `${boardData.boardName}`;
    }

    const headerSubtitle = document.querySelector('.sidebar-header p');
    if (headerSubtitle) {
      headerSubtitle.textContent = 'Map View - Filter by block';
    }

    // Get auth from session/URL
    const authData = await getAuthData();
    console.log('[Map] Auth data:', authData ? { userId: authData.userId, hasToken: !!authData.token } : null);
    
    if (!authData) {
      showError('Not authenticated. Please log in from the main dashboard.');
      return;
    }

    appState.userToken = authData.token;
    appState.userId = authData.userId;

    // Initialize Leaflet map
    console.log('[Map] Initializing Leaflet map...');
    initializeMap();

    // Load blocks and cards
    console.log('[Map] Loading blocks...');
    await loadBlocks();
    console.log('[Map] Blocks loaded:', appState.blocks);

    console.log('[Map] Loading cards...');
    await loadCards();
    console.log('[Map] Cards loaded:', appState.cards.length, 'total cards');

    // Initialize UI
    renderBlockList();
    updateCardCount();

    // Restore saved preferences
    restorePreferences();
    console.log('[Map] Visible blocks:', Array.from(appState.visibleBlocks));

    // Render markers
    console.log('[Map] Rendering markers...');
    renderMarkers();

    // Start geocoding queue for cards that need it
    console.log('[Map] Starting geocoding queue...');
    startGeocodingQueue();

    console.log('[Map] Initialization complete!');

  } catch (error) {
    console.error('[Map] Initialization error:', error);
    showError(`Failed to initialize map: ${error.message}`);
  }
});

// ============================================================================
// MAP INITIALIZATION
// ============================================================================

function initializeMap() {
  const mapElement = document.getElementById('map');
  if (!mapElement) {
    showError('Map container not found in DOM');
    throw new Error('Map container not found');
  }

  appState.map = L.map('map').setView(CONFIG.MAP.DEFAULT_CENTER, CONFIG.MAP.DEFAULT_ZOOM);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(appState.map);
}

// ============================================================================
// AUTHENTICATION & DATA LOADING
// ============================================================================

async function getAuthData() {
  // Try to get from URL hash first
  const hash = window.location.hash.substring(1);
  if (hash.startsWith('token=')) {
    const token = hash.substring(6);
    const storedUser = localStorage.getItem('trelloCurrentUser');
    if (storedUser) {
      const allUserData = JSON.parse(localStorage.getItem('trelloUserData')) || {};
      const userData = allUserData[storedUser] || {};
      return { token, userId: storedUser };
    }
  }

  // Try to get from localStorage (existing session)
  const storedUserId = localStorage.getItem('trelloCurrentUser');
  if (storedUserId) {
    const allUserData = JSON.parse(localStorage.getItem('trelloUserData')) || {};
    const userData = allUserData[storedUserId] || {};
    if (userData.token) {
      return { token: userData.token, userId: storedUserId };
    }
  }

  return null;
}

function getBoardData() {
  const storedUserId = localStorage.getItem('trelloCurrentUser');
  if (!storedUserId) return null;

  const allUserData = JSON.parse(localStorage.getItem('trelloUserData')) || {};
  const userData = allUserData[storedUserId] || {};
  const settings = userData.settings;

  if (settings && settings.boardId && settings.boardName) {
    return {
      boardId: settings.boardId,
      boardName: settings.boardName,
      selectedLists: settings.selectedLists || []
    };
  }

  return null;
}

async function loadBlocks() {
  const storedUserId = localStorage.getItem('trelloCurrentUser');
  const allUserData = JSON.parse(localStorage.getItem('trelloUserData')) || {};
  const userData = allUserData[storedUserId] || {};
  
  const layouts = userData.dashboardLayout || {};
  const boardLayout = layouts[appState.selectedBoardId] || [];

  appState.blocks = boardLayout;

  // Initialize visibility based on 'includeOnMap' setting
  // Default to true if not explicitly set to false
  appState.blocks.forEach(block => {
    if (block.includeOnMap !== false) {
      appState.visibleBlocks.add(block.id);
    }
  });
}

async function loadCards() {
  const TRELLO_API_KEY = '558e200650487a28cf1cc0b33561cd82'; // Read-only key
  const boardId = appState.selectedBoardId;

  try {
    const url = `https://api.trello.com/1/boards/${boardId}/cards?fields=id,name,desc,idList,coordinates,labels,idLabels&key=${TRELLO_API_KEY}&token=${appState.userToken}`;
    
    console.log('[Map] Fetching cards from:', url);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API error: ${response.status} - ${response.statusText}`);
    }

    const cards = await response.json();
    console.log('[Map] Raw cards response:', cards);
    
    appState.cards = cards || [];
    console.log('[Map] Total cards:', appState.cards.length);
    console.log('[Map] Cards with coordinates:', appState.cards.filter(c => c.coordinates).length);
    console.log('[Map] Cards with description:', appState.cards.filter(c => c.desc).length);

    // Filter out template cards by default
    if (!appState.showTemplates) {
      appState.cards = appState.cards.filter(c => !c.isTemplate);
    }

    // Filter out completed cards by default
    if (!appState.showCompleted) {
      appState.cards = appState.cards.filter(c => {
        const hasCompletedLabel = c.labels?.some(l => l.name === 'Completed');
        return !hasCompletedLabel;
      });
    }

    console.log('[Map] Filtered cards:', appState.cards.length);

  } catch (error) {
    console.error('[Map] Error loading cards:', error);
    throw error;
  }
}

// ============================================================================
// UI RENDERING
// ============================================================================

function renderBlockList() {
  const blockListEl = document.getElementById('blockList');
  blockListEl.innerHTML = '';

  appState.blocks.forEach(block => {
    const cardsInBlock = appState.cards.filter(c => block.listIds?.includes(c.idList)).length;
    
    const blockEl = document.createElement('div');
    blockEl.className = 'block-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `block-${block.id}`;
    checkbox.checked = appState.visibleBlocks.has(block.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        appState.visibleBlocks.add(block.id);
      } else {
        appState.visibleBlocks.delete(block.id);
      }
      savePreferences();
      renderMarkers();
      updateCardCount();
    });

    const label = document.createElement('label');
    label.htmlFor = `block-${block.id}`;
    label.textContent = block.name;

    const count = document.createElement('span');
    count.className = 'block-count';
    count.textContent = cardsInBlock;

    blockEl.appendChild(checkbox);
    blockEl.appendChild(label);
    blockEl.appendChild(count);

    blockListEl.appendChild(blockEl);
  });
}

function renderBlockSettingsModal() {
  const container = document.getElementById('blockSettingsContainer');
  container.innerHTML = '';

  appState.blocks.forEach(block => {
    const settingEl = document.createElement('div');
    settingEl.className = 'settings-item';

    const storageKey = `${CONFIG.STORAGE_KEYS.BLOCK_VISIBILITY}${block.id}`;
    const isIncluded = localStorage.getItem(storageKey) !== 'false';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `setting-block-${block.id}`;
    checkbox.checked = isIncluded;
    checkbox.addEventListener('change', () => {
      localStorage.setItem(storageKey, checkbox.checked ? 'true' : 'false');
    });

    const label = document.createElement('label');
    label.htmlFor = `setting-block-${block.id}`;
    label.textContent = `Include "${block.name}" on Map`;

    settingEl.appendChild(checkbox);
    settingEl.appendChild(label);
    container.appendChild(settingEl);
  });
}

function updateCardCount() {
  const visibleCards = getVisibleCards();
  const indicator = document.getElementById('cardCountIndicator');
  indicator.textContent = `${visibleCards.length} cards`;
}

function getVisibleCards() {
  return appState.cards.filter(card => {
    const block = appState.blocks.find(b => b.listIds?.includes(card.idList));
    return block && appState.visibleBlocks.has(block.id);
  });
}

function renderMarkers() {
  // Clear existing markers
  appState.markers.forEach(marker => {
    appState.map.removeLayer(marker);
  });
  appState.markers.clear();

  const visibleCards = getVisibleCards();
  console.log('[Map] Visible cards:', visibleCards.length);
  console.log('[Map] Visible cards with coordinates:', visibleCards.filter(c => c.coordinates).length);

  const bounds = L.latLngBounds();
  let hasMarkers = false;

  visibleCards.forEach(card => {
    // Skip cards without coordinates (they're in the geocoding queue)
    if (!card.coordinates || !card.coordinates.lat || !card.coordinates.lng) {
      console.log('[Map] Card without coordinates:', card.id, card.name);
      return;
    }

    console.log('[Map] Creating marker for card:', card.id, card.name, 'at', card.coordinates.lat, card.coordinates.lng);
    
    const marker = createMarker(card);
    if (marker) {
      marker.addTo(appState.map);
      appState.markers.set(card.id, marker);
      bounds.extend([card.coordinates.lat, card.coordinates.lng]);
      hasMarkers = true;
    }
  });

  console.log('[Map] Total markers created:', appState.markers.size);

  // Auto-zoom to fit all markers
  if (hasMarkers && bounds.isValid()) {
    console.log('[Map] Fitting bounds...');
    appState.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
  } else {
    console.log('[Map] No markers to display, staying at default zoom');
  }
}

function createMarker(card) {
  if (!card.coordinates || !card.coordinates.lat || !card.coordinates.lng) {
    return null;
  }

  const markerConfig = getMarkerConfig(card);
  const marker = L.marker(
    [card.coordinates.lat, card.coordinates.lng],
    {
      icon: L.AwesomeMarkers.icon({
        icon: markerConfig.icon,
        prefix: markerConfig.prefix,
        markerColor: markerConfig.color
      })
    }
  );

  marker.bindPopup(`
    <strong>${card.name}</strong><br>
    <small>${card.coordinates.lat.toFixed(4)}, ${card.coordinates.lng.toFixed(4)}</small>
  `);

  return marker;
}

function getMarkerConfig(card) {
  // Check for specific labels in priority order
  const labels = card.labels?.map(l => l.name) || [];

  // Check for completion first
  if (labels.includes('Completed')) {
    return { icon: 'check-circle', color: 'green', prefix: 'fa' };
  }

  // Check for status labels
  if (labels.includes('En route')) {
    return { icon: 'truck', color: 'blue', prefix: 'fa' };
  }

  if (labels.includes('On Scene')) {
    return { icon: 'wrench', color: 'blue', prefix: 'fa' };
  }

  // Check for priority labels
  if (labels.includes('Priority')) {
    return { icon: 'exclamation-triangle', color: 'red', prefix: 'fa' };
  }

  if (labels.includes('Important')) {
    return { icon: 'exclamation-circle', color: 'orange', prefix: 'fa' };
  }

  if (labels.includes('Routine')) {
    return { icon: 'info-circle', color: 'yellow', prefix: 'fa' };
  }

  // Default
  return { icon: 'map-marker', color: 'blue', prefix: 'fa' };
}

// ============================================================================
// GEOCODING QUEUE
// ============================================================================

function startGeocodingQueue() {
  // Add all cards without coordinates to the queue
  appState.geocodingQueue = appState.cards.filter(card => {
    return !card.coordinates && card.desc && card.desc.trim();
  }).map(card => card.id);

  console.log('[Map] Geocoding queue initialized with', appState.geocodingQueue.length, 'cards');
  console.log('[Map] Queue card IDs:', appState.geocodingQueue);

  processGeocodingQueue();
}

async function processGeocodingQueue() {
  if (appState.isProcessingGeocodeQueue || appState.geocodingQueue.length === 0) {
    console.log('[Map] Geocoding queue processing skipped. Already processing:', appState.isProcessingGeocodeQueue, 'Queue empty:', appState.geocodingQueue.length === 0);
    return;
  }

  appState.isProcessingGeocodeQueue = true;
  console.log('[Map] Starting geocoding queue processing...');

  while (appState.geocodingQueue.length > 0) {
    const cardId = appState.geocodingQueue.shift();
    const card = appState.cards.find(c => c.id === cardId);

    if (!card || !card.desc) {
      console.log('[Map] Skipping card', cardId, '- no card or description found');
      continue;
    }

    try {
      console.log('[Map] Processing card for geocoding:', cardId, card.name);
      
      const address = parseAddressFromDescription(card.desc);
      console.log('[Map] Parsed address from description:', address);
      
      if (!address) {
        console.log('[Map] No address found in description for card', cardId);
        continue;
      }

      const coordinates = await geocodeAddress(address);
      console.log('[Map] Geocoded address to coordinates:', coordinates);
      
      if (!coordinates) {
        console.log('[Map] Geocoding failed for address:', address);
        continue;
      }

      // Update card locally
      card.coordinates = coordinates;

      // Update in Trello via API
      console.log('[Map] Updating Trello card with coordinates...');
      await updateCardCoordinates(cardId, coordinates);

      // Render marker if card is visible
      const block = appState.blocks.find(b => b.listIds?.includes(card.idList));
      if (block && appState.visibleBlocks.has(block.id)) {
        const marker = createMarker(card);
        if (marker) {
          marker.addTo(appState.map);
          appState.markers.set(card.id, marker);
          console.log('[Map] Marker added for card:', cardId);
        }
      }

      // Respect rate limiting
      await sleep(CONFIG.GEOCODING.DELAY_MS);

    } catch (error) {
      console.error(`[Map] Error geocoding card ${cardId}:`, error);
    }
  }

  appState.isProcessingGeocodeQueue = false;
  console.log('[Map] Geocoding queue processing complete');
}

function parseAddressFromDescription(desc) {
  // Try to extract Google Maps link
  const mapsLinkMatch = desc.match(/https:\/\/(www\.)?google\.com\/maps[^\s]*/i);
  if (mapsLinkMatch) {
    return mapsLinkMatch[0];
  }

  // Try to extract coordinates from description
  const coordMatch = desc.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (coordMatch) {
    return `${coordMatch[1]},${coordMatch[2]}`;
  }

  // Return the first line as a potential address
  const firstLine = desc.split('\n')[0].trim();
  if (firstLine.length > 3) {
    return firstLine;
  }

  return null;
}

async function geocodeAddress(address) {
  try {
    // Check if it's already coordinates
    const coordMatch = address.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      return {
        lat: parseFloat(coordMatch[1]),
        lng: parseFloat(coordMatch[2])
      };
    }

    // Use Nominatim for address geocoding
    const searchUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'TrellopsMapView/1.0'
      }
    });

    if (!response.ok) throw new Error(`Geocoding API error: ${response.status}`);

    const results = await response.json();
    if (results.length === 0) return null;

    const firstResult = results[0];
    return {
      lat: parseFloat(firstResult.lat),
      lng: parseFloat(firstResult.lon)
    };

  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

async function updateCardCoordinates(cardId, coordinates) {
  try {
    const response = await fetch('/api/update-location', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        cardId,
        lat: coordinates.lat,
        lng: coordinates.lng
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();

  } catch (error) {
    console.error('Error updating card coordinates:', error);
    throw error;
  }
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

document.getElementById('selectAllBtn').addEventListener('click', () => {
  appState.visibleBlocks.clear();
  appState.blocks.forEach(block => appState.visibleBlocks.add(block.id));
  savePreferences();
  renderBlockList();
  renderMarkers();
  updateCardCount();
});

document.getElementById('clearAllBtn').addEventListener('click', () => {
  appState.visibleBlocks.clear();
  savePreferences();
  renderBlockList();
  renderMarkers();
  updateCardCount();
});

document.getElementById('settingsBtn').addEventListener('click', () => {
  renderBlockSettingsModal();
  document.getElementById('settingsModal').classList.add('active');
});

document.getElementById('closeSettingsBtn').addEventListener('click', () => {
  document.getElementById('settingsModal').classList.remove('active');
});

document.getElementById('showCompletedToggle').addEventListener('change', (e) => {
  appState.showCompleted = e.target.checked;
  localStorage.setItem(CONFIG.STORAGE_KEYS.SHOW_COMPLETED, appState.showCompleted ? 'true' : 'false');
  // Would need to reload cards to apply this filter
});

document.getElementById('showTemplatesToggle').addEventListener('change', (e) => {
  appState.showTemplates = e.target.checked;
  localStorage.setItem(CONFIG.STORAGE_KEYS.SHOW_TEMPLATES, appState.showTemplates ? 'true' : 'false');
  // Would need to reload cards to apply this filter
});

document.getElementById('settingsModal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settingsModal')) {
    document.getElementById('settingsModal').classList.remove('active');
  }
});

// ============================================================================
// PREFERENCE MANAGEMENT
// ============================================================================

function savePreferences() {
  const prefs = {
    visibleBlocks: Array.from(appState.visibleBlocks),
    showCompleted: appState.showCompleted,
    showTemplates: appState.showTemplates
  };
  localStorage.setItem(`mapViewPrefs_${appState.selectedBoardId}`, JSON.stringify(prefs));
}

function restorePreferences() {
  const saved = localStorage.getItem(`mapViewPrefs_${appState.selectedBoardId}`);
  if (saved) {
    const prefs = JSON.parse(saved);
    appState.visibleBlocks = new Set(prefs.visibleBlocks || []);
    appState.showCompleted = prefs.showCompleted !== false;
    appState.showTemplates = prefs.showTemplates !== false;
  } else {
    // Default: show blocks that have includeOnMap set to true
    appState.visibleBlocks.clear();
    appState.blocks.forEach(block => {
      if (block.includeOnMap !== false) {
        appState.visibleBlocks.add(block.id);
      }
    });
  }

  // Also restore global toggles
  const savedShowCompleted = localStorage.getItem(CONFIG.STORAGE_KEYS.SHOW_COMPLETED);
  const savedShowTemplates = localStorage.getItem(CONFIG.STORAGE_KEYS.SHOW_TEMPLATES);

  if (savedShowCompleted !== null) {
    appState.showCompleted = savedShowCompleted === 'true';
    document.getElementById('showCompletedToggle').checked = appState.showCompleted;
  }

  if (savedShowTemplates !== null) {
    appState.showTemplates = savedShowTemplates === 'true';
    document.getElementById('showTemplatesToggle').checked = appState.showTemplates;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showError(message) {
  const container = document.getElementById('blockList');
  if (container) {
    container.innerHTML = `<div style="color: red; padding: 20px; text-align: center;">${message}</div>`;
  }
  console.error(message);
}
