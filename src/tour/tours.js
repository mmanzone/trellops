/**
 * Guided tour content.
 *
 * Each tour belongs to one view and starts once its `anchor` element is on
 * screen, so a new user is never walked through an empty page. Steps whose
 * element is missing or hidden (a feature turned off, a mobile layout) are
 * skipped automatically. A step with no `element` shows a centred note.
 *
 * The help page reuses the dashboard texts for its interactive dashboard, so
 * the in-app tour and the guide always say the same thing.
 */

export const TOURS = [
    {
        id: 'settings-board',
        view: 'settings',
        anchor: '#board-selection-container',
        steps: [
            {
                element: '#board-selection-container',
                title: 'Choose your board',
                description: 'Pick the Trello board you want to follow. Boards from all your Trello workspaces are listed here.',
            },
        ],
    },
    {
        id: 'settings-layout',
        view: 'settings',
        anchor: '#section-2',
        steps: [
            {
                element: '#section-2',
                title: 'Create blocks',
                description: 'A block is a heading that groups tiles on the dashboard, such as Pipeline or Delivery. Add as many as you need and drag them into order.',
            },
            {
                element: '#unassigned-lists-container',
                title: 'Your Trello lists',
                description: 'Every list on the board starts here. Drag a list into a block to show it as a tile on the dashboard.',
            },
            {
                element: '.tiles-blocks .tiles-block',
                title: 'Arrange your tiles',
                description: 'Drag tiles to reorder them or move them between blocks, and pick a colour for each one. Block options can leave out an instructions card at the top of a list.',
            },
            {
                element: '.settings-tabs',
                title: 'More settings',
                description: 'The other tabs set up the map, statistics and AI summaries, and options such as the clock, theme and your own terms for cards and lists.',
            },
            {
                element: '.save-layout-button',
                title: 'Save to see your dashboard',
                description: 'Your settings stay in this browser. Save to apply them and open the dashboard.',
            },
        ],
    },
    {
        id: 'dashboard',
        view: 'dashboard',
        anchor: '.dashboard-tile',
        steps: [
            {
                key: 'block',
                element: '.dashboard-block .block-header-row',
                title: 'Blocks',
                description: 'Each block groups the tiles you set up in Settings. Use the eye icon to hide a block you do not need right now.',
            },
            {
                key: 'tile',
                element: '.dashboard-tile',
                title: 'Tiles',
                description: 'A tile shows how many cards are in one Trello list, and updates as cards move. Click a tile to see its cards.',
            },
            {
                key: 'labels',
                element: '.map-header-actions .filter-dropdown',
                title: 'Filter by label',
                description: 'Count only the cards that carry the labels you pick.',
            },
            {
                key: 'period',
                element: '#dashboard-time-filter',
                title: 'Filter by date',
                description: 'Count only cards created in a period, such as this week or last week.',
            },
            {
                key: 'stats',
                element: '#nav-stats-button',
                title: 'Statistics',
                description: 'See activity on the board over time, with an AI summary of the period.',
            },
            {
                key: 'map',
                element: '#nav-map-button',
                title: 'Map view',
                description: 'Plot cards that have an address or coordinates on a map.',
            },
            {
                key: 'settings',
                element: '#footer-settings-button',
                title: 'Settings',
                description: 'Change blocks, tiles, colours and options at any time.',
            },
            {
                key: 'replay',
                element: '[data-tour="tour-button"]',
                title: 'Show me around',
                description: 'Open this guide again from here whenever you need it.',
            },
        ],
    },
    {
        id: 'map',
        view: 'map',
        anchor: '.map-fit-button',
        steps: [
            {
                element: '#map-filter-panel .map-filters-overlay',
                title: 'Filter the map',
                description: 'Open the filters to show or hide lists and labels, and focus on the cards you need.',
            },
            {
                element: '[data-tour="map-count"]',
                title: 'Mapped cards',
                description: 'How many cards have a location. Trellops uses a card’s coordinates, or looks up the address in its description.',
            },
            {
                element: '.map-fit-button',
                title: 'Fit map',
                description: 'Frame all the visible pins in one view.',
            },
            {
                element: '#basemap-selector',
                title: 'Map style',
                description: 'Switch between road, traffic, satellite, terrain and dark map styles.',
            },
            {
                title: 'Pins',
                description: 'Click a pin to see its card. From there you can open it in Trello or, with write access, move it to another list.',
            },
        ],
    },
    {
        id: 'stats',
        view: 'stats',
        anchor: '#card-line-chart',
        steps: [
            {
                element: '#stats-period-filter',
                title: 'Choose a period',
                description: 'Everything on this page covers the period you pick here, or a custom date range.',
            },
            {
                element: '[data-tour="ai-summary"]',
                title: 'AI summary',
                description: 'A plain-English briefing of what happened on the board in the period. You can shape it with a custom prompt in Settings.',
            },
            {
                element: '#card-line-chart',
                title: 'Created and completed',
                description: 'Cards created and completed over the period, by day, week or month.',
            },
            {
                element: '#card-pie-chart',
                title: 'Label breakdown',
                description: 'How the cards in the period split across labels.',
            },
        ],
    },
];

export const toursForView = (view) => TOURS.filter(t => t.view === view);

export const dashboardStep = (key) => TOURS.find(t => t.id === 'dashboard').steps.find(s => s.key === key);
