import React from 'react';

/*
 * Illustrations for the homepage, drawn as inline SVG so they stay sharp,
 * weigh almost nothing and use the site palette.
 */

const C = {
    ink: '#15171c',
    ink2: '#474d58',
    ink3: '#767c88',
    line: '#e6e3dc',
    c1: '#5b6b7f',
    c2: '#d9822b',
    c3: '#7a5cc7',
    c4: '#1f8a70',
    c5: '#0079bf',
    c6: '#d0453f',
    c7: '#3d4654',
};

const display = { fontFamily: 'var(--s-display)', fontWeight: 650, letterSpacing: '-0.02em' };

const Tile = ({ x, y, w, h, color, n, label, size = 30 }) => (
    <g>
        <rect x={x} y={y} width={w} height={h} rx="8" fill={color} />
        <text x={x + w / 2} y={y + h / 2 + size * 0.22} textAnchor="middle" fill="#fff" fontSize={size} style={display}>{n}</text>
        <text x={x + w / 2} y={y + h / 2 + size * 0.22 + 16} textAnchor="middle" fill="#fff" fontSize="10.5" fontWeight="500" opacity="0.92">{label}</text>
    </g>
);

export const WallboardArt = () => {
    const row1 = [
        ['Inbox', C.c1, 18], ['Dispatched', C.c5, 9], ['On site', C.c2, 6], ['Blocked', C.c6, 2],
    ];
    const row2 = [['Awaiting parts', C.c3, 5], ['Invoiced', C.c4, 31], ['Closed this week', C.c7, 47]];
    return (
        <svg viewBox="0 0 560 380" role="img" aria-label="A wall-mounted screen showing a Trellops dashboard with a clock and coloured tiles for each list.">
            <ellipse cx="280" cy="350" rx="190" ry="10" fill="#15171c" opacity="0.07" />
            <rect x="40" y="24" width="480" height="292" rx="14" fill={C.ink} />
            <rect x="52" y="36" width="456" height="268" rx="6" fill="#fff" />
            <text x="72" y="70" fontSize="15" fill={C.ink} style={display}>Operations</text>
            <text x="488" y="70" fontSize="15" fill={C.ink3} textAnchor="end" style={{ ...display, fontVariantNumeric: 'tabular-nums' }}>09:41</text>
            <text x="72" y="96" fontSize="10" fill={C.ink3} fontWeight="600" letterSpacing="0.08em">FIELD TEAM</text>
            {row1.map(([label, color, n], i) => (
                <Tile key={label} x={72 + i * 106} y={104} w={96} h={80} color={color} n={n} label={label} />
            ))}
            <text x="72" y="208" fontSize="10" fill={C.ink3} fontWeight="600" letterSpacing="0.08em">OFFICE</text>
            {row2.map(([label, color, n], i) => (
                <Tile key={label} x={72 + i * 141.3} y={216} w={131.3} h={72} color={color} n={n} label={label} />
            ))}
            <rect x="258" y="316" width="44" height="14" fill="#c9c5bb" />
            <rect x="214" y="330" width="132" height="8" rx="4" fill="#d4d0c7" />
        </svg>
    );
};

const Pin = ({ x, y, color, big }) => (
    <g transform={`translate(${x} ${y}) scale(${big ? 1.2 : 1})`}>
        <ellipse cx="0" cy="1" rx="7" ry="2.5" fill="#15171c" opacity="0.15" />
        <path d="M0 0 C-4 -10 -12 -14 -12 -23 A12 12 0 1 1 12 -23 C12 -14 4 -10 0 0Z" fill={color} stroke="#fff" strokeWidth="2" />
        <circle cx="0" cy="-23" r="4.5" fill="#fff" />
    </g>
);

export const MapArt = () => (
    <svg viewBox="0 0 560 380" role="img" aria-label="A map with coloured pins for each card, and an open card that can be moved to another list.">
        <defs>
            <clipPath id="map-clip"><rect width="560" height="380" rx="12" /></clipPath>
            <filter id="map-shadow" x="-20%" y="-20%" width="140%" height="160%">
                <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#15171c" floodOpacity="0.14" />
            </filter>
        </defs>
        <g clipPath="url(#map-clip)">
            <rect width="560" height="380" fill="#eceee7" />
            <path d="M372 0 H560 V168 C520 176 478 150 452 124 C424 96 398 62 372 0Z" fill="#cfe2ec" />
            <path d="M24 262 C56 228 132 238 152 280 C168 322 112 352 62 342 C28 334 10 292 24 262Z" fill="#d6e6cc" />
            <path d="M300 300 C330 288 372 300 380 330 C386 356 340 370 312 360 C290 352 284 316 300 300Z" fill="#d6e6cc" />
            {/* minor roads */}
            <g fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round">
                <path d="M0 140 L560 120" />
                <path d="M100 0 L120 380" />
                <path d="M0 320 L560 280" />
                <path d="M330 0 L360 380" />
                <path d="M460 160 L500 380" />
            </g>
            {/* main roads */}
            <g fill="none" strokeLinecap="round">
                <path d="M-10 206 C150 192 300 222 570 194" stroke="#d9d6cc" strokeWidth="17" />
                <path d="M226 -10 C236 120 204 262 246 390" stroke="#d9d6cc" strokeWidth="17" />
                <path d="M-10 206 C150 192 300 222 570 194" stroke="#fff" strokeWidth="13" />
                <path d="M226 -10 C236 120 204 262 246 390" stroke="#fff" strokeWidth="13" />
            </g>
            {/* HQ marker */}
            <g transform="translate(230 205)">
                <circle r="13" fill={C.ink} stroke="#fff" strokeWidth="2.5" />
                <path d="M-6 1 L0 -5 L6 1 V6 H-6Z" fill="#fff" />
            </g>
            <Pin x={128} y={176} color={C.c5} />
            <Pin x={300} y={118} color={C.c2} />
            <Pin x={278} y={268} color={C.c4} />
            <Pin x={160} y={304} color={C.c3} />
            <Pin x={360} y={338} color={C.c2} />
            <Pin x={486} y={320} color={C.c5} />
            <Pin x={84} y={86} color={C.c4} />
            <Pin x={420} y={240} color={C.c6} big />
            {/* open card */}
            <g filter="url(#map-shadow)">
                <rect x="318" y="110" width="212" height="92" rx="10" fill="#fff" />
                <path d="M410 202 L420 214 L430 202Z" fill="#fff" />
            </g>
            <rect x="334" y="126" width="54" height="18" rx="9" fill="#fbe4e3" />
            <circle cx="345" cy="135" r="3.5" fill={C.c6} />
            <text x="353" y="139" fontSize="10" fontWeight="600" fill="#9b2f2a">Blocked</text>
            <text x="334" y="163" fontSize="13" fontWeight="600" fill={C.ink}>Leak repair, 14 Rose St</text>
            <text x="334" y="186" fontSize="11" fontWeight="600" fill={C.c5}>Move to In progress</text>
            <path d="M448 182 h8 m-3 -3 l3 3 l-3 3" stroke={C.c5} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
    </svg>
);

const Sparkle = ({ x, y, s = 1, color }) => (
    <path transform={`translate(${x} ${y}) scale(${s})`} d="M0 -8 C1 -2 2 -1 8 0 C2 1 1 2 0 8 C-1 2 -2 1 -8 0 C-2 -1 -1 -2 0 -8Z" fill={color} />
);

export const StatsArt = () => {
    const created = [88, 120, 104, 150, 128, 172];
    const done = [70, 96, 112, 118, 142, 160];
    const base = 314;
    return (
        <svg viewBox="0 0 560 380" role="img" aria-label="A chart of cards created and completed each week, next to a short plain-English AI summary.">
            <defs>
                <filter id="stats-shadow" x="-10%" y="-10%" width="120%" height="130%">
                    <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#15171c" floodOpacity="0.08" />
                </filter>
            </defs>
            <rect x="12" y="16" width="318" height="348" rx="12" fill="#fff" filter="url(#stats-shadow)" />
            <text x="34" y="50" fontSize="13" fontWeight="600" fill={C.ink}>Created and completed</text>
            <text x="34" y="68" fontSize="11" fill={C.ink3}>Last 6 weeks</text>
            <circle cx="214" cy="64" r="4" fill="#c9ced6" />
            <text x="222" y="68" fontSize="10.5" fill={C.ink2}>Created</text>
            <circle cx="268" cy="64" r="4" fill={C.c5} />
            <text x="276" y="68" fontSize="10.5" fill={C.ink2}>Done</text>
            {[0, 1, 2, 3].map((k) => (
                <line key={k} x1="34" x2="308" y1={base - k * 56} y2={base - k * 56} stroke={C.line} strokeDasharray={k ? '3 4' : '0'} />
            ))}
            {created.map((h, g) => {
                const x = 46 + g * 44;
                return (
                    <g key={g}>
                        <rect x={x} y={base - h} width="15" height={h} rx="3" fill="#c9ced6" />
                        <rect x={x + 18} y={base - done[g]} width="15" height={done[g]} rx="3" fill={C.c5} />
                        <text x={x + 16.5} y={base + 20} fontSize="10" textAnchor="middle" fill={C.ink3}>{`W${g + 1}`}</text>
                    </g>
                );
            })}

            <rect x="346" y="16" width="202" height="348" rx="12" fill="#fff" filter="url(#stats-shadow)" />
            <Sparkle x={370} y={46} color={C.c5} />
            <Sparkle x={381} y={37} s={0.45} color={C.c5} />
            <text x="388" y="50" fontSize="13" fontWeight="600" fill={C.ink}>AI summary</text>
            <rect x="472" y="38" width="38" height="16" rx="8" fill="#e4f0f6" />
            <text x="491" y="49.5" fontSize="8.5" fontWeight="700" letterSpacing="0.06em" textAnchor="middle" fill="#055a8c">BETA</text>
            <text fontSize="11.5" fill={C.ink} fontWeight="500">
                <tspan x="364" y="84">Throughput is up 18% on</tspan>
                <tspan x="364" y="101">last week. Design review is</tspan>
                <tspan x="364" y="118">the bottleneck: four cards</tspan>
                <tspan x="364" y="135">waited more than three days.</tspan>
            </text>
            {[156, 172, 188].map((y, k) => (
                <rect key={y} x="364" y={y} width={[160, 148, 112][k]} height="7" rx="3.5" fill="#ebe8e1" />
            ))}
            <line x1="364" x2="530" y1="214" y2="214" stroke={C.line} />
            <text x="364" y="240" fontSize="10" fill={C.ink3} fontWeight="600" letterSpacing="0.06em">CREATED</text>
            <text x="364" y="270" fontSize="26" fill={C.ink} style={display}>172</text>
            <text x="452" y="240" fontSize="10" fill={C.ink3} fontWeight="600" letterSpacing="0.06em">DONE</text>
            <text x="452" y="270" fontSize="26" fill={C.c5} style={display}>160</text>
            <rect x="364" y="296" width="166" height="44" rx="8" fill="#f3f1ec" />
            <text x="378" y="316" fontSize="10.5" fill={C.ink2}>Prompt: summarise as a</text>
            <text x="378" y="331" fontSize="10.5" fill={C.ink2}>Monday stand-up briefing</text>
        </svg>
    );
};

export const BrandMark = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="18" height="18" rx="4" fill="#0079bf" />
        <rect x="20" width="12" height="8" rx="3" fill="#d9822b" />
        <rect x="20" y="10" width="12" height="22" rx="4" fill="#7a5cc7" />
        <rect y="20" width="18" height="12" rx="4" fill="#1f8a70" />
        <rect x="4" y="12" width="6" height="2" rx="1" fill="#fff" />
    </svg>
);
