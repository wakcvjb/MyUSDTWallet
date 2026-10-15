import { WDK } from '@tetherto/wdk';
import { WalletManagerSolana } from '@tetherto/wdk-wallet-solana';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as bip39 from 'bip39';

const RPC_URL = 'https://api.mainnet-beta.solana.com';

let wdkInstance: WDK | null = null;
let currentMnemonic = '';

export const TOKENS = [
  { symbol: 'USDT', name: 'Tether USD', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  { symbol: 'USDC', name: 'USD Coin', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  { symbol: 'SOL', name: 'Solana', mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
];

export async function hasExistingWallet(): Promise<boolean> {
  const seed = await AsyncStorage.getItem('wallet_seed');
  return !!seed;
}

export async function createWallet(): Promise<string> {
  const seed = bip39.generateMnemonic(128);
  await AsyncStorage.setItem('wallet_seed', seed);
  currentMnemonic = seed;
  return seed;
}

export async function initWallet() {
  const seed = await AsyncStorage.getItem('wallet_seed');
  if (!seed) throw new Error('no wallet found');
  currentMnemonic = seed;
  const wallet = new WalletManagerSolana(seed, { provider: RPC_URL });
  wdkInstance = new WDK(wallet);
  await wdkInstance.init();
  return wdkInstance;
}

export function getMnemonic() {
  return currentMnemonic;
}

export function getWdk() {
  if (!wdkInstance) throw new Error('wallet not initialized');
  return wdkInstance;
}

export async function getAddress(): Promise<string> {
  const wdk = getWdk();
  const account = await wdk.getAccount(0);
  return account.address;
}

export async function getBalance(tokenSymbol: string): Promise<string> {
  const wdk = getWdk();
  const account = await wdk.getAccount(0);
  return String(await account.getTokenBalance(tokenSymbol));
}

export async function sendToken(tokenSymbol: string, to: string, amount: string) {
  const wdk = getWdk();
  const account = await wdk.getAccount(0);
  return await account.transferToken({ token: tokenSymbol, to, amount });
}

export async function getPrices() {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=tether,usd-coin,solana&vs_currencies=usd,cny'
  );
  const data = await res.json();
  return {
    USDT: data.tether,
    USDC: data['usd-coin'],
    SOL: data.solana,
  };
}

export type BillRecord = {
  id: string;
  type: 'send' | 'receive' | 'deposit' | 'withdraw' | 'interest';
  token: string;
  amount: string;
  detail: string;
  timestamp: number;
};

export async function getBillRecords(): Promise<BillRecord[]> {
  const raw = await AsyncStorage.getItem('bill_records');
  if (!raw) return [];
  return JSON.parse(raw);
}

export async function addBillRecord(record: Omit<BillRecord, 'id'>) {
  const records = await getBillRecords();
  const newRecord: BillRecord = {
    ...record,
    id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
  };
  records.unshift(newRecord);
  await AsyncStorage.setItem('bill_records', JSON.stringify(records.slice(0, 200)));
}
