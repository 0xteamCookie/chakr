// Compiles contracts/AuditAnchor.sol and deploys it to Polygon Amoy with the wallet in ANCHOR_PRIVATE_KEY.
// Prints the contract address (put it in ANCHOR_CONTRACT). Never prints the key.
//   cd packages/core && pnpm deploy:anchor

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygonAmoy } from "viem/chains";

const require = createRequire(import.meta.url);
const solc = require("solc");

const { ANCHOR_RPC_URL, ANCHOR_PRIVATE_KEY } = process.env;
if (!ANCHOR_RPC_URL || !ANCHOR_PRIVATE_KEY) throw new Error("set ANCHOR_RPC_URL and ANCHOR_PRIVATE_KEY in .env first");

const file = resolve(import.meta.dirname, "../../../contracts/AuditAnchor.sol");
if (!existsSync(file)) throw new Error(`missing ${file}`);
const out = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources: { "AuditAnchor.sol": { content: readFileSync(file, "utf8") } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
})));
const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
if (errors.length) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));
const c = out.contracts["AuditAnchor.sol"].AuditAnchor;

const account = privateKeyToAccount(ANCHOR_PRIVATE_KEY as `0x${string}`);
const transport = http(ANCHOR_RPC_URL);
const pub = createPublicClient({ chain: polygonAmoy, transport });
const wallet = createWalletClient({ account, chain: polygonAmoy, transport });

const balance = await pub.getBalance({ address: account.address });
console.log(`deployer ${account.address}, balance ${Number(balance) / 1e18} POL`);
const hash = await wallet.deployContract({ abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` });
console.log(`tx ${hash}\nhttps://amoy.polygonscan.com/tx/${hash}`);
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`ANCHOR_CONTRACT=${receipt.contractAddress}`);
console.log(`https://amoy.polygonscan.com/address/${receipt.contractAddress}`);
