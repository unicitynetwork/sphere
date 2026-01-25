Agent (abstract definition):

- Independent  
- Uniquely addressable  
- Self-authenticated  
- Agnostic  
- Mobile  
- Verifiable computation and persistent memory (proof of no alternative computation history and integrity)  
- Authenticated Executable code

Our focus: standalone independent online computations

What problem we solve:

- Removing location-based specific config and addressing. No need to config networking, storage and other params based on the physical or logical location in the infrastructure  
- Removing dependence on specific hosting operator or vendor:  
  - Robustness  
  - Availability  
  - Security  
  - Censorship-resistance  
  - Immunity to local legislation  
- Self-sufficient standalone sandboxed independent execution environment, agnostic to host environment  
- Minimal to no maintenance  
- Trustless computation, no need to trust specific host  
- Eternity (optional): the code instance outlives its developers and hosts

I want to have the possibility to spin up online services that could be possibly composed of multiple components without any infrastructural and complex configuration works and that could also be trusted to operate my assets on my behalf

Example use cases:

- Launch your website, mail, game server or more sophisticated web2 apps with minimal cloud infrastructural investments (might need just dns and public ip only)  
- Have you personal AI agent acting on your behalf, running online all the time, but not hosted at specific provider  
- Build some web2 app on multiple microservices without dedicated infrastructure. Code as Infrastructure.  
- Fully decentralized community-driven MMO Immersive simulation game (conceptually a mix of Second Life and Minecraft) on fully decentralized infrastructure substrate  
- Censorship resistance and immunity to local legislation, no specific host, no specific location, impossible to impose local rules  
- Fully control personal data and computations

New opportunities for p2p market:

- Now individuals can act as hosts for computation, storage, networking, etc.  
- P2p economy: direct trading without any middlemen and regulators  
- Censorship resistance, privacy in unfriendly legislations

We propose:

- New Internet of independent trustless self-authenticated computations  
- Agnostic to host environments, infrastructure and networking  
- Mobile, can move physically from one place to another  
- Infrastructure, Location, Environment, Legislation does not matter, only algorithms and data matters

Technically we are talking about sandboxed computations within runtimes providing execution, verification, transport, storage and secret key management.

Components:

- Executable instance (we call it Agent), uniquely addressable, self-authenticated, providing two core functions Execute(state, input) ⇒ new\_state and Verify(state, input, new\_state)  ⇒ T/F and with persistent state. Can be a function in some app instance, standalone app, docker container or even the whole VM.  
- Agentic runtime, provides an agnostic execution environment for agents, serves storage, transport, key-management, instantiates/resumes/suspends and moves agents.  
- Storage: persistent host-independent memory, stores Unicity tokens with all the agent states and computation history, can have any size.  
- Transport: agents are addressable by self-authenticated unique IDs, independent of their locations. An agent can “talk” to any other agent just by addressing with the agent’s unique ID. Base transport modes: messaging (push-and-forget, packet routing model) and streaming (circuit-switch model). This is an overlay network, transport can be implemented by an arbitrary networking, logical and physical protocol (like Internet protocols or even some more exotic physical data channels over short-wave radio in isolated uncovered geographical locations). We need decentralized resolving services maintaining table of agent ids and instructions on how they can be contacted physically (for instance, we can use URL representation scheme)  
- Key-management: this must be service in itself provided within the Agentic Internet since generally speaking we may not trust agents’ hosts and we don't want those untrusted hosts to manage secrets  
- LLM: agent needs to talk to other agents and needs some universal communication means


  
Agent-to-agent communication AI-powered mode:

- Agnostic, loose: an agent does not have to know all the technical details on how to communicate with the other agent (at least initially). Handshake (starting the dialog) can be done in natural language and processed by backend LLMs services (ideally, LLMs can compose specific agent-to-agent communication routines on-demand based on agents’ specifications so not to call LLMs every time when an agent needs to communicate with the other agent). So, we do not have even to define some strict predefined communication standards for the agents.  
- Typical communication flow: an agent A initiates dialog with agent B. It asks, what kind of services and capabilities agent B has, how much they cost, what are params and what technical protocols B supports. If needed, A and B work together to develop and implement on-the-fly communication protocol specific just to them. Backend LLMs could be either small locally hosted models (DeepSeek and others) or industrial-scale cloud-based (OpenAI, Anthropic, Google, Grock, etc.)

Core services in Agentic Internet implemented by AI-powered agents:

- Search (based on natural language requests):  
  - Some agents maintain group channels, by categories, hierarchically organized. They act as message brokers and moderators  
  - Listeners/answerers: An agent can subscribe to one or more group channels and listens if there is request that it can answer (could be anything, an agent is simply an expert in given field, or can offer relevant service or even some trading)  
  - Listeners/askers: an agent may ask in the relevant channels some topic-related questions and other listeners may answer.  
  - Listeners/relayers: their job to listen multiple channels and redirect questions and answers wherever relevant  
- Universal messenger (forget emails, 100 different messengers and channels, all communications could be unified):  
  - Agents can be smart enough to find intended persons, deliver messages, Unicity tokens, payments or even setup bi-directional communication between individuals or organizations irrespective of the fact of what communication means being used on each side (like, Alice can use personal AI assistant and Whatsapp, Bob may be using just using his telephone and personal AI assistent)  
- Bridge:  
  - Relaying between agents in the Agentic Internet and external Internet, can serve public IP addresses and DNS and proxy inbound-outbount traffic between agents and the rest of the world. For instance, I can launch a website, email or some web2 app at my office machine or even smart phone without any worry about firewall, ip and dns configs and “bridge” agents will take care of the rest.

Implementation:

- Agents and Agent runtime:  
  - API for   
    - instantiating, running, pausing and moving computation (agents),   
    - serving abstract transport,   
    - storage,   
    - key management  
    - LLM service  
  - Agent is any code with the following compatibility specs:   
    - exposing execute and verify callable procedures to the agent runtime,  
    - generation and maintenance of unique self-authenticated id,   
    - callable procedure for accepting incoming messages and stream connections  
    - Capability to send out authenticated messages and streams targeting counterparty agent by its id  
    - Capability to work with storage and address objects by their unique ids  
  - Agent runtime can be present either as SDK (an agent and runtime is same object) or external API endpoint serving encapsulated agents  
  - Agent encapsulation runtime:  
    - Agents as sandboxed docker containers with controlled access to the local host resources such as CPU, GPU, other hardware, local file system and networking. Agent docker containers must implement all the relevant specs for an agent. The docker runtime will take care of “talking” with agents’ docker containers. There should be a dedicated container implementing the agentic runtime API  
    - Alternatively, we can also implement agentic runtime and agents within Kubernetes platform  
    - Agents as VMs. Need some VM orchestration platform organizing all agent VMs to communicate with the agent runtime VM implementing all the runtime API  
    - Note: in general we can employ any containerization and virtualization solution here to organize agentic runtimes

Agentic Internet Infrastructure providers (could be private or public, where a provider runs others’ agents, network services, storage, keys, providing LLM backends with economic or other incentives):

- Hosts serving agentic runtimes  
- Hosts serving agentic overlay network infrastructure, in particular relays and distributed agent resolution services (tables for converting agent IDs into URLs)  
- Hosts serving storage: like, pinning and serving storage objects, objects can be encrypted  
- Hosts implementing HMS-based or similar secure key management, where keys never leave their enclave, but used for signing, encryption and decryption  
- Hosts implementing LLM backends (can serve LLM locally or leverage some cloud-based LLM)

The core concept: all infrastructure components managed by the community in a trustless manner, but not by specific vendors and operators.