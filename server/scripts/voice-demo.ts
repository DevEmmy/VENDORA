// Local-only demo. Disposable PostgreSQL, generated signing keys and a mock limiter;
// never imported by the production server and never connects to application data.
import { startTestServer } from '../test/support/http';
import { seedVoiceProducts } from './voice-seed';

async function main() {
  const harness = await startTestServer({ serveWeb: true });
  try {
    const account = await harness.account('Ngozi Voice Demo');
    await harness.db.business.update({ where: { id: account.businessId }, data: { inventoryMode: 'RELATIONAL' } });
    await seedVoiceProducts(harness.db, { businessId: account.businessId, userId: account.userId });
    if (process.argv.includes('--smoke')) {
      const response = await fetch(harness.url + '/health');
      if (!response.ok) throw new Error('Health check failed');
      console.log('PASS keyless demo: database migrated, account created, catalog seeded, HTTP healthy.');
      await harness.stop(); process.exit(0);
    }
    console.log(`Voice demo: ${harness.url}\nPhone: ${account.phone}\nPassword: ${account.password}\nSign in, then open Talk to Vendora. Recordings use a canned rice transcript; readback uses device speech when available. Typed transcripts are enabled.\nDisposable database; Ctrl+C stops it.`);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await harness.stop(); process.exit(0); };
    process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
  } catch (error) { await harness.stop(); throw error; }
}
void main().catch(() => { console.error('Local voice demo failed. Run npm ci in server and web, then npm run voice:demo.'); process.exit(1); });
