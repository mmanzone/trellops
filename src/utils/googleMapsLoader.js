import { Loader } from '@googlemaps/js-api-loader';

let loaderInstance = null;
let loaderPromise = null;

// Replace with your actual key or load from env
// Ideally: const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
// For now, prompt instruction mentioned Vercel setup, so we expect env var.
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

export const loadGoogleMaps = () => {
    if (loaderPromise) return loaderPromise;

    if (!GOOGLE_MAPS_API_KEY) {
        return Promise.reject(new Error("Google Maps API Key is missing. Please check VITE_GOOGLE_MAPS_API_KEY env var."));
    }

    loaderInstance = new Loader({
        apiKey: GOOGLE_MAPS_API_KEY,
        version: "weekly",
        libraries: ["places", "geocoding"]
    });

    loaderPromise = loaderInstance.load().then(() => {
        return window.google.maps;
    });

    return loaderPromise;
};
