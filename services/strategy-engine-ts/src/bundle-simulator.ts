import { ethers } from "ethers";
import { spawn, ChildProcess } from "child_process";
import { createClient, RedisClientType } from "redis";
import { CURRENT_NETWORK, TOKENS, ABIS, MEV_CONFIG } from "./constants";

interface SimulationResult {
  success: boolean;
  gasUsed: number;
  profit: string;
  error?: string;
  executionTime: number;
}

interface TransactionBundle {
  transactions: ethers.TransactionRequest[];
  expectedProfit: string;
  description: string;
}

class BundleSimulator {
  private anvilProcess: ChildProcess | null = null;
  private simulationProvider: ethers.JsonRpcProvider | null = null;
  private forkBlockNumber: number | null = null;
  private simulationRpcUrl = "http://127.0.0.1:8545";
  private readonly mainProvider: ethers.JsonRpcProvider;
  
  constructor() {
    this.mainProvider = new ethers.JsonRpcProvider(CURRENT_NETWORK.rpcUrl);
  }
  
  async start() {
    console.log("🔧 Starting Bundle Simulator...");
    
    // Get current block number for fork
    this.forkBlockNumber = await this.mainProvider.getBlockNumber();
    console.log(`📊 Forking from block: ${this.forkBlockNumber}`);
    
    // Start Anvil fork
    await this.startAnvilFork();
    
    // Wait for Anvil to be ready
    await this.waitForAnvil();
    
    // Create simulation provider
    this.simulationProvider = new ethers.JsonRpcProvider(this.simulationRpcUrl);
    
    // Wait a bit more for Anvil to be fully ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log("✅ Bundle simulator is ready");
  }
  
  private async findAvailablePort(startPort: number): Promise<number> {
    const net = require('net');
    
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(startPort, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      server.on('error', () => {
        // Try next port
        resolve(this.findAvailablePort(startPort + 1));
      });
    });
  }

  private async startAnvilFork() {
    console.log("🔄 Starting Anvil fork...");
    
    // Try to find an available port
    const port = await this.findAvailablePort(8545);
    
    const anvilArgs = [
      "--fork-url", CURRENT_NETWORK.rpcUrl,
      "--fork-block-number", (this.forkBlockNumber! - 2).toString(), // Fork 2 blocks behind for safety
      "--port", port.toString(),
      "--host", "127.0.0.1",
      "--accounts", "10",
      "--balance", "1000000", // 1M AVAX per account
      "--gas-limit", "30000000",
      "--gas-price", "0",
      "--base-fee", "0",
      "--auto-impersonate"
    ];
    
    this.anvilProcess = spawn("anvil", anvilArgs);
    
    if (!this.anvilProcess) {
      throw new Error("Failed to start Anvil process");
    }
    
    // Handle process events
    this.anvilProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      if (output.includes("Listening on")) {
        console.log("✅ Anvil fork started successfully");
      }
    });
    
    this.anvilProcess.stderr?.on("data", (data) => {
      const errorOutput = data.toString();
      if (errorOutput.includes("Address already in use")) {
        console.error("❌ Anvil error: Address already in use (os error 98)");
      } else {
        console.error("❌ Anvil error:", errorOutput);
      }
    });
    
    this.anvilProcess.on("exit", (code) => {
      console.log(`🛑 Anvil process exited with code ${code}`);
      this.anvilProcess = null;
    });
    
    // Update simulation provider URL with the correct port
    this.simulationRpcUrl = `http://127.0.0.1:${port}`;
  }
  
  private async waitForAnvil(timeout = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const testProvider = new ethers.JsonRpcProvider(this.simulationRpcUrl);
        await testProvider.getBlockNumber();
        console.log("✅ Anvil is ready");
        return;
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    throw new Error("Anvil failed to start within timeout");
  }
  
    async simulateBundle(bundle: TransactionBundle, fastMode: boolean = MEV_CONFIG.FAST_SIMULATION): Promise<SimulationResult> {
    if (!this.simulationProvider) {
      throw new Error("Simulation provider not initialized");
    }

    const startTime = Date.now();
    
    try {
      console.log(`🧪 Simulating bundle: ${bundle.description}`);
      
      // Create test wallet with funds
      const testWallet = new ethers.Wallet(
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // Default anvil private key
        this.simulationProvider
      );
      
      // Get initial balance
      const initialBalance = await testWallet.provider!.getBalance(testWallet.address);
      console.log(`💰 Initial balance: ${ethers.formatEther(initialBalance)} AVAX`);
      
      // Get the starting nonce to ensure proper transaction ordering
      let currentNonce = await testWallet.provider!.getTransactionCount(testWallet.address);
      
      let totalGasUsed = 0;
      let totalGasCost = 0n; // Track gas costs
      
      // Execute transactions in bundle
      for (let i = 0; i < bundle.transactions.length; i++) {
        const tx = bundle.transactions[i];
        
        console.log(`📤 Executing transaction ${i + 1}/${bundle.transactions.length}`);
        
        // Use a reasonable gas price instead of 0
        const feeData = await testWallet.provider!.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.parseUnits("25", "gwei");
        

        
        // Send transaction with explicit nonce
        const txResponse = await testWallet.sendTransaction({
          ...tx,
          nonce: currentNonce + i, // Ensure correct nonce ordering
          gasLimit: tx.gasLimit || MEV_CONFIG.GAS_LIMIT,
          gasPrice: gasPrice
        });
        
        // Wait for confirmation
        const receipt = await txResponse.wait();
        
        if (!receipt) {
          throw new Error(`Transaction ${i + 1} failed - no receipt`);
        }
        
        if (receipt.status === 0) {
          throw new Error(`Transaction ${i + 1} reverted`);
        }
        

        
        const gasUsed = Number(receipt.gasUsed);
        const gasCost = BigInt(gasUsed) * gasPrice;
        totalGasUsed += gasUsed;
        totalGasCost += gasCost;
        console.log(`⛽ Transaction ${i + 1} used ${gasUsed.toLocaleString()} gas (${ethers.formatEther(gasCost)} AVAX)`);
      }
      
      let profit: bigint;
      
      if (fastMode) {
        // Fast profit calculation - prioritizes speed over precision
        // This avoids waiting for balance updates which can be slow in Anvil
        let calculatedProfit = 0n - totalGasCost; // Start with negative gas cost
        
        // Subtract any AVAX value sent in transactions
        for (const tx of bundle.transactions) {
          if (tx.value) {
            calculatedProfit -= BigInt(tx.value);
          }
        }
        
        // Add expected profit from bundle if specified
        if (bundle.expectedProfit && bundle.expectedProfit !== "0") {
          calculatedProfit += BigInt(bundle.expectedProfit);
        }
        
        profit = calculatedProfit;
        console.log(`📈 Calculated profit (fast mode): ${ethers.formatEther(profit)} AVAX`);
      } else {
        // Precise profit calculation - waits for balance updates
        await new Promise(resolve => setTimeout(resolve, 100));
        const finalBalance = await testWallet.provider!.getBalance(testWallet.address);
        profit = finalBalance - initialBalance;
        console.log(`💰 Final balance: ${ethers.formatEther(finalBalance)} AVAX`);
        console.log(`📈 Actual profit (precise mode): ${ethers.formatEther(profit)} AVAX`);
      }
      
              const executionTime = Date.now() - startTime;
      console.log(`⛽ Total gas used: ${totalGasUsed.toLocaleString()}`);
      console.log(`💸 Total gas cost: ${ethers.formatEther(totalGasCost)} AVAX`);
      console.log(`⏱️ Execution time: ${executionTime}ms`);
      
      return {
        success: true,
        gasUsed: totalGasUsed,
        profit: profit.toString(),
        executionTime
      };
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      console.error(`❌ Bundle simulation failed: ${error}`);
      
      return {
        success: false,
        gasUsed: 0,
        profit: "0",
        error: error instanceof Error ? error.message : "Unknown error",
        executionTime
      };
    }
  }
  
  async createArbitrageBundle(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    dexBuy: string,
    dexSell: string
  ): Promise<TransactionBundle> {
    
    if (!this.simulationProvider) {
      throw new Error("Simulation provider not initialized");
    }
    
    const testWallet = new ethers.Wallet(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      this.simulationProvider
    );
    
    // Router addresses for different DEXs
    const routerAddresses: { [key: string]: string } = {
      "TraderJoe": "0x60aE616a2155Ee3d9A68541Ba4544862310933d4",
      "Pangolin": "0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106",
      "SushiSwap": "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"
    };
    
    const buyRouter = routerAddresses[dexBuy];
    const sellRouter = routerAddresses[dexSell];
    
    if (!buyRouter || !sellRouter) {
      throw new Error(`Unknown DEX: ${dexBuy} or ${dexSell}`);
    }
    
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
    
    const transactions: ethers.TransactionRequest[] = [];
    
    // If tokenIn is not WAVAX, we need to approve it first
    if (tokenIn !== TOKENS.WAVAX) {
      const tokenContract = new ethers.Contract(tokenIn, ABIS.ERC20, testWallet);
      
      // Approve buy router
      transactions.push({
        to: tokenIn,
        data: tokenContract.interface.encodeFunctionData("approve", [buyRouter, amountIn])
      });
    }
    
    // Transaction 1: Buy tokens on first DEX
    const buyRouterContract = new ethers.Contract(buyRouter, ABIS.UNISWAP_V2_ROUTER, testWallet);
    const buyPath = [tokenIn, tokenOut];
    
    if (tokenIn === TOKENS.WAVAX) {
      // If paying with AVAX, use swapExactAVAXForTokens
      transactions.push({
        to: buyRouter,
        value: amountIn,
        data: buyRouterContract.interface.encodeFunctionData("swapExactAVAXForTokens", [
          "0", // amountOutMin (0 for simulation)
          buyPath,
          testWallet.address,
          deadline
        ])
      });
    } else {
      // If paying with ERC20, use swapExactTokensForTokens
      transactions.push({
        to: buyRouter,
        data: buyRouterContract.interface.encodeFunctionData("swapExactTokensForTokens", [
          amountIn,
          "0", // amountOutMin (0 for simulation)
          buyPath,
          testWallet.address,
          deadline
        ])
      });
    }
    
    // Transaction 2: Approve sell router (if needed)
    if (tokenOut !== TOKENS.WAVAX) {
      const tokenContract = new ethers.Contract(tokenOut, ABIS.ERC20, testWallet);
      
      transactions.push({
        to: tokenOut,
        data: tokenContract.interface.encodeFunctionData("approve", [sellRouter, ethers.MaxUint256])
      });
    }
    
    // Transaction 3: Sell tokens on second DEX
    const sellRouterContract = new ethers.Contract(sellRouter, ABIS.UNISWAP_V2_ROUTER, testWallet);
    const sellPath = [tokenOut, tokenIn];
    
    if (tokenOut === TOKENS.WAVAX) {
      // If selling AVAX, use swapExactAVAXForTokens
      transactions.push({
        to: sellRouter,
        value: "0", // Will be set dynamically based on received amount
        data: sellRouterContract.interface.encodeFunctionData("swapExactAVAXForTokens", [
          "0", // amountOutMin (0 for simulation)
          sellPath,
          testWallet.address,
          deadline
        ])
      });
    } else {
      // If selling ERC20, use swapExactTokensForTokens
      transactions.push({
        to: sellRouter,
        data: sellRouterContract.interface.encodeFunctionData("swapExactTokensForTokens", [
          "0", // amountIn (will be set dynamically)
          "0", // amountOutMin (0 for simulation)
          sellPath,
          testWallet.address,
          deadline
        ])
      });
    }
    
    return {
      transactions,
      expectedProfit: "0", // Will be calculated during simulation
      description: `Arbitrage ${this.getTokenSymbol(tokenIn)}→${this.getTokenSymbol(tokenOut)} (${dexBuy}→${dexSell})`
    };
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
  
  async testSimpleSwap(): Promise<SimulationResult> {
    console.log("🧪 Testing simple swap simulation...");
    
    if (!this.simulationProvider) {
      throw new Error("Simulation provider not initialized");
    }
    
    // Create test wallet
    const testWallet = new ethers.Wallet(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      this.simulationProvider
    );
    

    
    // Create router contract instance
    const routerAddress = "0x60aE616a2155Ee3d9A68541Ba4544862310933d4"; // TraderJoe Router
    const routerContract = new ethers.Contract(routerAddress, ABIS.UNISWAP_V2_ROUTER, testWallet);
    
    // Setup swap parameters
    const amountIn = ethers.parseEther("1"); // 1 AVAX
    const amountOutMin = 0; // Accept any amount of tokens out
    const path = [TOKENS.WAVAX, TOKENS.USDC];
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
    
    // Create properly encoded transaction data
    const swapData = routerContract.interface.encodeFunctionData("swapExactAVAXForTokens", [
      amountOutMin,
      path,
      testWallet.address,
      deadline
    ]);
    
    const bundle: TransactionBundle = {
      transactions: [
        {
          to: routerAddress,
          value: amountIn,
          data: swapData,
          gasLimit: 300000
        }
      ],
      expectedProfit: "0", // Simple swap test - no expected profit, just testing execution
      description: "Simple WAVAX -> USDC swap test"
    };
    
    return await this.simulateBundle(bundle);
  }

  async testArbitrageSimulation(): Promise<SimulationResult> {
    console.log("🎯 Testing arbitrage simulation...");
    
    if (!this.simulationProvider) {
      throw new Error("Simulation provider not initialized");
    }
    
    // Create test wallet
    const testWallet = new ethers.Wallet(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      this.simulationProvider
    );
    
    // Router contracts
    const traderJoeRouter = new ethers.Contract(
      "0x60aE616a2155Ee3d9A68541Ba4544862310933d4",
      ABIS.UNISWAP_V2_ROUTER,
      testWallet
    );
    
    const sushiRouter = new ethers.Contract(
      "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
      ABIS.UNISWAP_V2_ROUTER,
      testWallet
    );
    
    // Arbitrage parameters (based on real opportunities we've seen)
    const amountIn = ethers.parseEther("1"); // 1 AVAX
    const deadline = Math.floor(Date.now() / 1000) + 300;
    
    // Step 1: Buy USDC from TraderJoe (lower price)
    const buyPath = [TOKENS.WAVAX, TOKENS.USDC];
    const buyData = traderJoeRouter.interface.encodeFunctionData("swapExactAVAXForTokens", [
      0, // amountOutMin - accept any amount
      buyPath,
      testWallet.address,
      deadline
    ]);
    
    // For testing, we'll simulate a simpler arbitrage where we just buy and sell
    // In a real arbitrage, you'd need to calculate exact amounts based on pool reserves
    
    // For now, let's create a simple test that shows the concept
    const bundle: TransactionBundle = {
      transactions: [
        {
          to: traderJoeRouter.target,
          value: amountIn,
          data: buyData,
          gasLimit: 300000
        }
      ],
      expectedProfit: ethers.parseEther("0.01").toString(), // Expected 1% profit
      description: "WAVAX/USDC arbitrage test: TraderJoe buy"
    };
    
    return await this.simulateBundle(bundle);
  }

  async simulateArbitrageOpportunity(opportunity: {
    tokenA: string;
    tokenB: string;
    buyDex: string;
    sellDex: string;
    buyPrice: number;
    sellPrice: number;
    profitPercent: number;
    minTradeAmount: string;
    maxTradeAmount: string;
  }): Promise<SimulationResult> {
    console.log(`🎯 Simulating arbitrage: ${opportunity.tokenA}/${opportunity.tokenB}`);
    console.log(`   Buy from: ${opportunity.buyDex} at ${opportunity.buyPrice}`);
    console.log(`   Sell to: ${opportunity.sellDex} at ${opportunity.sellPrice}`);
    console.log(`   Expected profit: ${opportunity.profitPercent.toFixed(2)}%`);
    
    if (!this.simulationProvider) {
      throw new Error("Simulation provider not initialized");
    }
    
    // Create test wallet
    const testWallet = new ethers.Wallet(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      this.simulationProvider
    );
    
    // Router addresses
    const routerAddresses = {
      'TraderJoe': "0x60aE616a2155Ee3d9A68541Ba4544862310933d4",
      'SushiSwap': "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
      'Pangolin': "0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106"
    };
    
    const buyRouter = new ethers.Contract(
      routerAddresses[opportunity.buyDex as keyof typeof routerAddresses],
      ABIS.UNISWAP_V2_ROUTER,
      testWallet
    );
    
    const sellRouter = new ethers.Contract(
      routerAddresses[opportunity.sellDex as keyof typeof routerAddresses],
      ABIS.UNISWAP_V2_ROUTER,
      testWallet
    );
    
    // Use a conservative trade amount (middle of min/max range)
    const minAmount = parseFloat(opportunity.minTradeAmount);
    const maxAmount = parseFloat(opportunity.maxTradeAmount);
    const tradeAmount = Math.min(maxAmount, minAmount * 2); // Use 2x min or max, whichever is smaller
    
    // Fix decimal precision issues by rounding to 18 decimal places
    const amountIn = ethers.parseEther(tradeAmount.toFixed(18));
    const deadline = Math.floor(Date.now() / 1000) + 300;
    
    const transactions = [];
    
    // Determine if we're trading AVAX or tokens
    const isAVAXTokenA = opportunity.tokenA === TOKENS.WAVAX;
    const isAVAXTokenB = opportunity.tokenB === TOKENS.WAVAX;
    
    if (isAVAXTokenA) {
      // Selling AVAX for tokenB, then selling tokenB for AVAX
      const buyPath = [opportunity.tokenA, opportunity.tokenB];
      const sellPath = [opportunity.tokenB, opportunity.tokenA];
      
      // Step 1: Buy tokenB from buyDex using AVAX
      const buyData = buyRouter.interface.encodeFunctionData("swapExactAVAXForTokens", [
        0, // amountOutMin
        buyPath,
        testWallet.address,
        deadline
      ]);
      
      transactions.push({
        to: buyRouter.target,
        value: amountIn,
        data: buyData,
        gasLimit: 300000
      });
      
      // Step 2: Approve sellRouter to spend tokenB
      const tokenBContract = new ethers.Contract(opportunity.tokenB, ABIS.ERC20, testWallet);
      // Fix decimal precision issues by rounding to 6 decimal places
      const tokenBAmount = (tradeAmount * opportunity.buyPrice).toFixed(6);
      const estimatedTokenB = ethers.parseUnits(tokenBAmount, 6);
      
      const approveData = tokenBContract.interface.encodeFunctionData("approve", [
        sellRouter.target,
        estimatedTokenB
      ]);
      
      transactions.push({
        to: opportunity.tokenB,
        value: 0,
        data: approveData,
        gasLimit: 100000
      });
      
      // Step 3: Sell tokenB for AVAX on sellDex
      const sellData = sellRouter.interface.encodeFunctionData("swapExactTokensForAVAX", [
        estimatedTokenB,
        0, // amountOutMin
        sellPath,
        testWallet.address,
        deadline
      ]);
      
      transactions.push({
        to: sellRouter.target,
        value: 0,
        data: sellData,
        gasLimit: 300000
      });
      
    } else {
      // Token-to-token arbitrage (not involving AVAX directly)
      const buyPath = [opportunity.tokenA, opportunity.tokenB];
      const sellPath = [opportunity.tokenB, opportunity.tokenA];
      
      // First, we need to get tokenA (assume we're starting with AVAX)
      const getTokenAData = buyRouter.interface.encodeFunctionData("swapExactAVAXForTokens", [
        0,
        [TOKENS.WAVAX, opportunity.tokenA],
        testWallet.address,
        deadline
      ]);
      
      transactions.push({
        to: buyRouter.target,
        value: amountIn,
        data: getTokenAData,
        gasLimit: 300000
      });
      
      // Then do the arbitrage with the tokens
      // This is more complex and would need dynamic amounts
      console.log("⚠️  Token-to-token arbitrage simulation not fully implemented yet");
    }
    
    const bundle: TransactionBundle = {
      transactions,
      // Fix decimal precision issues by rounding before parsing
      expectedProfit: ethers.parseEther((tradeAmount * opportunity.profitPercent / 100).toFixed(18)).toString(),
      description: `${opportunity.tokenA}/${opportunity.tokenB} arbitrage: ${opportunity.buyDex} → ${opportunity.sellDex}`
    };
    
    return await this.simulateBundle(bundle);
  }

  async testLiveArbitrageOpportunities(): Promise<SimulationResult[]> {
    console.log("🔍 Testing live arbitrage opportunities from Redis...");
    
    const redisClient = createClient({ url: 'redis://localhost:6379' });
    await redisClient.connect();
    
    try {
      // Get all arbitrage opportunities from Redis
      const keys = await redisClient.keys(`${MEV_CONFIG.REDIS_KEY_PREFIX}opportunity:*`);
      
      if (keys.length === 0) {
        console.log("⚠️  No live arbitrage opportunities found in Redis");
        return [];
      }
      
      console.log(`📊 Found ${keys.length} live arbitrage opportunities`);
      
      const results: SimulationResult[] = [];
      
      // Test up to 3 opportunities to avoid overwhelming the system
      for (let i = 0; i < Math.min(3, keys.length); i++) {
        const key = keys[i];
        const opportunityData = await redisClient.get(key);
        
        if (opportunityData) {
          const opportunity = JSON.parse(opportunityData);
          
          console.log(`\n🎯 Testing opportunity ${i + 1}/${Math.min(3, keys.length)}`);
          console.log(`   Pair: ${opportunity.tokenA}/${opportunity.tokenB}`);
          console.log(`   Profit: ${opportunity.profitPercent.toFixed(2)}%`);
          
          try {
            // Reset fork before each simulation to ensure accurate pool states
            await this.resetFork();
            
            const result = await this.simulateArbitrageOpportunity(opportunity);
            results.push(result);
            
            console.log(`   Simulation result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
            console.log(`   Actual profit: ${ethers.formatEther(result.profit)} AVAX`);
            console.log(`   Gas used: ${result.gasUsed.toLocaleString()}`);
            
            if (result.error) {
              console.log(`   Error: ${result.error}`);
            }
            
          } catch (error) {
            console.error(`   ❌ Simulation failed: ${error}`);
            results.push({
              success: false,
              gasUsed: 0,
              profit: "0",
              error: error instanceof Error ? error.message : "Unknown error",
              executionTime: 0
            });
          }
          
          // Add delay between simulations
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      return results;
      
    } finally {
      await redisClient.quit();
    }
  }
  
  async resetSimulation() {
    console.log("🔄 Resetting simulation environment...");
    
    if (this.anvilProcess) {
      console.log("🛑 Stopping existing Anvil process...");
      this.anvilProcess.kill('SIGTERM');
      
      // Wait for process to exit
      await new Promise<void>((resolve) => {
        if (this.anvilProcess) {
          this.anvilProcess.on('exit', () => resolve());
          // Add timeout to prevent hanging
          setTimeout(resolve, 5000);
        } else {
          resolve();
        }
      });
      
      this.anvilProcess = null;
    }
    
    // Restart Anvil fork
    await this.startAnvilFork();
    await this.waitForAnvil();
    
    // Recreate simulation provider
    this.simulationProvider = new ethers.JsonRpcProvider(this.simulationRpcUrl);
    
    console.log("✅ Simulation environment reset");
  }

  async stop() {
    console.log("🛑 Stopping bundle simulator...");
    
    if (this.anvilProcess) {
      console.log("🔄 Terminating Anvil process...");
      this.anvilProcess.kill('SIGTERM');
      
      // Wait for process to exit
      await new Promise<void>((resolve) => {
        if (this.anvilProcess) {
          this.anvilProcess.on('exit', () => resolve());
          // Add timeout to prevent hanging
          setTimeout(resolve, 5000);
        } else {
          resolve();
        }
      });
      
      this.anvilProcess = null;
    }
    
    this.simulationProvider = null;
    console.log("✅ Bundle simulator stopped");
  }
  
  // Reset fork to latest block
  async resetFork() {
    if (!this.simulationProvider) {
      throw new Error("Simulation provider not initialized");
    }
    
    // Get latest block number
    const latestBlock = await this.mainProvider.getBlockNumber();
    
    // Reset fork to latest block (correct anvil_reset syntax with object parameter)
    await this.simulationProvider.send("anvil_reset", [{
      forking: {
        jsonRpcUrl: CURRENT_NETWORK.rpcUrl,
        blockNumber: latestBlock - 2
      }
    }]);
    
    this.forkBlockNumber = latestBlock - 2;
    
    // Fund the default account with fresh AVAX
    await this.simulationProvider.send("anvil_setBalance", [
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // Default anvil account
      ethers.parseEther("1000000").toString()
    ]);
  }
  
  // Get account balance in simulation
  async getSimulationBalance(address: string): Promise<string> {
    if (!this.simulationProvider) {
      throw new Error("Simulation provider not initialized");
    }
    
    const balance = await this.simulationProvider.getBalance(address);
    return ethers.formatEther(balance);
  }
  
  // Fund an account in simulation
  async fundAccount(address: string, amount: string) {
    if (!this.simulationProvider) {
      throw new Error("Simulation provider not initialized");
    }
    
    console.log(`💰 Funding account ${address} with ${amount} AVAX`);
    
    await this.simulationProvider.send("anvil_setBalance", [
      address,
      ethers.parseEther(amount).toString()
    ]);
    
    console.log(`✅ Account funded successfully`);
  }

  // Monitor Redis for arbitrage opportunities and simulate them
  async startMonitoring() {
    console.log("🔍 Starting to monitor Redis for arbitrage opportunities...");
    
    const redisClient = createClient({ url: 'redis://localhost:6379' });
    await redisClient.connect();
    
    let lastOpportunityCount = 0;
    
    const checkOpportunities = async () => {
      try {
        // Get all arbitrage opportunities from Redis
        const keys = await redisClient.keys(`${MEV_CONFIG.REDIS_KEY_PREFIX}opportunity:*`);
        
        if (keys.length !== lastOpportunityCount) {
          console.log(`📊 Found ${keys.length} arbitrage opportunities in Redis`);
          lastOpportunityCount = keys.length;
        }
        
                 // Process new opportunities (one at a time to avoid nonce conflicts)
         for (const key of keys.slice(0, 3)) { // Limit to top 3 opportunities
           const opportunityData = await redisClient.get(key);
           
           if (opportunityData) {
             const opportunity = JSON.parse(opportunityData);
             
             // Only simulate profitable opportunities
             if (opportunity.profitPercent > 0.1) { // At least 0.1% profit
               console.log(`\n🎯 Simulating opportunity: ${opportunity.tokenA}/${opportunity.tokenB}`);
               console.log(`   Profit: ${opportunity.profitPercent.toFixed(2)}%`);
               console.log(`   Buy: ${opportunity.buyDex} → Sell: ${opportunity.sellDex}`);
               
               try {
                 // Reset fork to fresh state before each simulation
                 // This ensures accurate pool balances for each simulation
                 await this.resetFork();
                 
                 const result = await this.simulateArbitrageOpportunity(opportunity);
                 
                 if (result.success) {
                   console.log(`✅ Simulation successful!`);
                   console.log(`   Profit: ${ethers.formatEther(result.profit)} AVAX`);
                   console.log(`   Gas: ${result.gasUsed.toLocaleString()}`);
                   console.log(`   Time: ${result.executionTime}ms`);
                   
                   // Here you could add logic to execute the transaction if profitable
                   const netProfit = parseFloat(ethers.formatEther(result.profit));
                   if (netProfit > MEV_CONFIG.MIN_PROFIT_THRESHOLD) {
                     console.log(`🚀 Opportunity meets profit threshold! Ready for execution.`);
                   }
                 } else {
                   console.log(`❌ Simulation failed: ${result.error}`);
                 }
               } catch (error) {
                 console.error(`❌ Simulation error: ${error}`);
               }
               
               // Add delay between simulations to prevent overwhelming the system
               await new Promise(resolve => setTimeout(resolve, 1000));
             }
           }
         }
        
      } catch (error) {
        console.error(`❌ Redis monitoring error: ${error}`);
      }
    };
    
    // Check every 2 seconds
    const interval = setInterval(checkOpportunities, 2000);
    
    // Handle cleanup
    process.on('SIGINT', async () => {
      clearInterval(interval);
      await redisClient.quit();
    });
    
    process.on('SIGTERM', async () => {
      clearInterval(interval);
      await redisClient.quit();
    });
    
    console.log("🎯 Monitoring started. Checking for opportunities every 2 seconds...");
  }
}

// Main execution
async function main() {
  const simulator = new BundleSimulator();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log("\n🛑 Shutting down gracefully...");
    await simulator.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log("\n🛑 Shutting down gracefully...");
    await simulator.stop();
    process.exit(0);
  });
  
  try {
    await simulator.start();
    
    // Run initial test simulation
    console.log("\n" + "=".repeat(50));
    console.log("🧪 Running test simulation...");
    console.log("=".repeat(50));
    
    const result = await simulator.testSimpleSwap();
    
    console.log("\n📊 Simulation Result:");
    console.log(`   Success: ${result.success}`);
    console.log(`   Gas Used: ${result.gasUsed.toLocaleString()}`);
    console.log(`   Profit: ${ethers.formatEther(result.profit)} AVAX`);
    console.log(`   Execution Time: ${result.executionTime}ms`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
    // Start monitoring Redis for arbitrage opportunities
    console.log("\n" + "=".repeat(50));
    console.log("🎯 Starting live arbitrage monitoring...");
    console.log("=".repeat(50));
    
    await simulator.startMonitoring();
    
    // Keep process alive
    await new Promise(() => {});
    
  } catch (error) {
    console.error("❌ Failed to start bundle simulator:", error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export default BundleSimulator; 