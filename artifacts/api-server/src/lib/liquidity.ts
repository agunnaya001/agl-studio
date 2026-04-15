import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  formatUnits,
  parseUnits,
  parseEther,
  encodeFunctionData,
  maxUint256,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

export const AGL_ADDRESS = "0xEA1221B4d80A89BD8C75248Fae7c176BD1854698" as Address;
export const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as Address;
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;

// Uniswap V3 on Base
export const UNISWAP_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as Address;
export const UNISWAP_V3_POSITION_MANAGER = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1" as Address;
export const UNISWAP_QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B136aa68B6Ca75d0610f" as Address;
export const SWAP_ROUTER_02 = "0x2626664c2603336E57B271c5C0b26F421741e481" as Address;

// Uniswap V3 fee tiers
export const FEE_HIGH = 10000; // 1% — best for new/volatile tokens
export const FEE_MEDIUM = 3000; // 0.3%
export const FEE_LOW = 500;    // 0.05%

const ERC20_ABI = [
  { name: "balanceOf", type: "function", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { name: "symbol", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "allowance", type: "function", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    name: "approve",
    type: "function",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

const FACTORY_ABI = [
  {
    name: "getPool",
    type: "function",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const;

const POOL_ABI = [
  { name: "slot0", type: "function", inputs: [], outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint8" }, { type: "bool" }], stateMutability: "view" },
  { name: "liquidity", type: "function", inputs: [], outputs: [{ type: "uint128" }], stateMutability: "view" },
  { name: "fee", type: "function", inputs: [], outputs: [{ type: "uint24" }], stateMutability: "view" },
  { name: "token0", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { name: "token1", type: "function", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

export function getWalletAccount() {
  let pk = process.env.WALLET_PRIVATE_KEY || "";
  if (!pk) throw new Error("WALLET_PRIVATE_KEY not set");
  if (!pk.startsWith("0x")) pk = "0x" + pk;
  return privateKeyToAccount(pk as `0x${string}`);
}

export function getClients() {
  const account = getWalletAccount();
  const transport = http("https://mainnet.base.org", { timeout: 20_000, retryCount: 3 });
  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({ account, chain: base, transport });
  return { account, publicClient, walletClient };
}

export async function getWalletBalances() {
  const { account, publicClient } = getClients();

  const [ethBal, aglBal, usdcBal] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({ address: AGL_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }),
    publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }),
  ]);

  return {
    address: account.address,
    eth: { raw: ethBal.toString(), formatted: formatEther(ethBal), symbol: "ETH" },
    agl: { raw: (aglBal as bigint).toString(), formatted: formatUnits(aglBal as bigint, 18), symbol: "AGL" },
    usdc: { raw: (usdcBal as bigint).toString(), formatted: formatUnits(usdcBal as bigint, 6), symbol: "USDC" },
    sufficientGas: ethBal >= parseEther("0.005"),
  };
}

export async function getPoolStatus(tokenA: Address, tokenB: Address, fee: number) {
  const { publicClient } = getClients();

  const poolAddress = await publicClient.readContract({
    address: UNISWAP_V3_FACTORY,
    abi: FACTORY_ABI,
    functionName: "getPool",
    args: [tokenA, tokenB, fee],
  });

  const ZERO = "0x0000000000000000000000000000000000000000";
  const exists = poolAddress !== ZERO;

  if (!exists) {
    return { exists: false, poolAddress: null, liquidity: "0", sqrtPriceX96: "0", tick: 0, fee };
  }

  const [slot0, liquidity] = await Promise.all([
    publicClient.readContract({ address: poolAddress, abi: POOL_ABI, functionName: "slot0" }),
    publicClient.readContract({ address: poolAddress, abi: POOL_ABI, functionName: "liquidity" }),
  ]);

  const [sqrtPriceX96, tick] = slot0 as [bigint, number, ...unknown[]];

  return {
    exists: true,
    poolAddress,
    liquidity: (liquidity as bigint).toString(),
    sqrtPriceX96: (sqrtPriceX96 as bigint).toString(),
    tick,
    fee,
    hasLiquidity: (liquidity as bigint) > 0n,
  };
}

export async function approveToken(tokenAddress: Address, spender: Address, amount: bigint) {
  const { account, publicClient, walletClient } = getClients();

  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, spender],
  });

  if ((allowance as bigint) >= amount) {
    return { alreadyApproved: true, txHash: null };
  }

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, maxUint256],
  });

  await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  return { alreadyApproved: false, txHash: hash };
}

// Calculate sqrtPriceX96 from a price ratio
// price = amount of token1 per token0
export function encodeSqrtRatioX96(amount1: bigint, amount0: bigint): bigint {
  const ratio = (amount1 * (2n ** 192n)) / amount0;
  return BigInt(Math.floor(Math.sqrt(Number(ratio))));
}

// Nearest valid tick for a fee tier
function nearestUsableTick(tick: number, tickSpacing: number): number {
  return Math.round(tick / tickSpacing) * tickSpacing;
}

// Tick spacing per fee tier
function getTickSpacing(fee: number): number {
  if (fee === 100) return 1;
  if (fee === 500) return 10;
  if (fee === 3000) return 60;
  if (fee === 10000) return 200;
  return 60;
}

const POSITION_MANAGER_ABI = [
  {
    name: "createAndInitializePoolIfNecessary",
    type: "function",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "sqrtPriceX96", type: "uint160" },
    ],
    outputs: [{ name: "pool", type: "address" }],
    stateMutability: "payable",
  },
  {
    name: "mint",
    type: "function",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", name2: "amount0", type: "uint256" },
      { name: "amount1", name3: "amount1", type: "uint256" },
    ],
    stateMutability: "payable",
  },
] as const;

export interface CreatePoolResult {
  poolAddress: string;
  txHash: string;
}

export interface AddLiquidityResult {
  tokenId: string;
  txHash: string;
  amount0Used: string;
  amount1Used: string;
}

export async function createAndSeedPool(config: {
  token0: Address;
  token1: Address;
  fee: number;
  // price = how many token1 per token0 (both in human-readable)
  price: number;
  token0Decimals: number;
  token1Decimals: number;
  // amounts to add in human-readable units
  amount0Human: string;
  amount1Human: string;
}): Promise<{ poolTxHash: string; mintTxHash: string; poolAddress: string }> {
  const { account, publicClient, walletClient } = getClients();

  const { token0, token1, fee, price, token0Decimals, token1Decimals, amount0Human, amount1Human } = config;

  // Sort tokens (Uniswap requires token0 < token1 by address)
  let t0 = token0, t1 = token1, p = price, a0 = amount0Human, a1 = amount1Human, d0 = token0Decimals, d1 = token1Decimals;
  if (token0.toLowerCase() > token1.toLowerCase()) {
    [t0, t1] = [t1, t0];
    [a0, a1] = [a1, a0];
    [d0, d1] = [d1, d0];
    p = 1 / price;
  }

  // Encode initial price as sqrtPriceX96
  // price in terms of token1/token0 scaled by decimals
  const priceScaled = BigInt(Math.floor(p * (10 ** d1))) * (10n ** BigInt(d0)) / (10n ** BigInt(d1));
  const sqrtPriceX96 = encodeSqrtRatioX96(priceScaled, 1n);

  // Create & initialize pool
  const poolTxHash = await walletClient.writeContract({
    address: UNISWAP_V3_POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "createAndInitializePoolIfNecessary",
    args: [t0, t1, fee, sqrtPriceX96],
  });

  const poolReceipt = await publicClient.waitForTransactionReceipt({ hash: poolTxHash, timeout: 120_000 });
  const poolAddress = poolReceipt.contractAddress ?? "0x";

  // Get actual pool address from factory
  const actualPool = await publicClient.readContract({
    address: UNISWAP_V3_FACTORY,
    abi: FACTORY_ABI,
    functionName: "getPool",
    args: [t0, t1, fee],
  });

  const tickSpacing = getTickSpacing(fee);
  const tickLower = nearestUsableTick(-887272, tickSpacing);
  const tickUpper = nearestUsableTick(887272, tickSpacing);

  const amount0Desired = parseUnits(a0, d0);
  const amount1Desired = parseUnits(a1, d1);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);

  const mintTxHash = await walletClient.writeContract({
    address: UNISWAP_V3_POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    functionName: "mint",
    args: [{
      token0: t0,
      token1: t1,
      fee,
      tickLower,
      tickUpper,
      amount0Desired,
      amount1Desired,
      amount0Min: 0n,
      amount1Min: 0n,
      recipient: account.address,
      deadline,
    }],
  });

  await publicClient.waitForTransactionReceipt({ hash: mintTxHash, timeout: 120_000 });

  return { poolTxHash, mintTxHash, poolAddress: actualPool as string };
}
