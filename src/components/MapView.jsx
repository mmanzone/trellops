import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { trelloFetch } from '/src/api/trello';
import { getPersistentLayout } from '/src/utils/persistence';
import { useDarkMode } from '/src/context/DarkModeContext';
import { STORAGE_KEYS } from '/src/utils/constants';
import { convertIntervalToSeconds, getLabelTextColor } from '/src/utils/helpers';
import DigitalClock from './common/DigitalClock';
import { ICONS } from './common/IconPicker';
import MapFilters from './MapFilters';
import { loadGoogleMaps } from '/src/utils/googleMapsLoader';
import '/src/styles/map.css';

// --- CUSTOM MAP STYLES ---
const DARK_MODE_STYLE = [
    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    {
        featureType: "administrative.locality",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d59563" }],
    },
    {
        featureType: "poi",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d59563" }],
    },
    {
        featureType: "poi.park",
        elementType: "geometry",
        stylers: [{ color: "#263c3f" }],
    },
    {
        featureType: "poi.park",
        elementType: "labels.text.fill",
        stylers: [{ color: "#6b9a76" }],
    },
    {
        featureType: "road",
        elementType: "geometry",
        stylers: [{ color: "#38414e" }],
    },
    {
        featureType: "road",
        elementType: "geometry.stroke",
        stylers: [{ color: "#212a37" }],
    },
    {
        featureType: "road",
        elementType: "labels.text.fill",
        stylers: [{ color: "#9ca5b3" }],
    },
    {
        featureType: "road.highway",
        elementType: "geometry",
        stylers: [{ color: "#746855" }],
    },
    {
        featureType: "road.highway",
        elementType: "geometry.stroke",
        stylers: [{ color: "#1f2835" }],
    },
    {
        featureType: "road.highway",
        elementType: "labels.text.fill",
        stylers: [{ color: "#f3d19c" }],
    },
    {
        featureType: "transit",
        elementType: "geometry",
        stylers: [{ color: "#2f3948" }],
    },
    {
        featureType: "transit.station",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d59563" }],
    },
    {
        featureType: "water",
        elementType: "geometry",
        stylers: [{ color: "#17263c" }],
    },
    {
        featureType: "water",
        elementType: "labels.text.fill",
        stylers: [{ color: "#515c6d" }],
    },
    {
        featureType: "water",
        elementType: "labels.text.stroke",
        stylers: [{ color: "#17263c" }],
    },
];

// --- ICONS LOGIC ---
const getGoogleMarkerIcon = (markerConfig) => {
    const colorMap = {
        'blue': '#3388ff', 'red': '#ff6b6b', 'green': '#51cf66',
        'orange': '#ffa94d', 'yellow': '#ffd43b', 'grey': '#868e96', 'black': '#343a40',
        'purple': '#9c27b0'
    };
    const markerColor = colorMap[markerConfig.color] || colorMap['blue'];
    const iconName = (markerConfig.icon || 'map-marker').toLowerCase();
    const svgPath = ICONS[iconName] || ICONS['map-marker'];
    const pinPath = `<path d="M14 0C8 0 3 5 3 11c0 8 11 21 11 21s11-13 11-21C25 5 20 0 14 0z" fill="${markerColor}"/>`;
    const innerIconGroup = `<g transform="translate(7, 4) scale(0.58)" fill="#fff">${svgPath}</g>`;
    const svg = `
    <svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 3px 4px rgba(0,0,0,0.4));">
        ${pinPath}
        ${innerIconGroup}
    </svg>`;
    const url = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    return {
        url: url,
        scaledSize: new window.google.maps.Size(28, 42),
        anchor: new window.google.maps.Point(14, 42),
        labelOrigin: new window.google.maps.Point(14, 15)
    };
};

const getMarkerConfig = (card, block, markerRules) => {
    let icon = block.mapIcon || 'map-marker';
    let color = 'blue';
    const activeRuleIds = ['default'];
    let iconSet = false;
    let colorSet = false;
    if (markerRules && markerRules.length > 0) {
        for (const rule of markerRules) {
            if (iconSet && colorSet) break;
            if (card.labels && card.labels.some(l => l.id === rule.labelId)) {
                if (rule.overrideType === 'icon' && !iconSet) {
                    icon = rule.overrideValue;
                    iconSet = true;
                    activeRuleIds.push(rule.id);
                } else if (rule.overrideType === 'color' && !colorSet) {
                    color = rule.overrideValue;
                    colorSet = true;
                    activeRuleIds.push(rule.id);
                }
            }
        }
    }
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
    expanded = expanded.replace(/^(?:CNR|Corner)\s+/i, 'Corner of ');
    const replacements = [
        [/\bRd\b/gi, 'Road'], [/\bAv\b/gi, 'Avenue'], [/\bAve\b/gi, 'Avenue'],
        [/\bSt\b/gi, 'Street'], [/\bDr\b/gi, 'Drive'], [/\bLn\b/gi, 'Lane'],
        [/\bCt\b/gi, 'Court'], [/\bPl\b/gi, 'Place'], [/\bCres\b/gi, 'Crescent'],
        [/\bBlvd\b/gi, 'Boulevard'], [/\bPde\b/gi, 'Parade'], [/\bHwy\b/gi, 'Highway'],
        [/\bFwy\b/gi, 'Freeway'],
    ];
    replacements.forEach(([regex, replacement]) => { expanded = expanded.replace(regex, replacement); });
    return expanded;
}

const parseAddressFromDescription = (desc) => {
    if (!desc || !desc.trim()) return null;
    const mapsPlaceMatch = desc.match(/https?:\/\/(?:www\.)?google\.[^\/\s]+\/maps\/place\/([^\s)]+)/i);
    if (mapsPlaceMatch) {
        const placePart = mapsPlaceMatch[1];
        try { return decodeURIComponent(placePart.replace(/\+/g, ' ')); } catch (e) { return placePart.replace(/\+/g, ' '); }
    }
    const coordMatch = desc.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (coordMatch) return `${coordMatch[1]},${coordMatch[2]}`;
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
        if (!/^S\d+|^[A-Z]{2}\d+/.test(lines[0])) return lines[0];
    }
    return null;
};

// --- HELPER FUNCTIONS ---
const formatCountdown = (seconds) => {
    if (seconds === null || seconds === undefined) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
};

// --- ERROR TOAST ---
const GeocodingErrorToast = ({ error, onDismiss, onApply }) => {
    const [manualAddress, setManualAddress] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const autocompleteService = useRef(null);
    useEffect(() => {
        if (window.google && window.google.maps && window.google.maps.places) {
            autocompleteService.current = new window.google.maps.places.AutocompleteService();
        }
    }, []);
    const handleManualAddressChange = (e) => {
        const val = e.target.value;
        setManualAddress(val);
        if (!val || val.length < 3) { setSearchResults([]); return; }
        if (autocompleteService.current) {
            autocompleteService.current.getPlacePredictions({ input: val }, (predictions, status) => {
                if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) setSearchResults(predictions);
                else setSearchResults([]);
            });
        }
    };
    const handleSelectResult = (prediction) => {
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode({ placeId: prediction.place_id }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const loc = results[0].geometry.location;
                onApply(error.cardId, { lat: loc.lat(), lng: loc.lng(), display_name: results[0].formatted_address });
            } else alert("Failed to get details for this location.");
        });
    };
    return (
        <div className="status-message error-toast" style={{ borderColor: '#ff6b6b', width: '350px', flexDirection: 'column', alignItems: 'flex-start', padding: '12px', gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', marginBottom: '10px', animation: 'slideIn 0.3s ease-out' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#c92a2a', fontWeight: 'bold' }}>Geocoding Error</span>
                    {error.cardUrl && <a href={error.cardUrl} target="_blank" rel="noreferrer" style={{ color: '#0057d9', fontSize: '0.85em', textDecoration: 'underline' }}>View Card</a>}
                </div>
                <button onClick={() => onDismiss(error.cardId)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2em', padding: '0 4px', color: '#666' }}>&times;</button>
            </div>
            <div style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>Failed: {error.failedAddress}</div>
            <div style={{ width: '100%', marginTop: '8px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
                <label style={{ fontSize: '0.85em', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Manual Fix (Search):</label>
                <div style={{ position: 'relative' }}>
                    <input type="text" value={manualAddress} onChange={handleManualAddressChange} placeholder="Google Maps Search..." style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }} />
                    {searchResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 3000, background: 'white', border: '1px solid #ccc', borderRadius: '4px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', maxHeight: '150px', overflowY: 'auto', color: 'black' }}>
                            {searchResults.map((p) => (
                                <div key={p.place_id} onClick={() => handleSelectResult(p)} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #eee', fontSize: '0.9em' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0f0f0'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}>{p.description}</div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- POPUP COMPONENT ---
const CardPopup = ({ card, listName, lists, onMove }) => {
    return (
        <div style={{ padding: '5px', minWidth: '220px', maxWidth: '300px' }}>
            <strong style={{ fontSize: '1.1em', display: 'block', marginBottom: '4px' }}>{card.name}</strong>
            <span style={{ color: '#666', fontSize: '0.9em', display: 'block', marginBottom: '8px' }}>in {listName}</span>

            {/* Description */}
            {card.desc && <div className="popup-desc" style={{ marginBottom: '8px', fontSize: '0.9em', color: '#444' }}>{card.desc}</div>}

            {/* Labels */}
            {card.labels && card.labels.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                    {card.labels.map(l => (
                        <span key={l.id} style={{
                            backgroundColor: l.color ? (l.color === 'sky' ? '#00c2e0' : l.color) : '#ccc',
                            color: getLabelTextColor(l.color),
                            padding: '2px 6px', borderRadius: '3px', fontSize: '0.75em', fontWeight: 'bold'
                        }}>{l.name}</span>
                    ))}
                </div>
            )}

            {/* Due Date */}
            {card.due && (
                <div style={{ fontSize: '0.85em', color: '#555', marginBottom: '8px' }}>
                    Due: {new Date(card.due).toLocaleDateString()}
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #eee' }}>
                <a href={card.shortUrl} target="_blank" rel="noreferrer" style={{ color: '#007aff', textDecoration: 'none', fontWeight: '500' }}>View in Trello</a>

                {/* Move Action */}
                {onMove && lists.length > 0 && (
                    <select
                        onChange={(e) => onMove(card.id, e.target.value)}
                        value=""
                        style={{ maxWidth: '120px', fontSize: '0.85em', padding: '2px' }}
                    >
                        <option value="" disabled>Move to...</option>
                        {lists.map(l => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                    </select>
                )}
            </div>
        </div>
    );
};


const MapView = ({ user, settings, onClose, onShowSettings, onLogout, onShowTasks }) => {
    const [cards, setCards] = useState([]);
    const [lists, setLists] = useState([]);
    const [boardLabels, setBoardLabels] = useState([]);
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(true);
    const [geocodingQueue, setGeocodingQueue] = useState([]);
    const [blocks, setBlocks] = useState([]);

    const [visibleListIds, setVisibleListIds] = useState(new Set());
    const [visibleRuleIds, setVisibleRuleIds] = useState(new Set(['default']));
    const [showHomeLocation, setShowHomeLocation] = useState(true);

    const [baseMap, setBaseMap] = useState('terrain');
    const [errors, setErrors] = useState([]);
    const [fitTrigger, setFitTrigger] = useState(0);
    const [markerRules, setMarkerRules] = useState([]);
    const [homeLocation, setHomeLocation] = useState(null);
    const [countdown, setCountdown] = useState(null);
    const [mapLoaded, setMapLoaded] = useState(false);

    const { theme, toggleTheme } = useDarkMode();
    const mapRef = useRef(null);
    const googleMapRef = useRef(null);
    const markersRef = useRef({});
    const homeMarkerRef = useRef(null);
    const geocoderRef = useRef(null);
    const popupRootsRef = useRef({}); // Store React roots for popups to unmount them

    // --- SETTINGS ---
    const getStoredSettings = () => {
        if (!user) return {};
        try { return JSON.parse(localStorage.getItem('trelloUserData') || '{}')[user.id]?.settings || {}; } catch (e) { return {}; }
    };
    const storedSettings = getStoredSettings();
    const boardId = settings?.boardId || storedSettings.boardId;
    const boardName = (settings && settings.boardName) ? settings.boardName : (storedSettings.boardName || 'Trello Board');
    const mapGeocodeMode = (settings && settings.mapGeocodeMode) || storedSettings?.mapGeocodeMode || 'store';
    const ignoreTemplateCards = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId) !== 'false';
    const updateTrelloCoordinates = localStorage.getItem('updateTrelloCoordinates_' + boardId) === 'true';
    const enableCardMove = localStorage.getItem('enableCardMove_' + boardId) === 'true';

    const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + boardId);
    const defaultRefreshSetting = { value: 1, unit: 'minutes' };
    const refreshSetting = savedRefresh ? JSON.parse(savedRefresh) : defaultRefreshSetting;
    const refreshIntervalSeconds = convertIntervalToSeconds(refreshSetting.value, refreshSetting.unit);
    const showClock = localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId) !== 'false';

    // --- INIT MAP ---
    useEffect(() => {
        loadGoogleMaps().then((maps) => {
            if (!mapRef.current) return;
            const mapOptions = { center: { lat: 0, lng: 0 }, zoom: 2, mapTypeControl: false, streetViewControl: false, fullscreenControl: false };
            const map = new maps.Map(mapRef.current, mapOptions);
            googleMapRef.current = map;
            geocoderRef.current = new maps.Geocoder();
            setMapLoaded(true);
            const styledMapType = new maps.StyledMapType(DARK_MODE_STYLE, { name: "Dark" });
            map.mapTypes.set("dark_mode", styledMapType);
        }).catch(console.error);
    }, []);

    useEffect(() => {
        if (!googleMapRef.current) return;
        const map = googleMapRef.current;
        switch (baseMap) {
            case 'topo': map.setMapTypeId(window.google.maps.MapTypeId.TERRAIN); break;
            case 'sat': map.setMapTypeId(window.google.maps.MapTypeId.HYBRID); break;
            case 'osm': case 'osmhot': map.setMapTypeId(window.google.maps.MapTypeId.ROADMAP); break;
            case 'dark': map.setMapTypeId('dark_mode'); break;
            default: map.setMapTypeId(window.google.maps.MapTypeId.TERRAIN);
        }
    }, [baseMap, mapLoaded]);

    // --- DATA LOADING ---
    const isFetchingRef = useRef(false);
    const loadData = useCallback(async (isRefresh = false) => {
        if (!user || !boardId || isFetchingRef.current) return;
        isFetchingRef.current = true;
        if (!isRefresh) { setLoading(true); setStatus('Loading cards...'); }
        try {
            const currentLayout = getPersistentLayout(user.id, boardId);
            setBlocks(currentLayout);
            const rulesKey = `TRELLO_MARKER_RULES_${boardId}`;
            const savedRules = localStorage.getItem(rulesKey);
            if (savedRules) setMarkerRules(JSON.parse(savedRules)); else setMarkerRules([]);

            const enableHome = localStorage.getItem(`enableHomeLocation_${boardId}`) === 'true';
            if (enableHome) {
                const homeCoords = JSON.parse(localStorage.getItem(`homeCoordinates_${boardId}`) || 'null');
                const homeIcon = localStorage.getItem(`homeIcon_${boardId}`) || 'home';
                const homeAddress = localStorage.getItem(`homeAddress_${boardId}`) || '';
                if (homeCoords) setHomeLocation({ coords: homeCoords, icon: homeIcon, address: homeAddress }); else setHomeLocation(null);
            } else setHomeLocation(null);

            if (!isRefresh) {
                const allListIds = currentLayout.filter(b => b.includeOnMap !== false).flatMap(b => b.listIds);
                setVisibleListIds(new Set(allListIds));
                const allRuleIds = (savedRules ? JSON.parse(savedRules) : []).map(r => r.id).concat(['default']);
                setVisibleRuleIds(new Set(allRuleIds));
            }

            const [listsData, labelsData, cardsData] = await Promise.all([
                trelloFetch(`/boards/${boardId}/lists?cards=none&fields=id,name`, user.token),
                trelloFetch(`/boards/${boardId}/labels`, user.token),
                trelloFetch(`/boards/${boardId}/cards?fields=id,name,desc,idList,labels,shortUrl,isTemplate,pos,coordinates,due,dueComplete&_=${Date.now()}`, user.token)
            ]);
            setLists(listsData);
            setBoardLabels(labelsData);

            const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
            const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
            const ignoreCompletedCards = localStorage.getItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + boardId) === 'true';
            const ignoreNoDescCards = localStorage.getItem('IGNORE_NO_DESC_CARDS_' + boardId) === 'true';

            const processedCards = cardsData.filter(c => {
                if (ignoreTemplateCards && c.isTemplate) return false;
                if (ignoreCompletedCards && c.dueComplete) return false;
                if (ignoreNoDescCards && (!c.desc || !c.desc.trim())) return false;
                return true;
            }).map(c => {
                let coords = null;
                if (c.coordinates) {
                    if (typeof c.coordinates === 'string' && c.coordinates.includes(',')) {
                        const parts = c.coordinates.split(',');
                        if (parts.length === 2) coords = { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
                    } else if (typeof c.coordinates === 'object') {
                        const lat = c.coordinates.lat || c.coordinates.latitude;
                        const lng = c.coordinates.lng || c.coordinates.long || c.coordinates.longitude;
                        if (lat && lng) coords = { lat: parseFloat(lat), lng: parseFloat(lng) };
                    }
                }
                if ((!coords || !coords.lat) && cache[c.id]) coords = cache[c.id];
                return { ...c, coordinates: coords };
            });
            setCards(processedCards);
        } catch (e) {
            console.error(e); setStatus(`Error: ${e.message}`);
        } finally {
            isFetchingRef.current = false;
            if (!isRefresh) { setLoading(false); setStatus(''); }
        }
    }, [user, boardId, ignoreTemplateCards]);

    // --- REFRESH LOOP ---
    const intervalRef = useRef(null);
    const countdownRef = useRef(null);
    useEffect(() => { loadData(false); }, [loadData]);
    useEffect(() => {
        if (countdownRef.current) clearInterval(countdownRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (geocodingQueue.length === 0 && !loading) {
            setCountdown(refreshIntervalSeconds);
            countdownRef.current = setInterval(() => setCountdown(p => (p !== null && p > 0) ? p - 1 : p), 1000);
            intervalRef.current = setInterval(() => { loadData(true); setCountdown(refreshIntervalSeconds); }, refreshIntervalSeconds * 1000);
        } else { setCountdown(null); }
        return () => { clearInterval(countdownRef.current); clearInterval(intervalRef.current); };
    }, [geocodingQueue.length, loading, refreshIntervalSeconds, loadData]);

    // --- FILTER HANDLERS ---
    const handleToggleList = (listId) => {
        const next = new Set(visibleListIds);
        if (next.has(listId)) next.delete(listId); else next.add(listId);
        setVisibleListIds(next);
    };
    const handleToggleBlock = (blockId, isChecked) => {
        const block = blocks.find(b => b.id === blockId);
        if (!block) return;
        const next = new Set(visibleListIds);
        block.listIds.forEach(id => isChecked ? next.add(id) : next.delete(id));
        setVisibleListIds(next);
    };
    const handleToggleAllBlocks = (isChecked) => {
        const next = new Set(visibleListIds);
        const allListIds = blocks.filter(b => b.includeOnMap !== false).flatMap(b => b.listIds);
        allListIds.forEach(id => isChecked ? next.add(id) : next.delete(id));
        setVisibleListIds(next);
    };
    const handleToggleRule = (ruleId) => {
        const next = new Set(visibleRuleIds);
        if (next.has(ruleId)) next.delete(ruleId); else next.add(ruleId);
        setVisibleRuleIds(next);
    };
    const handleToggleAllRules = (isChecked) => {
        const allRuleIds = markerRules.map(r => r.id).concat(['default']);
        const next = new Set(isChecked ? allRuleIds : []);
        setVisibleRuleIds(next);
    };

    // --- MOVE CARD ---
    const handleMoveCard = async (cardId, newListId) => {
        if (!enableCardMove) return;
        try {
            await trelloFetch(`/cards/${cardId}`, user.token, {
                method: 'PUT',
                body: JSON.stringify({ idList: newListId }),
                headers: { 'Content-Type': 'application/json' }
            });
            // Optimistic update
            setCards(prev => prev.map(c => c.id === cardId ? { ...c, idList: newListId } : c));
        } catch (e) {
            console.error("Failed to move card", e);
            alert("Failed to move card.");
        }
    };

    // --- MARKERS RENDER ---
    useEffect(() => {
        if (!googleMapRef.current || !mapLoaded) return;
        const map = googleMapRef.current;
        const validCards = cards.filter(c => c.coordinates && c.coordinates.lat);

        const visibleCards = validCards.filter(c => {
            if (!visibleListIds.has(c.idList)) return false;
            const block = blocks.find(b => b.listIds.includes(c.idList));
            if (!block) return true;
            const { activeRuleIds } = getMarkerConfig(c, block, markerRules);
            return [...activeRuleIds].some(id => visibleRuleIds.has(id));
        });

        const newMarkers = {};
        visibleCards.forEach(c => {
            const block = blocks.find(b => b.listIds.includes(c.idList)) || { mapIcon: 'map-marker' };
            const markerConfig = getMarkerConfig(c, block, markerRules);
            const googleIcon = getGoogleMarkerIcon(markerConfig);
            const position = { lat: c.coordinates.lat, lng: c.coordinates.lng };

            if (markersRef.current[c.id]) {
                const m = markersRef.current[c.id];
                m.setPosition(position);
                m.setIcon(googleIcon);
                // Update click listener content if needed? 
                // Creating a new listener for every render is expensive. 
                // We'll trust the click handler references the closure.
                // Actually closure is stale. We need to attach new data or handle correctly.
                // Best to re-attach or use a property.
                m.set('cardData', c); // Store data on marker
                newMarkers[c.id] = m;
            } else {
                const m = new window.google.maps.Marker({ position, map, icon: googleIcon, title: c.name });
                m.set('cardData', c);

                const infoWindow = new window.google.maps.InfoWindow();
                m.addListener("click", () => {
                    const currentCard = m.get('cardData'); // Get fresh data
                    const div = document.createElement('div');
                    const root = createRoot(div);
                    // Find current list Name
                    const list = lists.find(l => l.id === currentCard.idList);
                    const listName = list ? list.name : 'Unknown List';

                    root.render(
                        <CardPopup
                            card={currentCard}
                            listName={listName}
                            lists={enableCardMove ? lists : []}
                            onMove={handleMoveCard}
                        />
                    );

                    // Cleanup old root when window closes? 
                    // Google Maps doesn't emit easy "close" for content cleanup. 
                    // But we can overwrite content.
                    infoWindow.setContent(div);
                    infoWindow.open(map, m);

                    // Simple memory manegement: we don't strictly unmount roots here which implies small leak
                    // if user clicks thousands of times. For now acceptable or we can add close listener.
                });

                newMarkers[c.id] = m;
            }
        });

        // Remove stale
        Object.keys(markersRef.current).forEach(id => {
            if (!newMarkers[id]) markersRef.current[id].setMap(null);
        });
        markersRef.current = newMarkers;

        // Home
        if (homeLocation && homeLocation.coords && showHomeLocation) {
            const pos = { lat: homeLocation.coords.lat, lng: homeLocation.coords.lon };
            const icon = getGoogleMarkerIcon({ icon: homeLocation.icon || 'home', color: 'purple' });
            if (homeMarkerRef.current) { homeMarkerRef.current.setPosition(pos); homeMarkerRef.current.setIcon(icon); homeMarkerRef.current.setMap(map); }
            else { homeMarkerRef.current = new window.google.maps.Marker({ position: pos, map, icon: icon, zIndex: 1000 }); }
        } else if (homeMarkerRef.current) { homeMarkerRef.current.setMap(null); }

    }, [cards, visibleListIds, visibleRuleIds, blocks, markerRules, homeLocation, showHomeLocation, mapLoaded, lists]);

    return (
        <div className="map-view-container">
            {/* Header */}
            <div className="map-header">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    {showClock && <DigitalClock boardId={boardId} />}
                    <h1 style={{ margin: 0, fontSize: '1.5em', marginLeft: showClock ? '20px' : '0' }}>{boardName} Map</h1>
                </div>
                {/* Right Aligned Controls in Header */}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '15px' }}>
                    {!mapLoaded && <span className="spinner"></span>}
                    {/* Base Layer */}
                    <select value={baseMap} onChange={e => setBaseMap(e.target.value)} style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.9em' }}>
                        <option value="topo">Topo (Default)</option>
                        <option value="sat">Satellite</option>
                        <option value="dark">Dark Mode</option>
                    </select>

                    {/* Theme Toggle Button */}
                    <button
                        onClick={() => toggleTheme()}
                        title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-color)'
                        }}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: theme === 'dark' ? ICONS.sun : ICONS.moon }} />
                    </button>
                </div>
            </div>

            {/* Toasts */}
            <div style={{ position: 'fixed', top: '80px', right: '20px', zIndex: 9999, pointerEvents: 'none' }}>
                <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    {errors.map(err => <GeocodingErrorToast key={err.cardId} error={err} onDismiss={handleDismissError} onApply={handleApplyResult} />)}
                </div>
            </div>

            <div style={{ display: 'flex', flexGrow: 1, position: 'relative' }}>
                <div className="map-sidebar">
                    <MapFilters
                        lists={lists} cards={cards} allLabels={boardLabels}
                        visibleListIds={visibleListIds} onToggleList={handleToggleList}
                        blocks={blocks} onToggleBlock={handleToggleBlock} onToggleAllBlocks={handleToggleAllBlocks}
                        markerRules={markerRules} visibleRuleIds={visibleRuleIds} onToggleRule={handleToggleRule} onToggleAllRules={handleToggleAllRules}
                        homeLocation={homeLocation} showHomeLocation={showHomeLocation} onToggleHome={() => setShowHomeLocation(!showHomeLocation)}
                    />
                </div>
                <div style={{ flexGrow: 1, position: 'relative', background: '#e0e0e0' }}>
                    <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
                    {!mapLoaded && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>Loading Google Maps...</div>}
                </div>
            </div>

            {/* Footer */}
            <div className="map-footer">
                <div className="map-footer-left">
                    <span>{status || (countdown !== null ? `Refreshing in ${formatCountdown(countdown)}` : 'Ready')}</span>
                    {geocodingQueue.length > 0 && <span>(Geocoding {geocodingQueue.length}...)</span>}
                </div>
                <div className="map-footer-right">
                    <button className="button-secondary" onClick={() => setFitTrigger(n => n + 1)}>Fit Map</button>
                    <div style={{ fontSize: '0.8em', color: '#888' }}>Powered by Google Maps & Trello</div>
                </div>
            </div>
        </div>
    );
};

export default MapView;
