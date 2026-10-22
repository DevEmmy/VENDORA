import React from 'react';
import { Mic, WifiOff, Package, ShieldCheck } from 'lucide-react';

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

        <ul className="vendora-auth-highlights">
          <li>
            <span className="highlight-icon" aria-hidden="true">
              <Mic size={18} />
            </span>
            <div>
              <strong>Record sales by voice or tap</strong>
              <span>Sell faster and keep track of every transaction.</span>
            </div>
          </li>
          <li>
            <span className="highlight-icon" aria-hidden="true">
              <WifiOff size={18} />
            </span>
            <div>
              <strong>Keep selling without internet</strong>
              <span>Your sales and stock records stay securely saved and sync when you're back online.</span>
            </div>
          </li>
          <li>
            <span className="highlight-icon" aria-hidden="true">
              <Package size={18} />
            </span>
            <div>
              <strong>Track your stock automatically</strong>
              <span>Know what's selling, what's remaining, and when it's time to restock.</span>
            </div>
          </li>
          <li>
            <span className="highlight-icon" aria-hidden="true">
              <ShieldCheck size={18} />
            </span>
            <div>
              <strong>Keep your business records secure</strong>
              <span>Your business information is protected on your device.</span>
            </div>
          </li>
        </ul>

        <div className="vendora-auth-trust-footer">
          <span>{footer}</span>
        </div>
      </div>
    </div>
  );
}
