import { useRef, useEffect, useCallback, useState } from 'react';

const useWakeLock = () => {
    const wakeLockRef = useRef(null);
    const [isSupported, setIsSupported] = useState(false);
    const [isLocked, setIsLocked] = useState(false);

    useEffect(() => {
        if ('wakeLock' in navigator) {
            setIsSupported(true);
        } else {
            console.warn("Screen Wake Lock API not supported.");
        }
    }, []);

    const requestWakeLock = useCallback(async () => {
        if (!isSupported) return;
        try {
            const wakeLock = await navigator.wakeLock.request('screen');
            wakeLockRef.current = wakeLock;
            setIsLocked(true);
            // console.log('Wake Lock acquired');

            wakeLock.addEventListener('release', () => {
                // console.log('Wake Lock released');
                setIsLocked(false);
                wakeLockRef.current = null;
            });
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        }
    }, [isSupported]);

    const releaseWakeLock = useCallback(async () => {
        if (!isSupported || !wakeLockRef.current) return;
        try {
            await wakeLockRef.current.release();
            wakeLockRef.current = null;
            setIsLocked(false);
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        }
    }, [isSupported]);

    // Handle visibility change to re-acquire lock
    useEffect(() => {
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible' && isLocked) {
                // Determine if we *intended* to be locked? 
                // The `isLocked` state might be stale if the system released it automatically on hide.
                // But if our app state says "Keep On", we should retry.
                // NOTE: This hook doesn't know the app "intent" state, only the API state.
                // Implementing re-acquire should likely be driven by the consumer effect.
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isLocked]);

    return { isSupported, isLocked, requestWakeLock, releaseWakeLock };
};

export default useWakeLock;
