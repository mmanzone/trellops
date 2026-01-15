
let googleMapsPromise = null;

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

export const loadGoogleMaps = () => {
    if (googleMapsPromise) return googleMapsPromise;

    if (!GOOGLE_MAPS_API_KEY) {
        return Promise.reject(new Error("Google Maps API Key is missing. Please check VITE_GOOGLE_MAPS_API_KEY env var."));
    }

    if (window.google && window.google.maps) {
        return Promise.resolve(window.google.maps);
    }

    googleMapsPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,geocoding&callback=__googleMapsCallback`;
        script.async = true;
        script.defer = true;
        script.onerror = (err) => reject(err);

        window.__googleMapsCallback = () => {
            resolve(window.google.maps);
        };

        document.head.appendChild(script);
    });

    return googleMapsPromise;
};
