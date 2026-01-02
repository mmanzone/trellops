
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

const testCases = [
    { name: "Long URL with coords", desc: "Start https://www.google.com/maps/place/Toorak+VIC+3142/@-37.840935,145.012345,15z/data=... End" },
    { name: "Long URL no coords", desc: "Check this https://www.google.com/maps/place/Toorak+VIC+3142/ other stuff" },
    { name: "Shortened URL (goo.gl)", desc: "Link: https://goo.gl/maps/123456" },
    { name: "Shortened URL (maps.app.goo.gl)", desc: "Link: https://maps.app.goo.gl/mR2d..." },
    { name: "Query URL", desc: "https://www.google.com/maps?q=-37.84,145.01" },
    { name: "Search URL", desc: "https://www.google.com/maps/search/?api=1&query=Toorak+VIC" },
    { name: "Raw Coords", desc: "-37.84, 145.01" },
    { name: "Address string", desc: "123 Toorak Rd, South Yarra VIC 3141" },
    { name: "User Description Attempt", desc: "PR2 - LDOB - S52254 - TOORAK - (S) - 0412943675 - GLASS PANEL AND FRAME SWINGING OF SIDE OF THE BUILDING -3M HIGH -\nhttps://maps.app.goo.gl/something" }
];

console.log("Running Tests on parseAddressFromDescription:");
testCases.forEach(test => {
    const result = parseAddressFromDescription(test.desc);
    console.log(`\n[${test.name}]`);
    console.log(`Input: ${test.desc}`);
    console.log(`Result: ${result}`);
});
