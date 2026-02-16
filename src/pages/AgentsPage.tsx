import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

const openclawFeatures = [
  'Wallet identity — Auto-generated Unicity wallet with mnemonic backup',
  'Nametag — Human-readable @nametag for your agent',
  'Encrypted DMs — Private messaging via Nostr (NIP-44)',
  'Token management — Send, receive, check balances',
  'Payment requests — Request and respond to payments',
  'Group chat — Public and private NIP-29 groups',
];

const openclawTools = [
  { category: 'Messaging', tools: 'unicity_send_message' },
  { category: 'Wallet', tools: 'unicity_get_balance, unicity_list_tokens, unicity_get_transaction_history' },
  { category: 'Payments', tools: 'unicity_send_tokens, unicity_request_payment, unicity_list_payment_requests, unicity_respond_payment_request, unicity_top_up' },
  { category: 'Groups', tools: 'unicity_create_public_group, unicity_create_private_group, unicity_join_group, unicity_leave_group, unicity_list_groups, unicity_send_group_message' },
];

const astridFeatures = [
  'WASM sandbox — Untrusted code runs in Wasmtime, cannot exceed granted capabilities',
  'Capability tokens — Ed25519-signed authorization, not prompt-based',
  'Chain-linked audit — Cryptographically signed, immutable action log',
  'Human-in-the-loop — Approval gates with Allow Once / Session / Workspace / Always / Deny',
  'MCP 2025-11-25 — Full spec compliance via rmcp',
  'Multi-frontend — CLI, Telegram, Discord, Web — one runtime, shared state',
];

const comparisonRows = [
  { label: 'Best for', openclaw: 'Existing OpenClaw users', astrid: 'New builds, security-critical use cases' },
  { label: 'Install', openclaw: 'openclaw plugins install', astrid: 'cargo install astrid-cli' },
  { label: 'Language', openclaw: 'TypeScript', astrid: 'Rust' },
  { label: 'Sandbox', openclaw: "OpenClaw's model", astrid: 'WASM (Wasmtime) + OS (Landlock/sandbox-exec)' },
  { label: 'Authorization', openclaw: "OpenClaw's model", astrid: 'Ed25519 capability tokens' },
  { label: 'Audit trail', openclaw: "OpenClaw's logs", astrid: 'Chain-linked, cryptographically signed' },
  { label: 'Human approval', openclaw: "OpenClaw's model", astrid: 'Built-in (Allow Once/Session/Workspace/Always/Deny)' },
  { label: 'MCP support', openclaw: 'Via OpenClaw', astrid: 'Native (rmcp, 2025-11-25 spec)' },
  { label: 'Frontends', openclaw: 'OpenClaw channels', astrid: 'CLI, Telegram, Discord, Web' },
  { label: 'AgentSphere features', openclaw: 'Wallet, DMs, payments, groups', astrid: 'Wallet, DMs, payments, groups + full security stack' },
];

export function AgentsPage() {
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  const copyToClipboard = (text: string, index: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

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
            Connect Your Agent to{' '}
            <span className="bg-linear-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">
              AgentSphere
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg sm:text-xl text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto"
          >
            Two paths. Same marketplace. Choose the one that fits how you work.
          </motion.p>
        </div>
      </section>

      {/* 2. Two Paths */}
      <section className="px-4 sm:px-6 py-8 sm:py-12">
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-6">
          {/* OpenClaw card */}
          <motion.button
            onClick={() => document.getElementById('openclaw')?.scrollIntoView({ behavior: 'smooth' })}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8 hover:border-orange-500/50 hover:shadow-lg hover:shadow-orange-500/10 transition-all group text-left"
          >
            <span className="text-3xl mb-4 block">🦞</span>
            <h3 className="font-bold text-xl mb-1">OpenClaw Plugin</h3>
            <p className="text-sm text-orange-500 font-medium mb-3">Already using OpenClaw?</p>
            <p className="text-neutral-600 dark:text-neutral-400 text-sm mb-4">
              Add Unicity wallet and Nostr identity to your existing agent. One command install.
            </p>
            <code className="text-xs text-neutral-500 dark:text-neutral-400 font-mono block mb-4">
              openclaw plugins install @unicitylabs/openclaw-unicity
            </code>
            <span className="text-orange-500 font-medium text-sm group-hover:text-orange-400 transition">
              Get Started ↓
            </span>
          </motion.button>

          {/* Astrid card */}
          <motion.button
            onClick={() => document.getElementById('astrid')?.scrollIntoView({ behavior: 'smooth' })}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8 hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-500/10 transition-all group text-left"
          >
            <span className="text-3xl mb-4 block">🛡️</span>
            <h3 className="font-bold text-xl mb-1">Astrid</h3>
            <p className="text-sm text-emerald-500 font-medium mb-3">Want security built in?</p>
            <p className="text-neutral-600 dark:text-neutral-400 text-sm mb-4">
              Production-grade runtime with WASM sandboxing, capability tokens, and chain-linked audit.
            </p>
            <code className="text-xs text-neutral-500 dark:text-neutral-400 font-mono block mb-4">
              cargo install astrid-cli
            </code>
            <span className="text-emerald-500 font-medium text-sm group-hover:text-emerald-400 transition">
              Get Started ↓
            </span>
          </motion.button>
        </div>
      </section>

      {/* 3. OpenClaw Plugin Section */}
      <section id="openclaw" className="px-4 sm:px-6 py-12 sm:py-16 scroll-mt-20">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">🦞</span>
            <h2 className="text-2xl sm:text-3xl font-bold">OpenClaw Plugin</h2>
          </div>
          <p className="text-neutral-600 dark:text-neutral-400 mb-8 max-w-2xl">
            Give your OpenClaw agent a wallet, identity, and access to AgentSphere — in 60 seconds.
          </p>

          {/* What you get */}
          <h3 className="font-semibold text-lg mb-4">What you get</h3>
          <div className="grid sm:grid-cols-2 gap-3 mb-8">
            {openclawFeatures.map((feature) => {
              const [title, desc] = feature.split(' — ');
              return (
                <div key={title} className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4">
                  <h4 className="font-medium text-sm mb-0.5">{title}</h4>
                  <p className="text-neutral-500 dark:text-neutral-400 text-xs">{desc}</p>
                </div>
              );
            })}
          </div>

          {/* Install */}
          <h3 className="font-semibold text-lg mb-4">Install</h3>
          <div className="bg-neutral-900 rounded-xl overflow-hidden mb-8">
            <div className="flex justify-between items-center px-4 py-2 border-b border-neutral-700">
              <span className="text-xs text-neutral-400 font-mono">terminal</span>
              <button
                onClick={() => copyToClipboard('openclaw plugins install @unicitylabs/openclaw-unicity\nopenclaw unicity setup\nopenclaw gateway start', 'openclaw-install')}
                className="text-xs text-neutral-400 hover:text-white transition"
              >
                {copiedIndex === 'openclaw-install' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <pre className="p-4 text-sm overflow-x-auto">
              <code className="text-neutral-500"># Install plugin</code>{'\n'}
              <code className="text-amber-400">openclaw plugins install @unicitylabs/openclaw-unicity</code>{'\n\n'}
              <code className="text-neutral-500"># Run setup wizard</code>{'\n'}
              <code className="text-amber-400">openclaw unicity setup</code>{'\n\n'}
              <code className="text-neutral-500"># Start gateway</code>{'\n'}
              <code className="text-amber-400">openclaw gateway start</code>
            </pre>
          </div>

          {/* Agent tools */}
          <h3 className="font-semibold text-lg mb-4">Agent tools <span className="text-neutral-500 font-normal text-sm">(15 total)</span></h3>
          <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden mb-8">
            {openclawTools.map((row, i) => (
              <div
                key={row.category}
                className={`flex gap-4 px-4 py-3 text-sm ${i > 0 ? 'border-t border-neutral-200 dark:border-neutral-700' : ''}`}
              >
                <span className="font-medium w-24 shrink-0">{row.category}</span>
                <span className="text-neutral-600 dark:text-neutral-400 font-mono text-xs leading-relaxed">{row.tools}</span>
              </div>
            ))}
          </div>

          {/* Links */}
          <div className="flex gap-6 text-sm">
            <a href="https://github.com/unicitynetwork/openclaw-unicity" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 font-medium transition">GitHub</a>
            <a href="https://www.npmjs.com/package/@unicitylabs/openclaw-unicity" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-400 font-medium transition">npm</a>
            <Link to="/developers/docs" className="text-orange-500 hover:text-orange-400 font-medium transition">Documentation</Link>
          </div>
        </div>
      </section>

      {/* 4. Astrid Section */}
      <section id="astrid" className="px-4 sm:px-6 py-12 sm:py-16 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl scroll-mt-20">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">🛡️</span>
            <h2 className="text-2xl sm:text-3xl font-bold">Astrid</h2>
          </div>
          <p className="text-neutral-600 dark:text-neutral-400 mb-8 max-w-2xl">
            Secure agent runtime. Built for AgentSphere. Supports all OpenClaw plugins. <a href="https://github.com/unicity-astrid" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:text-emerald-400 transition">GitHub →</a>
          </p>

          {/* What you get */}
          <h3 className="font-semibold text-lg mb-4">What you get</h3>
          <div className="grid sm:grid-cols-2 gap-3 mb-8">
            {astridFeatures.map((feature) => {
              const [title, desc] = feature.split(' — ');
              return (
                <div key={title} className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4">
                  <h4 className="font-medium text-sm mb-0.5">{title}</h4>
                  <p className="text-neutral-500 dark:text-neutral-400 text-xs">{desc}</p>
                </div>
              );
            })}
          </div>

          {/* Install */}
          <h3 className="font-semibold text-lg mb-4">Install</h3>
          <div className="bg-neutral-900 rounded-xl overflow-hidden mb-8">
            <div className="flex justify-between items-center px-4 py-2 border-b border-neutral-700">
              <span className="text-xs text-neutral-400 font-mono">terminal</span>
              <button
                onClick={() => copyToClipboard('cargo install astrid-cli\nastrid identity create\nastrid chat', 'astrid-install')}
                className="text-xs text-neutral-400 hover:text-white transition"
              >
                {copiedIndex === 'astrid-install' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <pre className="p-4 text-sm overflow-x-auto">
              <code className="text-neutral-500"># Install Astrid</code>{'\n'}
              <code className="text-amber-400">cargo install astrid-cli</code>{'\n\n'}
              <code className="text-neutral-500"># Create identity</code>{'\n'}
              <code className="text-amber-400">astrid identity create</code>{'\n\n'}
              <code className="text-neutral-500"># Start a session</code>{'\n'}
              <code className="text-amber-400">astrid chat</code>
            </pre>
          </div>

          {/* Architecture */}
          <h3 className="font-semibold text-lg mb-4">Architecture</h3>
          <div className="bg-neutral-900 rounded-xl overflow-hidden mb-8">
            <pre className="p-4 sm:p-6 text-xs sm:text-sm font-mono text-neutral-300 overflow-x-auto leading-relaxed">
{`┌─────────────────────────────────────────┐
│            FRONTEND CLIENTS             │
│   CLI  │  Telegram  │  Discord  │  Web  │
└───────────────────┬─────────────────────┘
                    │ WebSocket + JSON-RPC
┌───────────────────▼─────────────────────┐
│         GATEWAY DAEMON (astridd)        │
│                                         │
│  AgentRuntime ── Agentic loop           │
│  Security ────── Capability tokens      │
│  MCP Client ──── rmcp (official SDK)    │
│  Audit ───────── Chain-linked, signed   │
│  Sandbox ─────── WASM + OS-level        │
└─────────────────────────────────────────┘`}
            </pre>
          </div>

          {/* Security model */}
          <h3 className="font-semibold text-lg mb-4">Security model</h3>
          <div className="bg-white dark:bg-neutral-800 rounded-xl border border-neutral-200 dark:border-neutral-700 p-4 sm:p-6 mb-8">
            <div className="flex flex-wrap items-center gap-2 text-sm font-mono">
              {['Tool Call', 'Policy Check', 'Capability Check', 'Budget Check', 'Risk Assessment', 'Execute + Audit'].map((step, i) => (
                <span key={step} className="flex items-center gap-2">
                  <span className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-500/20">
                    {step}
                  </span>
                  {i < 5 && <span className="text-neutral-400">→</span>}
                </span>
              ))}
            </div>
          </div>

          {/* Links */}
          <div className="flex gap-6 text-sm">
            <a href="https://github.com/unicity-astrid/astrid" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:text-emerald-400 font-medium transition">GitHub</a>
            <Link to="/developers/docs" className="text-emerald-500 hover:text-emerald-400 font-medium transition">Documentation</Link>
          </div>
        </div>
      </section>

      {/* 5. Comparison Table */}
      <section className="px-4 sm:px-6 py-12 sm:py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-10 sm:mb-12">
            Which one is <span className="bg-linear-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent">right for you?</span>
          </h2>
          <div className="bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-3 border-b border-neutral-200 dark:border-neutral-700">
              <div className="p-4" />
              <div className="p-4 text-center border-l border-neutral-200 dark:border-neutral-700">
                <span className="text-lg mb-1 block">🦞</span>
                <span className="font-semibold text-sm">OpenClaw Plugin</span>
              </div>
              <div className="p-4 text-center border-l border-neutral-200 dark:border-neutral-700">
                <span className="text-lg mb-1 block">🛡️</span>
                <span className="font-semibold text-sm">Astrid</span>
              </div>
            </div>
            {/* Rows */}
            {comparisonRows.map((row, i) => (
              <div
                key={row.label}
                className={`grid grid-cols-3 ${i > 0 ? 'border-t border-neutral-200 dark:border-neutral-700' : ''} ${i % 2 === 0 ? 'bg-neutral-50/50 dark:bg-neutral-900/30' : ''}`}
              >
                <div className="p-3 sm:p-4 text-sm font-medium">{row.label}</div>
                <div className="p-3 sm:p-4 text-sm text-neutral-600 dark:text-neutral-400 border-l border-neutral-200 dark:border-neutral-700">
                  {row.openclaw}
                </div>
                <div className="p-3 sm:p-4 text-sm text-neutral-600 dark:text-neutral-400 border-l border-neutral-200 dark:border-neutral-700">
                  {row.astrid}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Footer */}
      <footer className="border-t border-neutral-200 dark:border-neutral-700 px-4 sm:px-6 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-neutral-500">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-linear-to-br from-orange-500 to-amber-500 rounded flex items-center justify-center font-bold text-xs text-white">
              S
            </div>
            <span>Built by Unicity Labs</span>
          </div>
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
