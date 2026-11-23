import React from 'react';

export const COLORS = [
    { name: 'blue', hex: '#3388ff', label: 'Blue' },
    { name: 'red', hex: '#ff6b6b', label: 'Red' },
    { name: 'green', hex: '#51cf66', label: 'Green' },
    { name: 'orange', hex: '#ffa94d', label: 'Orange' },
    { name: 'yellow', hex: '#ffd43b', label: 'Yellow' },
    { name: 'grey', hex: '#868e96', label: 'Grey' },
    { name: 'black', hex: '#212529', label: 'Black' }
];

const ColorPicker = ({ selectedColor, onChange }) => {
    return (
        <div className="color-picker-flex" role="listbox" aria-label="Marker colour">
            {COLORS.map(c => (
                <div
                    key={c.name}
                    title={c.label}
                    role="option"
                    aria-selected={selectedColor === c.name}
                    onClick={() => onChange(c.name)}
                    className={`color-picker-swatch${selectedColor === c.name ? ' is-selected' : ''}`}
                    style={{ backgroundColor: c.hex }}
                />
            ))}
        </div>
    );
};

export default ColorPicker;
