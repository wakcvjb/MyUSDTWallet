import { WDK } from '@tetherto/wdk';
import { WalletManagerSolana } from '@tetherto/wdk-wallet-solana';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import * as bip39 from 'bip39';
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
} from '@solana/web3.js';
import {
  KaminoMarket,
  KaminoAction,
  VanillaObligation,
  PROGRAM_ID,
} from '@kamino-finance/klend-sdk';
import Decimal from 'decimal.js';

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const KAMINO_MAIN_MARKET = new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF');

let wdkInstance: WDK | null = null;
let currentMnemonic = '';
let kaminoMarket: KaminoMarket | null = null;

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
  await Keychain.setGenericPassword('wallet', seed, {
    service: 'com.myusdtwallet.seed',
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  currentMnemonic = seed;
  return seed;
}

export async function initWallet() {
  let seed = await AsyncStorage.getItem('wallet_seed');
  if (!seed) {
    const creds = await Keychain.getGenericPassword({
      service: 'com.myusdtwallet.seed',
    });
    if (creds) {
      seed = creds.password;
      await AsyncStorage.setItem('wallet_seed', seed);
    }
  }
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

export async function initKamino() {
  if (kaminoMarket) return kaminoMarket;
  const connection = new Connection(RPC_URL, 'confirmed');
  kaminoMarket = await KaminoMarket.load(connection, KAMINO_MAIN_MARKET);
  await kaminoMarket.loadReserves();
  return kaminoMarket;
}

export async function getKaminoApy(): Promise<number> {
  const market = await initKamino();
  const reserve = market.getReserve('USDT');
  if (!reserve) return 0;
  return Number(reserve.stats.supplyInterestAPY) * 100;
}

export async function getKaminoDeposit(): Promise<string> {
  const market = await initKamino();
  const connection = new Connection(RPC_URL, 'confirmed');
  const wdk = getWdk();
  const account = await wdk.getAccount(0);
  const owner = new PublicKey(account.address);
  const obligation = await market.getUserVanillaObligation(owner);
  if (!obligation) return '0';
  const reserve = market.getReserve('USDT');
  if (!reserve) return '0';
  const deposited = obligation.deposits.get(reserve.address);
  if (!deposited) return '0';
  return new Decimal(deposited.amount.toString()).div(10 ** 6).toString();
}

export async function depositToKamino(amount: string): Promise<string> {
  const market = await initKamino();
  const connection = new Connection(RPC_URL, 'confirmed');
  const wdk = getWdk();
  const account = await wdk.getAccount(0);
  const owner = new PublicKey(account.address);
  const amountBase = new Decimal(amount).mul(10 ** 6).toNumber();
  const reserve = market.getReserve('USDT');
  if (!reserve) throw new Error('USDT reserve not found');
  const currentSlot = await connection.getSlot();
  const kaminoAction = await KaminoAction.buildDepositTxns({
    kaminoMarket: market,
    amount: String(amountBase),
    reserveAddress: reserve.address,
    owner,
    obligation: new VanillaObligation(PROGRAM_ID),
    useV2Ixs: true,
    scopeRefreshConfig: undefined,
    currentSlot,
  });
  const tx = new Transaction();
  tx.add(...kaminoAction.computeBudgetIxs, ...kaminoAction.setupIxs, ...kaminoAction.lendingIxs);
  tx.feePayer = owner;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  const signed = await wdk.signTransaction(0, tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
  await addBillRecord({
    type: 'deposit',
    token: 'USDT',
    amount,
    detail: '存入 Kamino 生息',
    timestamp: Date.now(),
  });
  return sig;
}

export async function withdrawFromKamino(amount: string): Promise<string> {
  const market = await initKamino();
  const connection = new Connection(RPC_URL, 'confirmed');
  const wdk = getWdk();
  const account = await wdk.getAccount(0);
  const owner = new PublicKey(account.address);
  const amountBase = new Decimal(amount).mul(10 ** 6).toNumber();
  const reserve = market.getReserve('USDT');
  if (!reserve) throw new Error('USDT reserve not found');
  const currentSlot = await connection.getSlot();
  const kaminoAction = await KaminoAction.buildWithdrawTxns({
    kaminoMarket: market,
    amount: String(amountBase),
    reserveAddress: reserve.address,
    owner,
    obligation: new VanillaObligation(PROGRAM_ID),
    useV2Ixs: true,
    scopeRefreshConfig: undefined,
    currentSlot,
  });
  const tx = new Transaction();
  tx.add(...kaminoAction.computeBudgetIxs, ...kaminoAction.setupIxs, ...kaminoAction.lendingIxs);
  tx.feePayer = owner;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  const signed = await wdk.signTransaction(0, tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
  await addBillRecord({
    type: 'withdraw',
    token: 'USDT',
    amount,
    detail: '从 Kamino 取出',
    timestamp: Date.now(),
  });
  return sig;
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

export async function checkForInterest(lastCheckTimestamp: number) {
  try {
    const market = await initKamino();
    const wdk = getWdk();
    const account = await wdk.getAccount(0);
    const owner = new PublicKey(account.address);
    const obligation = await market.getUserVanillaObligation(owner);
    if (!obligation) return;
    const reserve = market.getReserve('USDT');
    if (!reserve) return;
    const deposited = obligation.deposits.get(reserve.address);
    if (!deposited) return;
    const currentDeposit = new Decimal(deposited.amount.toString()).div(10 ** 6);
    const lastDeposit = await AsyncStorage.getItem('last_kamino_deposit');
    if (lastDeposit) {
      const diff = currentDeposit.minus(new Decimal(lastDeposit));
      if (diff.gt(0) && lastCheckTimestamp > 0) {
        await addBillRecord({
          type: 'interest',
          token: 'USDT',
          amount: diff.toFixed(6),
          detail: 'Kamino 生息收益',
          timestamp: Date.now(),
        });
      }
    }
    await AsyncStorage.setItem('last_kamino_deposit', currentDeposit.toString());
  } catch {
    return;
  }
}
