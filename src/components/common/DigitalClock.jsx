import React, { useState, useEffect } from 'react';
import { STORAGE_KEYS } from '../../utils/constants';

const DigitalClock = ({ boardId }) => {
    const [time, setTime] = useState('');
    const [showClock, setShowClock] = useState(() => localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId) !== 'false');

    useEffect(() => {
        const timer = setInterval(() => {
            const now = new Date();
            setTime(now.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const savedSetting = localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId);
        // Default to true if not set
        setShowClock(savedSetting !== 'false');
    }, [boardId]);

    if (!showClock) return null;

    return (
        <div className="large-clock">
            {time || '--:--:--'}
        </div>
    );
};

export default DigitalClock;
