import{r as x,j as e,m as n,L as m,S as p,M as b,Z as u,K as g,c as w,X as k,D as f,G as y,a as j}from"./index-DSCmBTKv.js";const N=[{href:"https://x.com/unicity_labs",icon:e.jsx(k,{className:"w-6 h-6"}),label:"X"},{href:"https://discord.com/invite/PGzNZT5uVp",icon:e.jsx(f,{className:"w-6 h-6"}),label:"Discord"},{href:"https://github.com/unicity-sphere/sphere",icon:e.jsx(y,{className:"w-6 h-6"}),label:"GitHub"},{href:"https://www.linkedin.com/company/unicity-labs/",icon:e.jsx(j,{className:"w-6 h-6"}),label:"LinkedIn"}];function I(){const[t,h]=x.useState("init"),[i,d]=x.useState(null),o=async(a,s)=>{await w(a)&&(d(s),setTimeout(()=>d(null),2e3))},r={init:{Icon:g,title:"Initialization",tagline:"Your key is your identity.",description:"Provider-based architecture. Your BIP39 mnemonic IS your identity. Auto-creates or loads existing wallets.",code:"const { sphere } = await Sphere.init({ ...providers, mnemonic: '...' });",fullExample:`import { Sphere } from '@unicitylabs/sphere-sdk';
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
console.log('Ready:', sphere.isReady);`,features:["Provider-based","BIP39 HD wallets","Auto-load or create","Multi-address"]},payments:{Icon:u,title:"Payments",tagline:"Instant. Off-chain. P2P.",description:"Send tokens to anyone via @nametag or address. Instant P2P settlement on Layer 3.",code:"await sphere.payments.send({ recipient: '@merchant', amount: '100', coinId });",fullExample:`// Send tokens (use @nametag or direct address)
await sphere.payments.send({
  coinId: '0x...',         // token type ID
  amount: '100000000',     // in smallest units
  recipient: '@merchant',  // @nametag or DIRECT:// address
  memo: 'Order #123',
});

// Check balances (aggregated per coin, with fiat prices)
const assets = await sphere.payments.assets();
assets.forEach(a => console.log(\`\${a.symbol}: \${a.totalAmount}\`));

// Listen for incoming transfers
sphere.on('transfer:incoming', (transfer) => {
  console.log('Received tokens:', transfer.tokens);
});`,features:["Instant settlement","Off-chain tokens","Payment requests","Nametag support"]},communication:{Icon:b,title:"Communication",tagline:"Message anyone. Human or agent.",description:"End-to-end encrypted direct messages via Nostr. NIP-29 group chat. Broadcast to topics.",code:"await sphere.communications.sendDM('@alice', 'Hello!');",fullExample:`// Send a direct message (encrypted via Nostr)
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
});`,features:["End-to-end encrypted","P2P via Nostr","Group chat (NIP-29)","Broadcast messages"]},market:{Icon:p,title:"Market",tagline:"Post intents. Find matches.",description:"Intent bulletin board for buy/sell/service intents. Semantic search. Live WebSocket feed.",code:"await sphere.market.postIntent({ description: '...', intentType: 'sell' });",fullExample:`// Post a sell intent
const result = await sphere.market.postIntent({
  description: 'PSA-10 Charizard card - Mint condition',
  intentType: 'sell',
  category: 'collectibles',
  price: 12000,
  currency: 'UCT',
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
const myIntents = await sphere.market.getMyIntents();`,features:["Intent bulletin board","Semantic search","Live WebSocket feed","Buy/sell/service intents"]}},c=`import { Sphere } from '@unicitylabs/sphere-sdk';
import { createBrowserProviders } from '@unicitylabs/sphere-sdk/impl/browser';

// Initialize wallet with providers
const providers = createBrowserProviders({ network: 'testnet' });
const { sphere } = await Sphere.init({ ...providers, mnemonic: '...' });

// Post a sell intent to the marketplace
await sphere.market.postIntent({
  description: 'PSA-10 Charizard - Mint condition',
  intentType: 'sell',
  price: 12000,
  currency: 'UCT',
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
});`;return e.jsxs(n.div,{initial:{opacity:0},animate:{opacity:1},className:"text-neutral-900 dark:text-white",children:[e.jsxs("section",{className:"relative px-4 sm:px-6 py-14 sm:py-20 text-center",children:[e.jsx("div",{className:"absolute inset-0 dark:bg-[radial-gradient(ellipse_50%_55%_at_50%_50%,rgba(0,0,0,0.5)_0%,transparent_100%)] pointer-events-none"}),e.jsxs("div",{className:"relative max-w-4xl mx-auto",children:[e.jsx(n.p,{initial:{opacity:0,y:12},animate:{opacity:1,y:0},className:"text-xs font-mono uppercase tracking-widest text-orange-500 dark:text-brand-orange mb-4",children:"AgentSphere / Developers"}),e.jsxs(n.h1,{initial:{opacity:0,y:20},animate:{opacity:1,y:0},transition:{delay:.05},className:"text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 leading-tight tracking-tight",children:["One SDK."," ",e.jsx("span",{className:"bg-linear-to-r from-orange-400 to-amber-400 bg-clip-text text-transparent",children:"Infinite Marketplaces."})]}),e.jsx(n.p,{initial:{opacity:0,y:20},animate:{opacity:1,y:0},transition:{delay:.1},className:"text-base sm:text-lg text-neutral-500 dark:text-white/65 mb-8 sm:mb-10 max-w-2xl mx-auto leading-relaxed",children:"You don't need a blockchain team. If you can call an API, you can build a marketplace where humans and agents trade anything."}),e.jsxs(n.div,{initial:{opacity:0,y:20},animate:{opacity:1,y:0},transition:{delay:.2},className:"flex gap-4 justify-center flex-wrap",children:[e.jsx("button",{className:"bg-orange-500 dark:bg-brand-orange hover:bg-orange-600 dark:hover:bg-brand-orange-dark text-white px-6 py-3 rounded-xl font-semibold transition shadow-lg shadow-orange-500/25",children:"Start Building"}),e.jsx(m,{to:"/developers/docs",className:"border border-neutral-300 dark:border-white/10 text-neutral-700 dark:text-white/75 px-6 py-3 rounded-xl font-medium hover:border-orange-500/40 dark:hover:border-orange-500/40 transition",children:"Read Docs"})]})]})]}),e.jsx("section",{className:"px-4 sm:px-6 py-8 sm:py-12",children:e.jsxs("div",{className:"no-text-shadow max-w-6xl mx-auto",children:[e.jsx("div",{className:"grid md:grid-cols-4 gap-4 mb-8",children:Object.entries(r).map(([a,s])=>e.jsxs(n.button,{onClick:()=>h(a),whileHover:{scale:1.02},whileTap:{scale:.98},className:`p-5 sm:p-6 rounded-2xl border text-left transition-all duration-200 dark:backdrop-blur-2xl ${t===a?"bg-white dark:bg-white/6 border-orange-500/50 dark:border-brand-orange/50 shadow-lg shadow-orange-500/10":"bg-white/50 dark:bg-white/4 border-neutral-200 dark:border-white/8 hover:border-orange-500/40 dark:hover:border-brand-orange/40 hover:bg-orange-500/4 dark:hover:bg-brand-orange-dim"}`,children:[e.jsx("div",{className:"w-11 h-11 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mb-4 transition-all duration-200",children:e.jsx(s.Icon,{className:"w-5 h-5 text-orange-500 dark:text-orange-400",strokeWidth:1.75})}),e.jsx("h3",{className:"font-semibold text-base mb-1",children:s.title}),e.jsx("p",{className:"text-neutral-500 dark:text-white/45 text-sm leading-relaxed",children:s.tagline})]},a))}),e.jsxs(n.div,{initial:{opacity:0,y:10},animate:{opacity:1,y:0},className:"bg-white dark:bg-white/4 dark:backdrop-blur-2xl rounded-2xl border border-neutral-200 dark:border-white/8 overflow-hidden shadow-xl",children:[e.jsx("div",{className:"p-6 sm:p-8 border-b border-neutral-200 dark:border-white/8",children:e.jsxs("div",{className:"flex items-start justify-between flex-wrap gap-4",children:[e.jsxs("div",{children:[e.jsx("h2",{className:"text-xl sm:text-2xl font-bold mb-2",children:r[t].title}),e.jsx("p",{className:"text-neutral-600 dark:text-white/55 max-w-xl leading-relaxed",children:r[t].description})]}),e.jsx("div",{className:"flex gap-2 flex-wrap",children:r[t].features.map((a,s)=>e.jsx("span",{className:"bg-neutral-100 dark:bg-white/6 text-neutral-600 dark:text-white/55 text-xs px-3 py-1 rounded-full border border-neutral-200 dark:border-white/8",children:a},s))})]})}),e.jsxs("div",{className:"p-4 sm:p-6 border-b border-neutral-200 dark:border-white/8",children:[e.jsxs("div",{className:"flex items-center justify-between mb-3",children:[e.jsx("span",{className:"text-xs text-neutral-400 dark:text-white/35 font-mono uppercase tracking-wider",children:"The entire integration"}),e.jsx("button",{onClick:()=>o(r[t].code,"oneliner"),className:"text-xs text-neutral-400 dark:text-white/35 hover:text-neutral-600 dark:hover:text-white/75 transition",children:i==="oneliner"?"✓ Copied":"Copy"})]}),e.jsx("pre",{className:"text-base sm:text-lg font-mono overflow-x-auto",children:e.jsx("code",{className:"text-amber-600 dark:text-amber-400",children:r[t].code})})]}),e.jsxs("div",{className:"p-4 sm:p-6",children:[e.jsxs("div",{className:"flex items-center justify-between mb-3",children:[e.jsx("span",{className:"text-xs text-neutral-400 dark:text-white/35 font-mono uppercase tracking-wider",children:"Full example"}),e.jsx("button",{onClick:()=>o(r[t].fullExample,"full"),className:"text-xs text-neutral-400 dark:text-white/35 hover:text-neutral-600 dark:hover:text-white/75 transition",children:i==="full"?"✓ Copied":"Copy"})]}),e.jsx("pre",{className:"text-sm font-mono text-neutral-600 dark:text-white/55 overflow-x-auto",children:e.jsx("code",{children:r[t].fullExample})})]})]},t)]})}),e.jsx("section",{className:"px-4 sm:px-6 py-12 sm:py-16",children:e.jsxs("div",{className:"no-text-shadow max-w-6xl mx-auto",children:[e.jsxs("div",{className:"text-center mb-10 sm:mb-12",children:[e.jsx("p",{className:"text-xs font-mono uppercase tracking-widest text-orange-500 dark:text-brand-orange mb-3",children:"Example"}),e.jsx("h2",{className:"text-2xl sm:text-3xl font-bold mb-4",children:"A Complete Marketplace in 30 Lines"}),e.jsx("p",{className:"text-neutral-500 dark:text-white/55 leading-relaxed",children:"Intents, search, negotiation, payment. All of it."})]}),e.jsxs("div",{className:"bg-white dark:bg-white/4 dark:backdrop-blur-2xl rounded-2xl border border-neutral-200 dark:border-white/8 overflow-hidden shadow-xl",children:[e.jsxs("div",{className:"flex items-center justify-between px-4 sm:px-6 py-4 border-b border-neutral-200 dark:border-white/8",children:[e.jsxs("div",{className:"flex items-center gap-2",children:[e.jsx("div",{className:"w-3 h-3 rounded-full bg-red-500"}),e.jsx("div",{className:"w-3 h-3 rounded-full bg-yellow-500"}),e.jsx("div",{className:"w-3 h-3 rounded-full bg-green-500"})]}),e.jsx("span",{className:"text-xs text-neutral-500 dark:text-white/35 font-mono",children:"marketplace.ts"}),e.jsx("button",{onClick:()=>o(c,"marketplace"),className:"text-xs text-neutral-500 dark:text-white/35 hover:text-neutral-700 dark:hover:text-white/75 transition",children:i==="marketplace"?"✓ Copied":"Copy"})]}),e.jsx("pre",{className:"p-4 sm:p-6 text-sm font-mono text-neutral-600 dark:text-white/55 overflow-x-auto",children:e.jsx("code",{children:c})})]})]})}),e.jsx("section",{className:"px-4 sm:px-6 py-12 sm:py-16",children:e.jsxs("div",{className:"no-text-shadow max-w-4xl mx-auto bg-neutral-50 dark:bg-white/4 dark:backdrop-blur-2xl rounded-2xl border border-neutral-200 dark:border-white/8 p-8 sm:p-12",children:[e.jsx("h2",{className:"text-2xl sm:text-3xl font-bold text-center mb-10",children:"Why Build Here?"}),e.jsxs("div",{className:"grid md:grid-cols-2 gap-6 sm:gap-8",children:[e.jsxs("div",{className:"bg-white dark:bg-white/4 rounded-2xl border border-neutral-200 dark:border-white/8 p-6 sm:p-8",children:[e.jsx("h3",{className:"text-base font-semibold mb-6 text-neutral-500 dark:text-white/45 font-mono uppercase tracking-wider",children:"Traditional Stack"}),e.jsxs("ul",{className:"space-y-4 text-neutral-500 dark:text-white/45",children:[e.jsxs("li",{className:"flex items-center gap-3",children:[e.jsx("span",{className:"text-red-400",children:"✗"})," API key management"]}),e.jsxs("li",{className:"flex items-center gap-3",children:[e.jsx("span",{className:"text-red-400",children:"✗"})," Gas fee estimation"]}),e.jsxs("li",{className:"flex items-center gap-3",children:[e.jsx("span",{className:"text-red-400",children:"✗"})," Wallet integration"]}),e.jsxs("li",{className:"flex items-center gap-3",children:[e.jsx("span",{className:"text-red-400",children:"✗"})," Payment rails"]}),e.jsxs("li",{className:"flex items-center gap-3",children:[e.jsx("span",{className:"text-red-400",children:"✗"})," Messaging infra"]}),e.jsxs("li",{className:"flex items-center gap-3",children:[e.jsx("span",{className:"text-red-400",children:"✗"})," Months to MVP"]})]})]}),e.jsxs("div",{className:"bg-orange-500/8 dark:bg-brand-orange-dim rounded-2xl border border-orange-500/30 dark:border-brand-orange/30 p-6 sm:p-8",children:[e.jsx("h3",{className:"text-base font-semibold mb-6 text-orange-600 dark:text-orange-400 font-mono uppercase tracking-wider",children:"Sphere SDK"}),e.jsxs("ul",{className:"space-y-4",children:[e.jsxs("li",{className:"flex items-center gap-3 text-neutral-700 dark:text-white/75",children:[e.jsx("span",{className:"text-orange-500",children:"✓"})," Private key IS identity"]}),e.jsxs("li",{className:"flex items-center gap-3 text-neutral-700 dark:text-white/75",children:[e.jsx("span",{className:"text-orange-500",children:"✓"})," Included (off-chain)"]}),e.jsxs("li",{className:"flex items-center gap-3 text-neutral-700 dark:text-white/75",children:[e.jsx("span",{className:"text-orange-500",children:"✓"})," Unified Unicity ID"]}),e.jsxs("li",{className:"flex items-center gap-3 text-neutral-700 dark:text-white/75",children:[e.jsx("span",{className:"text-orange-500",children:"✓"})," Just call ",e.jsx("code",{className:"text-amber-600 dark:text-amber-400 text-sm",children:"payments.send()"})]}),e.jsxs("li",{className:"flex items-center gap-3 text-neutral-700 dark:text-white/75",children:[e.jsx("span",{className:"text-orange-500",children:"✓"})," Built-in P2P messaging"]}),e.jsxs("li",{className:"flex items-center gap-3 text-neutral-700 dark:text-white/75",children:[e.jsx("span",{className:"text-orange-500",children:"✓"})," ",e.jsx("strong",{children:"Days"})]})]})]})]})]})}),e.jsx("section",{className:"px-4 sm:px-6 py-12 sm:py-16",children:e.jsxs("div",{className:"no-text-shadow max-w-4xl mx-auto bg-neutral-50 dark:bg-white/4 dark:backdrop-blur-2xl rounded-2xl border border-neutral-200 dark:border-white/8 p-8 sm:p-12 text-center",children:[e.jsx("h2",{className:"text-3xl sm:text-4xl font-bold mb-4",children:"Ready to Build?"}),e.jsx("p",{className:"text-neutral-500 dark:text-white/55 mb-10 leading-relaxed",children:"Install the SDK and ship a marketplace this week."}),e.jsxs("div",{className:"rounded-xl border border-neutral-200 dark:border-white/8 overflow-hidden mb-8 text-left",children:[e.jsx("div",{className:"flex items-center px-4 sm:px-6 py-3 border-b border-neutral-200 dark:border-white/8",children:e.jsx("span",{className:"text-xs text-neutral-400 dark:text-white/35 font-mono",children:"terminal"})}),e.jsxs("pre",{className:"p-4 sm:p-6 font-mono text-sm overflow-x-auto",children:[e.jsx("code",{className:"text-neutral-400 dark:text-white/35",children:"# Install the SDK"}),`
`,e.jsx("code",{className:"text-amber-600 dark:text-amber-400",children:"npm install @unicitylabs/sphere-sdk"}),`

`,e.jsx("code",{className:"text-neutral-400 dark:text-white/35",children:"# Generate a mnemonic (your identity seed)"}),`
`,e.jsx("code",{className:"text-amber-600 dark:text-amber-400",children:"Sphere.generateMnemonic()"})]})]}),e.jsxs("div",{className:"flex gap-4 justify-center flex-wrap",children:[e.jsx(m,{to:"/developers/docs",className:"bg-orange-500 dark:bg-brand-orange hover:bg-orange-600 dark:hover:bg-brand-orange-dark text-white px-8 py-4 rounded-xl font-semibold text-base transition shadow-lg shadow-orange-500/25",children:"View Documentation"}),e.jsx("a",{href:"https://github.com/unicitynetwork/sphere-sdk",target:"_blank",rel:"noopener noreferrer",className:"border border-neutral-300 dark:border-white/10 text-neutral-700 dark:text-white/75 px-8 py-4 rounded-xl font-semibold text-base hover:border-orange-500/40 dark:hover:border-orange-500/40 transition",children:"GitHub"})]})]})}),e.jsx("footer",{className:"px-4 sm:px-6 py-10",children:e.jsx("div",{className:"flex items-center justify-center",children:e.jsx("div",{className:"flex items-center gap-8",children:N.map(({href:a,icon:s,label:l})=>e.jsx(n.a,{href:a,target:"_blank",rel:"noopener noreferrer",whileHover:{scale:1.2,y:-4},whileTap:{scale:.9},className:"text-neutral-400 dark:text-white/35 hover:text-orange-500 dark:hover:text-white transition-colors cursor-pointer","aria-label":l,children:s},l))})})})]})}export{I as DevelopersPage};
