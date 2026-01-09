/**
 * Formats a duration in seconds into a dynamic human-readable string.
 * Rules:
 * - < 60 seconds: "Xs"
 * - 1 min <= t < 60 mins: "X min"
 * - >= 60 mins: "X hr" or "Xh Ym"
 */
export const formatCountdown = (totalSeconds) => {
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    } else if (totalSeconds < 3600) {
        return `${Math.ceil(totalSeconds / 60)} min`;
    } else {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.ceil((totalSeconds % 3600) / 60);
        if (minutes === 0) return `${hours} hr`;
        return `${hours}h ${minutes}m`;
    }
};
