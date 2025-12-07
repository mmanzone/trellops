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
  refreshIntervalMs: 30000, // 30 seconds default (max 30 seconds)
  cardSnapshots: new Map() // cardId -> {name, desc, labels, idList} for change detection
};

// ============================================================================
// UI HELPERS
// ============================================================================

function showStatusMessage(message) {
  const statusEl = document.getElementById('statusMessage');
  const statusText = document.getElementById('statusText');
  if (statusEl && statusText) {
    // message can be string or object { text, queue: [names] }
    if (typeof message === 'string') {
      statusText.textContent = message;
      const qEl = document.getElementById('statusQueue'); if (qEl) qEl.innerHTML = '';
    } else if (message && typeof message === 'object') {
      statusText.textContent = message.text || '';
      const qEl = document.getElementById('statusQueue');
      if (qEl) {
        if (Array.isArray(message.queue) && message.queue.length) {
          qEl.innerHTML = '<ul style="padding-left:18px;margin:4px 0">' + message.queue.map(n => `<li>${escapeHtml(n)}</li>`).join('') + '</ul>';
          // mark wide for extra content
          statusEl.classList.add('wide');
        } else {
          qEl.innerHTML = '';
        }
      }
      // Progress handling
      const progressTotal = Number(message.total || 0);
      const progressProcessed = Number(message.processed || 0);
      const progressContainer = statusEl.querySelector('.status-progress') || (() => {
        const div = document.createElement('div');
        div.className = 'status-progress';
        div.innerHTML = '<div class="bar" style="width:0%"></div>';
        statusEl.querySelector('.status-content')?.appendChild(div);
        // add percent text
        const pct = document.createElement('div'); pct.style.fontSize = '0.85em'; pct.style.marginTop = '6px'; pct.className = 'status-percent';
        statusEl.querySelector('.status-content')?.appendChild(pct);
        return div;
      })();
      if (progressTotal > 0) {
        const pct = Math.round((progressProcessed / progressTotal) * 100);
        const bar = progressContainer.querySelector('.bar');
        if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
        const pctEl = statusEl.querySelector('.status-percent'); if (pctEl) pctEl.textContent = `${pct}%`;
      } else {
        const bar = progressContainer.querySelector('.bar'); if (bar) bar.style.width = '0%';
        const pctEl = statusEl.querySelector('.status-percent'); if (pctEl) pctEl.textContent = '';
      }
    }
    statusEl.classList.remove('hidden');
  }
}

function clearStatusQueue() {
  const qEl = document.getElementById('statusQueue');
  if (qEl) qEl.innerHTML = '';
}

function hideStatusMessage() {
  const statusEl = document.getElementById('statusMessage');
  if (statusEl) {
    statusEl.classList.add('hidden');
    statusEl.classList.remove('wide');
  }
  const qEl = document.getElementById('statusQueue'); if (qEl) qEl.innerHTML = '';
  const bar = document.querySelector('#statusMessage .status-progress .bar'); if (bar) bar.style.width = '0%';
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

// Check if card content has changed compared to previous snapshot
function hasCardChanged(card) {
  if (!appState.cardSnapshots.has(card.id)) {
    return true; // New card
  }
  const prev = appState.cardSnapshots.get(card.id);
  const currLabels = (card.labels || []).map(l => l.name || l.color || '').sort().join('|');
  const prevLabels = prev.labels || '';
  return (
    prev.name !== card.name ||
    prev.desc !== card.desc ||
    prev.idList !== card.idList ||
    prevLabels !== currLabels
  );
}

// Snapshot card for change detection
function snapshotCard(card) {
  const labels = (card.labels || []).map(l => l.name || l.color || '').sort().join('|');
  appState.cardSnapshots.set(card.id, {
    name: card.name,
    desc: card.desc,
    labels: labels,
    idList: card.idList
  });
}

// Return a Set of first-card IDs per list based on raw card positions
function getFirstCardIds() {
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
  return new Set(Object.values(firstCardByList).map(x => x.id));
}

function countCardsInBlock(block) {
  if (!block) return 0;
  const firstCardIds = getFirstCardIds();
  return appState.cards.filter(card => {
    if (!block.listIds?.includes(card.idList)) return false;
    if (!appState.showTemplates && card.isTemplate) return false;
    if (block.ignoreFirstCard && firstCardIds.has(card.id)) return false;
    return true;
  }).length;
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
      if (headerTitle) headerTitle.textContent = `${boardData.boardName}`;
      const headerSubtitle = document.querySelector('.sidebar-header p');
      if (headerSubtitle) headerSubtitle.textContent = 'Map View - Filter by block';
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
      // Update header with board name
      const boardTitle = document.getElementById('mapBoardTitle');
      if (boardTitle) boardTitle.textContent = boardData.boardName;
      // Load blocks and cards
      console.log('[Map] Loading blocks...');
      await loadBlocks();
      console.log('[Map] Blocks loaded:', appState.blocks);
      console.log('[Map] Loading cards...');
      // Show progress bar for card loading
      showStatusMessage({ text: 'Loading cards...', processed: 0, total: 1 });
      await loadCards();
      showStatusMessage({ text: 'Parsing cards...', processed: 0, total: appState.cards.length });
      // Always show all cards matching block lists (do not snapshot here — snapshot after markers rendered)
      appState.cards.forEach((card, idx) => {
        showStatusMessage({ text: `Parsing: ${card.name.substring(0, 40)}...`, processed: idx + 1, total: appState.cards.length });
      });
      // Initialize UI
      renderBlockList();
      updateCardCount();
      // Initialize clock if enabled
      initializeClockDisplay();
      // Restore saved preferences
      restorePreferences();
      console.log('[Map] Visible blocks:', Array.from(appState.visibleBlocks));
      // Render markers for all cards matching block lists
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
      loadRefreshInterval();
      startAutoRefresh();
      hideStatusMessage();
      console.log('[Map] Initialization complete!');

      // ============================================================================
      // EVENT HANDLERS (added inside DOMContentLoaded to ensure DOM is ready)
      // ============================================================================

      // Dashboard button (footer) - open in new window
      const dashboardBtnFooter = document.getElementById('dashboardBtnFooter');
      if (dashboardBtnFooter) {
        dashboardBtnFooter.addEventListener('click', () => { window.open('/', '_blank'); });
      }

      // Settings button (footer) - redirect to dashboard settings
      const footerSettingsBtn = document.getElementById('footerSettingsBtn');
      if (footerSettingsBtn) {
        footerSettingsBtn.addEventListener('click', () => {
          // Store flag to open settings on dashboard
          localStorage.setItem('openSettingsOnLoad', 'true');
          window.location.href = '/';
        });
      }

      // Logout button
      const logoutBtn = document.getElementById('logoutBtnFooter');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
          if (confirm('Are you sure you want to log out?')) {
            // Clear session
            const storedUserId = localStorage.getItem('trelloCurrentUser');
            if (storedUserId) {
              const allUserData = JSON.parse(localStorage.getItem('trelloUserData')) || {};
              delete allUserData[storedUserId];
              localStorage.setItem('trelloUserData', JSON.stringify(allUserData));
            }
            localStorage.removeItem('trelloCurrentUser');
            window.location.href = '/';
          }
        });
      }

      // Select/Clear All buttons
      const selectAllBtnEl = document.getElementById('selectAllBtn');
      if (selectAllBtnEl) {
        selectAllBtnEl.addEventListener('click', () => {
          appState.visibleBlocks.clear();
          appState.blocks.forEach(block => appState.visibleBlocks.add(block.id));
          savePreferences();
          renderBlockList();
          renderMarkers();
          updateCardCount();
          startGeocodingQueue();
          appState.geocodingQueue = [];
        });
      }

      const clearAllBtnEl = document.getElementById('clearAllBtn');
      if (clearAllBtnEl) {
        clearAllBtnEl.addEventListener('click', () => {
          appState.visibleBlocks.clear();
          savePreferences();
          renderBlockList();
          renderMarkers();
          updateCardCount();
          appState.geocodingQueue = [];
        });
      }

      // Toggle listeners
      document.getElementById('showCompletedToggle')?.addEventListener('change', (e) => {
        appState.showCompleted = e.target.checked;
        localStorage.setItem(CONFIG.STORAGE_KEYS.SHOW_COMPLETED, appState.showCompleted ? 'true' : 'false');
      });

      document.getElementById('showTemplatesToggle')?.addEventListener('change', (e) => {
        appState.showTemplates = e.target.checked;
        localStorage.setItem(CONFIG.STORAGE_KEYS.SHOW_TEMPLATES, appState.showTemplates ? 'true' : 'false');
      });

      // Modal click handler
      document.getElementById('settingsModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('settingsModal')) {
          document.getElementById('settingsModal').classList.remove('active');
        }
      });
    } catch (error) {
      console.error('[Map] Initialization error:', error);
      showError(`Failed to initialize map: ${error.message}`);
    }
  });
});

// ============================================================================
// CLOCK DISPLAY
// ============================================================================

function initializeClockDisplay() {
  try {
    const boardId = appState.selectedBoardId;
    if (!boardId) return;
    
    // Check if clock is enabled in dashboard settings for this board
    const clockEnabled = localStorage.getItem(`dashboardClockSetting_${boardId}`) !== 'false';
    const clockEl = document.getElementById('mapHeaderClock');
    
    if (!clockEl) return;
    
    if (!clockEnabled) {
      clockEl.classList.add('hidden');
      return;
    }
    
    clockEl.classList.remove('hidden');
    updateClockDisplay();
    
    // Update clock every second
    if (appState.clockInterval) clearInterval(appState.clockInterval);
    appState.clockInterval = setInterval(updateClockDisplay, 1000);
  } catch (e) {
    console.warn('[Map] Failed to initialize clock display:', e);
  }
}

function updateClockDisplay() {
  const clockEl = document.getElementById('mapHeaderClock');
  if (!clockEl) return;
  
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  clockEl.textContent = `${hours}:${minutes}:${seconds}`;
}

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

  // Base layers
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  });

  const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri',
    maxZoom: 19
  });

  const dark = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri',
    maxZoom: 19
  });

  // Default add OSM
  osm.addTo(appState.map);

  appState.baseLayers = { osm, esriSat, dark };

  // Basemap control element
  const basemapSelect = document.getElementById('basemapSelect');
  if (basemapSelect) {
    basemapSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      // remove all
      Object.values(appState.baseLayers).forEach(layer => {
        try { appState.map.removeLayer(layer); } catch (err) {}
      });
      if (val === 'osm') appState.baseLayers.osm.addTo(appState.map);
      else if (val === 'sat') appState.baseLayers.esriSat.addTo(appState.map);
      else if (val === 'dark') appState.baseLayers.dark.addTo(appState.map);
    });
  }
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
      await doRefreshCycle();
    } catch (error) {
      console.error('[Map] Error during auto-refresh:', error);
    }
  }, appState.refreshIntervalMs);

  // countdown timer for display
  if (appState.countdownTimer) clearInterval(appState.countdownTimer);
  appState.nextRefreshAt = Date.now() + appState.refreshIntervalMs;
  appState.countdownTimer = setInterval(updateRefreshCountdown, 1000);

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
    await doRefreshCycle();
  } catch (error) {
    console.error('[Map] Error during manual refresh:', error);
    showError('Failed to refresh map data');
  }
}

async function doRefreshCycle() {
  // perform a refresh: reload cards, render markers and start geocoding
  await loadCards();
  renderMarkers();
  startGeocodingQueue();
  // reset next refresh timestamp
  appState.nextRefreshAt = Date.now() + appState.refreshIntervalMs;
}

function loadRefreshInterval() {
  try {
    const dashboardSettings = localStorage.getItem('dashboardSettings');
    if (dashboardSettings) {
      const settings = JSON.parse(dashboardSettings);
      // allow refreshInterval in seconds or ms; if <1000 assume seconds
      if (settings.refreshInterval && settings.refreshInterval > 0) {
        let val = Number(settings.refreshInterval);
        if (val < 1000) val = val * 1000;
        // Cap at 30 seconds maximum
        val = Math.min(val, 30000);
        appState.refreshIntervalMs = val;
      }
    }
  } catch (e) {
    console.warn('[Map] loadRefreshInterval failed, using default', e);
  }
}

function updateRefreshCountdown() {
  const el = document.getElementById('refreshCountdown');
  if (!el) return;
  const remaining = Math.max(0, appState.nextRefreshAt - Date.now());
  const seconds = Math.ceil(remaining / 1000);
  el.textContent = `${seconds}s`;
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
  // Render blocks in the header
  const headerList = document.getElementById('blockListHeader');
  if (headerList) headerList.innerHTML = '';

  appState.blocks.forEach(block => {
    const cardsInBlock = countCardsInBlock(block);

    // Header block list item
    if (headerList) {
      const blockEl = document.createElement('div');
      blockEl.className = 'block-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `block-${block.id}`;
      checkbox.checked = appState.visibleBlocks.has(block.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) appState.visibleBlocks.add(block.id);
        else appState.visibleBlocks.delete(block.id);
        savePreferences();
        renderMarkers();
        updateCardCount();
        // Ensure any newly-visible cards without coordinates are enqueued for geocoding
        enqueueMissingCoordinatesForVisibleCards(true);
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

      headerList.appendChild(blockEl);
    }
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
  const indicator = document.getElementById('mapCardCount');
  if (indicator) {
    indicator.textContent = `${visibleCards.length} cards`;
  }
}

function getVisibleCards() {
  const firstCardIds = getFirstCardIds();
  return appState.cards.filter(card => {
    const block = appState.blocks.find(b => b.listIds?.includes(card.idList));
    if (!block || !appState.visibleBlocks.has(block.id)) return false;
    // Exclude template cards when showTemplates is false
    if (!appState.showTemplates && card.isTemplate) return false;
    // Exclude first card of list when the block requests it
    if (block.ignoreFirstCard && firstCardIds.has(card.id)) return false;
    return true;
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
      // Update position if changed
      try {
        existingMarker.setLatLng([coords.lat, coords.lng]);
      } catch (e) {
        console.warn('[Map] Failed to set marker position for', card.id, e);
      }

      // Prepare a small metadata snapshot for comparison
      const newMeta = {
        id: card.id,
        name: card.name,
        idList: card.idList,
        labels: (card.labels || []).map(l => (l.name || l.color || '').toLowerCase()).join(',')
      };

      // If metadata changed (label or list or name), update icon and popup
      const oldMeta = existingMarker._cardMeta || {};
      if (JSON.stringify(oldMeta) !== JSON.stringify(newMeta)) {
        // Update icon
        const markerConfig = getMarkerConfig(card);
        const newIcon = getMarkerIcon(markerConfig);
        existingMarker.setIcon(newIcon);
        console.log('[Map] Updated marker icon for card:', card.id, 'icon:', markerConfig.icon, 'color:', markerConfig.color);
        // Update popup
        try {
          existingMarker.setPopupContent(getPopupHtml(card));
        } catch (e) {
          console.warn('[Map] Failed to update popup for', card.id, e);
        }
        existingMarker._cardMeta = newMeta;
      }

      // Snapshot card after ensuring marker/meta is up to date
      try {
        snapshotCard(card);
      } catch (e) {
        console.warn('[Map] Failed to snapshot card after updating marker:', card.id, e);
      }

      bounds.extend([coords.lat, coords.lng]);
      hasMarkers = true;
      return; // Keep existing marker
    }

    console.log('[Map] Creating marker for card:', card.id, card.name, 'at', coords.lat, coords.lng);
    
    // Create a card object with parsed coordinates
    const cardWithCoords = { ...card, coordinates: coords };
    const marker = createMarker(cardWithCoords);
    if (marker) {
      marker.addTo(appState.map);
      appState.markers.set(card.id, marker);
      console.log('[Map] Created marker and set icon for card:', card.id);
      bounds.extend([coords.lat, coords.lng]);
      hasMarkers = true;
      // Snapshot card after creating marker so it won't be re-queued
      try {
        snapshotCard(card);
      } catch (e) {
        console.warn('[Map] Failed to snapshot card after creating marker:', card.id, e);
      }
    }
  });

  console.log('[Map] Total markers created:', appState.markers.size);

  // Auto-zoom to fit all markers (compute bounds from all current markers to ensure all are included)
  const markerBounds = L.latLngBounds();
  let anyMarker = false;
  for (const [, m] of appState.markers.entries()) {
    try {
      const latlng = m.getLatLng();
      if (latlng && typeof latlng.lat === 'number') {
        markerBounds.extend(latlng);
        anyMarker = true;
      }
    } catch (e) {
      console.warn('[Map] Failed to read marker LatLng for bounds:', e);
    }
  }

  if (anyMarker && markerBounds.isValid()) {
    console.log('[Map] Fitting bounds to all markers...');
    appState.map.fitBounds(markerBounds, { padding: [50, 50], maxZoom: 15 });
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
    console.log('[Map] createMarker: markerConfig for', card.id, markerConfig);
    const markerIcon = getMarkerIcon(markerConfig);

    const marker = L.marker(
      [card.coordinates.lat, card.coordinates.lng],
      {
        icon: markerIcon
      }
    );

    const popupHtml = getPopupHtml(card);
    marker.bindPopup(popupHtml);

    // store a small metadata snapshot on the marker to make updates possible
    marker._cardMeta = {
      id: card.id,
      name: card.name,
      idList: card.idList,
      labels: (card.labels || []).map(l => (l.name || l.color || '').toLowerCase()).join(',')
    };

    return marker;
  } catch (error) {
    console.error('[Map] Error creating marker for card', card.id, ':', error);
    return null;
  }
}

// Build popup HTML for a card
function getPopupHtml(card) {
  const listName = (appState.listMap && appState.listMap[card.idList]) ? appState.listMap[card.idList] : escapeHtml(card.idList || '');
  const safeDesc = escapeHtml(card.desc || '').replace(/\n/g, '<br>');
  const cardUrl = card.shortUrl || `https://trello.com/c/${card.id}`;

  // Build labels HTML
  const labelColorMap = {
    green: '#51cf66',
    yellow: '#ffd43b',
    orange: '#ffa94d',
    red: '#ff6b6b',
    purple: '#845ef7',
    blue: '#4dabf7',
    sky: '#74c0fc',
    lime: '#b8e986',
    pink: '#ff6bcb',
    black: '#555'
  };

  const labelsHtml = (card.labels || []).map(l => {
    const color = labelColorMap[(l.color || '').toLowerCase()] || '#999';
    const name = escapeHtml(l.name || '');
    return `<span style="display:inline-block;padding:4px 8px;border-radius:12px;background:${color};color:#fff;margin-right:6px;font-size:0.8em">${name}</span>`;
  }).join('');

  return `
    <div class="popup-card">
      <a href="${cardUrl}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(card.name)}</strong></a>
      <div style="font-size:0.95em;color:#222;margin-top:6px">${escapeHtml(listName)}</div>
      <div style="margin-top:6px">${labelsHtml}</div>
      <hr style="margin:6px 0;opacity:0.6" />
      <div class="popup-desc" style="max-height:200px;overflow:auto;white-space:pre-wrap">${safeDesc}</div>
      <div style="margin-top:6px;font-size:0.85em;color:#333"><small>${card.coordinates.lat.toFixed(4)}, ${card.coordinates.lng.toFixed(4)}</small></div>
    </div>
  `;
}

// Create a marker icon (AwesomeMarkers if available, otherwise styled divIcon with drop shadow)
function getMarkerIcon(markerConfig) {
  if (typeof L !== 'undefined' && L.AwesomeMarkers && L.AwesomeMarkers.icon) {
    return L.AwesomeMarkers.icon({
      icon: markerConfig.icon || 'map-marker',
      prefix: markerConfig.prefix || 'fa',
      markerColor: markerConfig.color || 'blue'
    });
  }

  const colorMap = {
    'blue': '#3388ff',
    'red': '#ff6b6b',
    'green': '#51cf66',
    'orange': '#ffa94d',
    'yellow': '#ffd43b'
  };
  const markerColor = colorMap[markerConfig.color] || '#3388ff';

  let innerSvg = '';
  const icon = (markerConfig.icon || '').toLowerCase();
  if (icon === 'truck' || icon === 'delivery' || icon === 'car') {
    innerSvg = `<svg width="18" height="12" viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg" fill="none">
      <rect x="1" y="4" width="14" height="8" rx="1" fill="#fff" stroke="#000" stroke-opacity="0.25" stroke-width="0.6" />
      <rect x="15" y="8" width="6" height="4" rx="1" fill="#fff" stroke="#000" stroke-opacity="0.25" stroke-width="0.6" />
      <circle cx="7" cy="13" r="1.6" fill="#fff" stroke="#000" stroke-opacity="0.25" stroke-width="0.6" />
      <circle cx="17" cy="13" r="1.6" fill="#fff" stroke="#000" stroke-opacity="0.25" stroke-width="0.6" />
    </svg>`;
  } else if (icon === 'wrench' || icon === 'tool' || icon === 'onsite' || icon === 'on site') {
    innerSvg = `<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none">
      <path d="M21.7 12.3l-2-2c-.4-.4-1-.4-1.4 0l-1 1-3.3-3.3 1-1c.4-.4.4-1 0-1.4l-2-2c-.4-.4-1-.4-1.4 0L6 6.6c-2.6 2.6-2.6 6.8 0 9.4s6.8 2.6 9.4 0l4.9-4.9c.4-.4.4-1 0-1.4z" fill="#fff" stroke="#000" stroke-opacity="0.25" stroke-width="0.6"/>
    </svg>`;
  } else if (icon === 'check-circle') {
    innerSvg = `<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M9 16.2l-3.5-3.5L4 14.2 9 19.2 20 8.2 18.6 6.8z" fill="#fff" stroke="#000" stroke-opacity="0.25" stroke-width="0.6"/></svg>`;
  } else if (icon === 'exclamation-triangle' || icon === 'exclamation-circle') {
    innerSvg = `<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" fill="#fff" stroke="#000" stroke-opacity="0.25" stroke-width="0.6"/></svg>`;
  } else {
    innerSvg = `<svg width="12" height="12" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="5" fill="#fff" stroke="#000" stroke-opacity="0.25" stroke-width="0.6"/></svg>`;
  }

  const html = `
    <div style="width:28px;height:42px;position:relative;display:flex;align-items:flex-start;justify-content:center;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.35));">
      <svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 0C8 0 3 5 3 11c0 8 11 21 11 21s11-13 11-21C25 5 20 0 14 0z" fill="${markerColor}"/>
        <circle cx="14" cy="11" r="5" fill="${markerColor}"/>
      </svg>
      <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);line-height:1;">${innerSvg}</div>
    </div>
  `;

  const safeIconClass = `custom-div-marker--${icon.replace(/[^a-z0-9_-]/g, '-')}`;
  return L.divIcon({
    html: html,
    iconSize: [28, 42],
    iconAnchor: [14, 42],
    popupAnchor: [0, -42],
    className: `custom-div-marker ${safeIconClass}`
  });
}

function getMarkerConfig(card) {
  try {
    // Check for specific labels in priority order (case-insensitive)
    const labels = (card.labels || []).map(l => (l.name || l.color || '').toLowerCase());

    // Determine icon based on status labels (En route = truck, On Site = wrench)
    let icon = 'map-marker';
    if (labels.includes('en route') || labels.includes('enroute') || labels.includes('en-route')) {
      icon = 'truck';
    } else if (labels.includes('on scene') || labels.includes('on site') || labels.includes('onscene') || labels.includes('onsite')) {
      icon = 'wrench';
    } else if (labels.includes('completed')) {
      icon = 'check-circle';
    }

    // Determine color based on priority labels
    let color = 'blue'; // default
    if (labels.includes('priority')) {
      color = 'red';
    } else if (labels.includes('important')) {
      color = 'orange';
    } else if (labels.includes('routine')) {
      color = 'yellow';
    } else if (labels.includes('completed')) {
      color = 'green';
    }

    return { icon: icon, color: color, prefix: 'fa' };
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

  // Add only cards from visible blocks that have changed and need geocoding to the queue
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

    // Only geocode if card content has changed since last run (on initial load or on updates)
    if (!hasCardChanged(card)) return false;

    return true;
  }).map(card => card.id);

  console.log('[Map] Geocoding queue initialized with', appState.geocodingQueue.length, 'cards from visible blocks');
  console.log('[Map] Queue card IDs:', appState.geocodingQueue);

  processGeocodingQueue();
}

/**
 * Ensure visible cards that lack coordinates are added to the geocoding queue.
 * If `force` is true, ignore the `hasCardChanged` check so user actions (like
 * re-checking a block) will trigger geocoding for those cards.
 */
function enqueueMissingCoordinatesForVisibleCards(force = false) {
  const visibleCards = getVisibleCards();
  const needIds = visibleCards.filter(card => {
    if (card.coordinates) return false;
    if (!card.desc || !card.desc.trim()) return false;
    // if not forcing, respect hasCardChanged() to avoid reprocessing unchanged cards
    if (!force && !hasCardChanged(card)) return false;
    return true;
  }).map(c => c.id);

  // Add to queue if not already present
  const existing = new Set(appState.geocodingQueue || []);
  for (const id of needIds) {
    if (!existing.has(id)) appState.geocodingQueue.push(id);
  }

  if ((needIds.length > 0)) {
    console.log('[Map] Enqueued missing-coordinate visible cards (force=' + !!force + '):', needIds);
    processGeocodingQueue();
  }
}

async function processGeocodingQueue() {
  if (appState.isProcessingGeocodeQueue || appState.geocodingQueue.length === 0) {
    console.log('[Map] Geocoding queue processing skipped. Already processing:', appState.isProcessingGeocodeQueue, 'Queue empty:', appState.geocodingQueue.length === 0);
    return;
  }

  appState.isProcessingGeocodeQueue = true;
  const initialQueue = appState.geocodingQueue.slice();
  let processedCount = 0;
  const totalToProcess = initialQueue.length;
  
  // Only show decoding if there are items in the queue
  if (totalToProcess > 0) {
    showStatusMessage({ text: 'Geocoding in progress...', processed: processedCount, total: totalToProcess });
  }
  console.log('[Map] Starting geocoding queue processing...');

  while (appState.geocodingQueue.length > 0) {
    const cardId = appState.geocodingQueue.shift();
    const card = appState.cards.find(c => c.id === cardId);

    if (!card || !card.desc) {
      console.log('[Map] Skipping card', cardId, '- no card or description found');
      processedCount++;
      if (totalToProcess > 0) {
        showStatusMessage({ text: `Geocoding in progress...`, processed: processedCount, total: totalToProcess });
      }
      continue;
    }

    try {
      console.log('[Map] Processing card for geocoding:', cardId, card.name);
      // Update status with current card being processed
      if (totalToProcess > 0) {
        showStatusMessage({ text: `Geocoding: ${card.name.substring(0, 40)}...`, processed: processedCount, total: totalToProcess });
      }
      
      const address = parseAddressFromDescription(card.desc);
      console.log('[Map] Parsed address from description:', address);
      
      if (!address) {
        console.log('[Map] No address found in description for card', cardId);
        processedCount++;
        if (totalToProcess > 0) {
          showStatusMessage({ text: `Geocoding in progress...`, processed: processedCount, total: totalToProcess });
        }
        snapshotCard(card);
        continue;
      }

      const coordinates = await geocodeAddress(address);
      console.log('[Map] Geocoded address to coordinates:', coordinates);
      
      if (!coordinates) {
        console.log('[Map] Geocoding failed for address:', address);
        processedCount++;
        if (totalToProcess > 0) {
          showStatusMessage({ text: `Geocoding in progress...`, processed: processedCount, total: totalToProcess });
        }
        snapshotCard(card);
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
          // Snapshot so it won't be re-queued
          try { snapshotCard(card); } catch (e) { console.warn('[Map] Failed to snapshot card after geocoding:', cardId, e); }
        }
      }

      // Snapshot card after successful processing
      snapshotCard(card);

      // Respect rate limiting
      await sleep(CONFIG.GEOCODING.DELAY_MS);

      // Update progress
      processedCount++;
      if (totalToProcess > 0) {
        showStatusMessage({ text: `Geocoding in progress...`, processed: processedCount, total: totalToProcess });
      }
    } catch (error) {
      console.error(`[Map] Error geocoding card ${cardId}:`, error);
      processedCount++;
      if (totalToProcess > 0) {
        showStatusMessage({ text: `Geocoding in progress...`, processed: processedCount, total: totalToProcess });
      }
      snapshotCard(card);
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
  clearStatusQueue();
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
