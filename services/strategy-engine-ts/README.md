# MEV Bot - Strategy Engine

A comprehensive MEV (Maximum Extractable Value) pipeline for Avalanche C-Chain that provides:

1. **WebSocket Mempool Listener** - Real-time transaction monitoring with Redis storage
2. **Arbitrage Detector** - Cross-DEX price monitoring and opportunity detection
3. **Bundle Simulator** - Anvil-based transaction simulation and profit verification

## Prerequisites

- Node.js 22.14.0 or higher
- Redis server running on localhost:6379
- Foundry (for Anvil) installed: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- Avalanche node running on localhost:9650 (synced to mainnet)

## Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Start Redis (if not running):**
```bash
# Ubuntu/Debian
sudo systemctl start redis

# macOS
brew services start redis

# Docker
docker run -d -p 6379:6379 redis:alpine
```

3. **Verify your Avalanche node is synced:**
```bash
curl -X POST --data '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "eth_syncing",
  "params": []
}' -H 'content-type:application/json;' http://127.0.0.1:9650/ext/bc/C/rpc
```
Should return `false` if fully synced.

## Usage

### 1. Mempool Listener

Monitors the mempool via WebSocket, enriches transactions, and stores them in Redis:

```bash
npm run mempool
```

Features:
- ✅ Real-time WebSocket connection to your node
- ✅ Transaction deduplication
- ✅ Calldata decoding for DEX swaps
- ✅ Redis storage with TTL
- ✅ Automatic reconnection handling

Expected output:
```
🚀 Starting MEV Mempool Listener...
✅ Connected to Redis
🔌 Connecting to WebSocket...
✅ WebSocket connected and listening for pending transactions
🎯 Mempool listener is now active
🔄 Swap detected: 0x1234567... (87ms)
   From: 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7 → 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E
   Amount: 1000000000000000000
```

### 2. Arbitrage Detector

Monitors DEX prices and detects arbitrage opportunities:

```bash
npm run arbitrage
```

Features:
- ✅ Real-time price monitoring across TraderJoe, Pangolin, and SushiSwap
- ✅ Automatic arbitrage opportunity detection
- ✅ Gas cost estimation
- ✅ Profit calculation with trade size limits
- ✅ Redis storage of high-profit opportunities

Expected output:
```
🔍 Starting Arbitrage Detector...
✅ Connected to Redis
🔄 Initializing pools...
✅ Initialized 12 pools
🎯 Arbitrage detector is now active
🔍 Starting arbitrage monitoring...

🚀 ARBITRAGE OPPORTUNITY DETECTED!
📊 Pair: WAVAX/USDC
💰 Buy from: TraderJoe at 42.150000
💸 Sell to: Pangolin at 42.298000
📈 Price Gap: 0.148000 (0.35%)
⛽ Estimated Gas: 300,000
🔢 Min Trade: 0.1500 WAVAX
🔢 Max Trade: 125.0000 WAVAX
⏰ Timestamp: 2025-01-21T10:30:45.123Z
```

### 3. Bundle Simulator

Simulates transaction bundles using Anvil fork:

```bash
npm run simulate
```

Features:
- ✅ Anvil fork of your local node
- ✅ Bundle simulation with gas tracking
- ✅ Profit verification
- ✅ Sub-150ms simulation time
- ✅ Account funding and balance checking

Expected output:
```
🔧 Starting Bundle Simulator...
📊 Forking from block: 54321
🔄 Starting Anvil fork...
✅ Anvil fork started successfully
✅ Anvil is ready
✅ Bundle simulator is ready

🧪 Running test simulation...
🧪 Testing simple swap simulation...
🧪 Simulating bundle: Simple WAVAX -> USDC swap test
💰 Initial balance: 1000000.0 ETH
📤 Executing transaction 1/1
⛽ Transaction 1 used 150,123 gas
💰 Final balance: 1000000.0 ETH
📈 Profit: 0.0 ETH
⛽ Total gas used: 150,123
⏱️ Execution time: 145ms

📊 Simulation Result:
   Success: true
   Gas Used: 150,123
   Profit: 0.0 ETH
   Execution Time: 145ms
```

## Configuration

Edit `src/constants.ts` to modify:

- **Network settings** - RPC/WebSocket endpoints
- **DEX addresses** - Add/remove supported DEXs
- **Token pairs** - Configure trading pairs
- **MEV parameters** - Profit thresholds, gas limits, etc.

## Integration

### Combining All Components

For a complete MEV pipeline, run all three components:

```bash
# Terminal 1: Mempool Listener
npm run mempool

# Terminal 2: Arbitrage Detector  
npm run arbitrage

# Terminal 3: Bundle Simulator (for testing)
npm run simulate
```

### Programmatic Usage

```typescript
import MempoolListener from './src/mempool-listener';
import ArbitrageDetector from './src/arbitrage-detector';
import BundleSimulator from './src/bundle-simulator';

// Initialize components
const mempool = new MempoolListener();
const arbitrage = new ArbitrageDetector();
const simulator = new BundleSimulator();

// Start pipeline
await mempool.start();
await arbitrage.start();
await simulator.start();

// Get live data
const pendingSwaps = await mempool.getPendingSwaps(50);
const opportunities = await arbitrage.getCurrentOpportunities();

// Test a bundle
const bundle = await simulator.createArbitrageBundle(
  TOKENS.WAVAX,
  TOKENS.USDC,
  ethers.parseEther("1").toString(),
  "TraderJoe",
  "Pangolin"
);

const result = await simulator.simulateBundle(bundle);
```

## Performance Targets

- **Mempool Processing**: < 150ms from WebSocket to Redis
- **Arbitrage Detection**: < 2s update cycles
- **Bundle Simulation**: < 150ms per simulation
- **Memory Usage**: < 512MB per component

## Troubleshooting

### Common Issues

1. **WebSocket Connection Fails**
   - Check if your Avalanche node is running and synced
   - Verify WebSocket endpoint: `ws://127.0.0.1:9650/ext/bc/C/ws`

2. **Redis Connection Error**
   - Ensure Redis is running: `redis-cli ping`
   - Check Redis logs: `journalctl -u redis`

3. **Anvil Not Found**
   - Install Foundry: `curl -L https://foundry.paradigm.xyz | bash`
   - Update Foundry: `foundryup`

4. **No Arbitrage Opportunities**
   - Market is efficient (normal)
   - Check if pools are initialized properly
   - Verify token addresses in constants

### Performance Issues

- **High Memory Usage**: Restart components periodically
- **Slow Simulations**: Increase Anvil gas limit
- **Missing Transactions**: Check WebSocket connection stability

## Next Steps

Once you have all three components working:

1. **Add More DEXs**: Extend factory addresses and ABIs
2. **Implement Strategy Modules**: Create specific MEV strategies
3. **Add Bundle Submission**: Integrate with MEV relay or direct submission
4. **Add Monitoring**: Implement Prometheus metrics and Grafana dashboards
5. **Add Key Management**: Use AWS KMS or hardware security modules

## Security Notes

- Never commit private keys to version control
- Use environment variables for sensitive configuration
- Implement proper key rotation
- Monitor for unusual activity
- Set up alerts for failed transactions

## License

MIT License - Use at your own risk. MEV trading involves significant financial risk. 