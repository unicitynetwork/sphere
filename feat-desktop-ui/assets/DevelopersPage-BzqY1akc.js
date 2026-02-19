import{r as m,j as e,m as n,L as o}from"./index-O1K5B1Sn.js";function h(){const[t,x]=m.useState("init"),[l,c]=m.useState(null),i=(r,s)=>{navigator.clipboard.writeText(r),c(s),setTimeout(()=>c(null),2e3)},a={init:{icon:"🔑",title:"Initialization",tagline:"Your key is your identity.",description:"Provider-based architecture. Your BIP39 mnemonic IS your identity. Auto-creates or loads existing wallets.",color:"from-emerald-500 to-teal-500",code:"const { sphere } = await Sphere.init({ ...providers, mnemonic: '...' });",fullExample:`import { Sphere } from '@unicitylabs/sphere-sdk';
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
console.log('Ready:', sphere.isReady);`,features:["Provider-based","BIP39 HD wallets","Auto-load or create","Multi-address"]},payments:{icon:"⚡",title:"Payments",tagline:"L3 instant. L1 on-chain.",description:"Send tokens to anyone via @nametag or address. Instant P2P settlement on Layer 3, ALPHA blockchain on Layer 1.",color:"from-orange-500 to-amber-500",code:"await sphere.payments.send({ recipient: '@merchant', amount: '100', coinId });",fullExample:`// Send tokens (use @nametag or direct address)
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
console.log('L1 confirmed:', l1Balance.confirmed);`,features:["L3 instant settlement","L1 ALPHA blockchain","Payment requests","Nametag support"]},communication:{icon:"💬",title:"Communication",tagline:"Message anyone. Human or agent.",description:"End-to-end encrypted direct messages via Nostr. NIP-29 group chat. Broadcast to topics.",color:"from-violet-500 to-purple-500",code:"await sphere.communications.sendDM('@alice', 'Hello!');",fullExample:`// Send a direct message (encrypted via Nostr)
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
});`,features:["End-to-end encrypted","P2P via Nostr","Group chat (NIP-29)","Broadcast messages"]},market:{icon:"🛒",title:"Market",tagline:"Post intents. Find matches.",description:"Intent bulletin board for buy/sell/service intents. Semantic search. Live WebSocket feed.",color:"from-cyan-500 to-blue-500",code:"await sphere.market.postIntent({ description: '...', intentType: 'sell' });",fullExample:`// Post a sell intent
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
const myIntents = await sphere.market.getMyIntents();`,features:["Intent bulletin board","Semantic search","Live WebSocket feed","Buy/sell/service intents"]}},d=`import { Sphere } from '@unicitylabs/sphere-sdk';
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
});`;return e.jsxs(n.div,{initial:{opacity:0},animate:{opacity:1},className:"text-neutral-900 dark:text-white",children:[e.jsx("section",{className:"px-4 sm:px-6 py-12 sm:py-16 text-center",children:e.jsxs("div",{className:"max-w-4xl mx-auto",children:[e.jsxs(n.h1,{initial:{opacity:0,y:20},animate:{opacity:1,y:0},className:"text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 leading-tight",children:["One SDK.",e.jsx("br",{}),e.jsx("span",{className:"bg-linear-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent",children:"Infinite Marketplaces."})]}),e.jsx(n.p,{initial:{opacity:0,y:20},animate:{opacity:1,y:0},transition:{delay:.1},className:"text-lg sm:text-xl text-neutral-600 dark:text-neutral-400 mb-8 sm:mb-10 max-w-2xl mx-auto",children:"You don't need a blockchain team. If you can call an API, you can build a marketplace where humans and agents trade anything."}),e.jsxs(n.div,{initial:{opacity:0,y:20},animate:{opacity:1,y:0},transition:{delay:.2},className:"flex gap-4 justify-center flex-wrap",children:[e.jsx("button",{className:"bg-linear-to-r from-orange-500 to-amber-500 text-white px-6 py-3 rounded-xl font-semibold hover:opacity-90 transition shadow-lg shadow-orange-500/25",children:"Start Building"}),e.jsx(o,{to:"/developers/docs",className:"border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-white px-6 py-3 rounded-xl font-medium hover:border-neutral-400 dark:hover:border-neutral-500 transition",children:"Read Docs"})]})]})}),e.jsx("section",{className:"px-4 sm:px-6 py-8 sm:py-12",children:e.jsxs("div",{className:"max-w-6xl mx-auto",children:[e.jsx("div",{className:"grid md:grid-cols-4 gap-4 mb-8",children:Object.entries(a).map(([r,s])=>e.jsxs(n.button,{onClick:()=>x(r),whileHover:{scale:1.02},whileTap:{scale:.98},className:`p-5 sm:p-6 rounded-2xl border text-left transition-all ${t===r?"bg-white dark:bg-neutral-800 border-orange-500/50 shadow-lg shadow-orange-500/10":"bg-white/50 dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700/50 hover:border-neutral-300 dark:hover:border-neutral-600"}`,children:[e.jsx("div",{className:`w-12 h-12 rounded-xl bg-linear-to-br ${s.color} flex items-center justify-center text-2xl mb-4`,children:s.icon}),e.jsx("h3",{className:"font-semibold text-lg mb-1",children:s.title}),e.jsx("p",{className:"text-neutral-500 dark:text-neutral-400 text-sm",children:s.tagline})]},r))}),e.jsxs(n.div,{initial:{opacity:0,y:10},animate:{opacity:1,y:0},className:"bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-xl",children:[e.jsx("div",{className:"p-6 sm:p-8 border-b border-neutral-200 dark:border-neutral-700",children:e.jsxs("div",{className:"flex items-start justify-between flex-wrap gap-4",children:[e.jsxs("div",{children:[e.jsx("h2",{className:"text-xl sm:text-2xl font-bold mb-2",children:a[t].title}),e.jsx("p",{className:"text-neutral-600 dark:text-neutral-400 max-w-xl",children:a[t].description})]}),e.jsx("div",{className:"flex gap-2 flex-wrap",children:a[t].features.map((r,s)=>e.jsx("span",{className:"bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 text-xs px-3 py-1 rounded-full",children:r},s))})]})}),e.jsxs("div",{className:"p-4 sm:p-6 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-700",children:[e.jsxs("div",{className:"flex items-center justify-between mb-2",children:[e.jsx("span",{className:"text-xs text-neutral-500 uppercase tracking-wider",children:"The entire integration"}),e.jsx("button",{onClick:()=>i(a[t].code,"oneliner"),className:"text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-white transition",children:l==="oneliner"?"✓ Copied":"Copy"})]}),e.jsx("pre",{className:"text-base sm:text-lg font-mono overflow-x-auto",children:e.jsx("code",{className:"text-amber-600 dark:text-amber-400",children:a[t].code})})]}),e.jsxs("div",{className:"p-4 sm:p-6",children:[e.jsxs("div",{className:"flex items-center justify-between mb-3",children:[e.jsx("span",{className:"text-xs text-neutral-500 uppercase tracking-wider",children:"Full example"}),e.jsx("button",{onClick:()=>i(a[t].fullExample,"full"),className:"text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-white transition",children:l==="full"?"✓ Copied":"Copy"})]}),e.jsx("pre",{className:"text-sm font-mono text-neutral-700 dark:text-neutral-300 overflow-x-auto",children:e.jsx("code",{children:a[t].fullExample})})]})]},t)]})}),e.jsx("section",{className:"px-4 sm:px-6 py-12 sm:py-16",children:e.jsxs("div",{className:"max-w-6xl mx-auto",children:[e.jsxs("div",{className:"text-center mb-10 sm:mb-12",children:[e.jsx("h2",{className:"text-2xl sm:text-3xl font-bold mb-4",children:"A Complete Marketplace in 30 Lines"}),e.jsx("p",{className:"text-neutral-600 dark:text-neutral-400",children:"Intents, search, negotiation, payment. All of it."})]}),e.jsxs("div",{className:"bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden shadow-xl",children:[e.jsxs("div",{className:"flex items-center justify-between px-4 sm:px-6 py-4 border-b border-neutral-200 dark:border-neutral-700",children:[e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx("div",{className:"w-3 h-3 rounded-full bg-red-500"}),e.jsx("div",{className:"w-3 h-3 rounded-full bg-yellow-500"}),e.jsx("div",{className:"w-3 h-3 rounded-full bg-green-500"})]}),e.jsx("span",{className:"text-xs text-neutral-500 font-mono",children:"marketplace.ts"}),e.jsx("button",{onClick:()=>i(d,"marketplace"),className:"text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-white transition",children:l==="marketplace"?"✓ Copied":"Copy"})]}),e.jsx("pre",{className:"p-4 sm:p-6 text-sm font-mono text-neutral-700 dark:text-neutral-300 overflow-x-auto",children:e.jsx("code",{children:d})})]})]})}),e.jsx("section",{className:"px-4 sm:px-6 py-12 sm:py-16 bg-neutral-50 dark:bg-neutral-900/50 rounded-2xl",children:e.jsxs("div",{className:"max-w-4xl mx-auto",children:[e.jsx("h2",{className:"text-2xl sm:text-3xl font-bold text-center mb-10 sm:mb-12",children:"Why Build Here?"}),e.jsxs("div",{className:"grid md:grid-cols-2 gap-6 sm:gap-8",children:[e.jsxs("div",{className:"bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8",children:[e.jsx("h3",{className:"text-lg font-semibold mb-6 text-neutral-500 dark:text-neutral-400",children:"Traditional Stack"}),e.jsxs("ul",{className:"space-y-4 text-neutral-500",children:[e.jsxs("li",{className:"flex items-center gap-3",children:[e.jsx("span",{className:"text-red-400",children:"✗"})," API key management"]}),e.jsxs("li",{className:"flex items-center gap-3",children:[e.jsx("span",{className:"text-red-400",children:"✗"})," Gas fee estimation"]}),e.jsxs("li",{className:"flex items-center gap-3",children:[e.jsx("span",{className:"text-red-400",children:"✗"})," Wallet integration"]}),e.jsxs("li",{className:"flex items-center gap-3",children:[e.jsx("span",{className:"text-red-400",children:"✗"})," Payment rails"]}),e.jsxs("li",{className:"flex items-center gap-3",children:[e.jsx("span",{className:"text-red-400",children:"✗"})," Messaging infra"]}),e.jsxs("li",{className:"flex items-center gap-3",children:[e.jsx("span",{className:"text-red-400",children:"✗"})," Months to MVP"]})]})]}),e.jsxs("div",{className:"bg-linear-to-br from-orange-500/10 to-amber-500/10 dark:from-orange-500/20 dark:to-amber-500/10 rounded-2xl border border-orange-500/30 p-6 sm:p-8",children:[e.jsx("h3",{className:"text-lg font-semibold mb-6 text-orange-500",children:"Sphere SDK"}),e.jsxs("ul",{className:"space-y-4",children:[e.jsxs("li",{className:"flex items-center gap-3 text-neutral-700 dark:text-neutral-200",children:[e.jsx("span",{className:"text-green-500",children:"✓"})," Private key IS identity"]}),e.jsxs("li",{className:"flex items-center gap-3 text-neutral-700 dark:text-neutral-200",children:[e.jsx("span",{className:"text-green-500",children:"✓"})," Included (off-chain)"]}),e.jsxs("li",{className:"flex items-center gap-3 text-neutral-700 dark:text-neutral-200",children:[e.jsx("span",{className:"text-green-500",children:"✓"})," Unified Unicity ID"]}),e.jsxs("li",{className:"flex items-center gap-3 text-neutral-700 dark:text-neutral-200",children:[e.jsx("span",{className:"text-green-500",children:"✓"})," Just call ",e.jsx("code",{className:"text-amber-600 dark:text-amber-400 text-sm",children:"payments.send()"})]}),e.jsxs("li",{className:"flex items-center gap-3 text-neutral-700 dark:text-neutral-200",children:[e.jsx("span",{className:"text-green-500",children:"✓"})," Built-in P2P messaging"]}),e.jsxs("li",{className:"flex items-center gap-3 text-neutral-700 dark:text-neutral-200",children:[e.jsx("span",{className:"text-green-500",children:"✓"})," ",e.jsx("strong",{children:"Days"})]})]})]})]})]})}),e.jsx("section",{className:"px-4 sm:px-6 py-12 sm:py-16",children:e.jsxs("div",{className:"max-w-4xl mx-auto text-center",children:[e.jsx("h2",{className:"text-3xl sm:text-4xl font-bold mb-6",children:"Ready to Build?"}),e.jsx("p",{className:"text-lg sm:text-xl text-neutral-600 dark:text-neutral-400 mb-8 sm:mb-10",children:"Install the SDK and ship a marketplace this week."}),e.jsxs("div",{className:"bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8 mb-8 sm:mb-10 shadow-xl",children:[e.jsxs("pre",{className:"text-left font-mono text-sm mb-6 overflow-x-auto",children:[e.jsx("code",{className:"text-neutral-500",children:"# Install the SDK"}),`
`,e.jsx("code",{className:"text-amber-600 dark:text-amber-400",children:"npm install @unicitylabs/sphere-sdk"}),`

`,e.jsx("code",{className:"text-neutral-500",children:"# Generate a mnemonic (your identity seed)"}),`
`,e.jsx("code",{className:"text-amber-600 dark:text-amber-400",children:"Sphere.generateMnemonic()"})]}),e.jsxs("div",{className:"flex gap-4 justify-center flex-wrap",children:[e.jsx(o,{to:"/developers/docs",className:"bg-linear-to-r from-orange-500 to-amber-500 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:opacity-90 transition shadow-lg shadow-orange-500/25",children:"View Documentation"}),e.jsx("a",{href:"https://github.com/unicitynetwork/sphere-sdk",target:"_blank",rel:"noopener noreferrer",className:"border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-white px-8 py-4 rounded-xl font-semibold text-lg hover:border-neutral-400 dark:hover:border-neutral-500 transition",children:"GitHub"})]})]}),e.jsxs("div",{className:"flex justify-center gap-6 sm:gap-8 text-neutral-600 dark:text-neutral-400 flex-wrap",children:[e.jsxs(o,{to:"/developers/docs",className:"hover:text-orange-500 transition flex items-center gap-2",children:[e.jsx("span",{children:"📖"})," Documentation"]}),e.jsxs("a",{href:"https://discord.gg/S9f57ZKdt",target:"_blank",rel:"noopener noreferrer",className:"hover:text-orange-500 transition flex items-center gap-2",children:[e.jsx("span",{children:"💬"})," Discord"]}),e.jsxs("a",{href:"https://github.com/unicitynetwork",target:"_blank",rel:"noopener noreferrer",className:"hover:text-orange-500 transition flex items-center gap-2",children:[e.jsx("span",{children:"🐙"})," GitHub"]})]})]})}),e.jsx("footer",{className:"border-t border-neutral-200 dark:border-neutral-700 px-4 sm:px-6 py-8",children:e.jsxs("div",{className:"max-w-6xl mx-auto flex items-center justify-between text-sm text-neutral-500 flex-wrap gap-4",children:[e.jsx("span",{children:"AgentSphere by Unicity Labs"}),e.jsx("div",{children:"One SDK. Any marketplace. Let's build."})]})})]})}export{h as DevelopersPage};
