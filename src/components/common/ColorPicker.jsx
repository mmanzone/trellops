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
        <div className="color-picker-flex" style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            marginTop: '8px'
        }}>
            {COLORS.map(c => (
                <div
                    key={c.name}
                    title={c.label}
                    onClick={() => onChange(c.name)}
                    style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: c.hex,
                        cursor: 'pointer',
                        border: selectedColor === c.name ? '3px solid #000' : '1px solid rgba(0,0,0,0.1)',
                        boxShadow: selectedColor === c.name ? '0 0 0 2px #fff inset' : 'none',
                        transition: 'transform 0.1s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1.0)'}
                />
            ))}
        </div>
    );
};

export default ColorPicker;
