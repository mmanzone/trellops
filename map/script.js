/**
 * Trellops Map View - Frontend Logic
 * Fetches Trello cards, geocodes them if needed, and displays on an interactive map
 */

// Wait for required libraries to load before initializing
function waitForLibraries(callback, attempts = 0) {
  if (typeof L !== 'undefined' && typeof L.AwesomeMarkers !== 'undefined') {
    callback();
  } else if (attempts < 50) {
    setTimeout(() => waitForLibraries(callback, attempts + 1), 100);
  } else {
    console.warn('[Map] AwesomeMarkers did not load, using fallback markers');
    callback();
  }
}

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
  userId: null,
  refreshInterval: null,
  refreshIntervalMs: 300000 // 5 minutes default
};

// ============================================================================
// UI HELPERS
// ============================================================================

function showStatusMessage(message) {
  const statusEl = document.getElementById('statusMessage');
  const statusText = document.getElementById('statusText');
  if (statusEl && statusText) {
    statusText.textContent = message;
    statusEl.classList.remove('hidden');
  }
}

function hideStatusMessage() {
  const statusEl = document.getElementById('statusMessage');
  if (statusEl) {
    statusEl.classList.add('hidden');
  }
}

// Basic HTML escaping for popup content
function escapeHtml(unsafe) {
  return (unsafe || '').replace(/[&<>"]+/g, function(match) {
    switch (match) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return match;
    }
  });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  waitForLibraries(async () => {
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

    // Load auto-refresh interval from dashboard settings
    try {
      const dashboardSettings = localStorage.getItem('dashboardSettings');
      if (dashboardSettings) {
        const settings = JSON.parse(dashboardSettings);
        if (settings.refreshInterval && settings.refreshInterval > 0) {
          appState.refreshIntervalMs = settings.refreshInterval * 1000; // Convert to ms
          console.log('[Map] Using refresh interval from settings:', appState.refreshIntervalMs, 'ms');
        }
      }
    } catch (e) {
      console.log('[Map] Could not load refresh interval from settings, using default');
    }

    // Start auto-refresh
    startAutoRefresh();

    console.log('[Map] Initialization complete!');

  } catch (error) {
    console.error('[Map] Initialization error:', error);
    showError(`Failed to initialize map: ${error.message}`);
  }
  });
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

// ============================================================================
// AUTO-REFRESH
// ============================================================================

function startAutoRefresh() {
  if (appState.refreshInterval) {
    clearInterval(appState.refreshInterval);
  }
  
  appState.refreshInterval = setInterval(async () => {
    console.log('[Map] Auto-refreshing map data...');
    try {
      await loadCards();
      renderMarkers();
      startGeocodingQueue();
    } catch (error) {
      console.error('[Map] Error during auto-refresh:', error);
    }
  }, appState.refreshIntervalMs);
  
  console.log('[Map] Auto-refresh started with interval:', appState.refreshIntervalMs, 'ms');
}

function stopAutoRefresh() {
  if (appState.refreshInterval) {
    clearInterval(appState.refreshInterval);
    appState.refreshInterval = null;
    console.log('[Map] Auto-refresh stopped');
  }
}

async function manualRefresh() {
  console.log('[Map] Manual refresh triggered...');
  try {
    await loadCards();
    renderMarkers();
    startGeocodingQueue();
  } catch (error) {
    console.error('[Map] Error during manual refresh:', error);
    showError('Failed to refresh map data');
  }
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
    // Fetch cards (include shortUrl so we can link to the Trello card)
    const cardsUrl = `https://api.trello.com/1/boards/${boardId}/cards?fields=id,name,desc,idList,labels,idLabels,pos,isTemplate,shortUrl&key=${TRELLO_API_KEY}&token=${appState.userToken}`;
    
    console.log('[Map] Fetching cards...');
    
    const cardsResponse = await fetch(cardsUrl);
    if (!cardsResponse.ok) {
      throw new Error(`Cards API error: ${cardsResponse.status} - ${cardsResponse.statusText}`);
    }

    const cards = await cardsResponse.json();
    console.log('[Map] Raw cards response:', cards);

    // Fetch custom fields to find the coordinates field ID
    const fieldsUrl = `https://api.trello.com/1/boards/${boardId}/customFields?key=${TRELLO_API_KEY}&token=${appState.userToken}`;
    const fieldsResponse = await fetch(fieldsUrl);
    const customFields = fieldsResponse.ok ? await fieldsResponse.json() : [];
    console.log('[Map] All custom fields on board:', customFields);
    const coordinatesField = customFields.find(f => {
      const lowerName = f.name?.toLowerCase() || '';
      return lowerName.includes('coordinates') || lowerName.includes('location') || lowerName.includes('coord');
    });
    console.log('[Map] Coordinates field found:', coordinatesField?.id, coordinatesField?.name);

    // If coordinates field exists, fetch custom field items for all cards
    if (coordinatesField) {
      try {
        // Fetch all list items and cards from the board with custom field items
        const listUrl = `https://api.trello.com/1/boards/${boardId}/lists?cards=open&customFieldItems=open&fields=id&key=${TRELLO_API_KEY}&token=${appState.userToken}`;
        const listResponse = await fetch(listUrl);
        if (listResponse.ok) {
          const lists = await listResponse.json();
          
          // Build a map of card ID to coordinates from nested card data
          for (const list of lists) {
            if (list.cards) {
              for (const cardWithCustomFields of list.cards) {
                const originalCard = cards.find(c => c.id === cardWithCustomFields.id);
                if (originalCard && cardWithCustomFields.customFieldItems) {
                  const coordItem = cardWithCustomFields.customFieldItems.find(
                    item => item.idCustomField === coordinatesField.id
                  );
                  if (coordItem && coordItem.value) {
                    if (typeof coordItem.value === 'string') {
                      originalCard.coordinates = coordItem.value;
                    } else if (coordItem.value.text) {
                      originalCard.coordinates = coordItem.value.text;
                    }
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        console.log('[Map] Could not fetch custom field items via lists:', e);
        
        // Fallback: fetch custom items for each card individually (slower)
        console.log('[Map] Falling back to individual card custom field requests...');
        for (const card of cards) {
          try {
            const itemUrl = `https://api.trello.com/1/cards/${card.id}/customFieldItems?key=${TRELLO_API_KEY}&token=${appState.userToken}`;
            const itemResponse = await fetch(itemUrl);
            if (itemResponse.ok) {
              const items = await itemResponse.json();
              const coordItem = items.find(item => item.idCustomField === coordinatesField.id);
              if (coordItem && coordItem.value) {
                if (typeof coordItem.value === 'string') {
                  card.coordinates = coordItem.value;
                } else if (coordItem.value.text) {
                  card.coordinates = coordItem.value.text;
                }
              }
            }
          } catch (itemError) {
            // Silently skip if we can't fetch custom items for a card
          }
        }
      }
    }

    // Fetch board lists so we can display list name in popups
    try {
      const listsUrl = `https://api.trello.com/1/boards/${boardId}/lists?fields=id,name&key=${TRELLO_API_KEY}&token=${appState.userToken}`;
      const listsResp = await fetch(listsUrl);
      if (listsResp.ok) {
        const lists = await listsResp.json();
        appState.listMap = {};
        lists.forEach(l => {
          appState.listMap[l.id] = l.name;
        });
        console.log('[Map] Board lists loaded:', appState.listMap);
      }
    } catch (e) {
      console.warn('[Map] Could not fetch board lists:', e);
    }

    // Keep a copy of the raw cards (unfiltered) so we can determine first-card per list
    appState.rawCards = cards || [];

    // Work on a filtered set for display and geocoding decisions
    appState.cards = appState.rawCards.slice();
    console.log('[Map] Total cards (raw):', appState.rawCards.length);
    console.log('[Map] Cards with coordinates (raw):', appState.rawCards.filter(c => c.coordinates).length);
    console.log('[Map] Cards with description (raw):', appState.rawCards.filter(c => c.desc).length);

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
      // When visibility changes, re-evaluate geocoding for newly visible cards
      startGeocodingQueue();
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
  // Clear only markers for cards that are no longer visible
  // Don't clear all markers upfront - this preserves them during refresh
  const visibleCardIds = new Set(getVisibleCards().map(c => c.id));
  
  // Remove markers for cards that are no longer visible
  for (const [cardId, marker] of appState.markers.entries()) {
    if (!visibleCardIds.has(cardId)) {
      appState.map.removeLayer(marker);
      appState.markers.delete(cardId);
    }
  }

  const visibleCards = getVisibleCards();
  console.log('[Map] Visible cards:', visibleCards.length);
  console.log('[Map] Visible cards with coordinates:', visibleCards.filter(c => c.coordinates).length);

  const bounds = L.latLngBounds();
  let hasMarkers = false;

  visibleCards.forEach(card => {
    // Parse coordinates if they come as a string from Trello API
    let coords = card.coordinates;
    if (typeof coords === 'string' && coords.trim()) {
      const parts = coords.split(',').map(p => parseFloat(p.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        coords = { lat: parts[0], lng: parts[1] };
      }
    }

    // Skip cards without valid coordinates
    if (!coords || !coords.lat || !coords.lng) {
      console.log('[Map] Card without coordinates:', card.id, card.name);
      return;
    }

    // Check if marker already exists
    if (appState.markers.has(card.id)) {
      const existingMarker = appState.markers.get(card.id);
      bounds.extend([coords.lat, coords.lng]);
      hasMarkers = true;
      return; // Skip creating new marker, keep existing one
    }

    console.log('[Map] Creating marker for card:', card.id, card.name, 'at', coords.lat, coords.lng);
    
    // Create a card object with parsed coordinates
    const cardWithCoords = { ...card, coordinates: coords };
    const marker = createMarker(cardWithCoords);
    if (marker) {
      marker.addTo(appState.map);
      appState.markers.set(card.id, marker);
      bounds.extend([coords.lat, coords.lng]);
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
  if (!markerConfig) {
    console.warn('[Map] markerConfig is undefined for card:', card.id, card.name);
    return null;
  }

  try {
    let markerIcon;
    
    // Try to use AwesomeMarkers if available, otherwise use default Leaflet marker
    if (typeof L !== 'undefined' && L.AwesomeMarkers && L.AwesomeMarkers.icon) {
      markerIcon = L.AwesomeMarkers.icon({
        icon: markerConfig.icon || 'map-marker',
        prefix: markerConfig.prefix || 'fa',
        markerColor: markerConfig.color || 'blue'
      });
      console.log('[Map] Using AwesomeMarkers icon:', markerConfig.color, markerConfig.icon);
    } else {
      // Fallback: Create a colored SVG marker using HTML div element
      console.log('[Map] AwesomeMarkers not available, using SVG fallback marker');
      const colorMap = {
        'blue': '#3388ff',
        'red': '#ff6b6b',
        'green': '#51cf66',
        'orange': '#ffa94d',
        'yellow': '#ffd43b'
      };
      
      const markerColor = colorMap[markerConfig.color] || '#3388ff';
      
      // Map common icon names to emoji for the fallback
      const emojiMap = {
        'truck': '🚚',
        'wrench': '🛠️',
        'check-circle': '✔️',
        'exclamation-triangle': '⚠️',
        'exclamation-circle': '❗',
        'info-circle': 'ℹ️',
        'map-marker': '📍'
      };
      const emoji = emojiMap[markerConfig.icon] || '📍';

      // Create a compact SVG pin with the emoji centered in the white circle
      const html = `
        <div style="width:28px;height:42px;position:relative;display:flex;align-items:flex-start;justify-content:center">
          <svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 0C8 0 3 5 3 11c0 8 11 21 11 21s11-13 11-21C25 5 20 0 14 0z" fill="${markerColor}"/>
            <circle cx="14" cy="11" r="5" fill="#ffffff"/>
          </svg>
          <div style="position:absolute;left:50%;top:22%;transform:translate(-50%,-50%);font-size:12px;line-height:12px">${emoji}</div>
        </div>
      `;

      markerIcon = L.divIcon({
        html: html,
        iconSize: [28, 42],
        iconAnchor: [14, 42],
        popupAnchor: [0, -42],
        className: 'custom-div-marker'
      });
    }

    const marker = L.marker(
      [card.coordinates.lat, card.coordinates.lng],
      {
        icon: markerIcon
      }
    );

    // Build popup: card name (link), list name, description, coords
    const listName = (appState.listMap && appState.listMap[card.idList]) ? appState.listMap[card.idList] : 'Unknown list';
    const safeDesc = escapeHtml(card.desc || '').replace(/\n/g, '<br>');
    const cardUrl = card.shortUrl || `https://trello.com/c/${card.id}`;

    marker.bindPopup(`
      <div class="popup-card">
        <a href="${cardUrl}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(card.name)}</strong></a>
        <div style="font-size:0.9em;color:#666;margin-top:4px">List: ${escapeHtml(listName)}</div>
        <hr style="margin:6px 0;opacity:0.6" />
        <div class="popup-desc" style="max-height:200px;overflow:auto;white-space:pre-wrap">${safeDesc}</div>
        <div style="margin-top:6px;font-size:0.85em;color:#333"><small>${card.coordinates.lat.toFixed(4)}, ${card.coordinates.lng.toFixed(4)}</small></div>
      </div>
    `);

    return marker;
  } catch (error) {
    console.error('[Map] Error creating marker for card', card.id, ':', error);
    return null;
  }
}

function getMarkerConfig(card) {
  try {
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
  } catch (error) {
    console.error('[Map] Error in getMarkerConfig:', error, 'card:', card?.id);
    return { icon: 'map-marker', color: 'blue', prefix: 'fa' };
  }
}

// ============================================================================
// GEOCODING QUEUE
// ============================================================================

function startGeocodingQueue() {
  // Determine first card per list (based on raw Trello 'pos') so we can skip them when blocks request it
  const firstCardByList = {};
  if (Array.isArray(appState.rawCards)) {
    appState.rawCards.forEach(c => {
      const listId = c.idList;
      const pos = typeof c.pos === 'number' ? c.pos : parseFloat(c.pos || 0);
      if (!firstCardByList[listId] || pos < firstCardByList[listId].pos) {
        firstCardByList[listId] = { id: c.id, pos };
      }
    });
  }

  const firstCardIds = new Set(Object.values(firstCardByList).map(x => x.id));

  // Use rawCards (unfiltered) to include all cards, even if they were just made visible
  const cardsToCheck = appState.rawCards || appState.cards;

  // Add only cards from visible blocks that need geocoding to the queue
  appState.geocodingQueue = cardsToCheck.filter(card => {
    // Must have no coordinates
    if (card.coordinates) return false;

    // Must have a description
    if (!card.desc || !card.desc.trim()) return false;

    // Must belong to a visible block
    const block = appState.blocks.find(b => b.listIds?.includes(card.idList));
    if (!block || !appState.visibleBlocks.has(block.id)) {
      return false;
    }

    // Skip template cards if global setting says so
    if (!appState.showTemplates && card.isTemplate) return false;

    // If the block has ignoreFirstCard, skip the list's first card
    if (block.ignoreFirstCard && firstCardIds.has(card.id)) return false;

    return true;
  }).map(card => card.id);

  console.log('[Map] Geocoding queue initialized with', appState.geocodingQueue.length, 'cards from visible blocks');
  console.log('[Map] Queue card IDs:', appState.geocodingQueue);

  processGeocodingQueue();
}

async function processGeocodingQueue() {
  if (appState.isProcessingGeocodeQueue || appState.geocodingQueue.length === 0) {
    console.log('[Map] Geocoding queue processing skipped. Already processing:', appState.isProcessingGeocodeQueue, 'Queue empty:', appState.geocodingQueue.length === 0);
    return;
  }

  appState.isProcessingGeocodeQueue = true;
  showStatusMessage('Decoding addresses...');
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
  // After processing, refresh markers and then hide the status
  try {
    renderMarkers();
  } catch (e) {
    console.warn('[Map] renderMarkers failed after geocoding:', e);
  }
  hideStatusMessage();
  console.log('[Map] Geocoding queue processing complete');
}

function parseAddressFromDescription(desc) {
  if (!desc || !desc.trim()) return null;
  
    // Try to extract Google Maps /place/ link and pull the place text from it (handles google.com.au etc.)
    const mapsPlaceMatch = desc.match(/https?:\/\/(?:www\.)?google\.[^\/\s]+\/maps\/place\/([^\s)]+)/i);
    if (mapsPlaceMatch) {
      const placePart = mapsPlaceMatch[1];
      console.log('[Map] Found Google Maps /place/ URL, placePart:', placePart);

      // Try to extract coordinates from the URL as well (format: /@lat,lng)
      const mapsUrlFullMatch = desc.match(/https?:\/\/(?:www\.)?google\.[^\s]+/i);
      const mapsUrlFull = mapsUrlFullMatch ? mapsUrlFullMatch[0] : null;
      if (mapsUrlFull) {
        const coordMatch = mapsUrlFull.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (coordMatch) {
          console.log('[Map] Extracted coordinates from Maps URL:', coordMatch[1], coordMatch[2]);
          return `${coordMatch[1]},${coordMatch[2]}`;
        }
      }

      // Decode plus signs and percent-encoding to a readable address for geocoding
      try {
        const decoded = decodeURIComponent(placePart.replace(/\+/g, ' '));
        console.log('[Map] Decoded place part for geocoding:', decoded);
        return decoded;
      } catch (e) {
        const fallback = placePart.replace(/\+/g, ' ');
        console.log('[Map] Using fallback place part for geocoding:', fallback);
        return fallback;
      }
    }

  // Try to extract coordinates from description (lat,lng format)
  const coordMatch = desc.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (coordMatch) {
    console.log('[Map] Found coordinates in description:', coordMatch[1], coordMatch[2]);
    return `${coordMatch[1]},${coordMatch[2]}`;
  }

  // Look for address-like patterns (street address)
  // Search for patterns like "123 Street Name, City" or "Street Name, Suburb, State"
  const addressPatterns = [
    /^\d+\s+[A-Za-z\s]+(?:St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Dr|Drive|Way|Court|Ct|Place|Pl|Parkway|Crescent|Cres|Boulevard|Blvd)[^\n]*/i,
    /(?:CNR|Corner)\s+[A-Za-z\s]+[&\/]\s+[A-Za-z\s]+[^\n]*/i,
    /[A-Za-z\s]+(?:VIC|NSW|QLD|SA|WA|TAS|ACT)\s+\d{4}/i
  ];

  for (const pattern of addressPatterns) {
    const match = desc.match(pattern);
    if (match) {
      const address = match[0].trim();
      if (address.length > 5) {
        console.log('[Map] Extracted address pattern:', address);
        return address;
      }
    }
  }

  // Return the first non-empty line as fallback address
  const lines = desc.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length > 0 && lines[0].length > 5) {
    // Skip if it looks like a short code or event number
    if (!/^S\d+|^[A-Z]{2}\d+/.test(lines[0])) {
      console.log('[Map] Using first line as address:', lines[0]);
      return lines[0];
    }
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
  startGeocodingQueue();
});

document.getElementById('clearAllBtn').addEventListener('click', () => {
  appState.visibleBlocks.clear();
  savePreferences();
  renderBlockList();
  renderMarkers();
  updateCardCount();
  // Clearing visibility means no geocoding needed
  appState.geocodingQueue = [];
});

document.getElementById('dashboardBtn').addEventListener('click', () => {
  window.location.href = '/';
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
