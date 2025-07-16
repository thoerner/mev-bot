import { ethers } from "ethers";
import { DEXS, TOKEN_PAIRS, fujiRpcUrl } from "./constants";

const provider = new ethers.JsonRpcProvider(fujiRpcUrl);

// Minimal ABI for UniswapV2Pair
const pairAbi = [
    "function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)",
    "function token0() external view returns (address)"
];

const factoryAbi = [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

const routerAbi = [
    "function factory() external view returns (address)"
];

async function getPairContract(factoryAddress: string, tokenA: string, tokenB: string) {
    const factory = new ethers.Contract(factoryAddress, factoryAbi, provider);
    const pairAddress = await factory.getPair(tokenA, tokenB);

    if (pairAddress === ethers.ZeroAddress) {
        return null;
    }

    return new ethers.Contract(pairAddress, pairAbi, provider);
}

async function main() {
    console.log("Starting arbitrage strategy engine on Fuji testnet...");

    const network = await provider.getNetwork();
    console.log(`Connected to network: ${network.name} (Chain ID: ${network.chainId})`);

    const traderJoeFactoryAddress = "0x7b50046cEC8252ca835b148b1eDD997319120a12"; // From Trader Joe Docs
    const pangolinRouterContract = new ethers.Contract(DEXS.PANGOLIN, routerAbi, provider);
    const pangolinFactoryAddress = await pangolinRouterContract.factory();

    provider.on("block", async (blockNumber) => {
        console.log(`\n--- New Block: ${blockNumber} ---`);

        try {
            const [traderJoePair, pangolinPair] = await Promise.all([
                getPairContract(traderJoeFactoryAddress, TOKEN_PAIRS.WAVAX, TOKEN_PAIRS.USDC),
                getPairContract(pangolinFactoryAddress, TOKEN_PAIRS.WAVAX, TOKEN_PAIRS.USDC)
            ]);

            if (!traderJoePair || !pangolinPair) {
                console.log("One or both pairs not found.");
                return;
            }

            const [traderJoeReserves, pangolinReserves, tjToken0, pgToken0] = await Promise.all([
                traderJoePair.getReserves(),
                pangolinPair.getReserves(),
                traderJoePair.token0(),
                pangolinPair.token0()
            ]);

            const [tjWavaxReserves, tjUsdcReserves] = tjToken0.toLowerCase() === TOKEN_PAIRS.WAVAX.toLowerCase()
                ? [traderJoeReserves[0], traderJoeReserves[1]]
                : [traderJoeReserves[1], traderJoeReserves[0]];

            const [pgWavaxReserves, pgUsdcReserves] = pgToken0.toLowerCase() === TOKEN_PAIRS.WAVAX.toLowerCase()
                ? [pangolinReserves[0], pangolinReserves[1]]
                : [pangolinReserves[1], pangolinReserves[0]];

            console.log("Trader Joe (WAVAX/USDC) Reserves:", {
                WAVAX: ethers.formatUnits(tjWavaxReserves, 18),
                USDC: ethers.formatUnits(tjUsdcReserves, 6)
            });

            console.log("Pangolin (WAVAX/USDC) Reserves:", {
                WAVAX: ethers.formatUnits(pgWavaxReserves, 18),
                USDC: ethers.formatUnits(pgUsdcReserves, 6)
            });

            // TODO: Calculate prices and check for arbitrage opportunities

        } catch (error) {
            console.error("Error fetching reserves:", error);
        }
    });
}

main().catch((error) => {
    console.error("Error in arbitrage engine:", error);
    process.exit(1);
}); 