import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

type ApiKey = 'init' | 'payments' | 'communication' | 'market';

interface ApiInfo {
  icon: string;
  title: string;
  tagline: string;
  description: string;
  color: string;
  code: string;
  fullExample: string;
  features: string[];
}

export function DevelopersPage() {
  const [activeApi, setActiveApi] = useState<ApiKey>('init');
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  const copyToClipboard = (text: string, index: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const apis: Record<ApiKey, ApiInfo> = {
    init: {
      icon: '\u{1F511}',
      title: 'Initialization',
      tagline: 'Your key is your identity.',
      description: 'Provider-based architecture. Your BIP39 mnemonic IS your identity. Auto-creates or loads existing wallets.',
      color: 'from-emerald-500 to-teal-500',
      code: `const { sphere } = await Sphere.init({ ...providers, mnemonic: '...' });`,
      fullExample: `import { Sphere } from '@unicitylabs/sphere-sdk';
import { createBrowserProviders } from '@unicitylabs/sphere-sdk/impl/browser';

// Create providers for your target network
const providers = createBrowserProviders({ network: 'testnet' });

// Auto-load existing wallet or create new one
const { sphere, created, generatedMnemonic } = await Sphere.init({
  ...providers,
  autoGenerate: true, // generate mnemonic if no wallet exists
});

if (generatedMnemonic) {
  console.log('Backup this mnemonic:', generatedMnemonic);
}

console.log('Identity:', sphere.identity);
console.log('Ready:', sphere.isReady);`,
      features: ['Provider-based', 'BIP39 HD wallets', 'Auto-load or create', 'Multi-address']
    },
    payments: {
      icon: '\u26A1',
      title: 'Payments',
      tagline: 'L3 instant. L1 on-chain.',
      description: 'Send tokens to anyone via @nametag or address. Instant P2P settlement on Layer 3, ALPHA blockchain on Layer 1.',
      color: 'from-orange-500 to-amber-500',
      code: `await sphere.payments.send({ recipient: '@merchant', amount: '100', coinId });`,
      fullExample: `// Send tokens (use @nametag or direct address)
await sphere.payments.send({
  coinId: '0x...',         // token type ID
  amount: '100000000',     // in smallest units
  recipient: '@merchant',  // @nametag or DIRECT:// address
  memo: 'Order #123',
});

// Check balance (synchronous)
const assets = sphere.payments.getBalance();
assets.forEach(a => console.log(\`\${a.symbol}: \${a.totalAmount}\`));

// Get assets with fiat prices
const withPrices = await sphere.payments.getAssets();

// Listen for incoming transfers
sphere.on('transfer:incoming', (transfer) => {
  console.log('Received tokens:', transfer.tokens);
});

// L1 ALPHA blockchain
const l1Balance = await sphere.payments.l1.getBalance();
console.log('L1 confirmed:', l1Balance.confirmed);`,
      features: ['L3 instant settlement', 'L1 ALPHA blockchain', 'Payment requests', 'Nametag support']
    },
    communication: {
      icon: '\u{1F4AC}',
      title: 'Communication',
      tagline: 'Message anyone. Human or agent.',
      description: 'End-to-end encrypted direct messages via Nostr. NIP-29 group chat. Broadcast to topics.',
      color: 'from-violet-500 to-purple-500',
      code: `await sphere.communications.sendDM('@alice', 'Hello!');`,
      fullExample: `// Send a direct message (encrypted via Nostr)
await sphere.communications.sendDM('@alice', 'Hello from the SDK!');

// Listen for incoming messages
sphere.communications.onDirectMessage((msg) => {
  console.log(\`From \${msg.senderNametag}: \${msg.content}\`);
});

// Get all conversations
const conversations = sphere.communications.getConversations();
conversations.forEach((messages, peer) => {
  console.log(\`\${peer}: \${messages.length} messages\`);
});

// Broadcast to a topic
await sphere.communications.broadcast('New listing available!', ['marketplace']);

// Listen for broadcasts
sphere.communications.onBroadcast((msg) => {
  console.log(\`Broadcast: \${msg.content}\`);
});`,
      features: ['End-to-end encrypted', 'P2P via Nostr', 'Group chat (NIP-29)', 'Broadcast messages']
    },
    market: {
      icon: '\u{1F6D2}',
      title: 'Market',
      tagline: 'Post intents. Find matches.',
      description: 'Intent bulletin board for buy/sell/service intents. Semantic search. Live WebSocket feed.',
      color: 'from-cyan-500 to-blue-500',
      code: `await sphere.market.postIntent({ description: '...', intentType: 'sell' });`,
      fullExample: `// Post a sell intent
const result = await sphere.market.postIntent({
  description: 'PSA-10 Charizard card - Mint condition',
  intentType: 'sell',
  category: 'collectibles',
  price: 12000,
  currency: 'ALPHA',
});
console.log('Intent posted:', result.intentId);

// Search the marketplace
const results = await sphere.market.search('charizard card');
results.intents.forEach(intent => {
  console.log(\`\${intent.description} - \${intent.price} \${intent.currency}\`);
});

// Subscribe to live feed
const unsubscribe = sphere.market.subscribeFeed((listing) => {
  console.log('New listing:', listing.description);
});

// Get your own intents
const myIntents = await sphere.market.getMyIntents();`,
      features: ['Intent bulletin board', 'Semantic search', 'Live WebSocket feed', 'Buy/sell/service intents']
    }
  };

  const marketplaceCode = `import { Sphere } from '@unicitylabs/sphere-sdk';
import { createBrowserProviders } from '@unicitylabs/sphere-sdk/impl/browser';

// Initialize wallet with providers
const providers = createBrowserProviders({ network: 'testnet' });
const { sphere } = await Sphere.init({ ...providers, mnemonic: '...' });

// Post a sell intent to the marketplace
await sphere.market.postIntent({
  description: 'PSA-10 Charizard - Mint condition',
  intentType: 'sell',
  price: 12000,
  currency: 'ALPHA',
});

// Search for items
const results = await sphere.market.search('charizard card');

// Message a seller to negotiate
const seller = results.intents[0];
await sphere.communications.sendDM(seller.agentPubkey, JSON.stringify({
  type: 'offer', intentId: seller.id, price: 11000
}));

// Listen for DMs and handle accepted offers
sphere.communications.onDirectMessage(async (msg) => {
  const data = JSON.parse(msg.content);
  if (data.type === 'accepted') {
    await sphere.payments.send({
      coinId: '0x...', amount: String(data.price), recipient: msg.senderPubkey,
    });
  }
});`;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-neutral-900 dark:text-white"
    >
        {/* Hero Section */}
        <section className="px-4 sm:px-6 py-12 sm:py-16 text-center">
          <div className="max-w-4xl mx-auto">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 leading-tight"
            >
              One SDK.<br />
              <span className="bg-linear-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">Infinite Marketplaces.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-lg sm:text-xl text-neutral-600 dark:text-neutral-400 mb-8 sm:mb-10 max-w-2xl mx-auto"
            >
              You don't need a blockchain team. If you can call an API, you can build a marketplace where humans and agents trade anything.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="flex gap-4 justify-center flex-wrap"
            >
              <button className="bg-linear-to-r from-orange-500 to-amber-500 text-white px-6 py-3 rounded-xl font-semibold hover:opacity-90 transition shadow-lg shadow-orange-500/25">
                Start Building
              </button>
              <Link to="/developers/docs" className="border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-white px-6 py-3 rounded-xl font-medium hover:border-neutral-400 dark:hover:border-neutral-500 transition">
                Read Docs
              </Link>
            </motion.div>
          </div>
        </section>

        {/* API Cards Section */}
        <section className="px-4 sm:px-6 py-8 sm:py-12">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-4 gap-4 mb-8">
              {(Object.entries(apis) as [ApiKey, ApiInfo][]).map(([key, api]) => (
                <motion.button
                  key={key}
                  onClick={() => setActiveApi(key)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`p-5 sm:p-6 rounded-2xl border text-left transition-all ${
                    activeApi === key
                      ? 'bg-white dark:bg-neutral-800 border-orange-500/50 shadow-lg shadow-orange-500/10'
                      : 'bg-white/50 dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700/50 hover:border-neutral-300 dark:hover:border-neutral-600'
                  }`}
                >
                  <div className={`w-12 h-12 rounded-xl bg-linear-to-br ${api.color} flex items-center justify-center text-2xl mb-4`}>
                    {api.icon}
                  </div>
                  <h3 className="font-semibold text-lg mb-1">{api.title}</h3>
                  <p className="text-neutral-500 dark:text-neutral-400 text-sm">{api.tagline}</p>
                </motion.button>
              ))}
            </div>

            {/* API Details Panel */}
            <motion.div
              key={activeApi}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-xl"
            >
              <div className="p-6 sm:p-8 border-b border-neutral-200 dark:border-neutral-700">
                <div className="flex items-start justify-between flex-wrap gap-4">
                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold mb-2">{apis[activeApi].title}</h2>
                    <p className="text-neutral-600 dark:text-neutral-400 max-w-xl">{apis[activeApi].description}</p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {apis[activeApi].features.map((f, i) => (
                      <span key={i} className="bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 text-xs px-3 py-1 rounded-full">{f}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* One-liner code */}
              <div className="p-4 sm:p-6 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-neutral-500 uppercase tracking-wider">The entire integration</span>
                  <button
                    onClick={() => copyToClipboard(apis[activeApi].code, 'oneliner')}
                    className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-white transition"
                  >
                    {copiedIndex === 'oneliner' ? '\u2713 Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="text-base sm:text-lg font-mono overflow-x-auto">
                  <code className="text-amber-600 dark:text-amber-400">{apis[activeApi].code}</code>
                </pre>
              </div>

              {/* Full example */}
              <div className="p-4 sm:p-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-neutral-500 uppercase tracking-wider">Full example</span>
                  <button
                    onClick={() => copyToClipboard(apis[activeApi].fullExample, 'full')}
                    className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-white transition"
                  >
                    {copiedIndex === 'full' ? '\u2713 Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="text-sm font-mono text-neutral-700 dark:text-neutral-300 overflow-x-auto">
                  <code>{apis[activeApi].fullExample}</code>
                </pre>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Complete Marketplace Section */}
        <section className="px-4 sm:px-6 py-12 sm:py-16">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-10 sm:mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold mb-4">A Complete Marketplace in 30 Lines</h2>
              <p className="text-neutral-600 dark:text-neutral-400">Intents, search, negotiation, payment. All of it.</p>
            </div>

            <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-xl">
              <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                </div>
                <span className="text-xs text-neutral-500 font-mono">marketplace.ts</span>
                <button
                  onClick={() => copyToClipboard(marketplaceCode, 'marketplace')}
                  className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-white transition"
                >
                  {copiedIndex === 'marketplace' ? '\u2713 Copied' : 'Copy'}
                </button>
              </div>
              <pre className="p-4 sm:p-6 text-sm font-mono text-neutral-700 dark:text-neutral-300 overflow-x-auto">
                <code>{marketplaceCode}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* Why Build Here Section */}
        <section className="px-4 sm:px-6 py-12 sm:py-16 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10 sm:mb-12">Why Build Here?</h2>
            <div className="grid md:grid-cols-2 gap-6 sm:gap-8">
              <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
                <h3 className="text-lg font-semibold mb-6 text-neutral-500 dark:text-neutral-400">Traditional Stack</h3>
                <ul className="space-y-4 text-neutral-500">
                  <li className="flex items-center gap-3"><span className="text-red-400">{'\u2717'}</span> API key management</li>
                  <li className="flex items-center gap-3"><span className="text-red-400">{'\u2717'}</span> Gas fee estimation</li>
                  <li className="flex items-center gap-3"><span className="text-red-400">{'\u2717'}</span> Wallet integration</li>
                  <li className="flex items-center gap-3"><span className="text-red-400">{'\u2717'}</span> Payment rails</li>
                  <li className="flex items-center gap-3"><span className="text-red-400">{'\u2717'}</span> Messaging infra</li>
                  <li className="flex items-center gap-3"><span className="text-red-400">{'\u2717'}</span> Months to MVP</li>
                </ul>
              </div>
              <div className="bg-linear-to-br from-orange-500/10 to-amber-500/10 dark:from-orange-500/20 dark:to-amber-500/10 rounded-2xl border border-orange-500/30 p-6 sm:p-8">
                <h3 className="text-lg font-semibold mb-6 text-orange-500">Sphere SDK</h3>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-neutral-700 dark:text-neutral-200"><span className="text-green-500">{'\u2713'}</span> Private key IS identity</li>
                  <li className="flex items-center gap-3 text-neutral-700 dark:text-neutral-200"><span className="text-green-500">{'\u2713'}</span> Included (off-chain)</li>
                  <li className="flex items-center gap-3 text-neutral-700 dark:text-neutral-200"><span className="text-green-500">{'\u2713'}</span> Unified Unicity ID</li>
                  <li className="flex items-center gap-3 text-neutral-700 dark:text-neutral-200"><span className="text-green-500">{'\u2713'}</span> Just call <code className="text-amber-600 dark:text-amber-400 text-sm">payments.send()</code></li>
                  <li className="flex items-center gap-3 text-neutral-700 dark:text-neutral-200"><span className="text-green-500">{'\u2713'}</span> Built-in P2P messaging</li>
                  <li className="flex items-center gap-3 text-neutral-700 dark:text-neutral-200"><span className="text-green-500">{'\u2713'}</span> <strong>Days</strong></li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="px-4 sm:px-6 py-12 sm:py-16">
          <div className="max-w-4xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold mb-6">Ready to Build?</h2>
            <p className="text-lg sm:text-xl text-neutral-600 dark:text-neutral-400 mb-8 sm:mb-10">Install the SDK and ship a marketplace this week.</p>

            <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8 mb-8 sm:mb-10 shadow-xl">
              <pre className="text-left font-mono text-sm mb-6 overflow-x-auto">
                <code className="text-neutral-500"># Install the SDK</code>{'\n'}
                <code className="text-amber-600 dark:text-amber-400">npm install @unicitylabs/sphere-sdk</code>{'\n\n'}
                <code className="text-neutral-500"># Generate a mnemonic (your identity seed)</code>{'\n'}
                <code className="text-amber-600 dark:text-amber-400">Sphere.generateMnemonic()</code>
              </pre>
              <div className="flex gap-4 justify-center flex-wrap">
                <Link
                  to="/developers/docs"
                  className="bg-linear-to-r from-orange-500 to-amber-500 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:opacity-90 transition shadow-lg shadow-orange-500/25"
                >
                  View Documentation
                </Link>
                <a
                  href="https://github.com/unicitynetwork/sphere-sdk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-white px-8 py-4 rounded-xl font-semibold text-lg hover:border-neutral-400 dark:hover:border-neutral-500 transition"
                >
                  GitHub
                </a>
              </div>
            </div>

            <div className="flex justify-center gap-6 sm:gap-8 text-neutral-600 dark:text-neutral-400 flex-wrap">
              <Link to="/developers/docs" className="hover:text-orange-500 transition flex items-center gap-2">
                <span>{'\u{1F4D6}'}</span> Documentation
              </Link>
              <a href="https://discord.gg/S9f57ZKdt" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 transition flex items-center gap-2">
                <span>{'\u{1F4AC}'}</span> Discord
              </a>
              <a href="https://github.com/unicitynetwork" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 transition flex items-center gap-2">
                <span>{'\u{1F419}'}</span> GitHub
              </a>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-neutral-200 dark:border-neutral-700 px-4 sm:px-6 py-8">
          <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-neutral-500 flex-wrap gap-4">
            <span>AgentSphere by Unicity Labs</span>
            <div>One SDK. Any marketplace. Let's build.</div>
          </div>
        </footer>

    </motion.div>
  );
}
