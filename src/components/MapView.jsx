import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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

    // Pin Shape
    const pinPath = `<path d="M14 0C8 0 3 5 3 11c0 8 11 21 11 21s11-13 11-21C25 5 20 0 14 0z" fill="${markerColor}"/>`;

    // Inner Icon centered
    const innerIconGroup = `<g transform="translate(7, 4) scale(0.58)" fill="#fff">${svgPath}</g>`;

    // Create SVG String
    const svg = `
    <svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 3px 4px rgba(0,0,0,0.4));">
        ${pinPath}
        ${innerIconGroup}
    </svg>`;

    // Convert to Data URI
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

const parseAddressFromDescription = (desc) => {
    if (!desc || !desc.trim()) return null;

    const mapsPlaceMatch = desc.match(/https?:\/\/(?:www\.)?google\.[^\/\s]+\/maps\/place\/([^\s)]+)/i);
    if (mapsPlaceMatch) {
        const placePart = mapsPlaceMatch[1];
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

// --- ERROR TOAST WITH GOOGLE AUTOCOMPLETE ---
const GeocodingErrorToast = ({ error, onDismiss, onApply }) => {
    const [manualAddress, setManualAddress] = useState('');
    const [searchResults, setSearchResults] = useState([]);

    // Use AutocompleteService for manual fix searches
    const autocompleteService = useRef(null);

    useEffect(() => {
        if (window.google && window.google.maps && window.google.maps.places) {
            autocompleteService.current = new window.google.maps.places.AutocompleteService();
        }
    }, []);

    const handleManualAddressChange = (e) => {
        const val = e.target.value;
        setManualAddress(val);

        if (!val || val.length < 3) {
            setSearchResults([]);
            return;
        }

        if (autocompleteService.current) {
            autocompleteService.current.getPlacePredictions({ input: val }, (predictions, status) => {
                if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
                    setSearchResults(predictions);
                } else {
                    setSearchResults([]);
                }
            });
        }
    };

    const handleSelectResult = (prediction) => {
        // Need Geocoder to get lat/lng from place_id
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode({ placeId: prediction.place_id }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const loc = results[0].geometry.location;
                onApply(error.cardId, {
                    lat: loc.lat(),
                    lng: loc.lng(),
                    display_name: results[0].formatted_address
                });
            } else {
                alert("Failed to get details for this location.");
            }
        });
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#c92a2a', fontWeight: 'bold' }}>Geocoding Error</span>
                    {error.cardUrl && (
                        <a href={error.cardUrl} target="_blank" rel="noreferrer" style={{ color: '#0057d9', fontSize: '0.85em', textDecoration: 'underline' }}>
                            View Card
                        </a>
                    )}
                </div>
                <button
                    onClick={() => onDismiss(error.cardId)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2em', padding: '0 4px', color: '#666' }}
                >
                    &times;
                </button>
            </div>

            <div style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                Failed: {error.failedAddress}
            </div>

            <div style={{ width: '100%', marginTop: '8px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
                <label style={{ fontSize: '0.85em', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
                    Manual Fix (Search):
                </label>
                <div style={{ position: 'relative' }}>
                    <input
                        type="text"
                        value={manualAddress}
                        onChange={handleManualAddressChange}
                        placeholder="Google Maps Search..."
                        style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                    {searchResults.length > 0 && (
                        <div style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            right: 0,
                            zIndex: 3000,
                            background: 'white',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            maxHeight: '150px',
                            overflowY: 'auto',
                            color: 'black'
                        }}>
                            {searchResults.map((p) => (
                                <div
                                    key={p.place_id}
                                    onClick={() => handleSelectResult(p)}
                                    style={{
                                        padding: '8px',
                                        cursor: 'pointer',
                                        borderBottom: '1px solid #eee',
                                        fontSize: '0.9em'
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0f0f0'}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}
                                >
                                    {p.description}
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
    // --- STATE ---
    const [cards, setCards] = useState([]);
    const [lists, setLists] = useState([]);
    const [boardLabels, setBoardLabels] = useState([]);
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(true);
    const [geocodingQueue, setGeocodingQueue] = useState([]);
    const [blocks, setBlocks] = useState([]);

    const [visibleListIds, setVisibleListIds] = useState(new Set());
    const [visibleRuleIds, setVisibleRuleIds] = useState(new Set(['default']));

    // Base Layer: 'roadmap', 'satellite', 'hybrid', 'terrain', or 'dark' (custom)
    const [baseMap, setBaseMap] = useState('terrain');

    const [errors, setErrors] = useState([]);
    const [fitTrigger, setFitTrigger] = useState(0);
    const [markerRules, setMarkerRules] = useState([]);
    const [homeLocation, setHomeLocation] = useState(null);
    const [countdown, setCountdown] = useState(null);
    const [mapLoaded, setMapLoaded] = useState(false);

    const { theme } = useDarkMode();

    // --- REFS ---
    const mapRef = useRef(null); // DOM element
    const googleMapRef = useRef(null); // google.maps.Map instance
    const markersRef = useRef({}); // { cardId: google.maps.Marker }
    const homeMarkerRef = useRef(null);
    const geocoderRef = useRef(null);

    // --- SETTINGS MAPPING ---
    const getStoredSettings = () => {
        if (!user) return {};
        try {
            return JSON.parse(localStorage.getItem('trelloUserData') || '{}')[user.id]?.settings || {};
        } catch (e) { return {}; }
    };
    const storedSettings = getStoredSettings();
    const boardId = settings?.boardId || storedSettings.boardId;
    const boardName = (settings && settings.boardName) ? settings.boardName : (storedSettings.boardName || 'Trello Board');

    // Geocode Config
    const mapGeocodeMode = (settings && settings.mapGeocodeMode) || storedSettings?.mapGeocodeMode || 'store';
    const ignoreTemplateCards = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId) !== 'false';
    const updateTrelloCoordinates = localStorage.getItem('updateTrelloCoordinates_' + boardId) === 'true';

    const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + boardId);
    const defaultRefreshSetting = { value: 1, unit: 'minutes' };
    const refreshSetting = savedRefresh ? JSON.parse(savedRefresh) : defaultRefreshSetting;
    const refreshIntervalSeconds = convertIntervalToSeconds(refreshSetting.value, refreshSetting.unit);

    const storedClockSetting = localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId);
    const showClock = storedClockSetting !== 'false';

    // --- INIT GOOGLE MAPS ---
    useEffect(() => {
        loadGoogleMaps().then((maps) => {
            if (!mapRef.current) return;

            // Default Options
            const mapOptions = {
                center: { lat: 0, lng: 0 },
                zoom: 2,
                mapTypeControl: false, // will enable custom
                streetViewControl: false,
                fullscreenControl: false,
            };

            const map = new maps.Map(mapRef.current, mapOptions);
            googleMapRef.current = map;
            geocoderRef.current = new maps.Geocoder();
            setMapLoaded(true);

            // Setup Custom "Dark Mode"
            const styledMapType = new maps.StyledMapType(DARK_MODE_STYLE, { name: "Dark" });
            map.mapTypes.set("dark_mode", styledMapType);

        }).catch(e => {
            console.error("Failed to load Google Maps", e);
            setStatus("Failed to load Google Maps API. Check Key.");
        });
    }, []);

    // --- UPDATE MAP LAYER ---
    useEffect(() => {
        if (!googleMapRef.current) return;
        const map = googleMapRef.current;

        // mapping simplified 'baseMap' key to Google MapTypeId or custom
        switch (baseMap) {
            case 'topo':
                map.setMapTypeId(window.google.maps.MapTypeId.TERRAIN);
                break;
            case 'sat':
                map.setMapTypeId(window.google.maps.MapTypeId.HYBRID); // Sat + Labels
                break;
            case 'osm': // Legacy fallback -> Roadmap
            case 'osmhot':
                map.setMapTypeId(window.google.maps.MapTypeId.ROADMAP);
                break;
            case 'dark':
                map.setMapTypeId('dark_mode');
                break;
            default:
                map.setMapTypeId(window.google.maps.MapTypeId.TERRAIN);
        }
    }, [baseMap, mapLoaded]);

    // --- GENERIC DATA FETCHING (Same as original) ---
    const isFetchingRef = useRef(false);
    const loadData = useCallback(async (isRefresh = false) => {
        if (!user || !boardId) return;
        if (isFetchingRef.current) return;

        isFetchingRef.current = true;
        if (!isRefresh) setLoading(true);
        if (!isRefresh) setStatus('Loading cards...');

        try {
            const currentLayout = getPersistentLayout(user.id, boardId);
            setBlocks(currentLayout);

            // Load Rules
            const rulesKey = `TRELLO_MARKER_RULES_${boardId}`;
            const savedRules = localStorage.getItem(rulesKey);
            if (savedRules) setMarkerRules(JSON.parse(savedRules));
            else setMarkerRules([]);

            // Load Home
            const enableHome = localStorage.getItem(`enableHomeLocation_${boardId}`) === 'true';
            if (enableHome) {
                const homeCoords = JSON.parse(localStorage.getItem(`homeCoordinates_${boardId}`) || 'null');
                const homeIcon = localStorage.getItem(`homeIcon_${boardId}`) || 'home';
                const homeAddress = localStorage.getItem(`homeAddress_${boardId}`) || '';
                if (homeCoords) {
                    setHomeLocation({ coords: homeCoords, icon: homeIcon, address: homeAddress });
                } else setHomeLocation(null);
            } else setHomeLocation(null);

            if (!isRefresh) {
                const allListIds = currentLayout.filter(b => b.includeOnMap !== false).flatMap(b => b.listIds);
                setVisibleListIds(new Set(allListIds));
                const allRuleIds = (savedRules ? JSON.parse(savedRules) : []).map(r => r.id).concat(['default']);
                setVisibleRuleIds(new Set(allRuleIds));
            }

            const listsPromise = trelloFetch(`/boards/${boardId}/lists?cards=none&fields=id,name`, user.token);
            const labelsPromise = trelloFetch(`/boards/${boardId}/labels`, user.token);
            const cardsPromise = trelloFetch(`/boards/${boardId}/cards?fields=id,name,desc,idList,labels,shortUrl,isTemplate,pos,coordinates,dueComplete&_=${Date.now()}`, user.token);

            const [listsData, labelsData, cardsData] = await Promise.all([listsPromise, labelsPromise, cardsPromise]);

            setLists(listsData);
            setBoardLabels(labelsData);

            // Process Cards
            const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
            const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
            const ignoreCompletedCards = localStorage.getItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + boardId) === 'true';
            const ignoreNoDescCards = localStorage.getItem('IGNORE_NO_DESC_CARDS_' + boardId) === 'true';

            const processedCards = [];
            for (const c of cardsData) {
                if (ignoreTemplateCards && c.isTemplate) continue;
                if (ignoreCompletedCards && c.dueComplete) continue;
                if (ignoreNoDescCards && (!c.desc || !c.desc.trim())) continue;

                let coords = null;
                // Check Trello API coords first
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
                // Fallback to cache
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

    }, [user, boardId, ignoreTemplateCards]);

    // --- REFRESH LOOP ---
    const intervalRef = useRef(null);
    const countdownRef = useRef(null);

    useEffect(() => {
        loadData(false);
    }, [loadData]);

    useEffect(() => {
        if (countdownRef.current) clearInterval(countdownRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);

        if (geocodingQueue.length === 0 && !loading) {
            setCountdown(refreshIntervalSeconds);
            countdownRef.current = setInterval(() => {
                setCountdown(prev => (prev !== null && prev > 0) ? prev - 1 : prev);
            }, 1000);
            intervalRef.current = setInterval(() => {
                loadData(true);
                setCountdown(refreshIntervalSeconds);
            }, refreshIntervalSeconds * 1000);
        } else {
            setCountdown(null);
        }
        return () => {
            clearInterval(countdownRef.current);
            clearInterval(intervalRef.current);
        };
    }, [geocodingQueue.length, loading, refreshIntervalSeconds, loadData]);


    // --- GEOCODING QUEUE LOGIC ---
    useEffect(() => {
        const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
        const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');

        const needGeocoding = cards.filter(c => {
            if (c.coordinates && c.coordinates.lat) return false;
            if (cache[c.id]) return false;
            if (mapGeocodeMode === 'disabled') return false;

            const addressCandidate = parseAddressFromDescription(c.desc) || (c.name.length > 10 ? c.name : null);
            if (mapGeocodeMode === 'store' && (!c.desc || !c.desc.trim())) return false;
            if (!addressCandidate) return false;

            if (!visibleListIds.has(c.idList)) return false;

            return true;
        }).map(c => c.id);

        if (needGeocoding.length > 0) {
            setGeocodingQueue(prev => {
                const newItems = needGeocoding.filter(id => !prev.includes(id));
                return newItems.length > 0 ? [...prev, ...newItems] : prev;
            });
        }
    }, [cards, visibleListIds, mapGeocodeMode, boardId]);

    // Process Buffer
    useEffect(() => {
        if (geocodingQueue.length === 0 || !geocoderRef.current) return;

        // Google Maps allows higher throughput. We can process 1 at a time every 200ms to be safe, 
        // or just fire one. Let's do simplistic queue consumption.
        const cardId = geocodingQueue[0];
        const card = cards.find(c => c.id === cardId);

        if (!card) {
            setGeocodingQueue(prev => prev.slice(1));
            return;
        }

        setStatus(`Geocoding: ${card.name} (${geocodingQueue.length} left)`);

        const process = async () => {
            let address = parseAddressFromDescription(card.desc) || (card.name.length > 5 ? card.name : null);
            if (address) {
                address = expandAbbreviations(address);
                geocoderRef.current.geocode({ address: address }, (results, status) => {
                    if (status === 'OK' && results[0]) {
                        const loc = results[0].geometry.location;
                        const coords = { lat: loc.lat(), lng: loc.lng() };

                        setCards(prev => prev.map(c => c.id === cardId ? { ...c, coordinates: coords } : c));

                        // Save Cache
                        const key = `MAP_GEOCODING_CACHE_${boardId}`;
                        const cache = JSON.parse(localStorage.getItem(key) || '{}');
                        cache[cardId] = coords;
                        localStorage.setItem(key, JSON.stringify(cache));

                        // Update Trello
                        if (updateTrelloCoordinates) {
                            trelloFetch(`/cards/${cardId}`, user.token, {
                                method: 'PUT',
                                body: JSON.stringify({ coordinates: `${coords.lat},${coords.lng}` }),
                                headers: { 'Content-Type': 'application/json' }
                            }).catch(console.warn);
                        }

                    } else {
                        // Error
                        console.warn(`Geocoding failed for ${card.name}: ${status}`);
                        if (status === 'ZERO_RESULTS') {
                            const errorObj = {
                                message: `Geocoding failed for: ${card.name}`,
                                cardUrl: card.shortUrl,
                                cardId: card.id,
                                failedAddress: address
                            };
                            setErrors(prev => [...prev, errorObj]);
                        }
                    }
                    // Next
                    setTimeout(() => {
                        setGeocodingQueue(prev => prev.slice(1));
                    }, 300); // 300ms delay between requests
                });
            } else {
                setGeocodingQueue(prev => prev.slice(1));
            }
        };
        process();

    }, [geocodingQueue, cards, updateTrelloCoordinates, user.token, boardId]);


    // --- RENDER MARKERS ---
    useEffect(() => {
        if (!googleMapRef.current || !mapLoaded) return;

        const map = googleMapRef.current;
        const validCards = cards.filter(c => c.coordinates && c.coordinates.lat);

        // 1. Determine which cards should be shown
        // Must be in visible list AND match a rule (if active)
        const visibleCards = validCards.filter(c => {
            if (!visibleListIds.has(c.idList)) return false;
            // Check Block logic
            const block = blocks.find(b => b.listIds.includes(c.idList));
            if (!block) return true; // Show if no block?

            // Rule filtering
            const { activeRuleIds } = getMarkerConfig(c, block, markerRules);
            const hasOverlap = [...activeRuleIds].some(id => visibleRuleIds.has(id));
            return hasOverlap;
        });

        // 2. Sync Markers
        const newMarkers = {};

        visibleCards.forEach(c => {
            const block = blocks.find(b => b.listIds.includes(c.idList)) || { mapIcon: 'map-marker' };
            const markerConfig = getMarkerConfig(c, block, markerRules);
            const googleIcon = getGoogleMarkerIcon(markerConfig);
            const position = { lat: c.coordinates.lat, lng: c.coordinates.lng };

            if (markersRef.current[c.id]) {
                // Update existing
                const m = markersRef.current[c.id];
                m.setPosition(position);
                m.setIcon(googleIcon);
                newMarkers[c.id] = m;
            } else {
                // Create new
                const m = new window.google.maps.Marker({
                    position,
                    map,
                    icon: googleIcon,
                    title: c.name
                });

                // Info Window click listener
                const infoWindow = new window.google.maps.InfoWindow({
                    content: `
                        <div style="padding: 5px; max-width: 200px;">
                            <strong style="font-size: 1.1em">${c.name}</strong><br/>
                            <span style="color: #666; font-size: 0.9em">${block.name || 'Unassigned'}</span><br/>
                            <a href="${c.shortUrl}" target="_blank" style="color: #007aff; text-decoration: none; margin-top: 5px; display: inline-block;">View in Trello</a>
                        </div>
                     `
                });

                m.addListener("click", () => {
                    infoWindow.open(map, m);
                });

                newMarkers[c.id] = m;
            }
        });

        // 3. Remove stale markers
        Object.keys(markersRef.current).forEach(id => {
            if (!newMarkers[id]) {
                markersRef.current[id].setMap(null);
            }
        });

        markersRef.current = newMarkers;

        // 4. Handle Home Marker
        if (homeLocation && homeLocation.coords) {
            const pos = { lat: homeLocation.coords.lat, lng: homeLocation.coords.lon };
            const icon = getGoogleMarkerIcon({ icon: homeLocation.icon || 'home', color: 'purple' });

            if (homeMarkerRef.current) {
                homeMarkerRef.current.setPosition(pos);
                homeMarkerRef.current.setIcon(icon);
                homeMarkerRef.current.setMap(map);
            } else {
                homeMarkerRef.current = new window.google.maps.Marker({
                    position: pos,
                    map,
                    icon: icon,
                    zIndex: 1000 // On top
                });
            }
        } else if (homeMarkerRef.current) {
            homeMarkerRef.current.setMap(null);
        }

    }, [cards, visibleListIds, visibleRuleIds, blocks, markerRules, homeLocation, mapLoaded]);

    // --- AUTO FIT BOUNDS (Smart Zoom) ---
    // Track content signature to trigger fit only on meaningful changes
    const prevSignature = useRef('');

    useEffect(() => {
        if (!googleMapRef.current) return;

        const displayedCards = Object.keys(markersRef.current); // IDs currently shown
        const homeKey = (homeLocation && homeLocation.coords) ? 'HOME' : '';
        const signature = displayedCards.sort().join(',') + '|' + homeKey + '|' + fitTrigger;

        if (signature !== prevSignature.current) {
            const bounds = new window.google.maps.LatLngBounds();
            let hasPoints = false;

            Object.values(markersRef.current).forEach(m => {
                bounds.extend(m.getPosition());
                hasPoints = true;
            });

            if (homeMarkerRef.current && homeMarkerRef.current.getMap()) {
                bounds.extend(homeMarkerRef.current.getPosition());
                hasPoints = true;
            }

            if (hasPoints) {
                googleMapRef.current.fitBounds(bounds, 50); // 50px padding
            }
            prevSignature.current = signature;
        }

    }, [cards, visibleListIds, visibleRuleIds, homeLocation, fitTrigger]);


    // --- UI HELPERS ---
    const handleDismissError = (cId) => setErrors(prev => prev.filter(e => e.cardId !== cId));
    const handleApplyResult = (cId, coords) => {
        setCards(prev => prev.map(c => c.id === cId ? { ...c, coordinates: coords } : c));
        const key = `MAP_GEOCODING_CACHE_${boardId}`;
        const cache = JSON.parse(localStorage.getItem(key) || '{}');
        cache[cId] = coords;
        localStorage.setItem(key, JSON.stringify(cache));

        if (updateTrelloCoordinates) {
            trelloFetch(`/cards/${cId}`, user.token, {
                method: 'PUT',
                body: JSON.stringify({ coordinates: `${coords.lat},${coords.lng}` }),
                headers: { 'Content-Type': 'application/json' }
            }).catch(console.warn);
        }
        handleDismissError(cId);
    };

    return (
        <div className="map-view-container">
            {/* Header */}
            <div className="map-header">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    {showClock && <DigitalClock boardId={boardId} />}
                    <h1 style={{ margin: 0, fontSize: '1.5em', marginLeft: showClock ? '20px' : '0' }}>
                        {boardName} Map
                    </h1>
                </div>

                {/* Toasts Container */}
                <div style={{ position: 'fixed', top: '80px', right: '20px', zIndex: 9999, pointerEvents: 'none' }}>
                    <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        {errors.map(err => (
                            <GeocodingErrorToast
                                key={err.cardId}
                                error={err}
                                onDismiss={handleDismissError}
                                onApply={handleApplyResult}
                            />
                        ))}
                    </div>
                </div>

                <div className="map-controls">
                    {/* Reusing existing logic for filters but we skip rendering specific implementation, assume MapFilters handles UI */}
                    <span style={{ fontSize: '0.9em', marginRight: '10px' }}>
                        {status || (
                            countdown !== null
                                ? `Refreshing in ${formatCountdown(countdown)}`
                                : 'Ready'
                        )}
                    </span>

                    {/* Base Layer Switcher */}
                    <div style={{ marginRight: '15px' }}>
                        <select
                            value={baseMap}
                            onChange={e => setBaseMap(e.target.value)}
                            style={{
                                padding: '6px',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                fontSize: '0.9em'
                            }}
                        >
                            <option value="topo">Topo (Default)</option>
                            <option value="sat">Satellite</option>
                            <option value="dark">Dark Mode</option>
                        </select>
                    </div>

                    <button className="button-secondary" onClick={() => setFitTrigger(n => n + 1)}>
                        Fit Map
                    </button>
                    <button className="button-secondary" onClick={onClose}>
                        Close Map
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', flexGrow: 1, position: 'relative' }}>
                {/* Sidebar */}
                <div className="map-sidebar">
                    <MapFilters
                        lists={lists.filter(l => {
                            // Only show lists that are part of a block which is included on map? 
                            // Or show all? Original logic: Show all available lists.
                            return true;
                        })}
                        labels={boardLabels}
                        visibleListIds={visibleListIds}
                        setVisibleListIds={setVisibleListIds}
                        blocks={blocks}
                        markerRules={markerRules}
                        visibleRuleIds={visibleRuleIds}
                        setVisibleRuleIds={setVisibleRuleIds}
                    />
                </div>

                {/* Map */}
                <div style={{ flexGrow: 1, position: 'relative', background: '#e0e0e0' }}>
                    <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
                    {!mapLoaded && (
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
                            Loading Google Maps...
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="footer-copyright">
                Powered by Google Maps & Trello
            </div>
        </div>
    );
};

export default MapView;
