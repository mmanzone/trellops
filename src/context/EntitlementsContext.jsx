import React, { createContext, useContext } from 'react';
import { OPEN_ENTITLEMENTS } from '../api/entitlements';

/**
 * The member's entitlements, provided by App.jsx. Components read them with
 * useEntitlements(); without a provider everything is allowed.
 */
const EntitlementsContext = createContext({
    entitlements: OPEN_ENTITLEMENTS,
    can: () => true,
    refresh: () => {},
    boardPlanBoards: [],
    boards: [],
    openUpgrade: () => {},
    requestBoardLimit: () => {},
});

export const EntitlementsProvider = ({ value, children }) => (
    <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>
);

export const useEntitlements = () => useContext(EntitlementsContext);
