import React from 'react';
import { Top } from '../components/ui.jsx';
import { PermissionList } from './Permissions.jsx';

/** Onboarding step 2: let the phone allow microphone, sound, location and camera, one tap each. */
export default function Onboard({ next, back }) {
  return (
    <div className="page" style={{ paddingBottom: 30 }}>
      <Top title="Allow Vendora" sub="Step 2 of 3. Tap each button, then press Allow." onBack={back} />
      <div className="wrap" style={{ marginTop: 4 }}>
        <PermissionList />
        <button className="btn kola full" style={{ marginTop: 18, minHeight: 56 }} onClick={next}>Continue</button>
        <div className="hint center">You can change these later in Profile, Permissions.</div>
      </div>
    </div>
  );
}
