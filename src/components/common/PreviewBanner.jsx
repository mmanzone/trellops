import React, { useEffect, useState } from 'react';

const PreviewBanner = () => {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (window.location.hostname !== 'trellops.xyz') {
            setIsVisible(true);
        }
    }, []);

    if (!isVisible) return null;

    return (
        <div style={{
            width: '100%',
            backgroundColor: '#003366',
            color: '#ffffff',
            textAlign: 'center',
            padding: '4px 0',
            fontSize: '12px',
            fontWeight: 'bold',
            letterSpacing: '1px',
            zIndex: 9999,
            position: 'relative' // Ensure it pushes content down
        }}>
            PREVIEW ENVIRONMENT
        </div>
    );
};

export default PreviewBanner;
