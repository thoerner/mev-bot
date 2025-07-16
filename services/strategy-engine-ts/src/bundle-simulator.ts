import { ethers } from "ethers";
import { spawn, ChildProcess } from "child_process";
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
      "--balance", "1000000", // 1M ETH per account
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
  
  async simulateBundle(bundle: TransactionBundle): Promise<SimulationResult> {
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
      console.log(`💰 Initial balance: ${ethers.formatEther(initialBalance)} ETH`);
      
      let totalGasUsed = 0;
      
      // Execute transactions in bundle
      for (let i = 0; i < bundle.transactions.length; i++) {
        const tx = bundle.transactions[i];
        
        console.log(`📤 Executing transaction ${i + 1}/${bundle.transactions.length}`);
        
        // Send transaction
        const txResponse = await testWallet.sendTransaction({
          ...tx,
          gasLimit: tx.gasLimit || MEV_CONFIG.GAS_LIMIT,
          gasPrice: tx.gasPrice || "0" // Use 0 gas price for simulation
        });
        
        // Wait for confirmation
        const receipt = await txResponse.wait();
        
        if (!receipt) {
          throw new Error(`Transaction ${i + 1} failed - no receipt`);
        }
        
        if (receipt.status === 0) {
          throw new Error(`Transaction ${i + 1} reverted`);
        }
        
        totalGasUsed += Number(receipt.gasUsed);
        console.log(`⛽ Transaction ${i + 1} used ${receipt.gasUsed.toLocaleString()} gas`);
      }
      
      // Get final balance
      const finalBalance = await testWallet.provider!.getBalance(testWallet.address);
      const profit = finalBalance - initialBalance;
      
      const executionTime = Date.now() - startTime;
      
      console.log(`💰 Final balance: ${ethers.formatEther(finalBalance)} ETH`);
      console.log(`📈 Profit: ${ethers.formatEther(profit)} ETH`);
      console.log(`⛽ Total gas used: ${totalGasUsed.toLocaleString()}`);
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
      expectedProfit: "0",
      description: "Simple WAVAX -> USDC swap test"
    };
    
    return await this.simulateBundle(bundle);
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
    
    console.log("🔄 Resetting fork to latest block...");
    
    // Get latest block number
    const latestBlock = await this.mainProvider.getBlockNumber();
    
    // Reset fork
    await this.simulationProvider.send("anvil_reset", [
      CURRENT_NETWORK.rpcUrl,
      latestBlock - 2
    ]);
    
    this.forkBlockNumber = latestBlock - 2;
    console.log(`✅ Fork reset to block ${this.forkBlockNumber}`);
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
    
    console.log(`💰 Funding account ${address} with ${amount} ETH`);
    
    await this.simulationProvider.send("anvil_setBalance", [
      address,
      ethers.parseEther(amount).toString()
    ]);
    
    console.log(`✅ Account funded successfully`);
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
    
    // Test simple swap
    console.log("\n" + "=".repeat(50));
    console.log("🧪 Running test simulation...");
    console.log("=".repeat(50));
    
    const result = await simulator.testSimpleSwap();
    
    console.log("\n📊 Simulation Result:");
    console.log(`   Success: ${result.success}`);
    console.log(`   Gas Used: ${result.gasUsed.toLocaleString()}`);
    console.log(`   Profit: ${ethers.formatEther(result.profit)} ETH`);
    console.log(`   Execution Time: ${result.executionTime}ms`);
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
    // Keep running for manual testing
    console.log("\n✅ Simulator is running. Press Ctrl+C to stop.");
    
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