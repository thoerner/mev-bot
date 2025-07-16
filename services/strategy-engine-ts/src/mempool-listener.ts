import { ethers } from "ethers";
import { createClient, RedisClientType } from "redis";
import { CURRENT_NETWORK, ABIS, MEV_CONFIG, TOKENS } from "./constants";

interface EnrichedTransaction {
  hash: string;
  from: string;
  to: string | null;
  value: string;
  gasLimit: string;
  gasPrice: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce: number;
  data: string;
  timestamp: number;
  blockNumber?: number;
  decodedCall?: DecodedCall;
}

interface DecodedCall {
  contractAddress: string;
  functionName: string;
  args: any[];
  isSwap: boolean;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: string;
  amountOut?: string;
  path?: string[];
}

class MempoolListener {
  private provider: ethers.JsonRpcProvider;
  private wsProvider: ethers.WebSocketProvider;
  private redisClient: RedisClientType;
  private seenTxs: Set<string> = new Set();
  private isRunning = false;
  
  // DEX interfaces for calldata decoding
  private dexInterfaces: { [address: string]: ethers.Interface } = {};
  
  constructor() {
    this.provider = new ethers.JsonRpcProvider(CURRENT_NETWORK.rpcUrl);
    this.wsProvider = new ethers.WebSocketProvider(CURRENT_NETWORK.wsUrl);
    this.redisClient = createClient({
      url: 'redis://localhost:6379'
    });
    
    this.initializeDexInterfaces();
  }
  
  private initializeDexInterfaces() {
    // Initialize interfaces for known DEX contracts
    const routerInterface = new ethers.Interface(ABIS.UNISWAP_V2_ROUTER);
    
    // Add interfaces for all known DEX routers
    const knownRouters = [
      "0x60aE616a2155Ee3d9A68541Ba4544862310933d4", // TraderJoe V1
      "0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106", // Pangolin
      "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506", // SushiSwap
    ];
    
    knownRouters.forEach(router => {
      this.dexInterfaces[router.toLowerCase()] = routerInterface;
    });
  }
  
  async start() {
    console.log("🚀 Starting MEV Mempool Listener...");
    
    // Connect to Redis
    await this.redisClient.connect();
    console.log("✅ Connected to Redis");
    
    // Set up WebSocket connection with reconnection logic
    await this.setupWebSocketConnection();
    
    this.isRunning = true;
    console.log("🎯 Mempool listener is now active");
    
    // Cleanup old entries every 5 minutes
    setInterval(() => this.cleanupOldEntries(), 5 * 60 * 1000);
  }
  
  private async setupWebSocketConnection() {
    try {
      console.log("🔌 Connecting to WebSocket...");
      
      // Subscribe to pending transactions
      this.wsProvider.on("pending", async (txHash: string) => {
        await this.handlePendingTransaction(txHash);
      });
      
      // Handle connection errors
      this.wsProvider.on("error", (error) => {
        console.error("❌ WebSocket error:", error);
        this.reconnectWebSocket();
      });
      
      console.log("✅ WebSocket connected and listening for pending transactions");
      
    } catch (error) {
      console.error("❌ Failed to setup WebSocket:", error);
      setTimeout(() => this.setupWebSocketConnection(), 5000);
    }
  }
  
  private async reconnectWebSocket() {
    console.log("🔄 Reconnecting WebSocket...");
    try {
      this.wsProvider.destroy();
      this.wsProvider = new ethers.WebSocketProvider(CURRENT_NETWORK.wsUrl);
      await this.setupWebSocketConnection();
    } catch (error) {
      console.error("❌ Reconnection failed:", error);
      setTimeout(() => this.reconnectWebSocket(), 5000);
    }
  }
  
  private async handlePendingTransaction(txHash: string) {
    try {
      // Deduplicate
      if (this.seenTxs.has(txHash)) {
        return;
      }
      
      const startTime = Date.now();
      
      // Fetch full transaction details
      const tx = await this.provider.getTransaction(txHash);
      if (!tx) {
        return;
      }
      
      // Mark as seen
      this.seenTxs.add(txHash);
      
      // Enrich transaction
      const enrichedTx = await this.enrichTransaction(tx);
      
      // Store in Redis
      await this.storeTransaction(enrichedTx);
      
      const processingTime = Date.now() - startTime;
      
      // Log interesting transactions
      if (enrichedTx.decodedCall?.isSwap) {
        console.log(`🔄 Swap detected: ${txHash.slice(0, 10)}... (${processingTime}ms)`);
        console.log(`   From: ${enrichedTx.decodedCall.tokenIn} → ${enrichedTx.decodedCall.tokenOut}`);
        console.log(`   Amount: ${enrichedTx.decodedCall.amountIn}`);
      }
      
      // Clean up memory if too many seen transactions
      if (this.seenTxs.size > 10000) {
        this.seenTxs.clear();
      }
      
    } catch (error) {
      console.error(`❌ Error processing transaction ${txHash}:`, error);
    }
  }
  
  private async enrichTransaction(tx: ethers.TransactionResponse): Promise<EnrichedTransaction> {
    const enriched: EnrichedTransaction = {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value.toString(),
      gasLimit: tx.gasLimit.toString(),
      gasPrice: tx.gasPrice?.toString() || "0",
      maxFeePerGas: tx.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString(),
      nonce: tx.nonce,
      data: tx.data,
      timestamp: Date.now(),
      blockNumber: tx.blockNumber || undefined,
    };
    
    // Decode calldata if it's a known DEX transaction
    if (tx.to && this.dexInterfaces[tx.to.toLowerCase()]) {
      enriched.decodedCall = this.decodeTransaction(tx.to, tx.data);
    }
    
    return enriched;
  }
  
  private decodeTransaction(contractAddress: string, data: string): DecodedCall | undefined {
    try {
      const iface = this.dexInterfaces[contractAddress.toLowerCase()];
      if (!iface) return undefined;
      
      const decoded = iface.parseTransaction({ data });
      if (!decoded) return undefined;
      
      const decodedCall: DecodedCall = {
        contractAddress,
        functionName: decoded.name,
        args: decoded.args,
        isSwap: false,
      };
      
      // Check if it's a swap function
      if (decoded.name.includes('swap')) {
        decodedCall.isSwap = true;
        
        // Extract swap details based on function name
        if (decoded.name === 'swapExactTokensForTokens') {
          decodedCall.amountIn = decoded.args[0].toString();
          decodedCall.path = decoded.args[2];
          decodedCall.tokenIn = decoded.args[2][0];
          decodedCall.tokenOut = decoded.args[2][decoded.args[2].length - 1];
        } else if (decoded.name === 'swapTokensForExactTokens') {
          decodedCall.amountOut = decoded.args[0].toString();
          decodedCall.path = decoded.args[2];
          decodedCall.tokenIn = decoded.args[2][0];
          decodedCall.tokenOut = decoded.args[2][decoded.args[2].length - 1];
        }
      }
      
      return decodedCall;
      
    } catch (error) {
      console.error(`❌ Error decoding transaction data:`, error);
      return undefined;
    }
  }
  
  private async storeTransaction(tx: EnrichedTransaction) {
    try {
      const key = `${MEV_CONFIG.REDIS_KEY_PREFIX}tx:${tx.hash}`;
      
      // Store with TTL
      await this.redisClient.setEx(
        key,
        MEV_CONFIG.MEMPOOL_TTL,
        JSON.stringify(tx)
      );
      
      // If it's a swap, also store in swap-specific key for faster lookup
      if (tx.decodedCall?.isSwap) {
        const swapKey = `${MEV_CONFIG.REDIS_KEY_PREFIX}swaps:${tx.hash}`;
        await this.redisClient.setEx(
          swapKey,
          MEV_CONFIG.MEMPOOL_TTL,
          JSON.stringify(tx)
        );
        
        // Add to swap list for batch processing
        await this.redisClient.lPush(
          `${MEV_CONFIG.REDIS_KEY_PREFIX}swap_queue`,
          tx.hash
        );
        
        // Trim queue to last 1000 swaps
        await this.redisClient.lTrim(
          `${MEV_CONFIG.REDIS_KEY_PREFIX}swap_queue`,
          0,
          999
        );
      }
      
    } catch (error) {
      console.error(`❌ Error storing transaction ${tx.hash}:`, error);
    }
  }
  
  private async cleanupOldEntries() {
    try {
      console.log("🧹 Cleaning up old Redis entries...");
      
      // Get all keys matching our pattern
      const keys = await this.redisClient.keys(`${MEV_CONFIG.REDIS_KEY_PREFIX}*`);
      
      let cleanedCount = 0;
      for (const key of keys) {
        const ttl = await this.redisClient.ttl(key);
        if (ttl === -1 || ttl <= 0) {
          await this.redisClient.del(key);
          cleanedCount++;
        }
      }
      
      console.log(`✅ Cleaned up ${cleanedCount} old entries`);
      
    } catch (error) {
      console.error("❌ Error during cleanup:", error);
    }
  }
  
  async stop() {
    console.log("🛑 Stopping mempool listener...");
    this.isRunning = false;
    
    this.wsProvider.destroy();
    await this.redisClient.quit();
    
    console.log("✅ Mempool listener stopped");
  }
  
  // Public method to get pending swaps
  async getPendingSwaps(limit: number = 100): Promise<EnrichedTransaction[]> {
    try {
      const hashes = await this.redisClient.lRange(
        `${MEV_CONFIG.REDIS_KEY_PREFIX}swap_queue`,
        0,
        limit - 1
      );
      
      const swaps: EnrichedTransaction[] = [];
      for (const hash of hashes) {
        const key = `${MEV_CONFIG.REDIS_KEY_PREFIX}tx:${hash}`;
        const txData = await this.redisClient.get(key);
        if (txData) {
          swaps.push(JSON.parse(txData));
        }
      }
      
      return swaps;
      
    } catch (error) {
      console.error("❌ Error fetching pending swaps:", error);
      return [];
    }
  }
}

// Main execution
async function main() {
  const listener = new MempoolListener();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log("\n🛑 Shutting down gracefully...");
    await listener.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log("\n🛑 Shutting down gracefully...");
    await listener.stop();
    process.exit(0);
  });
  
  try {
    await listener.start();
  } catch (error) {
    console.error("❌ Failed to start mempool listener:", error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export default MempoolListener; 