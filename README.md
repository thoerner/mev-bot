# Avalanche MEV Bot

A comprehensive MEV (Maximum Extractable Value) pipeline for Avalanche C-Chain that provides real-time arbitrage detection, mempool monitoring, and bundle simulation capabilities.

## 🚀 Features

- **Real-time Mempool Monitoring** - WebSocket-based transaction monitoring with Redis storage
- **Multi-DEX Arbitrage Detection** - Cross-DEX price monitoring across TraderJoe, Pangolin, and SushiSwap
- **Bundle Simulation** - Anvil-based transaction simulation with profit verification
- **High Performance** - Sub-150ms processing targets with optimized memory usage
- **Production Ready** - Comprehensive error handling, logging, and monitoring

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Mempool       │    │   Arbitrage     │    │   Bundle        │
│   Listener      │───▶│   Detector      │───▶│   Simulator     │
│   (Go/TS)       │    │   (TypeScript)  │    │   (Anvil)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Redis Cache   │    │   Price Data    │    │   Simulation    │
│   (Transactions)│    │   (Opportunities)│   │   Results       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📋 Prerequisites

- **Node.js** 22.14.0 or higher
- **Redis** server running on localhost:6379
- **Foundry** (for Anvil) installed: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Avalanche node** running on localhost:9650 (synced to mainnet)

## 🛠️ Quick Start

1. **Clone and install:**
```bash
git clone https://github.com/thoerner/mev-bot.git
cd mev-bot/services/strategy-engine-ts
npm install
```

2. **Start Redis:**
```bash
# Ubuntu/Debian
sudo systemctl start redis

# macOS
brew services start redis

# Docker
docker run -d -p 6379:6379 redis:alpine
```

3. **Verify Avalanche node:**
```bash
curl -X POST --data '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "eth_syncing",
  "params": []
}' -H 'content-type:application/json;' http://127.0.0.1:9650/ext/bc/C/rpc
```

4. **Run components:**
```bash
# Terminal 1: Mempool Listener
npm run mempool

# Terminal 2: Arbitrage Detector
npm run arbitrage

# Terminal 3: Bundle Simulator
npm run simulate
```

## 📊 Performance Targets

- **Mempool Processing**: < 150ms from WebSocket to Redis
- **Arbitrage Detection**: < 2s update cycles
- **Bundle Simulation**: < 150ms per simulation
- **Memory Usage**: < 512MB per component

## 🔧 Configuration

Edit `src/constants.ts` to modify:

- **Network settings** - RPC/WebSocket endpoints
- **DEX addresses** - Add/remove supported DEXs
- **Token pairs** - Configure trading pairs
- **MEV parameters** - Profit thresholds, gas limits, etc.

## 🛡️ Security

- Never commit private keys to version control
- Use environment variables for sensitive configuration
- Implement proper key rotation
- Monitor for unusual activity
- Set up alerts for failed transactions

## 📈 Roadmap

### Phase 1: Core Infrastructure ✅
- [x] WebSocket mempool listener
- [x] Multi-DEX arbitrage detection
- [x] Bundle simulation with Anvil
- [x] Redis caching and data persistence
- [x] Performance optimization

### Phase 2: Enhanced Strategies 🚧
- [ ] Liquidation opportunity detection
- [ ] Sandwich attack prevention
- [ ] Cross-chain arbitrage (Avalanche ↔ Ethereum)
- [ ] Flash loan integration
- [ ] Advanced gas optimization

### Phase 3: Production Features 📋
- [ ] MEV relay integration
- [ ] Bundle submission to validators
- [ ] Prometheus metrics and Grafana dashboards
- [ ] AWS KMS key management
- [ ] Multi-region deployment
- [ ] Automated testing suite

### Phase 4: Advanced Analytics 🔮
- [ ] Machine learning price prediction
- [ ] Historical performance analysis
- [ ] Risk management algorithms
- [ ] Portfolio optimization
- [ ] Real-time P&L tracking

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This software is for educational and research purposes only. MEV trading involves significant financial risk. Use at your own risk and never trade with funds you cannot afford to lose.

## 👨‍💻 Author

**Tim Hoerner** - CTO @ ReplyCorp
- GitHub: [@thoerner](https://github.com/thoerner)
- Email: thoerner@gmail.com

---

*Built with ❤️ for the Avalanche ecosystem*