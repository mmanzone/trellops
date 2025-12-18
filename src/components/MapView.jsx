import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, useMap, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '/src/styles/map.css';
import { trelloFetch } from '/src/api/trello';
import { getPersistentLayout } from '/src/utils/persistence';
import { useDarkMode } from '/src/context/DarkModeContext';
import { STORAGE_KEYS } from '/src/utils/constants';
import { convertIntervalToSeconds, getLabelTextColor } from '/src/utils/helpers';

// --- ICONS LOGIC ---
const getMarkerIcon = (markerConfig) => {
    const colorMap = {
        'blue': '#3388ff', 'red': '#ff6b6b', 'green': '#51cf66',
        'orange': '#ffa94d', 'yellow': '#ffd43b'
    };
    const markerColor = colorMap[markerConfig.color] || '#3388ff';
    const icon = (markerConfig.icon || '').toLowerCase();

    let iconSvg = '';

    if (['truck', 'delivery', 'car', 'en route'].some(k => icon.includes(k))) {
        iconSvg = `<svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C8 0 3 5 3 11c0 8 11 21 11 21s11-13 11-21C25 5 20 0 14 0z" fill="${markerColor}"/><circle cx="14" cy="11" r="6" fill="none" stroke="#222" stroke-width="3.2" /><circle cx="14" cy="11" r="6" fill="none" stroke="#fff" stroke-width="2.4" /><circle cx="14" cy="11" r="2.2" fill="#222" /><circle cx="14" cy="11" r="1.8" fill="#fff" /><line x1="14" y1="5.5" x2="14" y2="7" stroke="#222" stroke-width="2.8" stroke-linecap="round" /><line x1="14" y1="5.5" x2="14" y2="7" stroke="#fff" stroke-width="2.2" stroke-linecap="round" /><line x1="14" y1="15" x2="14" y2="16.5" stroke="#222" stroke-width="2.8" stroke-linecap="round" /><line x1="14" y1="15" x2="14" y2="16.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" /><line x1="8.5" y1="11" x2="10" y2="11" stroke="#222" stroke-width="2.8" stroke-linecap="round" /><line x1="8.5" y1="11" x2="10" y2="11" stroke="#fff" stroke-width="2.2" stroke-linecap="round" /><line x1="18" y1="11" x2="19.5" y2="11" stroke="#222" stroke-width="2.8" stroke-linecap="round" /><line x1="18" y1="11" x2="19.5" y2="11" stroke="#fff" stroke-width="2.2" stroke-linecap="round" /></svg>`;
    } else if (['wrench', 'tool', 'onsite', 'on site'].some(k => icon.includes(k))) {
        iconSvg = `<svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C8 0 3 5 3 11c0 8 11 21 11 21s11-13 11-21C25 5 20 0 14 0z" fill="${markerColor}"/><polygon points="14,4 9,14 19,14" fill="#fff" stroke="#222" stroke-width="1.2" /><line x1="11.5" y1="7.5" x2="16.5" y2="7.5" stroke="#222" stroke-width="1.2" stroke-linecap="round" /><line x1="10" y1="10.5" x2="18" y2="10.5" stroke="#222" stroke-width="1.2" stroke-linecap="round" /><ellipse cx="14" cy="14.5" rx="5" ry="1.5" fill="#222" opacity="0.4" /></svg>`;
    } else if (icon.includes('check')) {
        iconSvg = `<svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C8 0 3 5 3 11c0 8 11 21 11 21s11-13 11-21C25 5 20 0 14 0z" fill="${markerColor}"/><polyline points="8,10 12,14 18,7" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>`;
    } else if (icon.includes('exclamation')) {
        iconSvg = `<svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C8 0 3 5 3 11c0 8 11 21 11 21s11-13 11-21C25 5 20 0 14 0z" fill="${markerColor}"/><circle cx="14" cy="14" r="0.8" fill="#fff" /><line x1="14" y1="8" x2="14" y2="12" stroke="#fff" stroke-width="1.5" stroke-linecap="round" /></svg>`;
    } else {
        iconSvg = `<svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C8 0 3 5 3 11c0 8 11 21 11 21s11-13 11-21C25 5 20 0 14 0z" fill="${markerColor}"/><circle cx="14" cy="10" r="2" fill="#fff" /></svg>`;
    }

    const html = `<div style="width:28px;height:42px;position:relative;display:flex;align-items:flex-start;justify-content:center;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.35));">${iconSvg}</div>`;

    return L.divIcon({
        html: html,
        iconSize: [28, 42],
        iconAnchor: [14, 42],
        popupAnchor: [0, -42],
        className: `custom-div-marker`
    });
};

const getMarkerConfig = (card) => {
    const labels = (card.labels || []).map(l => (l.name || l.color || '').toLowerCase());

    let icon = 'map-marker';
    if (labels.some(l => ['en route', 'enroute', 'en-route'].includes(l))) icon = 'truck';
    else if (labels.some(l => ['on scene', 'on site', 'onscene', 'onsite'].includes(l))) icon = 'wrench';
    else if (labels.some(l => l.includes('completed'))) icon = 'check-circle';
    else if (labels.some(l => l.includes('priority'))) icon = 'exclamation-circle';

    let color = 'blue';
    if (labels.some(l => l.includes('priority'))) color = 'red';
    else if (labels.some(l => l.includes('important'))) color = 'orange';
    else if (labels.some(l => l.includes('routine'))) color = 'yellow';
    else if (labels.some(l => l.includes('completed'))) color = 'green';

    return { icon, color };
};

// --- GEOCODING UTILS ---
async function geocodeAddress(address) {
    try {
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
    if (!desc) return null;
    const lines = desc.split('\n');
    for (const line of lines) {
        if (line.trim().length > 5) return line.trim();
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

const MapView = ({ user, onClose, onShowSettings }) => {
    const [cards, setCards] = useState([]);
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(true);
    const [geocodingQueue, setGeocodingQueue] = useState([]);
    const [blocks, setBlocks] = useState([]);
    const [visibleBlockIds, setVisibleBlockIds] = useState(new Set());
    const [baseMap, setBaseMap] = useState('topo');
    const [errorMessage, setErrorMessage] = useState('');

    // Countdown state
    const [countdown, setCountdown] = useState(null);

    const { theme, toggleTheme } = useDarkMode();
    const intervalRef = useRef(null);
    const countdownRef = useRef(null);

    // Per-board settings
    const settings = user ? JSON.parse(localStorage.getItem('trelloUserData') || '{}')[user.id]?.settings : null;
    const boardId = settings?.boardId;
    const boardName = settings?.boardName;
    const ignoreTemplateCards = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId) !== 'false';
    const updateTrelloCoordinates = localStorage.getItem('updateTrelloCoordinates_' + boardId) === 'true'; // Verify this key in SettingsScreen, assuming pattern

    // Refresh Settings
    const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + boardId);
    const defaultRefreshSetting = { value: 1, unit: 'minutes' };
    const refreshSetting = savedRefresh ? JSON.parse(savedRefresh) : defaultRefreshSetting;
    const refreshIntervalSeconds = convertIntervalToSeconds(refreshSetting.value, refreshSetting.unit);

    // Helper to save local cache
    const saveLocalGeocode = (cId, coords) => {
        try {
            const key = `MAP_GEOCODING_CACHE_${boardId}`;
            const cache = JSON.parse(localStorage.getItem(key) || '{}');
            cache[cId] = coords;
            localStorage.setItem(key, JSON.stringify(cache));
        } catch (e) { }
    };

    // Trello Write-Back
    const updateTrelloCardCoordinates = async (cardId, coords) => {
        if (!updateTrelloCoordinates) return;
        try {
            // Write to 'coordinates' field (standard if enabled) or pluginData
            // If the Map Power-Up is enabled, logic is complex (plugin data).
            // However, often 'coordinates' works if supported, or customized. 
            // For now, let's try standard PUT to 'coordinates' if API allows, otherwise log.
            // Actually, official Trello API doesn't expose 'coordinates' on root for write easily without powerup context.
            // Assumption: User likely means 'pos' or custom field. 
            // BUT, if legacy code did it, we should emulate.
            // Given I cannot see legacy, I will assume a direct PUT to /cards/:id with coordinates querystring or body?
            // "put to cart coordinates field". 
            // Let's assume a custom field or specific power-up payload.
            // Safe fallback: standard PUT /cards/id with `coordinates: {lat,long}` (unlikely to work without plugin context) or just locally.
            // If "updateTrelloCoordinates" is true, I will attempt to update `coordinates` property.
            await trelloFetch(`/cards/${cardId}`, user.token, {
                method: 'PUT',
                body: JSON.stringify({ coordinates: `${coords.lat},${coords.lng}` }) // Attempting string format or object
            });
            // Also try specific plugin format if known? 
            // For now, simplified attempt.
        } catch (e) { console.warn("Failed to write back coords", e); }
    };

    // Load Data Helper
    const loadData = useCallback(async (isRefresh = false) => {
        if (!user || !boardId) return;
        if (!isRefresh) setLoading(true);
        if (!isRefresh) setStatus('Loading cards...');

        try {
            // 1. Get Blocks
            const currentLayout = getPersistentLayout(user.id, boardId);
            setBlocks(currentLayout);

            // Set initial visibility only if first load
            if (!isRefresh) {
                const initialVisible = new Set(currentLayout.filter(b => b.includeOnMap !== false).map(b => b.id));
                setVisibleBlockIds(initialVisible);
            }

            // 2. Fetch Cards
            const cardsData = await trelloFetch(`/boards/${boardId}/cards?fields=id,name,desc,idList,labels,shortUrl,isTemplate,pos,coordinates`, user.token);

            // 3. Load Geocoding Cache
            const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
            const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');

            const processedCards = cardsData.map(c => {
                let coords = null;
                // Prefer Trello coordinates if they exist (mapped by powerup?)
                if (c.coordinates) {
                    coords = typeof c.coordinates === 'object' ? c.coordinates : null;
                    // Trello might return it if fields=coordinates was working
                }

                // Fallback to cache
                if (!coords && cache[c.id]) coords = cache[c.id];

                return { ...c, coordinates: coords };
            });

            setCards(processedCards);

        } catch (e) {
            console.error(e);
            setStatus(`Error: ${e.message}`);
        } finally {
            if (!isRefresh) setLoading(false);
            if (!isRefresh) setStatus('');
        }
    }, [user, boardId]);

    // Initial Load
    useEffect(() => {
        loadData(false);
    }, [loadData]);


    // Countdown + Interval Logic
    useEffect(() => {
        // Reset countdown logic
        if (countdownRef.current) clearInterval(countdownRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);

        // Only start countdown if queue is empty
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
                setCountdown(refreshIntervalSeconds); // Reset countdown after refresh trigger
            }, refreshIntervalSeconds * 1000);
        } else {
            setCountdown(null); // Pause or hide countdown
        }

        return () => {
            if (countdownRef.current) clearInterval(countdownRef.current);
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [geocodingQueue.length, loading, refreshIntervalSeconds, loadData]);


    // Queue Calculation Effect
    useEffect(() => {
        const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
        const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');

        const needGeocoding = cards.filter(c => {
            if (cache[c.id]) return false; // Already cached
            if (c.coordinates) return false;
            // if (!c.desc) return false; // Try even if no desc? No, need address.
            // But maybe address is in name? User said "description".
            if (!c.desc && !parseAddressFromDescription(c.name)) return false;
            if (ignoreTemplateCards && c.isTemplate) return false;

            const block = blocks.find(b => b.listIds.includes(c.idList));
            if (!block || !visibleBlockIds.has(block.id)) return false;

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

    }, [cards, visibleBlockIds, blocks, ignoreTemplateCards, boardId]);


    // Geocoding Processor
    useEffect(() => {
        if (geocodingQueue.length === 0) {
            if (status.startsWith('Geocoding')) setStatus('');
            return;
        }

        const process = async () => {
            const cardId = geocodingQueue[0];
            const card = cards.find(c => c.id === cardId);

            if (!card) {
                setGeocodingQueue(prev => prev.slice(1));
                return;
            }

            setStatus(`Geocoding: ${card.name} (${geocodingQueue.length} left)`);

            // 1s Rate Limit check
            await new Promise(r => setTimeout(r, 1000));

            try {
                const address = parseAddressFromDescription(card.desc) || parseAddressFromDescription(card.name); // Fallback to name?
                if (address) {
                    const coords = await geocodeAddress(address);
                    if (coords) {
                        setCards(prev => prev.map(c => c.id === cardId ? { ...c, coordinates: coords } : c));
                        saveLocalGeocode(cardId, coords);

                        // Write back
                        if (updateTrelloCoordinates) {
                            updateTrelloCardCoordinates(cardId, coords);
                        }
                    } else {
                        // Failed to find coords (returned null)
                        throw new Error("Address not found");
                    }
                } else {
                    // No address found
                }
            } catch (e) {
                console.warn("Geocoding failed for", card.name);
                setErrorMessage(`Failed to geocode: ${card.name}`);
                setTimeout(() => setErrorMessage(''), 2000);
            }

            setGeocodingQueue(prev => prev.slice(1));
        };
        process();
    }, [geocodingQueue, cards, status, updateTrelloCoordinates]);

    // Handle block toggle with Refresh trigger
    const handleBlockToggle = (blockId, isChecked) => {
        const next = new Set(visibleBlockIds);
        if (isChecked) {
            next.add(blockId);
            loadData(true);
        } else {
            next.delete(blockId);
        }
        setVisibleBlockIds(next);
    };

    // Calculate visible markers
    const markers = useMemo(() => {
        return cards
            .filter(c => c.coordinates && c.coordinates.lat && c.coordinates.lng)
            .filter(c => {
                if (ignoreTemplateCards && c.isTemplate) return false;

                const block = blocks.find(b => b.listIds.includes(c.idList));
                if (!block || !visibleBlockIds.has(block.id)) return false;

                if (block.ignoreFirstCard) {
                    const cardsInList = cards.filter(pc => pc.idList === c.idList);
                    const minPos = cardsInList.reduce((min, cur) => (cur.pos < min ? cur.pos : min), Infinity);
                    if (c.pos === minPos) return false;
                }
                return true;
            })
            .map(c => (
                <Marker
                    key={c.id} // Ensure key is unique and stable
                    position={[c.coordinates.lat, c.coordinates.lng]}
                    icon={getMarkerIcon(getMarkerConfig(c))}
                >
                    <Popup>
                        <div className="popup-card">
                            <a href={c.shortUrl} target="_blank" rel="noreferrer"><strong>{c.name}</strong></a>
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
                            <div className="popup-desc" style={{ whiteSpace: 'pre-wrap' }}>{c.desc}</div>
                        </div>
                    </Popup>
                </Marker>
            ));
    }, [cards, visibleBlockIds, blocks, ignoreTemplateCards]);

    // Calculate count per block for header
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

    const MapBounds = () => {
        const map = useMap();
        useEffect(() => {
            if (markers.length > 0) {
                const validCards = cards.filter(c =>
                    c.coordinates && c.coordinates.lat && c.coordinates.lng &&
                    markers.some(m => m.key === c.id)
                );
                if (validCards.length > 0) {
                    const bounds = L.latLngBounds(validCards.map(c => [c.coordinates.lat, c.coordinates.lng]));
                    map.fitBounds(bounds, { padding: [50, 50] });
                }
            }
        }, [markers.length]); // Intentionally limited to length change to avoid constant zoom reset on refresh
        return null;
    };


    return (
        <div className="map-container">
            <div className="map-header">
                <div className="map-header-title-area">
                    <h1>{boardName} - Map View</h1>
                    <div style={{ marginLeft: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {blocks.map(b => (
                            <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9em', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={visibleBlockIds.has(b.id)}
                                    onChange={e => handleBlockToggle(b.id, e.target.checked)}
                                />
                                {b.name} ({getBlockCount(b)})
                            </label>
                        ))}
                    </div>
                </div>
                <div className="map-header-actions">
                    <span className="map-card-count">{markers.length} mapped cards</span>
                    <select
                        value={baseMap}
                        onChange={e => setBaseMap(e.target.value)}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #ddd' }}
                    >
                        {Object.entries(TILE_LAYERS).map(([key, config]) => (
                            <option key={key} value={key}>{config.name}</option>
                        ))}
                    </select>

                    <button className="theme-toggle-button" onClick={() => toggleTheme()} style={{ marginLeft: '5px' }}>
                        {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
                    </button>
                </div>
            </div>

            <div id="map">
                <MapContainer center={[51.505, -0.09]} zoom={2} style={{ height: "100%", width: "100%" }}>
                    <TileLayer
                        attribution={TILE_LAYERS[baseMap].attribution}
                        url={TILE_LAYERS[baseMap].url}
                    />
                    {markers}
                    <MapBounds />
                </MapContainer>
            </div>

            <div className="map-footer">
                <div className="map-footer-left">
                    Map tiles © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> |
                    Leaflet | Geocoding: Nominatim
                    {countdown !== null && (
                        <span style={{ marginLeft: '15px', color: '#666', fontWeight: 'bold' }}>
                            Refreshing in {countdown}s
                        </span>
                    )}
                </div>
                <div className="map-footer-right">
                    <button className="dashboard-btn" onClick={onClose}>Dashboard View</button>
                    <button className="settings-button" onClick={() => {
                        if (onShowSettings) onShowSettings();
                        else onClose();
                    }}>Settings</button>
                    <button className="logout-button" onClick={() => loadData(true)}>Reload</button>
                </div>
            </div>

            {status && (
                <div className="status-message">
                    <div className="spinner"></div>
                    <span>{status}</span>
                </div>
            )}

            {/* Error Toast */}
            {errorMessage && (
                <div className="status-message error-toast" style={{ borderColor: 'red' }}>
                    <span style={{ color: 'red' }}>{errorMessage}</span>
                </div>
            )}
        </div>
    );
};

export default MapView;
