import React from "react";

// Illustrated avatar for Nova, the draft assistant persona.
export default function Avatar({ size = 44 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Nova, your draft assistant"
      style={{ borderRadius: "50%", flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="nova-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#37003c" />
          <stop offset="1" stopColor="#7b2d8b" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill="url(#nova-bg)" />
      {/* hair back */}
      <path d="M14 34c0-14 7-23 18-23s18 9 18 23c0 10-2 16-4 20H18c-2-4-4-10-4-20z" fill="#2b1b12" />
      {/* face */}
      <ellipse cx="32" cy="32" rx="11.5" ry="12.5" fill="#e8b58f" />
      {/* fringe */}
      <path d="M20.5 30c0-9 4.5-15 11.5-15s11.5 6 11.5 15c-2-6-5-8-11.5-8s-9.5 2-11.5 8z" fill="#3a2417" />
      {/* eyes */}
      <circle cx="27.5" cy="32.5" r="1.6" fill="#2b1b12" />
      <circle cx="36.5" cy="32.5" r="1.6" fill="#2b1b12" />
      <path d="M25 29.5c1.5-1.2 3.5-1.2 5 0" stroke="#2b1b12" strokeWidth="0.9" fill="none" />
      <path d="M34 29.5c1.5-1.2 3.5-1.2 5 0" stroke="#2b1b12" strokeWidth="0.9" fill="none" />
      {/* smile */}
      <path d="M28 38.5c2.5 2 5.5 2 8 0" stroke="#a05a2c" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {/* shoulders / presenter jacket */}
      <path d="M12 64c2-10 9-14 20-14s18 4 20 14z" fill="#00ff87" />
      <path d="M28 52l4 5 4-5c-1.5-1.3-6.5-1.3-8 0z" fill="#fff" />
      {/* earpiece mic hint */}
      <path d="M43 34c2 0 3 3 1.5 5" stroke="#222" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
