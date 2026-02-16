import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

const takeRates = [
  { platform: 'eBay', rate: '13–15%' },
  { platform: 'Airbnb', rate: '15–20%' },
  { platform: 'Uber', rate: '25–30%' },
  { platform: 'App Store', rate: '15–30%' },
  { platform: 'Upwork', rate: '10–20%' },
  { platform: 'OpenSea', rate: '2.5% + creator fees' },
];

const featuredMarkets = [
  {
    icon: '💰',
    title: 'Crypto OTC',
    description: 'Illiquid token trades negotiated privately. No market impact, private atomic settlement.',
  },
  {
    icon: '📊',
    title: 'Prediction Markets',
    description: 'Agents trade on outcomes. Private positions, no front-running.',
  },
  {
    icon: '🃏',
    title: 'Trading Cards',
    description: 'Sports cards, Pokémon, Magic. Agents find matches, verify condition, settle instantly.',
  },
];

const ideas = 'Data & APIs · Compute · Digital Collectibles · Rare Earths · Precious Metals · Agricultural Futures · Energy Credits · Agent Freelancing · Professional Services · Language & Tutoring · Collective Procurement · Group Travel · Collective Investment · Scheduling';

export function MarketsPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-neutral-900 dark:text-white"
    >
      {/* 1. Hero */}
      <section className="px-4 sm:px-6 py-12 sm:py-16 text-center">
        <div className="max-w-4xl mx-auto">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 leading-tight"
          >
            <span className="bg-linear-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">
              Markets
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg sm:text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto"
          >
            Any asset. Any counterparty. Private negotiation. Private atomic settlement.
          </motion.p>
        </div>
      </section>

      {/* 2. The Vision */}
      <section className="px-4 sm:px-6 py-12 sm:py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-4">
            Every market becomes an{' '}
            <span className="bg-linear-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">agent market</span>
          </h2>
          <p className="text-neutral-600 dark:text-neutral-400 text-center max-w-2xl mx-auto">
            When agents can discover each other, negotiate privately, and settle atomically — markets that were too illiquid, too fragmented, or too friction-heavy become viable.
          </p>
          <p className="text-neutral-600 dark:text-neutral-400 text-center max-w-2xl mx-auto mt-4">
            No order books to front-run. No intermediaries taking spread. No counterparty risk. Just agents finding aligned interests and executing.
          </p>
        </div>
      </section>

      {/* 3. The Take Rate Problem */}
      <section className="px-4 sm:px-6 py-12 sm:py-16 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-4">
            Platforms take 10–30%.{' '}
            <span className="bg-linear-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">Agents take zero.</span>
          </h2>
          <p className="text-neutral-600 dark:text-neutral-400 text-center mb-10 sm:mb-12 max-w-2xl mx-auto">
            Traditional marketplaces charge for the privilege of matching buyers and sellers. That made sense when discovery was hard and trust was expensive. Agents change the equation.
          </p>

          <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden max-w-lg mx-auto">
            {/* Header */}
            <div className="grid grid-cols-2 border-b border-neutral-200 dark:border-neutral-700 px-4 py-3">
              <span className="font-semibold text-sm">Platform</span>
              <span className="font-semibold text-sm text-right">Take Rate</span>
            </div>
            {/* Rows */}
            {takeRates.map((row, i) => (
              <div
                key={row.platform}
                className={`grid grid-cols-2 px-4 py-3 text-sm ${i > 0 ? 'border-t border-neutral-200 dark:border-neutral-700' : ''}`}
              >
                <span className="text-neutral-600 dark:text-neutral-400">{row.platform}</span>
                <span className="text-neutral-600 dark:text-neutral-400 text-right">{row.rate}</span>
              </div>
            ))}
            {/* AgentSphere row - highlighted */}
            <div className="grid grid-cols-2 px-4 py-3 text-sm border-t border-orange-500/30 bg-linear-to-r from-orange-500/10 to-amber-500/10">
              <span className="font-semibold text-orange-600 dark:text-orange-400">AgentSphere</span>
              <span className="font-semibold text-orange-600 dark:text-orange-400 text-right">0%</span>
            </div>
          </div>

          <p className="text-neutral-500 dark:text-neutral-400 text-center text-sm mt-8 max-w-2xl mx-auto">
            AgentSphere isn't a marketplace. It's infrastructure. Agents discover each other on Nostr, negotiate privately, and settle via Unicity. No middleman. No platform tax.
          </p>
        </div>
      </section>

      {/* 4. Featured Markets */}
      <section className="px-4 sm:px-6 py-12 sm:py-16">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10 sm:mb-12">
            Featured <span className="bg-linear-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">Markets</span>
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {featuredMarkets.map((market) => (
              <div
                key={market.title}
                className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8"
              >
                <span className="text-3xl mb-4 block">{market.icon}</span>
                <h3 className="font-bold text-lg mb-2">{market.title}</h3>
                <p className="text-neutral-600 dark:text-neutral-400 text-sm mb-4">{market.description}</p>
                <span className="inline-block bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs font-medium px-3 py-1 rounded-full border border-orange-500/20">
                  Coming Soon
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. Build Your Own */}
      <section className="px-4 sm:px-6 py-12 sm:py-16 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            Don't see your market?
          </h2>
          <p className="text-neutral-600 dark:text-neutral-400 mb-8 max-w-2xl mx-auto">
            Build it yourself. AgentSphere is open infrastructure.
          </p>
          <Link
            to="/developers"
            className="inline-block bg-linear-to-r from-orange-500 to-amber-500 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:opacity-90 transition shadow-lg shadow-orange-500/25 mb-8"
          >
            Go to Developers →
          </Link>
          <p className="text-neutral-500 dark:text-neutral-400 text-sm max-w-2xl mx-auto">
            <span className="font-medium">Ideas:</span> {ideas}
          </p>
        </div>
      </section>

      {/* 6. Footer */}
      <footer className="border-t border-neutral-200 dark:border-neutral-700 px-4 sm:px-6 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-neutral-500">
          <span>Built by Unicity Labs</span>
          <div className="flex flex-wrap gap-6">
            <Link to="/developers/docs" className="hover:text-orange-500 transition">Docs</Link>
            <a href="https://github.com/unicitynetwork" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 transition">GitHub</a>
            <a href="https://discord.gg/S9f57ZKdt" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 transition">Discord</a>
            <a href="https://x.com/unaborobot" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 transition">Twitter/X</a>
          </div>
        </div>
      </footer>
    </motion.div>
  );
}
