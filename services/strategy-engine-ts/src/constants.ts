// Network Configuration
export const NETWORK_CONFIG = {
  MAINNET: {
    rpcUrl: "http://127.0.0.1:9650/ext/bc/C/rpc",
    wsUrl: "ws://127.0.0.1:9650/ext/bc/C/ws",
    chainId: 43114
  },
  FUJI: {
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
    wsUrl: "wss://api.avax-test.network/ext/bc/C/ws",
    chainId: 43113
  }
};

// Use mainnet by default, fallback to fuji for testing
export const CURRENT_NETWORK = NETWORK_CONFIG.MAINNET;

// Mainnet DEX addresses
export const DEXS = {
  TRADER_JOE_V1: "0x60aE616a2155Ee3d9A68541Ba4544862310933d4", // TraderJoe V1 Router
  TRADER_JOE_V2: "0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30", // TraderJoe V2 Router
  PANGOLIN: "0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106", // Pangolin Router
  SUSHISWAP: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506", // SushiSwap Router
};

// Mainnet Factory addresses
export const FACTORIES = {
  TRADER_JOE_V1: "0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10",
  TRADER_JOE_V2: "0x8e42f2F4101563bF679975178e880FD87d3eFd4e",
  PANGOLIN: "0xefa94DE7a4656D787667C749f7E1223D71E9FD88",
  SUSHISWAP: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4"
};

// Mainnet token addresses
export const TOKENS = {
  WAVAX: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
  USDC: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", // USDC.e
  USDT: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", // USDT.e
  DAI: "0xd586E7F844cEa2F87f50152665BCbc2C279D8d70", // DAI.e
  WETH: "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", // WETH.e
};

// Token decimals
export const TOKEN_DECIMALS = {
  [TOKENS.WAVAX]: 18,
  [TOKENS.USDC]: 6,
  [TOKENS.USDT]: 6,
  [TOKENS.DAI]: 18,
  [TOKENS.WETH]: 18
};

// Common trading pairs for arbitrage
export const ARBITRAGE_PAIRS = [
  { tokenA: TOKENS.WAVAX, tokenB: TOKENS.USDC },
  { tokenA: TOKENS.WAVAX, tokenB: TOKENS.USDT },
  { tokenA: TOKENS.WAVAX, tokenB: TOKENS.WETH },
  { tokenA: TOKENS.USDC, tokenB: TOKENS.USDT },
];

// MEV Configuration
export const MEV_CONFIG = {
  MIN_PROFIT_THRESHOLD: 0.001, // Minimum profit in AVAX to execute
  MAX_SLIPPAGE: 0.03, // 3% max slippage
  GAS_LIMIT: 500000,
  PRIORITY_FEE_MULTIPLIER: 1.2,
  REDIS_KEY_PREFIX: "mev:",
  MEMPOOL_TTL: 300, // 5 minutes
  SIMULATION_TIMEOUT: 150, // 150ms max simulation time
  FAST_SIMULATION: true, // Use fast mode for simulations (prioritizes speed over precision)
};

// ABIs
export const ABIS = {
  UNISWAP_V2_PAIR: [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)",
    "function totalSupply() external view returns (uint256)"
  ],
  UNISWAP_V2_FACTORY: [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)"
  ],
  UNISWAP_V2_ROUTER: [
    "function factory() external view returns (address)",
    "function WETH() external view returns (address)",
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function swapExactAVAXForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapTokensForExactAVAX(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function swapExactTokensForAVAX(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function swapAVAXForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
    "function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)"
  ],
  ERC20: [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function transfer(address to, uint amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)"
  ]
};

// Legacy exports for backwards compatibility
export const fujiRpcUrl = NETWORK_CONFIG.FUJI.rpcUrl;
export const TOKEN_PAIRS = {
  WAVAX: TOKENS.WAVAX,
  USDC: TOKENS.USDC
}; 