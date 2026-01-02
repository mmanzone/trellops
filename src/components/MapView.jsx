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
import DigitalClock from './common/DigitalClock';
import { ICONS } from './common/IconPicker'; // Import the SVG paths

// --- ICONS LOGIC ---
const getMarkerIcon = (markerConfig) => {
    const colorMap = {
        'blue': '#3388ff', 'red': '#ff6b6b', 'green': '#51cf66',
        'orange': '#ffa94d', 'yellow': '#ffd43b', 'grey': '#868e96', 'black': '#343a40'
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
    // Block Icon takes precedence over generic default
    let icon = block.mapIcon || 'map-marker';
    let color = 'blue'; // Default color

    // 2. Apply Rules (Top to Bottom priority - First Match Wins per property?)
    // User Requirement: "if there is a conflict... only the highest setting in the list should be applied."
    // Implementation: Iterate rules. Once we find a rule that sets 'icon', we lock 'icon'. Same for 'color'.

    let iconSet = false;
    let colorSet = false;

    if (markerRules && markerRules.length > 0) {
        for (const rule of markerRules) {
            if (iconSet && colorSet) break; // All done

            if (card.labels && card.labels.some(l => l.id === rule.labelId)) {
                if (rule.overrideType === 'icon' && !iconSet) {
                    icon = rule.overrideValue;
                    iconSet = true;
                } else if (rule.overrideType === 'color' && !colorSet) {
                    color = rule.overrideValue;
                    colorSet = true;
                }
            }
        }
    }

    return { icon, color };
};

// --- GEOCODING UTILS ---
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

const MapView = ({ user, settings, onClose, onShowSettings, onLogout }) => {
    const [cards, setCards] = useState([]);
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(true);
    const [geocodingQueue, setGeocodingQueue] = useState([]);
    const [blocks, setBlocks] = useState([]);
    const [visibleBlockIds, setVisibleBlockIds] = useState(new Set());
    const [baseMap, setBaseMap] = useState('topo');
    const [errorState, setErrorState] = useState(null);
    const [markerRules, setMarkerRules] = useState([]); // State for Rules

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
                body: JSON.stringify({ coordinates: `${coords.lat},${coords.lng}` })
            });
        } catch (e) { console.warn("Failed to write back coords", e); }
    };

    const loadData = useCallback(async (isRefresh = false) => {
        if (!user || !boardId) return;
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

            if (!isRefresh) {
                const initialVisible = new Set(
                    currentLayout
                        .filter(b => b.includeOnMap !== false)
                        .map(b => b.id)
                );
                setVisibleBlockIds(initialVisible);
            }

            const cardsData = await trelloFetch(`/boards/${boardId}/cards?fields=id,name,desc,idList,labels,shortUrl,isTemplate,pos,coordinates`, user.token);
            const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
            const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');

            const processedCards = cardsData.map(c => {
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
    }, [geocodingQueue.length, loading, refreshIntervalSeconds, loadData]);


    useEffect(() => {
        const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
        const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');

        const needGeocoding = cards.filter(c => {
            if (c.coordinates && c.coordinates.lat && c.coordinates.lng) return false;

            if (cache[c.id]) return false;

            const addressCandidate = parseAddressFromDescription(c.desc) || (c.name.length > 10 ? c.name : null);
            if (!addressCandidate) return false;

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
                    const address = parseAddressFromDescription(card.desc) || (card.name.length > 5 ? card.name : null);
                    if (address) {
                        const coords = await geocodeAddress(address);
                        if (coords) {
                            setCards(prev => prev.map(c => c.id === cardId ? { ...c, coordinates: coords } : c));
                            saveLocalGeocode(cardId, coords);
                            if (updateTrelloCoordinates) {
                                updateTrelloCardCoordinates(cardId, coords);
                            }
                        } else {
                            throw new Error("Nominatim returned no valid results");
                        }
                    } else {
                        throw new Error("No address found in description or name");
                    }
                } catch (e) {
                    console.warn(`Geocoding failed for ${card.name}:`, e);
                    setErrorState({
                        message: `Geocoding failed for: ${card.name}`,
                        cardUrl: card.shortUrl
                    });
                    setTimeout(() => setErrorState(null), 5000);
                }

                setGeocodingQueue(prev => prev.slice(1));
                break;
            }
            geocodeLoopRef.current = false;
        };

        processQueue();

    }, [geocodingQueue, cards, status, updateTrelloCoordinates]);

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
            .map(c => {
                const block = blocks.find(b => b.listIds.includes(c.idList));
                const config = getMarkerConfig(c, block, markerRules);

                return (
                    <Marker
                        key={c.id}
                        position={[c.coordinates.lat, c.coordinates.lng]}
                        icon={getMarkerIcon(config)}
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
                );
            });
    }, [cards, visibleBlockIds, blocks, ignoreTemplateCards, markerRules]);

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
        }, [markers.length]);
        return null;
    };

    return (
        <div className="map-container">
            <div className="map-header">
                <div className="map-header-title-area">
                    {showClock && <DigitalClock boardId={boardId} />}
                    <h1 style={{ marginLeft: showClock ? '15px' : '0' }}>{boardName} - Map View</h1>
                    <div style={{ marginLeft: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {blocks.filter(b => b.includeOnMap !== false).map(b => (
                            <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9em', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={visibleBlockIds.has(b.id)}
                                    onChange={e => handleBlockToggle(b.id, e.target.checked)}
                                />
                                {/* Render Icon */}
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#555', marginTop: '-1px' }}>
                                    <path d={ICONS[b.mapIcon ? b.mapIcon.toLowerCase() : 'map-marker'] || ICONS['map-marker']} />
                                </svg>
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
                    <span style={{ fontSize: '0.85em', marginRight: '15px', color: '#666', display: 'flex', gap: '5px', alignItems: 'center' }}>
                        Map tiles © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> |
                        <a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a> |
                        Geocoding: <a href="https://nominatim.org" target="_blank" rel="noreferrer">Nominatim</a>
                    </span>
                </div>
                <div className="map-footer-right">
                    {countdown !== null && (
                        <span className="countdown" style={{ marginRight: '15px' }}>
                            Next refresh in {countdown}s
                        </span>
                    )}
                    <button className="settings-button" onClick={resetLocalGeocodingCache} title="Clear locally cached addresses">
                        Reset Location Cache
                    </button>
                    <button className="dashboard-btn" onClick={onClose}>Dashboard View</button>
                    <button className="refresh-button" onClick={() => loadData(true)}>Refresh Map</button>
                    <button className="settings-button" onClick={() => {
                        if (onShowSettings) onShowSettings();
                        else onClose();
                    }}>Settings</button>
                    <button className="logout-button" onClick={onLogout}>Log Out</button>
                </div>
            </div>

            {status && (
                <div className="status-message">
                    <div className="spinner"></div>
                    <span>{status}</span>
                </div>
            )}

            {errorState && (
                <div className="status-message error-toast" style={{ borderColor: '#ff6b6b', maxWidth: '400px', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ color: '#c92a2a', fontWeight: 'bold' }}>Geocoding Error</span>
                    <span style={{ color: '#333', fontSize: '0.9em' }}>{errorState.message}</span>
                    {errorState.cardUrl && (
                        <a href={errorState.cardUrl} target="_blank" rel="noreferrer" style={{ color: '#0057d9', fontSize: '0.9em', marginTop: '4px', textDecoration: 'underline' }}>
                            View Card
                        </a>
                    )}
                </div>
            )}
        </div>
    );
};

export default MapView;
