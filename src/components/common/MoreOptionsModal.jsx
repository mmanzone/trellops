import React from 'react';

const MoreOptionsModal = ({ onClose, onExport, onImport, onReset, boardName, selectedBoardId }) => {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <span className="modal-close" onClick={onClose} style={{ float: 'right', fontSize: '1.5em', cursor: 'pointer' }}>&times;</span>
                <h3>More Options</h3>
                <div className="modal-actions">
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
