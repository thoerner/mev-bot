import { ethers } from "ethers";
import { createClient, RedisClientType } from "redis";
import { 
  CURRENT_NETWORK, 
  FACTORIES, 
  TOKENS, 
  TOKEN_DECIMALS, 
  ARBITRAGE_PAIRS, 
  ABIS, 
  MEV_CONFIG 
} from "./constants";

interface PoolReserves {
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  pairAddress: string;
  dexName: string;
  blockNumber: number;
  timestamp: number;
}

interface ArbitrageOpportunity {
  tokenA: string;
  tokenB: string;
  buyDex: string;
  sellDex: string;
  buyPrice: number;
  sellPrice: number;
  priceGap: number;
  profitPercent: number;
  estimatedGas: number;
  minTradeAmount: string;
  maxTradeAmount: string;
  timestamp: number;
}

class ArbitrageDetector {
  private provider: ethers.JsonRpcProvider;
  private redisClient: RedisClientType;
  private isRunning = false;
  
  // Pool contracts cache
  private poolCache: Map<string, ethers.Contract> = new Map();
  private reservesCache: Map<string, PoolReserves> = new Map();
  
  // DEX factory contracts
  private factories: { [name: string]: ethers.Contract } = {};
  
  // Interval references for cleanup
  private reserveUpdateInterval?: NodeJS.Timeout;
  private opportunityCheckInterval?: NodeJS.Timeout;
  
  constructor() {
    this.provider = new ethers.JsonRpcProvider(CURRENT_NETWORK.rpcUrl);
    this.redisClient = createClient({
      url: 'redis://localhost:6379'
    });
    
    this.initializeFactories();
  }
  
  private initializeFactories() {
    this.factories = {
      'TraderJoe': new ethers.Contract(FACTORIES.TRADER_JOE_V1, ABIS.UNISWAP_V2_FACTORY, this.provider),
      'Pangolin': new ethers.Contract(FACTORIES.PANGOLIN, ABIS.UNISWAP_V2_FACTORY, this.provider),
      'SushiSwap': new ethers.Contract(FACTORIES.SUSHISWAP, ABIS.UNISWAP_V2_FACTORY, this.provider)
    };
  }
  
  async start() {
    console.log("🔍 Starting Arbitrage Detector...");
    
    // Connect to Redis
    await this.redisClient.connect();
    console.log("✅ Connected to Redis");
    
    // Initialize pools for all pairs
    await this.initializePools();
    
    this.isRunning = true;
    console.log("🎯 Arbitrage detector is now active");
    
    // Monitor for arbitrage opportunities
    this.startArbitrageMonitoring();
  }
  
  private async initializePools() {
    console.log("🔄 Initializing pools...");
    
    for (const pair of ARBITRAGE_PAIRS) {
      for (const [dexName, factory] of Object.entries(this.factories)) {
        try {
          const pairAddress = await factory.getPair(pair.tokenA, pair.tokenB);
          
          if (pairAddress !== ethers.ZeroAddress) {
            const poolContract = new ethers.Contract(pairAddress, ABIS.UNISWAP_V2_PAIR, this.provider);
            const cacheKey = `${dexName}-${pair.tokenA}-${pair.tokenB}`;
            
            this.poolCache.set(cacheKey, poolContract);
            
            // Initial reserves fetch
            await this.updatePoolReserves(cacheKey, poolContract, dexName);
          }
        } catch (error) {
          console.error(`❌ Error initializing pool for ${dexName} ${pair.tokenA}/${pair.tokenB}:`, error);
        }
      }
    }
    
    console.log(`✅ Initialized ${this.poolCache.size} pools`);
  }
  
  private async updatePoolReserves(cacheKey: string, poolContract: ethers.Contract, dexName: string) {
    try {
      const [reserves, token0, token1] = await Promise.all([
        poolContract.getReserves(),
        poolContract.token0(),
        poolContract.token1()
      ]);
      
      const blockNumber = await this.provider.getBlockNumber();
      
      const poolReserves: PoolReserves = {
        token0: token0.toLowerCase(),
        token1: token1.toLowerCase(),
        reserve0: reserves[0],
        reserve1: reserves[1],
        pairAddress: await poolContract.getAddress(),
        dexName,
        blockNumber,
        timestamp: Date.now()
      };
      
      this.reservesCache.set(cacheKey, poolReserves);
      
      // Store in Redis with TTL (convert BigInt to string)
      const serializable = {
        ...poolReserves,
        reserve0: poolReserves.reserve0.toString(),
        reserve1: poolReserves.reserve1.toString()
      };
      
      // Store in Redis if connected
      if (this.redisClient.isOpen) {
        await this.redisClient.setEx(
          `${MEV_CONFIG.REDIS_KEY_PREFIX}reserves:${cacheKey}`,
          60, // 1 minute TTL
          JSON.stringify(serializable)
        );
      }
      
    } catch (error) {
      console.error(`❌ Error updating reserves for ${cacheKey}:`, error);
    }
  }
  
  private async startArbitrageMonitoring() {
    console.log("🔍 Starting arbitrage monitoring...");
    
    // Update reserves every 5 seconds
    this.reserveUpdateInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.updateAllReserves();
      }
    }, 5000);
    
    // Check for arbitrage opportunities every 2 seconds
    this.opportunityCheckInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.checkArbitrageOpportunities();
      }
    }, 2000);
  }
  
  private async updateAllReserves() {
    const updatePromises = Array.from(this.poolCache.entries()).map(
      async ([cacheKey, poolContract]) => {
        const dexName = cacheKey.split('-')[0];
        return this.updatePoolReserves(cacheKey, poolContract, dexName);
      }
    );
    
    await Promise.all(updatePromises);
  }
  
  private async checkArbitrageOpportunities() {
    try {
      for (const pair of ARBITRAGE_PAIRS) {
        const opportunities = await this.findArbitrageForPair(pair.tokenA, pair.tokenB);
        
        for (const opportunity of opportunities) {
          if (opportunity.profitPercent > 0.1) { // Only log opportunities > 0.1%
            await this.logArbitrageOpportunity(opportunity);
          }
        }
      }
    } catch (error) {
      console.error("❌ Error checking arbitrage opportunities:", error);
    }
  }
  
  private async findArbitrageForPair(tokenA: string, tokenB: string): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    
    // Get all pools for this pair
    const poolsForPair: Array<{ dexName: string; reserves: PoolReserves }> = [];
    
    for (const [cacheKey, reserves] of this.reservesCache.entries()) {
      const [dexName, token0, token1] = cacheKey.split('-');
      
      if ((token0 === tokenA && token1 === tokenB) || 
          (token0 === tokenB && token1 === tokenA)) {
        poolsForPair.push({ dexName, reserves });
      }
    }
    
    // Compare prices between all pairs
    for (let i = 0; i < poolsForPair.length; i++) {
      for (let j = i + 1; j < poolsForPair.length; j++) {
        const pool1 = poolsForPair[i];
        const pool2 = poolsForPair[j];
        
        const opportunity = this.calculateArbitrage(pool1, pool2, tokenA, tokenB);
        if (opportunity) {
          opportunities.push(opportunity);
        }
      }
    }
    
    return opportunities;
  }
  
  private calculateArbitrage(
    pool1: { dexName: string; reserves: PoolReserves },
    pool2: { dexName: string; reserves: PoolReserves },
    tokenA: string,
    tokenB: string
  ): ArbitrageOpportunity | null {
    
    try {
      // Get prices from both pools
      const price1 = this.getPrice(pool1.reserves, tokenA, tokenB);
      const price2 = this.getPrice(pool2.reserves, tokenA, tokenB);
      
      if (!price1 || !price2) return null;
      
      // Determine which pool has lower price (buy from) and higher price (sell to)
      const [buyDex, sellDex, buyPrice, sellPrice] = 
        price1 < price2 
          ? [pool1.dexName, pool2.dexName, price1, price2]
          : [pool2.dexName, pool1.dexName, price2, price1];
      
      const priceGap = sellPrice - buyPrice;
      const profitPercent = (priceGap / buyPrice) * 100;
      
      // Calculate gas estimate (rough estimate)
      const estimatedGas = 300000; // 2 swaps + overhead
      
      // Calculate minimum trade amount to be profitable
      const gasPrice = 25; // 25 gwei
      const gasUsed = estimatedGas * gasPrice * 1e-9; // Convert to ETH
      const minTradeAmount = gasUsed / (priceGap / buyPrice); // Min amount to cover gas
      
      // Calculate max trade amount based on pool liquidity
      const maxTradeAmount = Math.min(
        this.getMaxTradeAmount(pool1.reserves, tokenA, tokenB),
        this.getMaxTradeAmount(pool2.reserves, tokenA, tokenB)
      );
      
      return {
        tokenA,
        tokenB,
        buyDex,
        sellDex,
        buyPrice,
        sellPrice,
        priceGap,
        profitPercent,
        estimatedGas,
        minTradeAmount: minTradeAmount.toString(),
        maxTradeAmount: maxTradeAmount.toString(),
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error("❌ Error calculating arbitrage:", error);
      return null;
    }
  }
  
  private getPrice(reserves: PoolReserves, tokenA: string, tokenB: string): number | null {
    try {
      const token0 = reserves.token0.toLowerCase();
      const token1 = reserves.token1.toLowerCase();
      const tokenAAddr = tokenA.toLowerCase();
      const tokenBAddr = tokenB.toLowerCase();
      
      let reserve0, reserve1, decimals0, decimals1;
      
      if (token0 === tokenAAddr && token1 === tokenBAddr) {
        reserve0 = reserves.reserve0;
        reserve1 = reserves.reserve1;
        decimals0 = TOKEN_DECIMALS[tokenA] || 18;
        decimals1 = TOKEN_DECIMALS[tokenB] || 18;
      } else if (token0 === tokenBAddr && token1 === tokenAAddr) {
        reserve0 = reserves.reserve1;
        reserve1 = reserves.reserve0;
        decimals0 = TOKEN_DECIMALS[tokenA] || 18;
        decimals1 = TOKEN_DECIMALS[tokenB] || 18;
      } else {
        return null;
      }
      
      if (reserve0 === 0n || reserve1 === 0n) return null;
      
      // Price = reserve1 / reserve0, adjusted for decimals
      const price = (Number(reserve1) / Number(reserve0)) * 
                   (10 ** (decimals0 - decimals1));
      
      return price;
      
    } catch (error) {
      console.error("❌ Error getting price:", error);
      return null;
    }
  }
  
  private getMaxTradeAmount(reserves: PoolReserves, tokenA: string, tokenB: string): number {
    try {
      const token0 = reserves.token0.toLowerCase();
      const tokenAAddr = tokenA.toLowerCase();
      
      // Use 5% of the pool's liquidity as max trade amount
      const relevantReserve = token0 === tokenAAddr ? reserves.reserve0 : reserves.reserve1;
      const decimals = TOKEN_DECIMALS[tokenA] || 18;
      
      return Number(relevantReserve) * 0.05 / (10 ** decimals);
      
    } catch (error) {
      console.error("❌ Error calculating max trade amount:", error);
      return 0;
    }
  }
  
  private async logArbitrageOpportunity(opportunity: ArbitrageOpportunity) {
    const tokenASymbol = this.getTokenSymbol(opportunity.tokenA);
    const tokenBSymbol = this.getTokenSymbol(opportunity.tokenB);
    
    console.log("\n🚀 ARBITRAGE OPPORTUNITY DETECTED!");
    console.log(`📊 Pair: ${tokenASymbol}/${tokenBSymbol}`);
    console.log(`💰 Buy from: ${opportunity.buyDex} at ${opportunity.buyPrice.toFixed(6)}`);
    console.log(`💸 Sell to: ${opportunity.sellDex} at ${opportunity.sellPrice.toFixed(6)}`);
    console.log(`📈 Price Gap: ${opportunity.priceGap.toFixed(6)} (${opportunity.profitPercent.toFixed(2)}%)`);
    console.log(`⛽ Estimated Gas: ${opportunity.estimatedGas.toLocaleString()}`);
    console.log(`🔢 Min Trade: ${parseFloat(opportunity.minTradeAmount).toFixed(4)} ${tokenASymbol}`);
    console.log(`🔢 Max Trade: ${parseFloat(opportunity.maxTradeAmount).toFixed(4)} ${tokenASymbol}`);
    console.log(`⏰ Timestamp: ${new Date(opportunity.timestamp).toISOString()}`);
    console.log("─".repeat(50));
    
    // Store in Redis for potential execution
    if (opportunity.profitPercent > 0.5 && this.redisClient.isOpen) { // Only store high-profit opportunities
      await this.redisClient.setEx(
        `${MEV_CONFIG.REDIS_KEY_PREFIX}opportunity:${opportunity.tokenA}-${opportunity.tokenB}-${opportunity.timestamp}`,
        30, // 30 second TTL
        JSON.stringify(opportunity)
      );
    }
  }
  
  private getTokenSymbol(address: string): string {
    const symbols: { [key: string]: string } = {
      [TOKENS.WAVAX]: "WAVAX",
      [TOKENS.USDC]: "USDC",
      [TOKENS.USDT]: "USDT",
      [TOKENS.DAI]: "DAI",
      [TOKENS.WETH]: "WETH"
    };
    
    return symbols[address] || address.slice(0, 8) + "...";
  }
  
  async stop() {
    console.log("🛑 Stopping arbitrage detector...");
    this.isRunning = false;
    
    // Clear intervals
    if (this.reserveUpdateInterval) {
      clearInterval(this.reserveUpdateInterval);
      this.reserveUpdateInterval = undefined;
    }
    
    if (this.opportunityCheckInterval) {
      clearInterval(this.opportunityCheckInterval);
      this.opportunityCheckInterval = undefined;
    }
    
    // Close Redis connection if it's still open
    if (this.redisClient.isOpen) {
      await this.redisClient.quit();
    }
    
    console.log("✅ Arbitrage detector stopped");
  }
  
  // Public method to get current arbitrage opportunities
  async getCurrentOpportunities(): Promise<ArbitrageOpportunity[]> {
    if (!this.redisClient.isOpen) {
      console.log("⚠️  Redis client is not connected, returning empty opportunities");
      return [];
    }
    
    try {
      const keys = await this.redisClient.keys(`${MEV_CONFIG.REDIS_KEY_PREFIX}opportunity:*`);
      const opportunities: ArbitrageOpportunity[] = [];
      
      for (const key of keys) {
        const data = await this.redisClient.get(key);
        if (data) {
          opportunities.push(JSON.parse(data));
        }
      }
      
      return opportunities.sort((a, b) => b.profitPercent - a.profitPercent);
    } catch (error) {
      console.error("❌ Error getting opportunities from Redis:", error);
      return [];
    }
  }
}

// Main execution
async function main() {
  const detector = new ArbitrageDetector();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log("\n🛑 Shutting down gracefully...");
    await detector.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log("\n🛑 Shutting down gracefully...");
    await detector.stop();
    process.exit(0);
  });
  
  try {
    await detector.start();
  } catch (error) {
    console.error("❌ Failed to start arbitrage detector:", error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export default ArbitrageDetector; 