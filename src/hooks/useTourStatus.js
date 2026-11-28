/**
 * Tour status, kept in local storage like the rest of Trellops' settings.
 *
 * TRELLOPS_TOUR_STATUS
 *   null        never asked: the welcome prompt offers the tour
 *   'on'        accepted: each view's tour runs the first time it is opened
 *   'skipped'   declined: tours only run from "Show me around"
 *   (older builds wrote 'pending' or 'completed'; both are treated as answered)
 *
 * TRELLOPS_TOURS_SEEN  JSON list of tour ids already shown.
 */

const TOUR_KEY = 'TRELLOPS_TOUR_STATUS';
const SEEN_KEY = 'TRELLOPS_TOURS_SEEN';

export const getTourStatus = () => {
    try {
        return localStorage.getItem(TOUR_KEY) || null;
    } catch {
        return null;
    }
};

export const setTourStatus = (status) => {
    try {
        localStorage.setItem(TOUR_KEY, status);
    } catch {
        // ignore storage errors
    }
};

export const isFirstTimeUser = () => getTourStatus() === null;

export const getSeenTours = () => {
    try {
        const list = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
};

export const markTourSeen = (id) => {
    try {
        const seen = new Set(getSeenTours());
        seen.add(id);
        localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch {
        // ignore storage errors
    }
};

// Ask the tour manager to replay the tours for the page on screen.
export const START_TOUR_EVENT = 'trellops:start-tour';
export const requestTour = () => window.dispatchEvent(new Event(START_TOUR_EVENT));
