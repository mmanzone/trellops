import React, { useCallback, useEffect, useRef, useState } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour.css';
import { toursForView } from './tours';
import {
    getTourStatus, setTourStatus, getSeenTours, markTourSeen, START_TOUR_EVENT,
} from '../hooks/useTourStatus';
import TourWelcomeModal from '../components/common/TourWelcomeModal';

const TOUR_VIEWS = new Set(['settings', 'dashboard', 'map', 'stats']);
const POLL_MS = 600;

// First element matching the selector that is actually on screen. Several
// controls exist twice (desktop header and mobile menu), so the first match
// in the DOM is not always the visible one.
const findVisible = (selector) => {
    if (!selector) return null;
    const nodes = document.querySelectorAll(selector);
    for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
    }
    return null;
};

const buildSteps = (tours) => tours.flatMap(t => t.steps)
    .map(step => {
        if (!step.element) return { popover: { title: step.title, description: step.description } };
        const el = findVisible(step.element);
        return el ? { element: el, popover: { title: step.title, description: step.description } } : null;
    })
    .filter(Boolean);

/**
 * Runs the guided tours. Mounted once by App with the current view.
 *
 * - Offers the tour once (welcome prompt) to anyone who has not answered.
 * - When accepted, each view's tour starts the first time its anchor shows.
 * - "Show me around" (requestTour) replays every tour for the current view.
 */
const TourManager = ({ view, enabled }) => {
    const [status, setStatus] = useState(getTourStatus);
    const activeRef = useRef(null);
    const active = enabled && TOUR_VIEWS.has(view);

    const run = useCallback((tours) => {
        if (activeRef.current || !tours.length) return false;
        const steps = buildSteps(tours);
        if (!steps.length) return false;
        tours.forEach(t => markTourSeen(t.id));
        const d = driver({
            steps,
            showProgress: steps.length > 1,
            progressText: '{{current}} of {{total}}',
            nextBtnText: 'Next',
            prevBtnText: 'Back',
            doneBtnText: 'Done',
            popoverClass: 'trellops-tour',
            overlayOpacity: 0.45,
            stagePadding: 6,
            stageRadius: 10,
            smoothScroll: true,
            allowClose: true,
            onDestroyed: () => { activeRef.current = null; },
        });
        activeRef.current = d;
        d.drive();
        return true;
    }, []);

    // Close a running tour when the view changes or the page goes away.
    useEffect(() => () => {
        if (activeRef.current) activeRef.current.destroy();
    }, [view]);

    // First-visit tours, once the user has accepted.
    useEffect(() => {
        if (!active || status !== 'on') return undefined;
        const timer = setInterval(() => {
            if (activeRef.current) return;
            const seen = new Set(getSeenTours());
            const next = toursForView(view).find(t => !seen.has(t.id) && findVisible(t.anchor));
            if (next) run([next]);
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [active, status, view, run]);

    // "Show me around": replay this view's tours, whatever was seen before.
    useEffect(() => {
        if (!active) return undefined;
        const onRequest = () => {
            if (activeRef.current) activeRef.current.destroy();
            run(toursForView(view).filter(t => findVisible(t.anchor)));
        };
        window.addEventListener(START_TOUR_EVENT, onRequest);
        return () => window.removeEventListener(START_TOUR_EVENT, onRequest);
    }, [active, view, run]);

    if (!active || status !== null) return null;

    return (
        <TourWelcomeModal
            onStartTour={() => { setTourStatus('on'); setStatus('on'); }}
            onSkip={() => { setTourStatus('skipped'); setStatus('skipped'); }}
        />
    );
};

export default TourManager;
