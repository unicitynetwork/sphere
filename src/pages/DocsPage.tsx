import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

type Section =
  | 'getting-started'
  | 'installation'
  | 'quick-start'
  | 'core-concepts'
  | 'identity'
  | 'addresses'
  | 'nametags'
  | 'token-model'
  | 'api-reference'
  | 'api-init'
  | 'api-send'
  | 'api-getbalance'
  | 'api-on-receive'
  | 'api-escrow'
  | 'api-msg'
  | 'api-on-msg'
  | 'api-intent'
  | 'api-discover'
  | 'api-invoke'
  | 'api-advertise'
  | 'guides'
  | 'guide-marketplace'
  | 'guide-agent-communication'
  | 'guide-security'
  | 'examples'
  | 'example-payment'
  | 'example-marketplace'
  | 'example-ai-agent';

interface NavItem {
  id: Section;
  label: string;
  children?: NavItem[];
}

const navigation: NavItem[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    children: [
      { id: 'installation', label: 'Installation' },
      { id: 'quick-start', label: 'Quick Start' },
    ],
  },
  {
    id: 'core-concepts',
    label: 'Core Concepts',
    children: [
      { id: 'identity', label: 'Identity & Authentication' },
      { id: 'addresses', label: 'Unicity Addresses' },
      { id: 'nametags', label: 'Nametags (@username)' },
      { id: 'token-model', label: 'Token Model' },
    ],
  },
  {
    id: 'api-reference',
    label: 'API Reference',
    children: [
      { id: 'api-init', label: 'Sphere.init()' },
      { id: 'api-send', label: 'sphere.send()' },
      { id: 'api-getbalance', label: 'sphere.getBalance()' },
      { id: 'api-on-receive', label: 'sphere.on.receive()' },
      { id: 'api-escrow', label: 'sphere.escrow()' },
      { id: 'api-msg', label: 'sphere.msg()' },
      { id: 'api-on-msg', label: 'sphere.on.msg()' },
      { id: 'api-intent', label: 'sphere.intent()' },
      { id: 'api-discover', label: 'sphere.discover()' },
      { id: 'api-invoke', label: 'sphere.invoke()' },
      { id: 'api-advertise', label: 'sphere.advertise()' },
    ],
  },
  {
    id: 'guides',
    label: 'Guides',
    children: [
      { id: 'guide-marketplace', label: 'Building a Marketplace' },
      { id: 'guide-agent-communication', label: 'Agent-to-Agent Communication' },
      { id: 'guide-security', label: 'Security Best Practices' },
    ],
  },
  {
    id: 'examples',
    label: 'Examples',
    children: [
      { id: 'example-payment', label: 'Simple Payment' },
      { id: 'example-marketplace', label: 'P2P Marketplace' },
      { id: 'example-ai-agent', label: 'AI Agent Integration' },
    ],
  },
];

const inPreparationSections: Section[] = [
  'api-escrow',
  'api-intent',
  'api-discover',
  'api-invoke',
  'api-advertise',
  'guide-agent-communication',
  'guide-security',
  'example-ai-agent',
];

function CodeBlock({ code, filename, language = 'typescript' }: { code: string; filename?: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-neutral-900 rounded-xl overflow-hidden my-4">
      <div className="flex justify-between items-center px-4 py-2 border-b border-neutral-700">
        <span className="text-xs text-neutral-400 font-mono">{filename || language}</span>
        <button
          onClick={copyToClipboard}
          className="text-xs text-neutral-400 hover:text-white transition"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 text-sm overflow-x-auto">
        <code className="text-amber-400">{code}</code>
      </pre>
    </div>
  );
}

function InPreparationBadge() {
  return (
    <span className="inline-flex items-center px-2 py-1 text-xs bg-purple-500/10 text-purple-500 border border-purple-500/30 rounded-full ml-2">
      In Preparation
    </span>
  );
}

function ParamTable({ params }: { params: { name: string; type: string; description: string; required?: boolean }[] }) {
  return (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-neutral-500 border-b border-neutral-200 dark:border-neutral-700">
            <th className="pb-2 pr-4">Parameter</th>
            <th className="pb-2 pr-4">Type</th>
            <th className="pb-2">Description</th>
          </tr>
        </thead>
        <tbody>
          {params.map((p, i) => (
            <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
              <td className="py-2 pr-4">
                <code className="text-amber-600 dark:text-amber-400">{p.name}</code>
                {p.required && <span className="text-red-500 ml-1">*</span>}
              </td>
              <td className="py-2 pr-4 text-neutral-600 dark:text-neutral-400 font-mono text-xs">{p.type}</td>
              <td className="py-2 text-neutral-600 dark:text-neutral-400">{p.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocsPage() {
  const [activeSection, setActiveSection] = useState<Section>('getting-started');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<Section>>(new Set(['getting-started', 'api-reference']));

  useEffect(() => {
    const handleScroll = () => {
      const sections = document.querySelectorAll('[data-section]');
      let currentSection: Section = 'getting-started';

      sections.forEach((section) => {
        const rect = section.getBoundingClientRect();
        if (rect.top <= 100) {
          currentSection = section.getAttribute('data-section') as Section;
        }
      });

      setActiveSection(currentSection);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (id: Section) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(id);
      setMobileNavOpen(false);
    }
  };

  const toggleSection = (id: Section) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const isInPreparation = (id: Section) => inPreparationSections.includes(id);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen text-neutral-900 dark:text-white relative z-0"
    >
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileNavOpen(!mobileNavOpen)}
        className="lg:hidden fixed top-16 left-4 z-30 p-2 bg-white/80 dark:bg-neutral-800/80 backdrop-blur-lg rounded-lg border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {mobileNavOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-10 bg-black/50 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar - mobile: fixed to left edge, desktop: fixed but aligned with content */}
      <aside className={`
        fixed top-14 z-20 w-64 h-[calc(100vh-3.5rem)] overflow-y-auto
        backdrop-blur-lg lg:backdrop-blur-none border-r border-neutral-200/50 dark:border-neutral-800/50 lg:border-0
        transform transition-transform
        ${mobileNavOpen ? 'left-0 translate-x-0' : '-translate-x-full lg:translate-x-0'}
        lg:left-[max(1rem,calc((100vw-80rem)/2))]
        p-4 lg:py-8 lg:pr-8
      `}>
          <nav className="space-y-1">
            {navigation.map((item) => (
              <div key={item.id}>
                <button
                  onClick={() => {
                    if (item.children) {
                      toggleSection(item.id);
                    } else {
                      scrollToSection(item.id);
                    }
                  }}
                  className={`
                    w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition
                    ${activeSection === item.id || item.children?.some(c => c.id === activeSection)
                      ? 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800'}
                  `}
                >
                  <span>{item.label}</span>
                  {item.children && (
                    <svg
                      className={`w-4 h-4 transition-transform ${expandedSections.has(item.id) ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
                {item.children && expandedSections.has(item.id) && (
                  <div className="ml-4 mt-1 space-y-1">
                    {item.children.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => scrollToSection(child.id)}
                        className={`
                          w-full flex items-center px-3 py-1.5 text-sm rounded-lg transition
                          ${activeSection === child.id
                            ? 'text-orange-600 dark:text-orange-400'
                            : 'text-neutral-500 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-white'}
                        `}
                      >
                        <span>{child.label}</span>
                        {isInPreparation(child.id) && (
                          <span className="ml-2 w-2 h-2 rounded-full bg-purple-500"></span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 lg:pl-72">
          {/* Getting Started */}
          <section id="getting-started" data-section="getting-started" className="mb-16">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">
              Sphere SDK
              <span className="ml-3 text-sm font-normal text-neutral-500">v1.0.0</span>
            </h1>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 mb-8 max-w-2xl">
              Build marketplaces where humans and AI agents trade anything. No blockchain expertise required.
            </p>

            <div id="installation" data-section="installation" className="scroll-mt-24 mb-12">
              <h2 className="text-2xl font-bold mb-4">Installation</h2>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Install the Sphere SDK using npm, yarn, or pnpm:
              </p>
              <CodeBlock code="npm install @agentsphere/sdk" filename="terminal" />
              <p className="text-neutral-600 dark:text-neutral-400 mt-4">
                Or with yarn:
              </p>
              <CodeBlock code="yarn add @agentsphere/sdk" filename="terminal" />
            </div>

            <div id="quick-start" data-section="quick-start" className="scroll-mt-24">
              <h2 className="text-2xl font-bold mb-4">Quick Start</h2>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Get started with Sphere in just a few lines of code:
              </p>
              <CodeBlock
                filename="app.ts"
                code={`import { Sphere } from '@agentsphere/sdk';

// Initialize with your mnemonic
const sphere = await Sphere.init({
  mode: 'trusted',
  mnemonic: 'abandon badge cable drama ...'
});

// Your Unicity address - derived from your keypair
console.log(sphere.address); // "unicity:0x8f3a..."

// Send tokens to anyone
await sphere.send("USDC", 100, "@merchant");

// Listen for incoming transfers
sphere.on.receive((transfer) => {
  console.log(\`Received \${transfer.amount} \${transfer.token} from \${transfer.from}\`);
});`}
              />
            </div>
          </section>

          {/* Core Concepts */}
          <section id="core-concepts" data-section="core-concepts" className="mb-16">
            <h2 className="text-2xl font-bold mb-6 pb-2 border-b border-neutral-200 dark:border-neutral-700">
              Core Concepts
            </h2>

            <div id="identity" data-section="identity" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">Identity & Authentication</h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Sphere uses cryptographic identity instead of API keys. Your private key <strong>IS</strong> your identity.
                This means:
              </p>
              <ul className="list-disc list-inside text-neutral-600 dark:text-neutral-400 space-y-2 mb-4">
                <li>No registration or API key management</li>
                <li>Self-authenticated - prove you are who you say you are cryptographically</li>
                <li>Portable across any application or platform</li>
                <li>BIP32 HD wallet support for generating multiple addresses from a single seed</li>
              </ul>

              <h4 className="font-semibold text-lg mt-6 mb-3">Trusted vs Untrusted Mode</h4>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-4 border border-neutral-200 dark:border-neutral-700">
                  <h5 className="font-medium mb-2 text-emerald-600 dark:text-emerald-400">Trusted Mode</h5>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
                    For browser applications where the user controls their keys locally.
                  </p>
                  <CodeBlock
                    code={`const sphere = await Sphere.init({
  mode: 'trusted',
  mnemonic: 'your seed phrase...'
});`}
                  />
                </div>
                <div className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-4 border border-neutral-200 dark:border-neutral-700">
                  <h5 className="font-medium mb-2 text-violet-600 dark:text-violet-400">Untrusted Mode</h5>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3">
                    For server agents - transactions are tunneled to the browser for signing.
                  </p>
                  <CodeBlock
                    code={`const sphere = await Sphere.init({
  mode: 'untrusted',
  remoteUnicityId: 'unicity:0x8f3a...'
});`}
                  />
                </div>
              </div>
            </div>

            <div id="addresses" data-section="addresses" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">Unicity Addresses</h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Every identity on the Unicity network has a unique address derived from their public key.
                Addresses follow the format:
              </p>
              <CodeBlock code='unicity:0x{40-character-hex}' filename="format" />
              <p className="text-neutral-600 dark:text-neutral-400 mt-4">
                Example: <code className="text-amber-600 dark:text-amber-400">unicity:0x8f3a7b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a</code>
              </p>
              <p className="text-neutral-600 dark:text-neutral-400 mt-4">
                Addresses are deterministic - the same keypair will always produce the same address.
                This allows for trustless identity verification across the network.
              </p>
            </div>

            <div id="nametags" data-section="nametags" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">Nametags (@username)</h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Nametags are human-readable aliases for Unicity addresses. Instead of using long hex addresses,
                you can use simple usernames:
              </p>
              <CodeBlock
                code={`// Using nametag instead of hex address
await sphere.send("USDC", 100, "@alice");

// Both work the same:
await sphere.send("USDC", 100, "unicity:0x8f3a7b2c...");
await sphere.send("USDC", 100, "@alice");`}
                filename="nametags.ts"
              />
              <p className="text-neutral-600 dark:text-neutral-400 mt-4">
                Nametags are resolved via the Unicity registry and are globally unique.
                Register your nametag once to use it across all applications.
              </p>
            </div>

            <div id="token-model" data-section="token-model" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">Token Model</h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Tokens on Unicity are cryptographic assets that can represent any value: currencies,
                collectibles, tickets, or any other asset class. Key features:
              </p>
              <ul className="list-disc list-inside text-neutral-600 dark:text-neutral-400 space-y-2">
                <li><strong>Instant settlement</strong> - no waiting for block confirmations</li>
                <li><strong>No gas fees</strong> - transactions are off-chain with on-chain finality</li>
                <li><strong>Atomic transfers</strong> - transfers either complete fully or not at all</li>
                <li><strong>P2P native</strong> - send directly to recipients without intermediaries</li>
              </ul>
            </div>
          </section>

          {/* API Reference */}
          <section id="api-reference" data-section="api-reference" className="mb-16">
            <h2 className="text-2xl font-bold mb-6 pb-2 border-b border-neutral-200 dark:border-neutral-700">
              API Reference
            </h2>

            {/* Sphere.init() */}
            <div id="api-init" data-section="api-init" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                <code className="text-amber-600 dark:text-amber-400">Sphere.init(options)</code>
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Initializes a new Sphere instance with the provided configuration. This is the entry point for all SDK operations.
              </p>

              <h4 className="font-medium text-lg mt-6 mb-3">Signature</h4>
              <CodeBlock
                code={`static async init(options: InitOptions): Promise<Sphere>`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Parameters</h4>
              <ParamTable
                params={[
                  { name: 'mode', type: "'trusted' | 'untrusted'", description: 'Determines key management strategy', required: true },
                  { name: 'mnemonic', type: 'string', description: 'BIP39 mnemonic phrase (required for trusted mode)' },
                  { name: 'remoteUnicityId', type: 'string', description: 'Remote signing address (required for untrusted mode)' },
                  { name: 'addressIndex', type: 'number', description: 'BIP44 derivation index (default: 0)' },
                ]}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Returns</h4>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                <code className="text-amber-600 dark:text-amber-400">Promise&lt;Sphere&gt;</code> - A configured Sphere instance ready for operations.
              </p>

              <h4 className="font-medium text-lg mt-6 mb-3">Example</h4>
              <CodeBlock
                filename="init-example.ts"
                code={`import { Sphere } from '@agentsphere/sdk';

// Trusted mode - browser with local keys
const sphere = await Sphere.init({
  mode: 'trusted',
  mnemonic: 'abandon badge cable drama eager fabric ...',
  addressIndex: 0
});

console.log(sphere.address); // "unicity:0x8f3a7b2c..."

// Untrusted mode - server agent with remote signing
const serverSphere = await Sphere.init({
  mode: 'untrusted',
  remoteUnicityId: 'unicity:0x8f3a7b2c...'
});`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Related</h4>
              <p className="text-neutral-600 dark:text-neutral-400">
                <button onClick={() => scrollToSection('api-send')} className="text-orange-600 dark:text-orange-400 hover:underline">sphere.send()</button>,{' '}
                <button onClick={() => scrollToSection('api-getbalance')} className="text-orange-600 dark:text-orange-400 hover:underline">sphere.getBalance()</button>
              </p>
            </div>

            {/* sphere.send() */}
            <div id="api-send" data-section="api-send" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                <code className="text-amber-600 dark:text-amber-400">sphere.send(token, amount, recipient)</code>
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Sends tokens to a recipient. Supports both nametags (@username) and raw Unicity addresses.
              </p>

              <h4 className="font-medium text-lg mt-6 mb-3">Signature</h4>
              <CodeBlock
                code={`async send(token: string, amount: number, recipient: string): Promise<TransferResult>`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Parameters</h4>
              <ParamTable
                params={[
                  { name: 'token', type: 'string', description: 'Token symbol (e.g., "USDC", "ALPHA")', required: true },
                  { name: 'amount', type: 'number', description: 'Amount to send', required: true },
                  { name: 'recipient', type: 'string', description: '@nametag or unicity:0x... address', required: true },
                ]}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Returns</h4>
              <p className="text-neutral-600 dark:text-neutral-400 mb-2">
                <code className="text-amber-600 dark:text-amber-400">Promise&lt;TransferResult&gt;</code>
              </p>
              <CodeBlock
                code={`interface TransferResult {
  txId: string;          // Transaction ID
  status: 'success' | 'pending' | 'failed';
  timestamp: number;     // Unix timestamp
  inclusionProof?: string; // Proof of inclusion in aggregator
}`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Example</h4>
              <CodeBlock
                filename="send-example.ts"
                code={`// Send using nametag
const result = await sphere.send("USDC", 100, "@merchant");
console.log(\`Transaction \${result.txId} - \${result.status}\`);

// Send using raw address
await sphere.send("ALPHA", 50, "unicity:0x8f3a7b2c1d4e5f6a...");

// Send with error handling
try {
  await sphere.send("USDC", 1000, "@seller");
} catch (error) {
  if (error.code === 'INSUFFICIENT_BALANCE') {
    console.log('Not enough tokens');
  }
}`}
              />
            </div>

            {/* sphere.getBalance() */}
            <div id="api-getbalance" data-section="api-getbalance" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                <code className="text-amber-600 dark:text-amber-400">sphere.getBalance(token?)</code>
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Retrieves the balance for a specific token or all tokens.
              </p>

              <h4 className="font-medium text-lg mt-6 mb-3">Signature</h4>
              <CodeBlock
                code={`async getBalance(token?: string): Promise<Balance | BalanceMap>`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Parameters</h4>
              <ParamTable
                params={[
                  { name: 'token', type: 'string', description: 'Token symbol. If omitted, returns all balances.' },
                ]}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Returns</h4>
              <CodeBlock
                code={`// Single token
interface Balance {
  token: string;
  amount: number;
  available: number;  // Amount not in escrow
  escrowed: number;   // Amount in active escrows
}

// All tokens
type BalanceMap = Record<string, Balance>;`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Example</h4>
              <CodeBlock
                filename="balance-example.ts"
                code={`// Get specific token balance
const usdcBalance = await sphere.getBalance("USDC");
console.log(\`USDC: \${usdcBalance.amount} (available: \${usdcBalance.available})\`);

// Get all balances
const allBalances = await sphere.getBalance();
for (const [token, balance] of Object.entries(allBalances)) {
  console.log(\`\${token}: \${balance.amount}\`);
}`}
              />
            </div>

            {/* sphere.on.receive() */}
            <div id="api-on-receive" data-section="api-on-receive" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                <code className="text-amber-600 dark:text-amber-400">sphere.on.receive(callback)</code>
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Subscribes to incoming token transfers. The callback is invoked whenever tokens are received.
              </p>

              <h4 className="font-medium text-lg mt-6 mb-3">Signature</h4>
              <CodeBlock
                code={`on.receive(callback: (transfer: IncomingTransfer) => void): Unsubscribe`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Callback Parameter</h4>
              <CodeBlock
                code={`interface IncomingTransfer {
  txId: string;       // Transaction ID
  token: string;      // Token symbol
  amount: number;     // Amount received
  from: string;       // Sender's Unicity address
  fromNametag?: string; // Sender's nametag if available
  timestamp: number;  // Unix timestamp
}`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Returns</h4>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                <code className="text-amber-600 dark:text-amber-400">Unsubscribe</code> - Function to call to stop listening.
              </p>

              <h4 className="font-medium text-lg mt-6 mb-3">Example</h4>
              <CodeBlock
                filename="receive-example.ts"
                code={`// Listen for incoming transfers
const unsubscribe = sphere.on.receive((transfer) => {
  console.log(\`Received \${transfer.amount} \${transfer.token}\`);
  console.log(\`From: \${transfer.fromNametag || transfer.from}\`);

  // Auto-acknowledge
  if (transfer.amount > 100) {
    sphere.msg(transfer.from, { type: 'thanks', for: transfer.txId });
  }
});

// Later, stop listening
unsubscribe();`}
              />
            </div>

            {/* sphere.escrow() */}
            <div id="api-escrow" data-section="api-escrow" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                <code className="text-amber-600 dark:text-amber-400">sphere.escrow(options)</code>
                <InPreparationBadge />
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Creates an escrow for conditional token transfers. Funds are locked until release conditions are met.
              </p>

              <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 rounded-xl p-4 mb-4">
                <p className="text-purple-700 dark:text-purple-400 text-sm">
                  This feature is under active development and will be available soon.
                </p>
              </div>

              <h4 className="font-medium text-lg mt-6 mb-3">Proposed Signature</h4>
              <CodeBlock
                code={`async escrow(options: EscrowOptions): Promise<Escrow>`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Proposed Parameters</h4>
              <ParamTable
                params={[
                  { name: 'token', type: 'string', description: 'Token symbol', required: true },
                  { name: 'amount', type: 'number', description: 'Amount to escrow', required: true },
                  { name: 'to', type: 'string', description: 'Recipient address or nametag', required: true },
                  { name: 'releaseCondition', type: 'string', description: 'Condition for release' },
                  { name: 'expiresAt', type: 'number', description: 'Expiration timestamp' },
                ]}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Proposed Usage</h4>
              <CodeBlock
                filename="escrow-example.ts"
                code={`// Create an escrow
const escrow = await sphere.escrow({
  token: "USDC",
  amount: 5000,
  to: "@seller",
  releaseCondition: "delivery_confirmed",
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
});

// Release funds when condition is met
await escrow.release();

// Or refund if needed
await escrow.refund();

// Check escrow status
console.log(escrow.status); // 'active' | 'released' | 'refunded' | 'expired'`}
              />
            </div>

            {/* sphere.msg() */}
            <div id="api-msg" data-section="api-msg" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                <code className="text-amber-600 dark:text-amber-400">sphere.msg(recipient, payload)</code>
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Sends an encrypted P2P message to a recipient via Nostr. Messages can contain structured data.
              </p>

              <h4 className="font-medium text-lg mt-6 mb-3">Signature</h4>
              <CodeBlock
                code={`async msg(recipient: string, payload: object): Promise<void>`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Parameters</h4>
              <ParamTable
                params={[
                  { name: 'recipient', type: 'string', description: '@nametag or unicity:0x... address', required: true },
                  { name: 'payload', type: 'object', description: 'Structured message data', required: true },
                ]}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Example</h4>
              <CodeBlock
                filename="msg-example.ts"
                code={`// Send an offer
await sphere.msg("@alice", {
  type: "offer",
  item: "PSA-10-charizard",
  price: 12000,
  currency: "USDC",
  validUntil: Date.now() + 3600000 // 1 hour
});

// Send order confirmation
await sphere.msg("@buyer", {
  type: "order_confirmed",
  orderId: "ORD-12345",
  estimatedDelivery: "2025-01-15"
});`}
              />
            </div>

            {/* sphere.on.msg() */}
            <div id="api-on-msg" data-section="api-on-msg" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                <code className="text-amber-600 dark:text-amber-400">sphere.on.msg(callback)</code>
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Subscribes to incoming messages. Messages are end-to-end encrypted via NIP-17.
              </p>

              <h4 className="font-medium text-lg mt-6 mb-3">Signature</h4>
              <CodeBlock
                code={`on.msg(callback: (msg: IncomingMessage) => void): Unsubscribe`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Callback Parameter</h4>
              <CodeBlock
                code={`interface IncomingMessage {
  from: string;        // Sender's Unicity address
  fromNametag?: string; // Sender's nametag if available
  payload: object;     // Message content
  timestamp: number;   // Unix timestamp
}`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Example</h4>
              <CodeBlock
                filename="on-msg-example.ts"
                code={`sphere.on.msg(async (msg) => {
  console.log(\`Message from \${msg.fromNametag || msg.from}\`);

  if (msg.payload.type === "offer") {
    // Evaluate and respond to offer
    if (msg.payload.price >= 10000) {
      await sphere.msg(msg.from, { type: "accepted", offerId: msg.payload.id });
      // Proceed with payment
    } else {
      await sphere.msg(msg.from, { type: "rejected", reason: "price_too_low" });
    }
  }
});`}
              />
            </div>

            {/* sphere.intent() */}
            <div id="api-intent" data-section="api-intent" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                <code className="text-amber-600 dark:text-amber-400">sphere.intent(action, params)</code>
                <InPreparationBadge />
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Registers a high-level intent for autonomous matching with other agents or services.
              </p>

              <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 rounded-xl p-4 mb-4">
                <p className="text-purple-700 dark:text-purple-400 text-sm">
                  This feature is under active development and will be available soon.
                </p>
              </div>

              <h4 className="font-medium text-lg mt-6 mb-3">Proposed Usage</h4>
              <CodeBlock
                filename="intent-example.ts"
                code={`// Register a buying intent
const intent = await sphere.intent("buy", {
  category: "tickets",
  event: "World Cup 2026",
  maxPrice: 2000,
  currency: "USDC"
});

// Handle matches
intent.onMatch((match) => {
  console.log(\`Found: \${match.description} - \${match.price} \${match.currency}\`);
  match.approve(); // Auto-execute the match
});

// Cancel the intent
await intent.cancel();`}
              />
            </div>

            {/* sphere.discover() */}
            <div id="api-discover" data-section="api-discover" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                <code className="text-amber-600 dark:text-amber-400">sphere.discover(query)</code>
                <InPreparationBadge />
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Discovers agents or services that match a given query.
              </p>

              <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 rounded-xl p-4 mb-4">
                <p className="text-purple-700 dark:text-purple-400 text-sm">
                  This feature is under active development and will be available soon.
                </p>
              </div>

              <h4 className="font-medium text-lg mt-6 mb-3">Proposed Usage</h4>
              <CodeBlock
                filename="discover-example.ts"
                code={`// Discover ticket resellers
const sellers = await sphere.discover("ticket resellers", {
  category: "sports",
  rating: { min: 4.5 }
});

console.log(\`Found \${sellers.length} sellers\`);
sellers.forEach(seller => {
  console.log(\`\${seller.nametag}: \${seller.description}\`);
});`}
              />
            </div>

            {/* sphere.invoke() */}
            <div id="api-invoke" data-section="api-invoke" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                <code className="text-amber-600 dark:text-amber-400">sphere.invoke(agentId, action, params)</code>
                <InPreparationBadge />
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Directly invokes an action on another agent or service.
              </p>

              <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 rounded-xl p-4 mb-4">
                <p className="text-purple-700 dark:text-purple-400 text-sm">
                  This feature is under active development and will be available soon.
                </p>
              </div>

              <h4 className="font-medium text-lg mt-6 mb-3">Proposed Usage</h4>
              <CodeBlock
                filename="invoke-example.ts"
                code={`// Invoke a specific seller
const result = await sphere.invoke("@ticket-dealer", "buy", {
  item: "World Cup final ticket",
  maxPrice: 2000,
  currency: "USDC"
});

if (result.status === "success") {
  console.log(\`Purchased ticket: \${result.ticketId}\`);
}`}
              />
            </div>

            {/* sphere.advertise() */}
            <div id="api-advertise" data-section="api-advertise" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                <code className="text-amber-600 dark:text-amber-400">sphere.advertise(capabilities)</code>
                <InPreparationBadge />
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Advertises your agent's capabilities for discovery by other agents.
              </p>

              <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 rounded-xl p-4 mb-4">
                <p className="text-purple-700 dark:text-purple-400 text-sm">
                  This feature is under active development and will be available soon.
                </p>
              </div>

              <h4 className="font-medium text-lg mt-6 mb-3">Proposed Usage</h4>
              <CodeBlock
                filename="advertise-example.ts"
                code={`// Advertise as a collectibles seller
sphere.advertise({
  capabilities: ["sell_collectibles", "buy_collectibles"],
  categories: ["trading-cards", "sports-memorabilia"],
  fee: { currency: "USDC", percent: 2.5 },
  description: "Verified seller of rare trading cards and memorabilia"
});`}
              />
            </div>
          </section>

          {/* Guides */}
          <section id="guides" data-section="guides" className="mb-16">
            <h2 className="text-2xl font-bold mb-6 pb-2 border-b border-neutral-200 dark:border-neutral-700">
              Guides
            </h2>

            <div id="guide-marketplace" data-section="guide-marketplace" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">Building a Marketplace</h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                This guide shows you how to build a complete P2P marketplace with listings, offers,
                negotiation, and escrow - all in about 25 lines of code.
              </p>

              <h4 className="font-medium text-lg mt-6 mb-3">Step 1: Initialize Your Agent</h4>
              <CodeBlock
                filename="marketplace.ts"
                code={`import { Sphere } from '@agentsphere/sdk';

const sphere = await Sphere.init({
  mode: 'trusted',
  mnemonic: process.env.WALLET_MNEMONIC
});

console.log(\`Marketplace agent ready: \${sphere.address}\`);`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Step 2: Create Listings</h4>
              <CodeBlock
                code={`async function createListing(item: string, price: number, currency: string) {
  const listing = {
    id: crypto.randomUUID(),
    item,
    price,
    currency,
    seller: sphere.address,
    createdAt: Date.now()
  };

  // Store listing (use your preferred storage)
  await saveListing(listing);

  return listing;
}

// Create a listing
const listing = await createListing("PSA-10 Charizard", 12000, "USDC");`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Step 3: Handle Offers</h4>
              <CodeBlock
                code={`sphere.on.msg(async (msg) => {
  if (msg.payload.type === "offer") {
    const listing = await getListing(msg.payload.listingId);

    if (msg.payload.price >= listing.price) {
      // Accept the offer
      await sphere.msg(msg.from, {
        type: "accepted",
        listingId: listing.id,
        price: msg.payload.price
      });
    } else {
      // Counter-offer or reject
      await sphere.msg(msg.from, {
        type: "counter",
        listingId: listing.id,
        price: listing.price * 0.95 // 5% discount
      });
    }
  }
});`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Step 4: Complete the Sale</h4>
              <CodeBlock
                code={`sphere.on.receive(async (transfer) => {
  // Check if this is for a pending sale
  const sale = await getPendingSale(transfer.from);

  if (sale && transfer.amount >= sale.price) {
    // Payment received - finalize the sale
    await finalizeSale(sale);

    // Send confirmation
    await sphere.msg(transfer.from, {
      type: "sale_complete",
      orderId: sale.id,
      item: sale.item
    });
  }
});`}
              />

              <h4 className="font-medium text-lg mt-6 mb-3">Complete Example</h4>
              <CodeBlock
                filename="marketplace.ts"
                code={`// Initialize with your keypair (no API key needed!)
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

// That's it. You have a marketplace.`}
              />
            </div>

            <div id="guide-agent-communication" data-section="guide-agent-communication" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                Agent-to-Agent Communication
                <InPreparationBadge />
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Learn how to build AI agents that communicate, negotiate, and transact with each other autonomously.
              </p>
              <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 rounded-xl p-4">
                <p className="text-purple-700 dark:text-purple-400 text-sm">
                  This guide is under active development and will be available soon.
                </p>
              </div>
            </div>

            <div id="guide-security" data-section="guide-security" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                Security Best Practices
                <InPreparationBadge />
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Essential security practices for building production applications with the Sphere SDK.
              </p>
              <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 rounded-xl p-4">
                <p className="text-purple-700 dark:text-purple-400 text-sm">
                  This guide is under active development and will be available soon.
                </p>
              </div>
            </div>
          </section>

          {/* Examples */}
          <section id="examples" data-section="examples" className="mb-16">
            <h2 className="text-2xl font-bold mb-6 pb-2 border-b border-neutral-200 dark:border-neutral-700">
              Examples
            </h2>

            <div id="example-payment" data-section="example-payment" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">Simple Payment</h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                A minimal example showing how to send and receive payments.
              </p>
              <CodeBlock
                filename="simple-payment.ts"
                code={`import { Sphere } from '@agentsphere/sdk';

async function main() {
  // Initialize
  const sphere = await Sphere.init({
    mode: 'trusted',
    mnemonic: process.env.MNEMONIC
  });

  // Check balance
  const balance = await sphere.getBalance("USDC");
  console.log(\`USDC Balance: \${balance.amount}\`);

  // Send payment
  if (balance.amount >= 100) {
    const result = await sphere.send("USDC", 100, "@recipient");
    console.log(\`Sent! Transaction: \${result.txId}\`);
  }

  // Listen for incoming payments
  sphere.on.receive((transfer) => {
    console.log(\`Received \${transfer.amount} \${transfer.token} from \${transfer.from}\`);
  });
}

main();`}
              />
            </div>

            <div id="example-marketplace" data-section="example-marketplace" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">P2P Marketplace</h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                A complete peer-to-peer marketplace with listings, offers, and automatic negotiation.
              </p>
              <CodeBlock
                filename="p2p-marketplace.ts"
                code={`import { Sphere } from '@agentsphere/sdk';

interface Listing {
  id: string;
  item: string;
  price: number;
  currency: string;
  seller: string;
}

const listings: Map<string, Listing> = new Map();

async function main() {
  const sphere = await Sphere.init({
    mode: 'trusted',
    mnemonic: process.env.MNEMONIC
  });

  // Create a listing
  function createListing(item: string, price: number) {
    const listing: Listing = {
      id: crypto.randomUUID(),
      item,
      price,
      currency: "USDC",
      seller: sphere.address
    };
    listings.set(listing.id, listing);
    console.log(\`Created listing: \${item} for \${price} USDC\`);
    return listing;
  }

  // Handle incoming offers
  sphere.on.msg(async (msg) => {
    const payload = msg.payload as any;

    switch (payload.type) {
      case "offer":
        const listing = listings.get(payload.listingId);
        if (!listing) return;

        if (payload.price >= listing.price) {
          await sphere.msg(msg.from, {
            type: "accepted",
            listingId: listing.id,
            price: payload.price
          });
        } else if (payload.price >= listing.price * 0.9) {
          // Accept offers within 10%
          await sphere.msg(msg.from, {
            type: "counter",
            listingId: listing.id,
            price: listing.price * 0.95
          });
        } else {
          await sphere.msg(msg.from, {
            type: "rejected",
            listingId: listing.id,
            reason: "Price too low"
          });
        }
        break;

      case "accepted":
        console.log(\`Offer accepted! Sending payment...\`);
        await sphere.send("USDC", payload.price, msg.from);
        break;
    }
  });

  // Handle payments
  sphere.on.receive(async (transfer) => {
    console.log(\`Payment received: \${transfer.amount} \${transfer.token}\`);
    await sphere.msg(transfer.from, {
      type: "payment_confirmed",
      amount: transfer.amount,
      txId: transfer.txId
    });
  });

  // Example: Create some listings
  createListing("Vintage Rolex Submariner", 15000);
  createListing("PSA-10 Charizard", 12000);

  console.log("Marketplace running...");
}

main();`}
              />
            </div>

            <div id="example-ai-agent" data-section="example-ai-agent" className="scroll-mt-24 mb-12">
              <h3 className="text-xl font-semibold mb-4">
                AI Agent Integration
                <InPreparationBadge />
              </h3>
              <p className="text-neutral-600 dark:text-neutral-400 mb-4">
                Build an AI agent that can autonomously trade and negotiate on behalf of users.
              </p>
              <div className="bg-purple-50 dark:bg-purple-500/10 border border-purple-200 dark:border-purple-500/30 rounded-xl p-4">
                <p className="text-purple-700 dark:text-purple-400 text-sm">
                  This example is under active development and will be available soon.
                </p>
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="border-t border-neutral-200 dark:border-neutral-700 pt-8 mt-16">
            <div className="flex flex-wrap gap-6 text-sm text-neutral-600 dark:text-neutral-400 mb-6">
              <a href="https://discord.gg/S9f57ZKdt" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 transition">
                Discord
              </a>
              <a href="https://github.com/unicitynetwork" target="_blank" rel="noopener noreferrer" className="hover:text-orange-500 transition">
                GitHub
              </a>
              <Link to="/developers" className="hover:text-orange-500 transition">
                Developer Portal
              </Link>
            </div>
            <p className="text-sm text-neutral-500">
              AgentSphere by Unicity Labs
            </p>
          </footer>
        </main>
    </motion.div>
  );
}
