import React from 'react';
import { X } from 'lucide-react';
import { ProLock } from './PlanGate';

const MoreOptionsModal = ({ onClose, onExport, onImport, onReset, boardName, selectedBoardId, exportLocked = false }) => {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button type="button" className="modal-close icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
                <h3>More Options</h3>
                {exportLocked && <ProLock feature="export" />}
                <div className="modal-actions">
                    {!exportLocked && <>
                    <button
                        className="settings-button"
                        onClick={onExport}
                        disabled={!selectedBoardId}
                    >
                        Export Dashboard configuration for {boardName}
                    </button>

                    <label htmlFor="import-file-input" className="settings-button">
                        Import a configuration file for {boardName}
                        <input
                            type="file"
                            id="import-file-input"
                            accept=".json"
                            onChange={onImport}
                            style={{ display: 'none' }}
                        />
                    </label>
                    </>}
                    <button
                        className="button-danger"
                        onClick={onReset}
                        disabled={!selectedBoardId}
                    >
                        Reset the layout for the {boardName}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MoreOptionsModal;
