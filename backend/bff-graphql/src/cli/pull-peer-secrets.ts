import { PeerDemoStorage, demoStorage } from '../integrations/demo-storage';
import { PeerElevenLabsKeys, elevenLabsKeys } from '../integrations/elevenlabs-keys';
import { ledgerPeer } from '../integrations/ledger-peer';
import { pullPeerSecrets } from '../integrations/peer-secrets';
import { prisma } from '../storage/client';

async function main() {
  const peer = ledgerPeer;
  if (!peer) throw new Error('No ledger peer: set DOCK_LEDGER_PEER_URL and DOCK_LEDGER_PEER_TOKEN');
  const call = (route: string, body: unknown) => peer.call(route, body);
  const pulled = await pullPeerSecrets(
    { keys: new PeerElevenLabsKeys(call), storage: new PeerDemoStorage(call) },
    { keys: elevenLabsKeys, storage: demoStorage },
  );
  process.stdout.write(`elevenlabs keys: ${pulled.keys.length} (${pulled.keys.join(', ')}), current: ${pulled.current ?? 'none'}, parked: ${pulled.parked.length}\n`);
  process.stdout.write(`demo storage: ${pulled.storage ? 'copied' : 'not configured on the peer'}\n`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'unknown error'}\n`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
