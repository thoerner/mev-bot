import { ethers } from "ethers";
import { createClient } from "redis";
import { CURRENT_NETWORK, TOKENS } from "./constants";
import MempoolListener from "./mempool-listener";
import ArbitrageDetector from "./arbitrage-detector";
import BundleSimulator from "./bundle-simulator";

async function testNodeConnection() {
  console.log("🔍 Testing Avalanche node connection...");
  
  try {
    const provider = new ethers.JsonRpcProvider(CURRENT_NETWORK.rpcUrl);
    const blockNumber = await provider.getBlockNumber();
    const network = await provider.getNetwork();
    
    console.log(`✅ Connected to ${network.name} (Chain ID: ${network.chainId})`);
    console.log(`✅ Current block: ${blockNumber}`);
    
    // Test WebSocket connection
    const wsProvider = new ethers.WebSocketProvider(CURRENT_NETWORK.wsUrl);
    const wsBlockNumber = await wsProvider.getBlockNumber();
    wsProvider.destroy();
    
    console.log(`✅ WebSocket connected, block: ${wsBlockNumber}`);
    
    return true;
  } catch (error) {
    console.error(`❌ Node connection failed: ${error}`);
    return false;
  }
}

async function testRedisConnection() {
  console.log("\n🔍 Testing Redis connection...");
  
  try {
    const client = createClient({ url: 'redis://localhost:6379' });
    await client.connect();
    
    // Test basic operations
    await client.set('test:key', 'test-value');
    const value = await client.get('test:key');
    await client.del('test:key');
    
    await client.quit();
    
    if (value === 'test-value') {
      console.log("✅ Redis connection and operations working");
      return true;
    } else {
      console.log("❌ Redis operations failed");
      return false;
    }
  } catch (error) {
    console.error(`❌ Redis connection failed: ${error}`);
    return false;
  }
}

async function testFoundryInstallation() {
  console.log("\n🔍 Testing Foundry installation...");
  
  try {
    const { spawn } = require('child_process');
    
    return new Promise<boolean>((resolve) => {
      const process = spawn('anvil', ['--version']);
      
      process.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        if (output.includes('anvil')) {
          console.log(`✅ Foundry installed: ${output.trim()}`);
          resolve(true);
        }
      });
      
      process.stderr.on('data', (data: Buffer) => {
        console.error(`❌ Anvil error: ${data.toString()}`);
        resolve(false);
      });
      
      process.on('exit', (code: number | null) => {
        if (code !== 0) {
          console.error(`❌ Anvil not found. Install with: curl -L https://foundry.paradigm.xyz | bash`);
          resolve(false);
        }
      });
      
      // Kill process after version check
      setTimeout(() => {
        process.kill();
      }, 3000);
    });
  } catch (error) {
    console.error(`❌ Foundry test failed: ${error}`);
    return false;
  }
}

async function testMempoolListener() {
  console.log("\n🔍 Testing Mempool Listener...");
  
  try {
    const listener = new MempoolListener();
    await listener.start();
    
    console.log("✅ Mempool listener started successfully");
    
    // Test for 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const pendingSwaps = await listener.getPendingSwaps(10);
    console.log(`✅ Retrieved ${pendingSwaps.length} pending swaps`);
    
    await listener.stop();
    console.log("✅ Mempool listener stopped successfully");
    
    return true;
  } catch (error) {
    console.error(`❌ Mempool listener test failed: ${error}`);
    return false;
  }
}

async function testArbitrageDetector() {
  console.log("\n🔍 Testing Arbitrage Detector...");
  
  try {
    const detector = new ArbitrageDetector();
    await detector.start();
    
    console.log("✅ Arbitrage detector started successfully");
    
    // Test for 10 seconds
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    const opportunities = await detector.getCurrentOpportunities();
    console.log(`✅ Found ${opportunities.length} arbitrage opportunities`);
    
    if (opportunities.length > 0) {
      const best = opportunities[0];
      console.log(`   Best opportunity: ${best.profitPercent.toFixed(2)}% profit`);
    }
    
    await detector.stop();
    console.log("✅ Arbitrage detector stopped successfully");
    
    return true;
  } catch (error) {
    console.error(`❌ Arbitrage detector test failed: ${error}`);
    return false;
  }
}

async function testBundleSimulator() {
  console.log("\n🔍 Testing Bundle Simulator...");
  
  try {
    const simulator = new BundleSimulator();
    await simulator.start();
    
    console.log("✅ Bundle simulator started successfully");
    
    // Test simple swap simulation
    const result = await simulator.testSimpleSwap();
    
    console.log("✅ Bundle simulation completed");
    console.log(`   Success: ${result.success}`);
    console.log(`   Gas Used: ${result.gasUsed.toLocaleString()}`);
    console.log(`   Execution Time: ${result.executionTime}ms`);
    
    await simulator.stop();
    console.log("✅ Bundle simulator stopped successfully");
    
    return result.success;
  } catch (error) {
    console.error(`❌ Bundle simulator test failed: ${error}`);
    return false;
  }
}

async function runFullTest() {
  console.log("🚀 MEV Pipeline Integration Test");
  console.log("=" + "=".repeat(50));
  
  const tests = [
    { name: "Node Connection", test: testNodeConnection },
    { name: "Redis Connection", test: testRedisConnection },
    { name: "Foundry Installation", test: testFoundryInstallation },
    { name: "Mempool Listener", test: testMempoolListener },
    { name: "Arbitrage Detector", test: testArbitrageDetector },
    { name: "Bundle Simulator", test: testBundleSimulator }
  ];
  
  const results: { [key: string]: boolean } = {};
  
  for (const { name, test } of tests) {
    try {
      results[name] = await test();
    } catch (error) {
      console.error(`❌ ${name} test crashed: ${error}`);
      results[name] = false;
    }
  }
  
  console.log("\n" + "=".repeat(50));
  console.log("📊 Test Results Summary:");
  console.log("=".repeat(50));
  
  let passed = 0;
  let total = 0;
  
  for (const [name, success] of Object.entries(results)) {
    const status = success ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} - ${name}`);
    if (success) passed++;
    total++;
  }
  
  console.log("=".repeat(50));
  console.log(`🎯 Overall: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log("🎉 All tests passed! Your MEV pipeline is ready.");
    console.log("\n🚀 Next steps:");
    console.log("   1. Run: npm run mempool (in terminal 1)");
    console.log("   2. Run: npm run arbitrage (in terminal 2)");
    console.log("   3. Run: npm run simulate (in terminal 3)");
    console.log("   4. Watch for arbitrage opportunities!");
  } else {
    console.log("⚠️  Some tests failed. Check the errors above.");
    console.log("   Review the README.md for troubleshooting steps.");
  }
  
  return passed === total;
}

// Run the test
if (require.main === module) {
  runFullTest()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error("💥 Test suite crashed:", error);
      process.exit(1);
    });
}

export default runFullTest; 