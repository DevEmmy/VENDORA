
import React from "react";
import { Store, UserRound, MapPin, ShieldCheck, Landmark } from "lucide-react";

export default function BusinessWorkspace({ user, membership, onLogout }) {
  const business = membership?.business;

  return (
    <div className="device">
      <div className="page">
        <header className="top round tall">
          <div className="wrap">
            <div className="sub">Your Vendora workspace</div>
            <h1>{business?.businessName || "Your business"}</h1>
            <p style={{ marginTop: 8 }}>
              Welcome, {user?.name || "Trader"}.
            </p>
          </div>
        </header>

        <div className="wrap" style={{ marginTop: 20 }}>
          <div className="card gap">
            <h2>Business profile</h2>

            <div className="row">
              <Store size={20} />
              <span>{business?.businessType || "Not specified"}</span>
            </div>

            <div className="row">
              <MapPin size={20} />
              <span>{business?.city || "Location not specified"}</span>
            </div>

            <div className="row">
              <UserRound size={20} />
              <span>{user?.name || "Account holder"}</span>
            </div>

            <div className="row">
              <ShieldCheck size={20} />
              <span>Business role: {membership?.role || "Member"}</span>
            </div>
          </div>

          <div className="card gap" style={{ marginTop: 16 }}>
            <div className="row">
              <Landmark size={22} />
              <h2>Financial services</h2>
            </div>

            <p className="muted">
              Wema account opening, transfer verification and lending
              are not yet available for authenticated businesses.
            </p>

            <p className="small">
              Your business registration is complete. Banking
              onboarding is a separate process.
            </p>
          </div>

          <div className="card gap" style={{ marginTop: 16 }}>
            <h2>Business records</h2>
            <p className="muted">
              Inventory and sales synchronization with the Vendora
              backend is still being integrated. No demo records
              have been added to this business.
            </p>
          </div>

          <button
            type="button"
            className="btn plain full"
            style={{ marginTop: 24 }}
            onClick={onLogout}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
