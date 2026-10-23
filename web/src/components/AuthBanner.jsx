import React from 'react';
import AuthScenes from './AuthScenes.jsx';

export default function AuthBanner({ footer = 'Built for retail merchants across Nigeria' }) {
  return (
    <div className="vendora-auth-desktop-banner">
      <div className="vendora-auth-brand">
        <span className="vendora-auth-brand-icon" aria-hidden="true">
          V
        </span>
        <span>Vendora</span>
      </div>

      <div className="vendora-auth-hero">
        <h2>Talk to your shop. Vendora keeps the records.</h2>
        <p>
          Record sales, manage stock, and keep your business running, even without internet.
        </p>

        <AuthScenes />

        <div className="vendora-auth-trust-footer">
          <span>{footer}</span>
        </div>
      </div>
    </div>
  );
}
