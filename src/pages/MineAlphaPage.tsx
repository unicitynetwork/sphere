import { useState } from 'react';
import { motion } from 'framer-motion';

type MiningOption = 'commercial' | 'solo' | 'pool';

interface OptionConfig {
  icon: string;
  title: string;
  tagline: string;
  description: string;
  color: string;
  features: string[];
  content: React.ReactNode;
}

export function MineAlphaPage() {
  const [activeOption, setActiveOption] = useState<MiningOption>('commercial');

  const options: Record<MiningOption, OptionConfig> = {
    commercial: {
      icon: '🏭',
      title: 'Commercial Mining',
      tagline: 'Plug in. Earn. No hardware.',
      description: 'Purchase hash rate from professional mining facilities. No equipment, no setup, no electricity bills. Just rewards.',
      color: 'from-emerald-500 to-teal-500',
      features: ['No hardware required', 'Instant activation', 'Professional facilities', 'Predictable returns'],
      content: (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-950 rounded-xl p-6 border border-neutral-200 dark:border-gray-800">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center text-2xl">⛏️</div>
              <div>
                <h3 className="font-semibold text-lg text-neutral-900 dark:text-white">Friendly Miners</h3>
                <p className="text-neutral-500 dark:text-gray-400 text-sm">Mining-as-a-Service Platform</p>
              </div>
            </div>
            <p className="text-neutral-600 dark:text-gray-300 mb-6">
              The easiest way to mine ALPHA. Purchase hash rate contracts from our network of professional mining facilities. No technical knowledge required.
            </p>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-neutral-100 dark:bg-gray-900 rounded-lg p-4">
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">99.9%</div>
                <div className="text-neutral-500 dark:text-gray-500 text-sm">Uptime guarantee</div>
              </div>
              <div className="bg-neutral-100 dark:bg-gray-900 rounded-lg p-4">
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">24/7</div>
                <div className="text-neutral-500 dark:text-gray-500 text-sm">Monitoring</div>
              </div>
              <div className="bg-neutral-100 dark:bg-gray-900 rounded-lg p-4">
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">0</div>
                <div className="text-neutral-500 dark:text-gray-500 text-sm">Hardware to manage</div>
              </div>
              <div className="bg-neutral-100 dark:bg-gray-900 rounded-lg p-4">
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">Daily</div>
                <div className="text-neutral-500 dark:text-gray-500 text-sm">Payouts</div>
              </div>
            </div>
            <a
              href="https://friendly-miners.com"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-center px-6 py-4 rounded-xl font-semibold hover:opacity-90 transition"
            >
              Start Mining on Friendly Miners →
            </a>
          </div>

          <div className="bg-neutral-50 dark:bg-gray-900/50 rounded-xl p-6 border border-neutral-200 dark:border-gray-800">
            <h4 className="font-semibold mb-3 text-neutral-900 dark:text-white">How it works</h4>
            <ol className="space-y-3 text-neutral-600 dark:text-gray-400">
              <li className="flex gap-3">
                <span className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 w-6 h-6 rounded-full flex items-center justify-center text-sm shrink-0">1</span>
                <span>Choose your hash rate package</span>
              </li>
              <li className="flex gap-3">
                <span className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 w-6 h-6 rounded-full flex items-center justify-center text-sm shrink-0">2</span>
                <span>Pay with crypto or fiat</span>
              </li>
              <li className="flex gap-3">
                <span className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 w-6 h-6 rounded-full flex items-center justify-center text-sm shrink-0">3</span>
                <span>Mining starts immediately</span>
              </li>
              <li className="flex gap-3">
                <span className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 w-6 h-6 rounded-full flex items-center justify-center text-sm shrink-0">4</span>
                <span>Receive daily ALPHA payouts to your wallet</span>
              </li>
            </ol>
          </div>
        </div>
      )
    },
    solo: {
      icon: '🎯',
      title: 'Solo Mining',
      tagline: 'Your hardware. Your rewards. Full control.',
      description: 'Run your own mining operation and keep 100% of block rewards. Higher variance, higher potential rewards.',
      color: 'from-orange-500 to-amber-500',
      features: ['100% of block rewards', 'Full decentralization', 'No pool fees', 'Complete control'],
      content: (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-950 rounded-xl p-6 border border-neutral-200 dark:border-gray-800">
            <h3 className="font-semibold text-lg mb-4 text-neutral-900 dark:text-white">Quick Start</h3>
            <div className="space-y-4">
              <div className="bg-neutral-100 dark:bg-gray-900 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-neutral-500 dark:text-gray-500 uppercase tracking-wider">1. Install the node</span>
                </div>
                <pre className="text-sm font-mono text-amber-600 dark:text-amber-400 overflow-x-auto">
                  <code>curl -sSL https://get.unicity.network | bash</code>
                </pre>
              </div>

              <div className="bg-neutral-100 dark:bg-gray-900 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-neutral-500 dark:text-gray-500 uppercase tracking-wider">2. Configure mining</span>
                </div>
                <pre className="text-sm font-mono text-amber-600 dark:text-amber-400 overflow-x-auto whitespace-pre-wrap">
{`# Edit config file
nano ~/.unicity/config.toml

# Set your wallet address
[mining]
enabled = true
wallet = "unicity:0xYOUR_WALLET_ADDRESS"
threads = 8  # Adjust to your CPU cores`}
                </pre>
              </div>

              <div className="bg-neutral-100 dark:bg-gray-900 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-neutral-500 dark:text-gray-500 uppercase tracking-wider">3. Start mining</span>
                </div>
                <pre className="text-sm font-mono text-amber-600 dark:text-amber-400 overflow-x-auto">
                  <code>unicity-node --mine</code>
                </pre>
              </div>
            </div>
          </div>

          <div className="bg-neutral-50 dark:bg-gray-900/50 rounded-xl p-6 border border-neutral-200 dark:border-gray-800">
            <h4 className="font-semibold mb-4 text-neutral-900 dark:text-white">Hardware Requirements</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-neutral-500 dark:text-gray-500 text-sm mb-1">Minimum</div>
                <ul className="text-neutral-700 dark:text-gray-300 text-sm space-y-1">
                  <li>• 4 CPU cores</li>
                  <li>• 8 GB RAM</li>
                  <li>• 100 GB SSD</li>
                  <li>• 10 Mbps connection</li>
                </ul>
              </div>
              <div>
                <div className="text-neutral-500 dark:text-gray-500 text-sm mb-1">Recommended</div>
                <ul className="text-neutral-700 dark:text-gray-300 text-sm space-y-1">
                  <li>• 16+ CPU cores</li>
                  <li>• 32 GB RAM</li>
                  <li>• 500 GB NVMe</li>
                  <li>• 100 Mbps connection</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="bg-neutral-50 dark:bg-gray-900/50 rounded-xl p-6 border border-neutral-200 dark:border-gray-800">
            <h4 className="font-semibold mb-3 text-neutral-900 dark:text-white">Solo Mining Considerations</h4>
            <ul className="space-y-2 text-neutral-600 dark:text-gray-400 text-sm">
              <li className="flex gap-2">
                <span className="text-amber-500 dark:text-amber-400">→</span>
                <span>High variance — you may go days without finding a block</span>
              </li>
              <li className="flex gap-2">
                <span className="text-amber-500 dark:text-amber-400">→</span>
                <span>When you find a block, you keep 100% of the reward</span>
              </li>
              <li className="flex gap-2">
                <span className="text-amber-500 dark:text-amber-400">→</span>
                <span>Best for miners with significant hash power</span>
              </li>
              <li className="flex gap-2">
                <span className="text-amber-500 dark:text-amber-400">→</span>
                <span>Contributes directly to network decentralization</span>
              </li>
            </ul>
          </div>

          <a
            href="https://friendly-miners.com"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white text-center px-6 py-4 rounded-xl font-semibold hover:opacity-90 transition"
          >
            Full Solo Mining Guide →
          </a>
        </div>
      )
    },
    pool: {
      icon: '🌊',
      title: 'Pool Mining',
      tagline: 'Combine forces. Steady rewards.',
      description: 'Join a mining pool to combine hash power with other miners. More consistent payouts, lower variance.',
      color: 'from-violet-500 to-purple-500',
      features: ['Steady payouts', 'Lower variance', 'Community support', 'Easy setup'],
      content: (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-950 rounded-xl p-6 border border-neutral-200 dark:border-gray-800">
            <h3 className="font-semibold text-lg mb-4 text-neutral-900 dark:text-white">Mining Pools</h3>
            <div className="space-y-4">

              <div className="bg-neutral-100 dark:bg-gray-900 rounded-lg p-4 border border-neutral-200 dark:border-gray-800 hover:border-violet-500/50 transition">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-violet-500/20 rounded-lg flex items-center justify-center text-lg">🔮</div>
                    <div>
                      <div className="font-semibold text-neutral-900 dark:text-white">Unicity Pool</div>
                      <div className="text-neutral-500 dark:text-gray-500 text-sm">Official community pool</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-violet-600 dark:text-violet-400 font-semibold">1% fee</div>
                    <div className="text-neutral-500 dark:text-gray-500 text-xs">PPLNS</div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-neutral-200 dark:border-gray-800">
                  <div className="text-sm text-neutral-600 dark:text-gray-400">pool.unicity.network:3333</div>
                  <a href="https://pool.unicity.network" target="_blank" rel="noopener noreferrer" className="text-violet-600 dark:text-violet-400 text-sm hover:underline">Connect →</a>
                </div>
              </div>

              <div className="bg-neutral-100 dark:bg-gray-900 rounded-lg p-4 border border-neutral-200 dark:border-gray-800 hover:border-violet-500/50 transition">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center text-lg">⚡</div>
                    <div>
                      <div className="font-semibold text-neutral-900 dark:text-white">HashVault</div>
                      <div className="text-neutral-500 dark:text-gray-500 text-sm">Multi-algo pool</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-violet-600 dark:text-violet-400 font-semibold">0.9% fee</div>
                    <div className="text-neutral-500 dark:text-gray-500 text-xs">PPLNS</div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-neutral-200 dark:border-gray-800">
                  <div className="text-sm text-neutral-600 dark:text-gray-400">alpha.hashvault.pro:3333</div>
                  <a href="https://hashvault.pro" target="_blank" rel="noopener noreferrer" className="text-violet-600 dark:text-violet-400 text-sm hover:underline">Connect →</a>
                </div>
              </div>

              <div className="bg-neutral-100 dark:bg-gray-900 rounded-lg p-4 border border-neutral-200 dark:border-gray-800 hover:border-violet-500/50 transition">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center text-lg">🌿</div>
                    <div>
                      <div className="font-semibold text-neutral-900 dark:text-white">HeroMiners</div>
                      <div className="text-neutral-500 dark:text-gray-500 text-sm">Global infrastructure</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-violet-600 dark:text-violet-400 font-semibold">1% fee</div>
                    <div className="text-neutral-500 dark:text-gray-500 text-xs">PROP</div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-neutral-200 dark:border-gray-800">
                  <div className="text-sm text-neutral-600 dark:text-gray-400">alpha.herominers.com:1111</div>
                  <a href="https://herominers.com" target="_blank" rel="noopener noreferrer" className="text-violet-600 dark:text-violet-400 text-sm hover:underline">Connect →</a>
                </div>
              </div>

              <div className="bg-neutral-100 dark:bg-gray-900 rounded-lg p-4 border border-neutral-200 dark:border-gray-800 hover:border-violet-500/50 transition">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-500/20 rounded-lg flex items-center justify-center text-lg">🦊</div>
                    <div>
                      <div className="font-semibold text-neutral-900 dark:text-white">2Miners</div>
                      <div className="text-neutral-500 dark:text-gray-500 text-sm">Established since 2017</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-violet-600 dark:text-violet-400 font-semibold">1% fee</div>
                    <div className="text-neutral-500 dark:text-gray-500 text-xs">PPLNS / SOLO</div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-neutral-200 dark:border-gray-800">
                  <div className="text-sm text-neutral-600 dark:text-gray-400">alpha.2miners.com:2222</div>
                  <a href="https://2miners.com" target="_blank" rel="noopener noreferrer" className="text-violet-600 dark:text-violet-400 text-sm hover:underline">Connect →</a>
                </div>
              </div>

            </div>
          </div>

          <div className="bg-neutral-50 dark:bg-gray-900/50 rounded-xl p-6 border border-neutral-200 dark:border-gray-800">
            <h4 className="font-semibold mb-4 text-neutral-900 dark:text-white">Quick Pool Setup</h4>
            <div className="bg-neutral-100 dark:bg-gray-900 rounded-lg p-4">
              <pre className="text-sm font-mono text-violet-600 dark:text-violet-400 overflow-x-auto whitespace-pre-wrap">
{`# Example: Connect to Unicity Pool
./unicity-miner -o stratum+tcp://pool.unicity.network:3333 \\
  -u YOUR_WALLET_ADDRESS \\
  -p x`}
              </pre>
            </div>
          </div>

          <div className="bg-neutral-50 dark:bg-gray-900/50 rounded-xl p-6 border border-neutral-200 dark:border-gray-800">
            <h4 className="font-semibold mb-3 text-neutral-900 dark:text-white">Pool vs Solo</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-violet-600 dark:text-violet-400 mb-2">Pool Mining</div>
                <ul className="text-neutral-600 dark:text-gray-400 space-y-1">
                  <li>✓ Regular payouts</li>
                  <li>✓ Lower variance</li>
                  <li>✓ Good for smaller miners</li>
                  <li>− Pool fees (0.9-1%)</li>
                </ul>
              </div>
              <div>
                <div className="text-amber-500 dark:text-amber-400 mb-2">Solo Mining</div>
                <ul className="text-neutral-600 dark:text-gray-400 space-y-1">
                  <li>✓ 100% of rewards</li>
                  <li>✓ No fees</li>
                  <li>✓ Full decentralization</li>
                  <li>− High variance</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )
    }
  };

  return (
    <div className="text-neutral-900 dark:text-white bg-neutral-100 dark:bg-gray-950 min-h-full">
      {/* Hero Section */}
      <section className="py-8 md:py-12 text-center">
        <div className="max-w-4xl mx-auto">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl md:text-5xl font-bold mb-4 md:mb-6 leading-tight"
          >
            Mine ALPHA.<br />
            <span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">Choose Your Path.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg md:text-xl text-neutral-600 dark:text-gray-400 mb-8 max-w-2xl mx-auto"
          >
            Three ways to participate in the Unicity network. From zero-setup cloud mining to running your own operation.
          </motion.p>
        </div>
      </section>

      {/* Options Section */}
      <section className="pb-8">
        <div className="max-w-6xl mx-auto">
          {/* Option Cards */}
          <div className="grid md:grid-cols-3 gap-4 mb-8">
            {(Object.entries(options) as [MiningOption, OptionConfig][]).map(([key, option]) => (
              <motion.button
                key={key}
                onClick={() => setActiveOption(key)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`p-6 rounded-2xl border text-left transition-all ${
                  activeOption === key
                    ? 'bg-white dark:bg-gray-900 border-neutral-300 dark:border-gray-700'
                    : 'bg-white/50 dark:bg-gray-900/50 border-neutral-200/50 dark:border-gray-800/50 hover:border-neutral-300 dark:hover:border-gray-700'
                }`}
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${option.color} flex items-center justify-center text-2xl mb-4`}>
                  {option.icon}
                </div>
                <h3 className="font-semibold text-lg mb-1 text-neutral-900 dark:text-white">{option.title}</h3>
                <p className="text-neutral-600 dark:text-gray-400 text-sm">{option.tagline}</p>
              </motion.button>
            ))}
          </div>

          {/* Content Panel */}
          <motion.div
            key={activeOption}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-gray-900 rounded-2xl border border-neutral-200 dark:border-gray-800 overflow-hidden"
          >
            <div className="p-6 md:p-8 border-b border-neutral-200 dark:border-gray-800">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-xl md:text-2xl font-bold mb-2 text-neutral-900 dark:text-white">{options[activeOption].title}</h2>
                  <p className="text-neutral-600 dark:text-gray-400 max-w-xl">{options[activeOption].description}</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {options[activeOption].features.map((f, i) => (
                    <span key={i} className="bg-neutral-100 dark:bg-gray-800 text-neutral-700 dark:text-gray-300 text-xs px-3 py-1 rounded-full">{f}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 md:p-8">
              {options[activeOption].content}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="py-8 md:py-12 bg-neutral-50 dark:bg-gray-900/50 rounded-2xl my-8">
        <div className="max-w-4xl mx-auto px-4">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 md:mb-12 text-neutral-900 dark:text-white">Which Option is Right for You?</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-gray-800">
                  <th className="py-4 px-4 text-neutral-500 dark:text-gray-400 font-medium"></th>
                  <th className="py-4 px-4 text-emerald-600 dark:text-emerald-400 font-medium">Commercial</th>
                  <th className="py-4 px-4 text-amber-600 dark:text-amber-400 font-medium">Solo</th>
                  <th className="py-4 px-4 text-violet-600 dark:text-violet-400 font-medium">Pool</th>
                </tr>
              </thead>
              <tbody className="text-neutral-700 dark:text-gray-300">
                <tr className="border-b border-neutral-200/50 dark:border-gray-800/50">
                  <td className="py-4 px-4 text-neutral-500 dark:text-gray-500">Hardware needed</td>
                  <td className="py-4 px-4">None</td>
                  <td className="py-4 px-4">Yes</td>
                  <td className="py-4 px-4">Yes</td>
                </tr>
                <tr className="border-b border-neutral-200/50 dark:border-gray-800/50">
                  <td className="py-4 px-4 text-neutral-500 dark:text-gray-500">Technical skill</td>
                  <td className="py-4 px-4">Beginner</td>
                  <td className="py-4 px-4">Advanced</td>
                  <td className="py-4 px-4">Intermediate</td>
                </tr>
                <tr className="border-b border-neutral-200/50 dark:border-gray-800/50">
                  <td className="py-4 px-4 text-neutral-500 dark:text-gray-500">Payout frequency</td>
                  <td className="py-4 px-4">Daily</td>
                  <td className="py-4 px-4">Variable</td>
                  <td className="py-4 px-4">Regular</td>
                </tr>
                <tr className="border-b border-neutral-200/50 dark:border-gray-800/50">
                  <td className="py-4 px-4 text-neutral-500 dark:text-gray-500">Fees</td>
                  <td className="py-4 px-4">Service fee</td>
                  <td className="py-4 px-4">None</td>
                  <td className="py-4 px-4">0.9-1%</td>
                </tr>
                <tr>
                  <td className="py-4 px-4 text-neutral-500 dark:text-gray-500">Best for</td>
                  <td className="py-4 px-4">Passive income</td>
                  <td className="py-4 px-4">Large miners</td>
                  <td className="py-4 px-4">Most miners</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-neutral-200 dark:border-gray-800 py-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-neutral-500 dark:text-gray-500 flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-gradient-to-br from-emerald-500 to-teal-500 rounded flex items-center justify-center font-bold text-xs text-white">⛏</div>
            <span>Mine ALPHA by Unicity Labs</span>
          </div>
          <div>Choose your path. Start mining today.</div>
        </div>
      </footer>
    </div>
  );
}
