import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, useMap, Marker, Popup } from 'react-leaflet';
import { formatCountdown } from '/src/utils/timeUtils';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '/src/styles/map.css';
import { trelloFetch } from '/src/api/trello';
import { getPersistentLayout } from '/src/utils/persistence';
import { useDarkMode } from '/src/context/DarkModeContext';
import { STORAGE_KEYS } from '/src/utils/constants';
import { convertIntervalToSeconds, getLabelTextColor } from '/src/utils/helpers';
import DigitalClock from './common/DigitalClock';
import { ICONS } from './common/IconPicker';
import { marked } from 'marked';
import MapFilters from './MapFilters';

// --- ICONS LOGIC ---
const getMarkerIcon = (markerConfig) => {
    const colorMap = {
        'blue': '#3388ff', 'red': '#ff6b6b', 'green': '#51cf66',
        'orange': '#ffa94d', 'yellow': '#ffd43b', 'grey': '#868e96', 'black': '#343a40',
        'purple': '#9c27b0'
    };
    const markerColor = colorMap[markerConfig.color] || colorMap['blue'];
    const iconName = (markerConfig.icon || 'map-marker').toLowerCase();

    // Retrieve SVG path from ICONS constant, fallback to map-marker if not found
    const svgPath = ICONS[iconName] || ICONS['map-marker'];

    // Construct the SVG string
    // We colored the path with white/black before, but user wants colored markers.
    // Let's keep the marker shape colored and the icon inside white?
    // OR: The user is selecting "Marker Colour".
    // Strategy: Use a standard pin shape in the selected color, and overlay the selected icon in White.

    // Pin Shape SVG (Standard Leaflet-ish shape)
    const pinPath = `<path d="M14 0C8 0 3 5 3 11c0 8 11 21 11 21s11-13 11-21C25 5 20 0 14 0z" fill="${markerColor}"/>`;

    // Inner Icon: Scale and position it inside the pin
    // The pin is ~28x42. The head is circle r=11 at (14,11).
    // Our icons are 24x24 viewBox. We need to scale them to fit in approx 14x14 box centered at (14,11).
    // Center: 14,11. Size 14. Top-Left: 7, 4.
    const innerIconGroup = `<g transform="translate(7, 4) scale(0.58)" fill="#fff">${svgPath}</g>`;

    const html = `<svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 3px 4px rgba(0,0,0,0.4));">
        ${pinPath}
        ${innerIconGroup}
    </svg>`;

    return L.divIcon({
        html: `<div style="width:28px;height:42px;display:block;">${html}</div>`,
        iconSize: [28, 42],
        iconAnchor: [14, 42],
        popupAnchor: [0, -42],
        className: `custom-div-marker`
    });
};

const getMarkerConfig = (card, block, markerRules) => {
    // 1. Initial Defaults
    let icon = block.mapIcon || 'map-marker';
    let color = 'blue'; // Default color
    const activeRuleIds = ['default']; // Always include default base

    // 2. Apply Rules
    let iconSet = false;
    let colorSet = false;

    if (markerRules && markerRules.length > 0) {
        for (const rule of markerRules) {
            if (iconSet && colorSet) break;

            if (card.labels && card.labels.some(l => l.id === rule.labelId)) {
                if (rule.overrideType === 'icon' && !iconSet) {
                    icon = rule.overrideValue;
                    iconSet = true;
                    // Replace 'default' if we have a specific rule? 
                    // Or just add this rule ID.
                    activeRuleIds.push(rule.id);
                } else if (rule.overrideType === 'color' && !colorSet) {
                    color = rule.overrideValue;
                    colorSet = true;
                    activeRuleIds.push(rule.id);
                }
            }
        }
    }

    // If any rule was applied, we might want to remove 'default' if 'default' implies "No Rule Applied".
    // But for filtering "Default / No Rule", we usually mean "Cards that didn't trigger any custom rule".
    // So if (activeRuleIds.length > 1), we remove 'default'.
    if (activeRuleIds.length > 1) {
        const index = activeRuleIds.indexOf('default');
        if (index > -1) activeRuleIds.splice(index, 1);
    }

    return { icon, color, activeRuleIds };
};

// --- GEOCODING UTILS ---
function expandAbbreviations(address) {
    if (!address) return address;
    let expanded = address;

    // "CNR" or "Corner" at start
    expanded = expanded.replace(/^(?:CNR|Corner)\s+/i, 'Corner of ');

    // Standard Suffixes (Case insensitive, word boundary)
    // We use a mapping for common ones
    const replacements = [
        [/\bRd\b/gi, 'Road'],
        [/\bAv\b/gi, 'Avenue'],
        [/\bAve\b/gi, 'Avenue'],
        [/\bSt\b/gi, 'Street'],
        [/\bDr\b/gi, 'Drive'],
        [/\bLn\b/gi, 'Lane'],
        [/\bCt\b/gi, 'Court'],
        [/\bPl\b/gi, 'Place'],
        [/\bCres\b/gi, 'Crescent'],
        [/\bBlvd\b/gi, 'Boulevard'],
        [/\bPde\b/gi, 'Parade'],
        [/\bHwy\b/gi, 'Highway'],
        [/\bFwy\b/gi, 'Freeway'],
    ];

    replacements.forEach(([regex, replacement]) => {
        expanded = expanded.replace(regex, replacement);
    });

    return expanded;
}

async function geocodeAddress(address) {
    try {
        const coordMatch = address.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
        if (coordMatch) {
            return {
                lat: parseFloat(coordMatch[1]),
                lng: parseFloat(coordMatch[2])
            };
        }

        const encoded = encodeURIComponent(address);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1`;
        const resp = await fetch(url, { headers: { 'User-Agent': 'TrellopsDashboard/1.0' } });
        if (resp.ok) {
            const data = await resp.json();
            if (data && data.length > 0) {
                return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
            }
        }
    } catch (e) {
        throw new Error("Nominatim Error");
    }
    return null;
}

const parseAddressFromDescription = (desc) => {
    if (!desc || !desc.trim()) return null;

    const mapsPlaceMatch = desc.match(/https?:\/\/(?:www\.)?google\.[^\/\s]+\/maps\/place\/([^\s)]+)/i);
    if (mapsPlaceMatch) {
        const placePart = mapsPlaceMatch[1];
        const mapsUrlFullMatch = desc.match(/https?:\/\/(?:www\.)?google\.[^\s]+/i);
        const mapsUrlFull = mapsUrlFullMatch ? mapsUrlFullMatch[0] : null;
        if (mapsUrlFull) {
            const coordMatch = mapsUrlFull.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (coordMatch) {
                return `${coordMatch[1]},${coordMatch[2]}`;
            }
        }
        try {
            return decodeURIComponent(placePart.replace(/\+/g, ' '));
        } catch (e) {
            return placePart.replace(/\+/g, ' ');
        }
    }

    const coordMatch = desc.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (coordMatch) {
        return `${coordMatch[1]},${coordMatch[2]}`;
    }

    const addressPatterns = [
        /^\d+\s+[A-Za-z\s]+(?:St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Dr|Drive|Way|Court|Ct|Place|Pl|Parkway|Crescent|Cres|Boulevard|Blvd)[^\n]*/i,
        /(?:CNR|Corner)\s+[A-Za-z\s]+[&\/]\s+[A-Za-z\s]+[^\n]*/i,
        /[A-Za-z\s]+(?:VIC|NSW|QLD|SA|WA|TAS|ACT)\s+\d{4}/i
    ];

    for (const pattern of addressPatterns) {
        const match = desc.match(pattern);
        if (match) {
            const address = match[0].trim();
            if (address.length > 5) return address;
        }
    }

    const lines = desc.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length > 0 && lines[0].length > 5) {
        if (!/^S\d+|^[A-Z]{2}\d+/.test(lines[0])) {
            return lines[0];
        }
    }

    return null;
};

// --- TILE LAYERS ---
const TILE_LAYERS = {
    'topo': { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles © Esri', name: 'Topographic (Esri)' },
    'osm': { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors', name: 'OpenStreetMap' },
    'osmhot': { url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors', name: 'OSM Hotspot' },
    'sat': { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles © Esri', name: 'Satellite (Esri)' },
    'dark': { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles © Esri', name: 'Dark Gray (Esri)' },
};

const MapBounds = ({ fitTrigger, visibleCards, homeLocation, showHomeLocation, prevSignatureRef }) => {
    const map = useMap();


    const calculateBounds = useCallback(() => {
        const points = [];
        // Add Cards
        if (visibleCards.length > 0) {
            visibleCards.forEach(c => {
                if (c.coordinates && c.coordinates.lat && c.coordinates.lng) {
                    points.push([c.coordinates.lat, c.coordinates.lng]);
                }
            });
        }
        // Add Home
        if (homeLocation && showHomeLocation && homeLocation.coords) {
            points.push([homeLocation.coords.lat, homeLocation.coords.lon]);
        }
        return points;
    }, [visibleCards, homeLocation, showHomeLocation]);

    // Auto Fit on Data Change (Smart Zoom)
    useEffect(() => {
        // Generate content signature to detect ADD/REMOVE
        const cardKeys = visibleCards.map(c => c.id).sort().join(',');
        const homeKey = (homeLocation && showHomeLocation) ? 'HOME' : '';
        const currentSignature = `${cardKeys}|${homeKey}`;

        // If signature changes, content changed -> Re-fit
        if (currentSignature !== prevSignatureRef.current) {
            const points = calculateBounds();
            if (points.length > 0) {
                const bounds = L.latLngBounds(points);
                if (bounds.isValid()) {
                    map.fitBounds(bounds, { padding: [80, 80] });
                }
            }
            prevSignatureRef.current = currentSignature;
        }
    }, [visibleCards, homeLocation, showHomeLocation, calculateBounds, prevSignatureRef]);

    // Manual Fit Trigger
    useEffect(() => {
        if (fitTrigger > 0) {
            const points = calculateBounds();
            if (points.length > 0) {
                const bounds = L.latLngBounds(points);
                if (bounds.isValid()) {
                    map.fitBounds(bounds, { padding: [80, 80] });
                }
            }
        }
    }, [fitTrigger, calculateBounds]);

    return null;
};

// --- ERROR TOAST COMPONENT ---
const GeocodingErrorToast = ({ error, onDismiss, onApply }) => {
    const [manualAddress, setManualAddress] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const searchTimeoutRef = useRef(null);

    const handleManualAddressChange = (e) => {
        const val = e.target.value;
        setManualAddress(val);

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        if (!val || val.length < 3) {
            setSearchResults([]);
            return;
        }

        setIsSearching(true);
        searchTimeoutRef.current = setTimeout(() => {
            fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&addressdetails=1&limit=5`)
                .then(res => res.json())
                .then(data => {
                    setSearchResults(data);
                    setIsSearching(false);
                })
                .catch(e => {
                    console.error(e);
                    setIsSearching(false);
                });
        }, 1000);
    };

    return (
        <div className="status-message error-toast" style={{
            borderColor: '#ff6b6b',
            width: '350px',
            flexDirection: 'column',
            alignItems: 'flex-start',
            padding: '12px',
            gap: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            backgroundColor: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            marginBottom: '10px',
            animation: 'slideIn 0.3s ease-out'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ color: '#c92a2a', fontWeight: 'bold' }}>Geocoding Error</span>
                <button
                    onClick={() => onDismiss(error.cardId)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2em', padding: '0 4px', color: '#666' }}
                >
                    &times;
                </button>
            </div>

            <div style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                Failed: <strong>
                    <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(error.failedAddress)}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'inherit', textDecoration: 'underline' }}
                    >
                        {error.failedAddress}
                    </a>
                </strong>
            </div>

            {error.cardUrl && (
                <a href={error.cardUrl} target="_blank" rel="noreferrer" style={{ color: '#0057d9', fontSize: '0.9em', textDecoration: 'underline' }}>
                    View Card
                </a>
            )}

            <div style={{ width: '100%', marginTop: '8px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
                <label style={{ fontSize: '0.85em', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
                    Manual Fix (Search Address or paste lat/long):
                </label>
                <div style={{ position: 'relative' }}>
                    <input
                        type="text"
                        value={manualAddress}
                        onChange={handleManualAddressChange}
                        placeholder="Type correct address..."
                        style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                    {isSearching && (
                        <div style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', color: '#888', fontSize: '0.8em' }}>
                            ...
                        </div>
                    )}

                    {searchResults.length > 0 && (
                        <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            zIndex: 3000,
                            background: 'var(--bg-primary)',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            maxHeight: '150px',
                            overflowY: 'auto'
                        }}>
                            {searchResults.map((result, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => onApply(error.cardId, result)}
                                    style={{
                                        padding: '8px',
                                        cursor: 'pointer',
                                        borderBottom: '1px solid #eee',
                                        fontSize: '0.9em'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                >
                                    {result.display_name}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const MapView = ({ user, settings, onClose, onShowSettings, onLogout, onShowTasks }) => {
    const [cards, setCards] = useState([]);
    const [lists, setLists] = useState([]);
    const [boardLabels, setBoardLabels] = useState([]); // NEW: Store labels for filter names
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(true);
    const [geocodingQueue, setGeocodingQueue] = useState([]);
    const [blocks, setBlocks] = useState([]);

    // Footer Dropdowns
    const [showDashboardDropdown, setShowDashboardDropdown] = useState(false); // NEW
    const [showTaskDropdown, setShowTaskDropdown] = useState(false); // NEW

    // FILTER STATE
    const [visibleListIds, setVisibleListIds] = useState(new Set());
    const [visibleRuleIds, setVisibleRuleIds] = useState(new Set(['default']));

    const [baseMap, setBaseMap] = useState('topo');
    const [errors, setErrors] = useState([]); // Array of error objects


    const [fitTrigger, setFitTrigger] = useState(0); // For manual fit bounds
    // const hasInitialZoom = useRef(false); // REMOVED in favor of signature check
    const [markerRules, setMarkerRules] = useState([]);
    const [homeLocation, setHomeLocation] = useState(null);

    // Ref to track map content signature across renders/refreshes
    // Lifted from MapBounds to ensure persistence
    const prevSignatureRef = useRef('');

    const [countdown, setCountdown] = useState(null);

    const { theme, toggleTheme } = useDarkMode();
    const intervalRef = useRef(null);
    const countdownRef = useRef(null);
    const geocodeLoopRef = useRef(false);

    // Reliable Board ID / Name logic
    const getStoredSettings = () => {
        if (!user) return {};
        try {
            return JSON.parse(localStorage.getItem('trelloUserData') || '{}')[user.id]?.settings || {};
        } catch (e) { return {}; }
    };
    const storedSettings = getStoredSettings();
    const boardId = settings?.boardId || storedSettings.boardId;
    const boardName = (settings && settings.boardName)
        ? settings.boardName
        : (storedSettings.boardName || 'Trello Board');

    // Geocoding Settings
    const mapGeocodeMode = (settings && settings.mapGeocodeMode) ? settings.mapGeocodeMode
        : (storedSettings.mapGeocodeMode || 'store'); // 'store' or 'disabled'

    const ignoreTemplateCards = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId) !== 'false';
    const updateTrelloCoordinates = localStorage.getItem('updateTrelloCoordinates_' + boardId) === 'true';

    const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + boardId);
    const defaultRefreshSetting = { value: 1, unit: 'minutes' };
    const refreshSetting = savedRefresh ? JSON.parse(savedRefresh) : defaultRefreshSetting;
    const refreshIntervalSeconds = convertIntervalToSeconds(refreshSetting.value, refreshSetting.unit);

    // Fallback: Default to TRUE if not set (null), otherwise parse 'false'
    const storedClockSetting = localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId);
    const showClock = storedClockSetting !== 'false';

    const saveLocalGeocode = (cId, coords) => {
        try {
            const key = `MAP_GEOCODING_CACHE_${boardId}`;
            const cache = JSON.parse(localStorage.getItem(key) || '{}');
            cache[cId] = coords;
            localStorage.setItem(key, JSON.stringify(cache));
        } catch (e) { }
    };

    const resetLocalGeocodingCache = () => {
        if (window.confirm("Are you sure you want to clear the local geocoding cache? This will force addresses to be re-fetched from Nominatim.")) {
            try {
                const key = `MAP_GEOCODING_CACHE_${boardId}`;
                localStorage.removeItem(key);
                loadData(true);
            } catch (e) {
                console.error("Failed to clear cache", e);
            }
        }
    };

    const updateTrelloCardCoordinates = async (cardId, coords) => {
        if (!updateTrelloCoordinates) return;

        try {
            await trelloFetch(`/cards/${cardId}`, user.token, {
                method: 'PUT',
                body: JSON.stringify({ coordinates: `${coords.lat},${coords.lng}` }),
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        } catch (e) { console.warn("Failed to write back coords", e); }
    };

    // MOVE CARD LOGIC
    const handleMoveCard = async (cardId, listId) => {
        try {
            // Optimistic update? No, safer to wait for API then refresh.
            // Or show spinner?
            await trelloFetch(`/cards/${cardId}?idList=${listId}&pos=bottom`, user.token, {
                method: 'PUT'
            });
            // Refresh Data
            loadData(true);
        } catch (e) {
            console.error("Failed to move card", e);
            alert("Failed to move card to new list.");
        }
    };


    const isFetchingRef = useRef(false);

    const loadData = useCallback(async (isRefresh = false) => {
        if (!user || !boardId) return;
        if (isFetchingRef.current) return; // Prevent overlapping fetches

        isFetchingRef.current = true;
        if (!isRefresh) setLoading(true);
        if (!isRefresh) setStatus('Loading cards...');

        try {
            const currentLayout = getPersistentLayout(user.id, boardId);
            setBlocks(currentLayout);

            // Load Marker Rules
            const rulesKey = `TRELLO_MARKER_RULES_${boardId}`;
            const savedRules = localStorage.getItem(rulesKey);
            if (savedRules) {
                setMarkerRules(JSON.parse(savedRules));
            } else {
                setMarkerRules([]);
            }

            // Load Home Location
            const enableHome = localStorage.getItem(`enableHomeLocation_${boardId}`) === 'true';
            if (enableHome) {
                const homeCoords = JSON.parse(localStorage.getItem(`homeCoordinates_${boardId}`) || 'null');
                const homeIcon = localStorage.getItem(`homeIcon_${boardId}`) || 'home';
                const homeAddress = localStorage.getItem(`homeAddress_${boardId}`) || '';
                if (homeCoords) {
                    setHomeLocation({ coords: homeCoords, icon: homeIcon, address: homeAddress });
                } else {
                    setHomeLocation(null);
                }
            } else {
                setHomeLocation(null);
            }

            if (!isRefresh) {
                // Initialize Visibility
                const allListIds = currentLayout.filter(b => b.includeOnMap !== false).flatMap(b => b.listIds);
                setVisibleListIds(new Set(allListIds));

                const allRuleIds = (savedRules ? JSON.parse(savedRules) : []).map(r => r.id).concat(['default']);
                setVisibleRuleIds(new Set(allRuleIds));
            }

            // FETCH LISTS & LABELS
            const listsPromise = trelloFetch(`/boards/${boardId}/lists?cards=none&fields=id,name`, user.token);
            const labelsPromise = trelloFetch(`/boards/${boardId}/labels`, user.token);
            const cardsPromise = trelloFetch(`/boards/${boardId}/cards?fields=id,name,desc,idList,labels,shortUrl,isTemplate,pos,coordinates,dueComplete&_=${Date.now()}`, user.token);

            const [listsData, labelsData, cardsData] = await Promise.all([listsPromise, labelsPromise, cardsPromise]);

            setLists(listsData);
            setBoardLabels(labelsData);
            const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
            const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');

            const ignoreTemplateCards = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId) !== 'false';
            const ignoreCompletedCards = localStorage.getItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + boardId) === 'true';
            const ignoreNoDescCards = localStorage.getItem('IGNORE_NO_DESC_CARDS_' + boardId) === 'true';

            const processedCards = [];

            for (const c of cardsData) {
                // 1. FILTERING
                if (ignoreTemplateCards && c.isTemplate) continue;
                if (ignoreCompletedCards && c.dueComplete) continue;
                if (ignoreNoDescCards && (!c.desc || !c.desc.trim())) continue;

                // Note: We don't filter by block existence here yet, because some users might 
                // want to see all geocoded cards even if not in a "Block" (legacy behavior).
                // However, the previous logic did not filter by block either at this stage, 
                // it just processed coordinates. Block filtering happens in renderMarkers.

                let coords = null;
                if (c.coordinates) {
                    if (typeof c.coordinates === 'string' && c.coordinates.includes(',')) {
                        const parts = c.coordinates.split(',');
                        if (parts.length === 2) coords = { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
                    } else if (typeof c.coordinates === 'object') {
                        const lat = c.coordinates.lat || c.coordinates.latitude;
                        const lng = c.coordinates.lng || c.coordinates.long || c.coordinates.longitude;
                        if (lat && lng) {
                            coords = { lat: parseFloat(lat), lng: parseFloat(lng) };
                        }
                    }
                }
                if ((!coords || !coords.lat) && cache[c.id]) coords = cache[c.id];
                processedCards.push({ ...c, coordinates: coords });
            }

            setCards(processedCards);

        } catch (e) {
            console.error(e);
            setStatus(`Error: ${e.message}`);
        } finally {
            isFetchingRef.current = false;
            if (!isRefresh) setLoading(false);
            if (!isRefresh) setStatus('');
        }
    }, [user, boardId]);

    useEffect(() => {
        window.scrollTo(0, 0); // Ensure page starts at top
        loadData(false);
    }, [loadData]);


    useEffect(() => {
        if (countdownRef.current) clearInterval(countdownRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);

        if (geocodingQueue.length === 0 && !loading) {
            setCountdown(refreshIntervalSeconds);

            countdownRef.current = setInterval(() => {
                setCountdown(prev => {
                    if (prev !== null && prev > 0) return prev - 1;
                    return prev;
                });
            }, 1000);

            intervalRef.current = setInterval(() => {
                loadData(true);
                setCountdown(refreshIntervalSeconds);
            }, refreshIntervalSeconds * 1000);
        } else {
            setCountdown(null);
        }

        return () => {
            if (countdownRef.current) clearInterval(countdownRef.current);
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [geocodingQueue.length, loading, refreshIntervalSeconds, loadData]);


    useEffect(() => {
        const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
        const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');

        const needGeocoding = cards.filter(c => {
            if (c.coordinates && c.coordinates.lat && c.coordinates.lng) return false;

            if (cache[c.id]) return false;

            // If local geocoding is disabled, stop here
            if (mapGeocodeMode === 'disabled') return false;

            // Note: We don't need strict address parsing check to Queue, but we do it to avoid queuing impossibles
            const addressCandidate = parseAddressFromDescription(c.desc) || (c.name.length > 10 ? c.name : null);

            // STRICTER CHECK IF NOMINATIM IS USED: Require Description
            if (mapGeocodeMode === 'store' && (!c.desc || !c.desc.trim())) return false;

            if (!addressCandidate) return false;

            if (ignoreTemplateCards && c.isTemplate) return false;

            const block = blocks.find(b => b.listIds.includes(c.idList));
            // if (!block || !visibleBlockIds.has(block.id)) return false; // OLD LOGIC
            // NEW LOGIC: Check if list is visible
            if (!visibleListIds.has(c.idList)) return false;

            if (block.ignoreFirstCard) {
                const cardsInList = cards.filter(pc => pc.idList === c.idList);
                const minPos = Math.min(...cardsInList.map(pc => pc.pos));
                if (c.pos === minPos) return false;
            }

            return true;
        }).map(c => c.id);

        if (needGeocoding.length > 0) {
            setGeocodingQueue(prev => {
                const newItems = needGeocoding.filter(id => !prev.includes(id));
                if (newItems.length > 0) return [...prev, ...newItems];
                return prev;
            });
        }

    }, [cards, visibleListIds, blocks, ignoreTemplateCards, boardId, mapGeocodeMode]);


    useEffect(() => {
        if (geocodingQueue.length === 0 || geocodeLoopRef.current) {
            if (geocodingQueue.length === 0 && status.startsWith('Geocoding')) setStatus('');
            return;
        }

        const processQueue = async () => {
            geocodeLoopRef.current = true;

            while (geocodingQueue.length > 0) {
                const cardId = geocodingQueue[0];
                const card = cards.find(c => c.id === cardId);

                if (!card) {
                    setGeocodingQueue(prev => prev.slice(1));
                    continue;
                }

                setStatus(`Geocoding: ${card.name} (${geocodingQueue.length} left)`);
                await new Promise(r => setTimeout(r, 1000));

                try {
                    let address = parseAddressFromDescription(card.desc) || (card.name.length > 5 ? card.name : null);
                    if (address) {
                        // SMART PARSING: Expand Abbreviations
                        address = expandAbbreviations(address);

                        const coords = await geocodeAddress(address);
                        if (coords) {
                            setCards(prev => prev.map(c => c.id === cardId ? { ...c, coordinates: coords } : c));
                            saveLocalGeocode(cardId, coords);
                            if (updateTrelloCoordinates) {
                                updateTrelloCardCoordinates(cardId, coords);
                            }
                        } else {
                            throw new Error(`Nominatim returned no valid results for: ${address}`);
                        }
                    } else {
                        throw new Error("No address found in description or name");
                    }
                } catch (e) {
                    console.warn(`Geocoding failed for ${card.name}:`, e);
                    // Persist error manually
                    const errorObj = {
                        message: `Geocoding failed for: ${card.name}`,
                        cardUrl: card.shortUrl,
                        cardId: card.id,
                        failedAddress: parseAddressFromDescription(card.desc) || (card.name.length > 5 ? card.name : "Unknown")
                    };
                    setErrors(prev => {
                        if (prev.some(e => e.cardId === card.id)) return prev;
                        return [...prev, errorObj];
                    });
                    // Don't auto-dismiss. Let user interact or click close. 
                }

                setGeocodingQueue(prev => prev.slice(1));
                break;
            }
            geocodeLoopRef.current = false;
        };

        processQueue();

    }, [geocodingQueue, cards, status, updateTrelloCoordinates]);

    // --- ERROR HANDLERS ---
    const handleDismissError = (cardId) => {
        setErrors(prev => prev.filter(e => e.cardId !== cardId));
    };

    const handleApplyResult = (cardId, result) => {
        const coords = { lat: parseFloat(result.lat), lng: parseFloat(result.lon) };
        // Apply locally
        setCards(prev => prev.map(c => c.id === cardId ? { ...c, coordinates: coords } : c));
        saveLocalGeocode(cardId, coords);
        // Update Trello if enabled
        if (updateTrelloCoordinates) {
            updateTrelloCardCoordinates(cardId, coords);
        }
        // Dismiss error
        handleDismissError(cardId);
    };

    // --- FILTER HANDLERS ---
    const handleToggleList = (listId) => {
        const next = new Set(visibleListIds);
        if (next.has(listId)) next.delete(listId);
        else next.add(listId);
        setVisibleListIds(next);
        // Force bounds update? Markers useMemo will handle it.
    };

    const handleToggleBlock = (blockId, isChecked) => {
        const block = blocks.find(b => b.id === blockId);
        if (!block) return;

        const next = new Set(visibleListIds);
        block.listIds.forEach(lId => {
            if (isChecked) next.add(lId);
            else next.delete(lId);
        });
        setVisibleListIds(next);
    };

    const handleToggleRule = (ruleId) => {
        const next = new Set(visibleRuleIds);
        if (next.has(ruleId)) next.delete(ruleId);
        else next.add(ruleId);
        setVisibleRuleIds(next);
    };

    const handleToggleAll = (show) => {
        if (show) {
            const allListIds = blocks.filter(b => b.includeOnMap !== false).flatMap(b => b.listIds);
            setVisibleListIds(new Set(allListIds));
            const allRuleIds = markerRules.map(r => r.id).concat(['default']);
            setVisibleRuleIds(new Set(allRuleIds));
            if (homeLocation) setShowHomeLocation(true);
        } else {
            setVisibleListIds(new Set());
            setVisibleRuleIds(new Set());
            setShowHomeLocation(false);
        }
    };

    const handleToggleAllBlocks = (show) => {
        if (show) {
            const allListIds = blocks.filter(b => b.includeOnMap !== false).flatMap(b => b.listIds);
            setVisibleListIds(new Set(allListIds));
        } else {
            setVisibleListIds(new Set());
        }
    };

    const handleToggleAllRules = (show) => {
        if (show) {
            const allRuleIds = markerRules.map(r => r.id).concat(['default']);
            setVisibleRuleIds(new Set(allRuleIds));
        } else {
            setVisibleRuleIds(new Set());
        }
    };

    const [showHomeLocation, setShowHomeLocation] = useState(true); // Default to visible
    const handleToggleHome = () => setShowHomeLocation(prev => !prev);

    // OPTIMIZATION: Memoize filtered cards for both markers AND bounds
    const visibleCards = useMemo(() => {
        return cards
            .filter(c => c.coordinates && c.coordinates.lat && c.coordinates.lng)
            .filter(c => {
                if (ignoreTemplateCards && c.isTemplate) return false;
                if (!visibleListIds.has(c.idList)) return false;

                const block = blocks.find(b => b.listIds.includes(c.idList));
                if (block && block.ignoreFirstCard) {
                    const cardsInList = cards.filter(pc => pc.idList === c.idList);
                    const minPos = cardsInList.reduce((min, cur) => (cur.pos < min ? cur.pos : min), Infinity);
                    if (c.pos === minPos) return false;
                }

                // Rule Visibility Check
                const config = getMarkerConfig(c, block, markerRules);
                if (config.activeRuleIds.some(id => !visibleRuleIds.has(id))) return false;

                return true;
            });
    }, [cards, visibleListIds, visibleRuleIds, blocks, ignoreTemplateCards, markerRules]);

    const markers = useMemo(() => {
        return visibleCards.map(c => {
            const block = blocks.find(b => b.listIds.includes(c.idList));
            const config = getMarkerConfig(c, block || {}, markerRules);
            const listName = lists.find(l => l.id === c.idList)?.name || '';

            return (
                <Marker
                    key={c.id}
                    position={[c.coordinates.lat, c.coordinates.lng]}
                    icon={getMarkerIcon(config)}
                >
                    <Popup>
                        <div className="popup-card">
                            <a href={c.shortUrl} target="_blank" rel="noreferrer"><strong>{c.name}</strong></a>
                            {(listName || block?.name) && (
                                <div style={{ fontWeight: 'bold', fontSize: '1.1em', color: '#444', marginBottom: '6px' }}>
                                    {block ? block.name : ''}{block && listName ? ' - ' : ''}{listName}
                                </div>
                            )}
                            {c.labels && c.labels.length > 0 && (
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', margin: '4px 0' }}>
                                    {c.labels.map((l, i) => (
                                        <span key={i} style={{
                                            backgroundColor: l.color ? (l.color === 'sky' ? '#00c2e0' : l.color) : '#ccc',
                                            color: getLabelTextColor(l.color || 'light'),
                                            border: '1px solid black',
                                            padding: '2px 6px',
                                            borderRadius: '3px',
                                            fontSize: '0.75rem',
                                            fontWeight: 'bold'
                                        }}>
                                            {l.name}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <div className="popup-desc" style={{ whiteSpace: 'pre-wrap', fontSize: '0.9em' }} dangerouslySetInnerHTML={{ __html: marked.parse(c.desc || '') }}></div>
                            <div style={{ marginTop: '8px', fontSize: '0.8em' }}>
                                <a href={`https://www.google.com/maps?q=${c.coordinates.lat},${c.coordinates.lng}`} target="_blank" rel="noreferrer" style={{ color: '#0079bf' }}>
                                    {c.coordinates.lat.toFixed(5)}, {c.coordinates.lng.toFixed(5)}
                                </a>
                            </div>


                            {settings?.enableCardMove && (
                                <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #eee' }}>
                                    <select
                                        value=""
                                        onChange={(e) => {
                                            if (e.target.value) handleMoveCard(c.id, e.target.value);
                                        }}
                                        style={{ width: '100%', fontSize: '0.85em', padding: '2px' }}
                                    >
                                        <option value="">Move to...</option>
                                        {blocks.filter(b => b.includeOnMap !== false).map(block => (
                                            <optgroup key={block.id} label={block.name} style={{ fontWeight: 'bold' }}>
                                                {block.listIds.map(lId => {
                                                    const list = lists.find(l => l.id === lId);
                                                    if (!list) return null;
                                                    return (
                                                        <option
                                                            key={lId}
                                                            value={lId}
                                                            disabled={lId === c.idList}
                                                            style={{ fontWeight: 'normal', color: lId === c.idList ? '#aaa' : 'inherit' }}
                                                        >
                                                            {list.name}
                                                        </option>
                                                    );
                                                })}
                                            </optgroup>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    </Popup>
                </Marker>
            );
        });
    }, [visibleCards, blocks, markerRules, lists, settings?.enableCardMove]);

    const getBlockCount = (block) => {
        return cards.filter(c => {
            if (!block.listIds.includes(c.idList)) return false;
            if (ignoreTemplateCards && c.isTemplate) return false;
            if (block.ignoreFirstCard) {
                const cardsInList = cards.filter(pc => pc.idList === c.idList);
                const minPos = cardsInList.reduce((min, cur) => (cur.pos < min ? cur.pos : min), Infinity);
                if (c.pos === minPos) return false;
            }
            return true;
        }).length;
    };

    // MapBounds moved outside to prevent re-mounting loop

    return (
        <div className="map-container">
            <div className="map-header">
                <div className="map-header-title-area">
                    {showClock && <DigitalClock boardId={boardId} />}
                    <h1 style={{ marginLeft: showClock ? '15px' : '0' }}>{boardName}</h1>
                    <div style={{ marginLeft: '20px' }}>
                        {/* Filters have been moved to MapFilters overlay */}
                    </div>
                </div>
                <div className="map-header-actions">
                    <span className="map-card-count">{markers.length} mapped cards</span>
                    <select
                        value={baseMap}
                        onChange={e => setBaseMap(e.target.value)}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                    >
                        {Object.entries(TILE_LAYERS).map(([key, config]) => (
                            <option key={key} value={key}>{config.name}</option>
                        ))}
                    </select>

                    <button className="theme-toggle-button" onClick={() => toggleTheme()} style={{ marginLeft: '5px' }}>
                        {theme === 'dark' ? '☀️' : '🌙'}
                    </button>
                </div>
            </div>

            <div id="map">
                {/* OVERLAY: Fit Map Button - Moved to Top Left below Zoom controls */}
                <div style={{
                    position: 'absolute',
                    top: '80px',
                    left: '12px',
                    zIndex: 2000,
                    background: 'white',
                    padding: '6px',
                    borderRadius: '4px',
                    border: '2px solid rgba(0,0,0,0.2)',
                    backgroundClip: 'padding-box',
                    boxShadow: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '30px', /* Match Leaflet control width approx */
                    height: '30px'
                }}
                    onClick={() => setFitTrigger(t => t + 1)}
                    title="Fit Map to Markers"
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f4f4f4'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="22" y1="12" x2="18" y2="12"></line>
                        <line x1="6" y1="12" x2="2" y2="12"></line>
                        <line x1="12" y1="6" x2="12" y2="2"></line>
                        <line x1="12" y1="22" x2="12" y2="18"></line>
                    </svg>
                </div>
                <MapContainer center={[51.505, -0.09]} zoom={2} style={{ height: "100%", width: "100%" }}>
                    <TileLayer
                        attribution={TILE_LAYERS[baseMap].attribution}
                        url={TILE_LAYERS[baseMap].url}
                    />

                    <MapFilters
                        blocks={blocks}
                        lists={lists}
                        allLabels={boardLabels}
                        cards={cards}
                        markerRules={markerRules}
                        visibleListIds={visibleListIds}
                        visibleRuleIds={visibleRuleIds}
                        onToggleList={handleToggleList}
                        onToggleBlock={handleToggleBlock}
                        onToggleRule={handleToggleRule}
                        onToggleAll={handleToggleAll}
                        onToggleAllBlocks={handleToggleAllBlocks}
                        onToggleAllRules={handleToggleAllRules}
                        homeLocation={homeLocation}
                        showHomeLocation={showHomeLocation}
                        onToggleHome={handleToggleHome}
                    />

                    {homeLocation && showHomeLocation && (
                        <Marker
                            position={[homeLocation.coords.lat, homeLocation.coords.lon]}
                            icon={getMarkerIcon({ icon: homeLocation.icon, color: 'purple' })}
                        >
                            <Popup>
                                <div className="popup-card">
                                    <strong>Home</strong>
                                    {homeLocation.address && <div style={{ fontSize: '0.9em', marginTop: '5px' }}>{homeLocation.address}</div>}
                                </div>
                            </Popup>
                        </Marker>
                    )}
                    {markers}
                    <MapBounds fitTrigger={fitTrigger} visibleCards={visibleCards} homeLocation={homeLocation} showHomeLocation={showHomeLocation} prevSignatureRef={prevSignatureRef} />
                </MapContainer>
            </div>

            <div className="map-footer">
                <div className="map-footer-left" style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <span style={{ fontSize: '0.85em', color: '#666', display: 'flex', gap: '5px', alignItems: 'center' }}>
                        Map tiles © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> |
                        <a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a> |
                        <a href="https://nominatim.org" target="_blank" rel="noreferrer">Nominatim</a>
                    </span>
                </div>
                <div className="map-footer-right" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    {countdown !== null && (
                        <span className="countdown" style={{ fontSize: '0.9em', color: 'var(--text-secondary)', marginRight: '10px' }}>
                            Next refresh in {formatCountdown(countdown)}
                        </span>
                    )}

                    <button className="refresh-button" onClick={() => {
                        loadData(true);
                        setCountdown(refreshIntervalSeconds);
                    }}>Refresh Map</button>

                    {/* DASHBOARD BUTTON */}
                    <div style={{ position: 'relative' }}>
                        <div style={{ display: 'flex' }}>
                            <button className="dashboard-btn" onClick={onClose}>Dashboard View</button>
                            <button className="settings-button dropdown-arrow" style={{ marginLeft: '-2px', padding: '0 5px' }} onClick={() => setShowDashboardDropdown(!showDashboardDropdown)}>
                                ▼
                            </button>
                        </div>
                        {showDashboardDropdown && (
                            <div className="context-menu" style={{ position: 'absolute', bottom: '100%', left: 0, background: 'var(--bg-primary)', border: '1px solid #ccc', borderRadius: '4px', padding: '5px', minWidth: '150px' }}>
                                <div className="menu-item" onClick={() => { window.open('/dashboard', '_blank'); setShowDashboardDropdown(false); }}>Open in New Tab</div>
                            </div>
                        )}
                    </div>

                    {/* TASKS BUTTON */}
                    {settings?.enableTaskView && (
                        <button className="settings-button" onClick={() => window.open('/tasks', '_blank')}>Tasks View ↗</button>
                    )}

                    <button className="settings-button" onClick={() => {
                        if (onShowSettings) onShowSettings();
                        else onClose();
                    }}>Settings</button>
                    <button className="logout-button" onClick={onLogout}>Log Out</button>
                </div>
            </div>

            {/* Click Outside to Close Dropdowns */}
            {(showDashboardDropdown || showTaskDropdown) && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => { setShowDashboardDropdown(false); setShowTaskDropdown(false); }} />
            )}

            {errors.length > 0 && (
                <div style={{
                    position: 'fixed',
                    bottom: '80px', // Above footer
                    left: '20px',
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column-reverse', // Stack upwards
                    alignItems: 'flex-start',
                    pointerEvents: 'none' // Allow click through on container, re-enable on toasts
                }}>
                    {errors.map(err => (
                        <div key={err.cardId} style={{ pointerEvents: 'auto' }}>
                            <GeocodingErrorToast error={err} onDismiss={handleDismissError} onApply={handleApplyResult} />
                        </div>
                    ))}
                </div>
            )}

        </div>
    );
};

export default MapView;
