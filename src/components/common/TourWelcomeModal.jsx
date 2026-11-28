import React, { useEffect, useRef } from 'react';
import { BrandMark } from '../landing/Illustrations';

/**
 * Offers the guided tour once, the first time someone signs in.
 * The tour is suggested, never started without the user's say-so.
 */
const TourWelcomeModal = ({ onStartTour, onSkip }) => {
    const startRef = useRef(null);

    useEffect(() => {
        startRef.current?.focus();
        const onKey = (e) => { if (e.key === 'Escape') onSkip(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onSkip]);

    return (
        <div className="tour-welcome-overlay">
            <div className="tour-welcome" role="dialog" aria-modal="true" aria-labelledby="tour-welcome-title">
                <BrandMark size={36} />
                <h2 id="tour-welcome-title">Welcome to Trellops</h2>
                <p>
                    Would you like a quick look around? As you open each page for the first time, we will point out
                    what each part does: setting up blocks and tiles, the dashboard, the map and statistics.
                </p>
                <div className="tour-welcome-actions">
                    <button type="button" className="button-secondary" onClick={onSkip}>Not now</button>
                    <button type="button" className="button-primary" ref={startRef} onClick={onStartTour}>Show me around</button>
                </div>
                <p className="tour-welcome-note">You can replay it any time with the help button at the top of the dashboard, map and statistics pages.</p>
            </div>
        </div>
    );
};

export default TourWelcomeModal;
