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
// --- GEOCODING UTILS ---
async function geocodeAddress(address) {
    try {
        // 1. Direct Coordinate Match
        const coordMatch = address.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
        if (coordMatch) {
            return {
                lat: parseFloat(coordMatch[1]),
                lng: parseFloat(coordMatch[2])
            };
        }

        // 2. Handle URL-like addresses (short links or full URLs passed as address)
        if (address.match(/^https?:\/\//i)) {
            let finalUrl = address;

            // Attempt to resolve short links if possible (client-side restriction applies)
            // Note: This often fails due to CORS if the shortener redirects to a different origin.
            // We'll try a HEAD request or just fetch. If it fails, we parse what we have.
            if (address.includes('goo.gl') || address.includes('bit.ly') || address.includes('t.co')) {
                try {
                    const resp = await fetch(address, { method: 'HEAD', mode: 'no-cors' }); // no-cors limits access to headers/url, but sometimes browser follows
                    // Actually, with no-cors we can't see the final URL.
                    // Realistically, without a backend proxy, we can't reliably resolve short links that do 301.
                    // However, sometimes the "address" passed in IS the resolution if `parseAddressFromDescription` did its job poorly.
                    // But `parseAddressFromDescription` (below) returns the URL if it can't parse it.
                } catch (e) {
                    // Ignore
                }
            }

            // Retry parsing the URL (in case it wasn't parsed fully before or we can extract more)
            // If it's still just a generic URL without coords, we can't match it.
            // But if it's a "search" URL, we can extract the query.
            try {
                const urlObj = new URL(finalUrl);
                const lat = urlObj.searchParams.get('lat');
                const lng = urlObj.searchParams.get('lng');
                if (lat && lng) return { lat: parseFloat(lat), lng: parseFloat(lng) };

                // q param
                const q = urlObj.searchParams.get('q') || urlObj.searchParams.get('query');
                if (q) {
                    // If q contains coords
                    const qCoords = q.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
                    if (qCoords) return { lat: parseFloat(qCoords[1]), lng: parseFloat(qCoords[2]) };

                    // Otherwise treat q as the address to search via Nominatim
                    // Recursive call with the extracted query string
                    return geocodeAddress(q);
                }
            } catch (e) { /* invalid url */ }

            // If we still have a URL and no coords, we CANNOT send the URL to Nominatim. It will fail.
            // So we return null here to avoid the specific error the user saw ("Nominatim returned no valid results").
            return null;
        }

        // 3. Nominatim Fallback
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
        console.warn("Geocoding/Nominatim error:", e);
        // Don't throw, just return null so we handle it gracefully
    }
    return null;
}

const parseAddressFromDescription = (desc) => {
    if (!desc || !desc.trim()) return null;

    // 1. Check for explicit Google Maps URL formats

    // a) @lat,lon
    const atStatsMatch = desc.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atStatsMatch) return `${atStatsMatch[1]},${atStatsMatch[2]}`;

    // b) search?q=lat,lon or ?q=Address
    // We look for the URL first
    const urlMatch = desc.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
        const urlStr = urlMatch[0];
        try {
            const urlObj = new URL(urlStr);

            // ?q=... or ?query=...
            const q = urlObj.searchParams.get('q') || urlObj.searchParams.get('query');
            if (q) {
                // Check if q is coordinates
                const qCoord = q.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
                if (qCoord) return `${qCoord[1]},${qCoord[2]}`;
                // Return the query itself (e.g. "Toorak VIC")
                return decodeURIComponent(q.replace(/\+/g, ' '));
            }

            // /maps/place/Address/@...
            if (urlStr.includes('/maps/place/')) {
                const parts = urlObj.pathname.split('/maps/place/');
                if (parts[1]) {
                    const addressPart = parts[1].split('/')[0];
                    return decodeURIComponent(addressPart.replace(/\+/g, ' '));
                }
            }

            // Shortened links: maps.app.goo.gl or goo.gl
            if (urlStr.includes('goo.gl') || urlStr.includes('maps.app.goo.gl')) {
                // Return the URL itself. `geocodeAddress` will attempt to handle it 
                // (though primarily by returning null if it can't resolve, preventing the "valid results" error 
                // effectively by not sending garbage to Nominatim).
                return urlStr;
            }

        } catch (e) {
            // URL parsing failed, fall back to regex
        }
    }

    // 2. Explicit Coords in text
    const coordMatch = desc.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (coordMatch) {
        // Enforce reasonable lat/lng ranges to avoid version numbers (e.g. 1.0.2)
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            return `${lat},${lng}`;
        }
    }

    // 3. Address Heuristics
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

    // 4. Fallback: First line if it looks like an address
    const lines = desc.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length > 0 && lines[0].length > 5) {
        // Exclude things that look like IDs
        if (!/^S\d+|^[A-Z]{2}\d+/.test(lines[0]) && !lines[0].startsWith('http')) {
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
    const boardName = settings?.boardName || storedSettings.boardName || 'Trello Board';

    const ignoreTemplateCards = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId) !== 'false';
    const updateTrelloCoordinates = localStorage.getItem('updateTrelloCoordinates_' + boardId) === 'true';

    const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + boardId);
    const defaultRefreshSetting = { value: 1, unit: 'minutes' };
    const refreshSetting = savedRefresh ? JSON.parse(savedRefresh) : defaultRefreshSetting;
    const refreshIntervalSeconds = convertIntervalToSeconds(refreshSetting.value, refreshSetting.unit);

    const [showClock, setShowClock] = useState(() => localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId) !== 'false');

    useEffect(() => {
        // Ensure clock setting is up to date when board changes or component mounts
        setShowClock(localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId) !== 'false');
    }, [boardId]);

    const saveLocalGeocode = (cId, coords) => {
        try {
            const key = `MAP_GEOCODING_CACHE_${boardId}`;
            const cache = JSON.parse(localStorage.getItem(key) || '{}');
            cache[cId] = coords;
            localStorage.setItem(key, JSON.stringify(cache));
        } catch (e) { }
    };

    const updateTrelloCardCoordinates = async (cardId, coords) => {
        if (!updateTrelloCoordinates) return;
        try {
            await trelloFetch(`/cards/${cardId}`, user.token, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
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

            if (!isRefresh) {
                const initialVisible = new Set(currentLayout.filter(b => b.includeOnMap !== false).map(b => b.id));
                setVisibleBlockIds(initialVisible);
            }

            const cardsData = await trelloFetch(`/boards/${boardId}/cards?fields=id,name,desc,idList,labels,shortUrl,isTemplate,pos,coordinates`, user.token);
            const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
            const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');

            const processedCards = cardsData.map(c => {
                let coords = null;
                let source = 'none';

                if (c.coordinates) {
                    if (typeof c.coordinates === 'string' && c.coordinates.includes(',')) {
                        const parts = c.coordinates.split(',');
                        if (parts.length === 2) {
                            coords = { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
                            source = 'api';
                        }
                    } else if (typeof c.coordinates === 'object') {
                        coords = c.coordinates;
                        source = 'api';
                    }
                }

                if ((!coords || !coords.lat) && cache[c.id]) {
                    coords = cache[c.id];
                    source = 'cache';
                }

                return { ...c, coordinates: coords, source };
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

    // --- SYNC LOOP FOR TRELLO COORDINATES ---
    useEffect(() => {
        if (!updateTrelloCoordinates || cards.length === 0) return;

        // Find cards that have coordinates (from cache or geocoding) but NOT from API
        // and haven't been marked as 'synced' yet (to avoid loops, though source check helps)
        const toSync = cards.filter(c =>
            c.coordinates &&
            c.coordinates.lat &&
            (c.source === 'cache' || c.source === 'new')
        );

        if (toSync.length === 0) return;

        const syncCards = async () => {
            for (const card of toSync) {
                // Double check it hasn't been updated in the meantime (e.g. by another process)
                // We optimistically mark it as 'api' locally after sync to stop retries
                try {
                    await updateTrelloCardCoordinates(card.id, card.coordinates);
                    // Update local state to reflect it's now synced (prevents loop)
                    setCards(prev => prev.map(p =>
                        p.id === card.id ? { ...p, source: 'api' } : p
                    ));
                    // Small delay to be nice to API
                    await new Promise(r => setTimeout(r, 500));
                } catch (e) {
                    console.warn(`Failed to sync card ${card.name}`, e);
                }
            }
        };

        syncCards();
    }, [cards, updateTrelloCoordinates]);


    useEffect(() => {
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
            if (cache[c.id]) return false;
            if (c.coordinates && c.coordinates.lat) return false;

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
                            setCards(prev => prev.map(c => c.id === cardId ? { ...c, coordinates: coords, source: 'new' } : c));
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
            .map(c => (
                <Marker
                    key={c.id}
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
