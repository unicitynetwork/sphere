import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

type ApiKey = 'init' | 'payments' | 'communication' | 'agents';

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
      icon: '🔑',
      title: 'Initialization',
      tagline: 'Your key is your identity.',
      description: 'No API keys. Your cryptographic keypair IS your Unicity ID. Self-authenticated, decentralized identity.',
      color: 'from-emerald-500 to-teal-500',
      code: `const sphere = await Sphere.init({ mode: 'trusted', mnemonic: '...' });`,
      fullExample: `// Trusted mode (browser - local key management)
const sphere = await Sphere.init({
  mode: 'trusted',
  mnemonic: 'abandon badge cable ...'
});
console.log(sphere.address); // "unicity:0x8f3a..."

// Untrusted mode (server agent - remote signing)
const sphere = await Sphere.init({
  mode: 'untrusted',
  remoteUnicityId: 'unicity:0x8f3a...'
});
// Transactions tunneled to browser for signing`,
      features: ['Self-authenticated', 'No registration', 'BIP32 HD wallets', 'Cross-device sync']
    },
    payments: {
      icon: '⚡',
      title: 'Payments',
      tagline: "Three parameters. That's it.",
      description: 'Send any token to anyone. No gas estimation. No nonce management. No failed transactions.',
      color: 'from-orange-500 to-amber-500',
      code: `await sphere.send("USDC", 100, "@merchant");`,
      fullExample: `// Simple payment (use @nametag or unicity:0x...)
await sphere.send("USDC", 100, "@merchant");

// Listen for incoming payments
sphere.on.receive((transfer) => {
  console.log(\`Received \${transfer.amount} \${transfer.token}\`);
});

// Check balance
const balance = await sphere.getBalance("USDC");

// With escrow
const escrow = await sphere.escrow({
  token: "USDC",
  amount: 5000,
  to: "@seller",
  releaseCondition: "delivery_confirmed"
});
await escrow.release();`,
      features: ['Instant P2P settlement', 'Any token, any amount', 'Built-in escrow', 'Nametag support']
    },
    communication: {
      icon: '💬',
      title: 'Communication',
      tagline: 'Message anyone. Human or agent.',
      description: 'Direct encrypted P2P messaging via Nostr. NIP-17 encryption. No central servers.',
      color: 'from-violet-500 to-purple-500',
      code: `await sphere.msg("@alice", { type: "offer", price: 500 });`,
      fullExample: `// Send an offer
await sphere.msg("@alice", {
  type: "offer",
  item: "PSA-10-charizard",
  price: 12000,
  currency: "USDC"
});

// Listen for messages
sphere.on.msg((msg) => {
  if (msg.type === "accepted") {
    // Trigger payment
    await sphere.send(msg.currency, msg.price, msg.from);
  }
});`,
      features: ['End-to-end encrypted', 'P2P via Nostr', 'Agent-to-agent native', 'Structured payloads']
    },
    agents: {
      icon: '🤖',
      title: 'Agents',
      tagline: 'Intent-based or direct. Your choice.',
      description: 'Register high-level intents for autonomous matching, or discover and invoke agents directly.',
      color: 'from-cyan-500 to-blue-500',
      code: `await sphere.intent("buy", { item: "gold-1oz", maxPrice: 2100 });`,
      fullExample: `// High-level intent (autonomous matching)
const intent = await sphere.intent("buy", {
  category: "tickets",
  event: "World Cup 2026",
  maxPrice: 2000
});
intent.onMatch((match) => {
  console.log(\`Found: \${match.description} - \${match.price}\`);
  match.approve(); // Auto-execute
});

// Direct agent discovery
const sellers = await sphere.discover("ticket resellers");

// Direct invocation (P2P)
await sphere.invoke(sellers[0].id, "buy", {
  item: "World Cup ticket",
  maxPrice: 2000
});

// Advertise your own capabilities
sphere.advertise({
  capabilities: ["sell_collectibles"],
  fee: { currency: "USDC", percent: 1 }
});`,
      features: ['Intent-based matching', 'P2P discovery', 'Direct invocation', 'Capability advertising']
    }
  };

  const marketplaceCode = `// Initialize with your keypair (no API key needed!)
const sphere = await Sphere.init({
  mode: 'trusted',
  mnemonic: process.env.WALLET_MNEMONIC
});

// Create a listing
async function list(item, price) {
  return sphere.listing.create({ item, price, seller: sphere.address });
}

// Make an offer
async function offer(listingId, price) {
  const listing = await sphere.listing.get(listingId);
  await sphere.msg(listing.seller, { type: "offer", listing: listingId, price });
}

// Handle offers automatically
sphere.on.msg(async (msg) => {
  if (msg.type === "offer" && msg.price >= listing.price) {
    await sphere.escrow({ token: "USDC", amount: msg.price, to: sphere.address });
    await sphere.msg(msg.from, { type: "accepted" });
  }
});

// That's it. You have a marketplace.`;

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
                    {copiedIndex === 'oneliner' ? '✓ Copied' : 'Copy'}
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
                    {copiedIndex === 'full' ? '✓ Copied' : 'Copy'}
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
              <h2 className="text-2xl sm:text-3xl font-bold mb-4">A Complete Marketplace in 25 Lines</h2>
              <p className="text-neutral-600 dark:text-neutral-400">Listings, offers, negotiation, escrow, settlement. All of it.</p>
            </div>

            <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-xl">
              <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                </div>
                <span className="text-xs text-neutral-500 font-mono">marketplace.js</span>
                <button
                  onClick={() => copyToClipboard(marketplaceCode, 'marketplace')}
                  className="text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-white transition"
                >
                  {copiedIndex === 'marketplace' ? '✓ Copied' : 'Copy'}
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
                  <li className="flex items-center gap-3"><span className="text-red-400">✗</span> API key management</li>
                  <li className="flex items-center gap-3"><span className="text-red-400">✗</span> Gas fee estimation</li>
                  <li className="flex items-center gap-3"><span className="text-red-400">✗</span> Wallet integration</li>
                  <li className="flex items-center gap-3"><span className="text-red-400">✗</span> Payment rails</li>
                  <li className="flex items-center gap-3"><span className="text-red-400">✗</span> Messaging infra</li>
                  <li className="flex items-center gap-3"><span className="text-red-400">✗</span> Months to MVP</li>
                </ul>
              </div>
              <div className="bg-linear-to-br from-orange-500/10 to-amber-500/10 dark:from-orange-500/20 dark:to-amber-500/10 rounded-2xl border border-orange-500/30 p-6 sm:p-8">
                <h3 className="text-lg font-semibold mb-6 text-orange-500">Sphere SDK</h3>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-neutral-700 dark:text-neutral-200"><span className="text-green-500">✓</span> Private key IS identity</li>
                  <li className="flex items-center gap-3 text-neutral-700 dark:text-neutral-200"><span className="text-green-500">✓</span> Included (off-chain)</li>
                  <li className="flex items-center gap-3 text-neutral-700 dark:text-neutral-200"><span className="text-green-500">✓</span> Unified Unicity ID</li>
                  <li className="flex items-center gap-3 text-neutral-700 dark:text-neutral-200"><span className="text-green-500">✓</span> Just call <code className="text-amber-600 dark:text-amber-400 text-sm">send()</code></li>
                  <li className="flex items-center gap-3 text-neutral-700 dark:text-neutral-200"><span className="text-green-500">✓</span> Built-in P2P</li>
                  <li className="flex items-center gap-3 text-neutral-700 dark:text-neutral-200"><span className="text-green-500">✓</span> <strong>Days</strong></li>
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
                <code className="text-amber-600 dark:text-amber-400">npm install @agentsphere/sdk</code>{'\n\n'}
                <code className="text-neutral-500"># Generate a keypair (your identity)</code>{'\n'}
                <code className="text-amber-600 dark:text-amber-400">npx sphere-keygen</code>
              </pre>
              <div className="flex gap-4 justify-center flex-wrap">
                <Link
                  to="/developers/docs"
                  className="bg-linear-to-r from-orange-500 to-amber-500 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:opacity-90 transition shadow-lg shadow-orange-500/25"
                >
                  View Documentation
                </Link>
                <a
                  href="#"
                  className="border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-white px-8 py-4 rounded-xl font-semibold text-lg hover:border-neutral-400 dark:hover:border-neutral-500 transition"
                >
                  Generate Keypair
                </a>
              </div>
            </div>

            <div className="flex justify-center gap-6 sm:gap-8 text-neutral-600 dark:text-neutral-400 flex-wrap">
              <Link to="/developers/docs" className="hover:text-orange-500 transition flex items-center gap-2">
                <span>📖</span> Documentation
              </Link>
              <a href="https://discord.gg/S9f57ZKdt" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 transition flex items-center gap-2">
                <span>💬</span> Discord
              </a>
              <a href="https://github.com/unicitynetwork" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 transition flex items-center gap-2">
                <span>🐙</span> GitHub
              </a>
              <a href="#" className="hover:text-orange-500 transition flex items-center gap-2">
                <span>💰</span> Grants
              </a>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-neutral-200 dark:border-neutral-700 px-4 sm:px-6 py-8">
          <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-neutral-500 flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 bg-linear-to-br from-orange-500 to-amber-500 rounded flex items-center justify-center font-bold text-xs text-white">S</div>
              <span>AgentSphere by Unicity Labs</span>
            </div>
            <div>One SDK. Any marketplace. Let's build.</div>
          </div>
        </footer>

    </motion.div>
  );
}
