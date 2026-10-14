import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import {
  initWallet,
  getAddress,
  getBalance,
  sendToken,
  getPrices,
  TOKENS,
  hasExistingWallet,
  createWallet,
  getMnemonic,
  getKaminoApy,
  getKaminoDeposit,
  depositToKamino,
  withdrawFromKamino,
  getBillRecords,
  addBillRecord,
  checkForInterest,
  BillRecord,
} from './wallet';

type Prices = { [key: string]: { usd: number; cny: number } };

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function billIcon(type: string): string {
  switch (type) {
    case 'send': return '↑';
    case 'receive': return '↓';
    case 'deposit': return '⊕';
    case 'withdraw': return '⊖';
    case 'interest': return '★';
    default: return '·';
  }
}

function billLabel(type: string): string {
  switch (type) {
    case 'send': return '发送';
    case 'receive': return '接收';
    case 'deposit': return '存入生息';
    case 'withdraw': return '取出';
    case 'interest': return '利息';
    default: return type;
  }
}

export default function App() {
  const [step, setStep] = useState<'loading' | 'welcome' | 'showMnemonic' | 'main'>('loading');
  const [address, setAddress] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [balances, setBalances] = useState<{ [key: string]: string }>({});
  const [prices, setPrices] = useState<Prices>({});
  const [currency, setCurrency] = useState<'usd' | 'cny'>('usd');
  const [selectedToken, setSelectedToken] = useState('USDT');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [bills, setBills] = useState<BillRecord[]>([]);
  const [kaminoApy, setKaminoApy] = useState(0);
  const [kaminoDeposit, setKaminoDeposit] = useState('0');
  const [depositAmount, setDepositAmount] = useState('');
  const [showDeposit, setShowDeposit] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const p = await getPrices();
      setPrices(p);
      const b: { [key: string]: string } = {};
      for (const t of TOKENS) {
        try {
          b[t.symbol] = await getBalance(t.symbol);
        } catch {
          b[t.symbol] = '0';
        }
      }
      setBalances(b);
      try {
        const apy = await getKaminoApy();
        setKaminoApy(apy);
        const dep = await getKaminoDeposit();
        setKaminoDeposit(dep);
        await checkForInterest(Date.now() - 3600000);
      } catch {
        setKaminoApy(0);
      }
      const rec = await getBillRecords();
      setBills(rec);
    } catch (e: any) {
      setStatus('error: ' + e.message);
    }
  }, []);

  useEffect(() => {
    async function boot() {
      try {
        const exists = await hasExistingWallet();
        if (exists) {
          await initWallet();
          setAddress(await getAddress());
          await loadAll();
          setStep('main');
        } else {
          setStep('welcome');
        }
      } catch (e: any) {
        setStatus('error: ' + e.message);
        setStep('welcome');
      }
    }
    boot();
  }, [loadAll]);

  async function handleCreate() {
    try {
      const seed = await createWallet();
      setMnemonic(seed);
      await initWallet();
      setAddress(await getAddress());
      await loadAll();
      setStep('showMnemonic');
    } catch (e: any) {
      Alert.alert('错误', e.message);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }

  async function handleSend() {
    if (!to || !amount) return;
    try {
      setStatus('发送中...');
      await sendToken(selectedToken, to, amount);
      await addBillRecord({
        type: 'send',
        token: selectedToken,
        amount,
        detail: `发送至 ${to.slice(0, 6)}...${to.slice(-4)}`,
        timestamp: Date.now(),
      });
      setStatus('已发送');
      setTo('');
      setAmount('');
      await loadAll();
    } catch (e: any) {
      setStatus('错误: ' + e.message);
    }
  }

  async function handleDeposit() {
    if (!depositAmount) return;
    try {
      setStatus('存入中...');
      await depositToKamino(depositAmount);
      setStatus('已存入');
      setDepositAmount('');
      setShowDeposit(false);
      await loadAll();
    } catch (e: any) {
      setStatus('错误: ' + e.message);
    }
  }

  async function handleWithdraw() {
    try {
      setStatus('取出中...');
      await withdrawFromKamino(kaminoDeposit);
      setStatus('已取出');
      await loadAll();
    } catch (e: any) {
      setStatus('错误: ' + e.message);
    }
  }

  function totalValue() {
    let sum = 0;
    for (const t of TOKENS) {
      const bal = parseFloat(balances[t.symbol] || '0');
      const price = prices[t.symbol]?.[currency] || 0;
      sum += bal * price;
    }
    const kd = parseFloat(kaminoDeposit || '0');
    const usdtPrice = prices['USDT']?.[currency] || 0;
    sum += kd * usdtPrice;
    return sum.toFixed(2);
  }

  if (step === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#9945FF" />
        <Text style={styles.loadingText}>正在加载...</Text>
      </View>
    );
  }

  if (step === 'welcome') {
    return (
      <View style={styles.welcomeContainer}>
        <Text style={styles.welcomeTitle}>USDT Wallet</Text>
        <Text style={styles.welcomeSubtitle}>Solana 自托管钱包</Text>
        <TouchableOpacity style={styles.bigButton} onPress={handleCreate}>
          <Text style={styles.bigButtonText}>创建新钱包</Text>
        </TouchableOpacity>
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </View>
    );
  }

  if (step === 'showMnemonic') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.mnemonicContainer}>
        <Text style={styles.warnTitle}>请抄写助记词</Text>
        <Text style={styles.warnText}>
          以下 12 个单词是你的钱包唯一凭证。请用笔抄写在纸上，离线保存。
          任何人获得这些单词即可转走你的全部资产。
        </Text>
        <View style={styles.mnemonicBox}>
          {mnemonic.split(' ').map((word, i) => (
            <View key={i} style={styles.wordChip}>
              <Text style={styles.wordIndex}>{i + 1}</Text>
              <Text style={styles.wordText}>{word}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={styles.bigButton} onPress={() => setStep('main')}>
          <Text style={styles.bigButtonText}>我已抄写完成</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#9945FF" />}
    >
      <View style={styles.header}>
        <Text style={styles.totalLabel}>总资产</Text>
        <Text style={styles.totalValue}>
          {currency === 'usd' ? '$' : '¥'}{totalValue()}
        </Text>
        <TouchableOpacity
          style={styles.currencyToggle}
          onPress={() => setCurrency(currency === 'usd' ? 'cny' : 'usd')}
        >
          <Text style={styles.currencyText}>{currency === 'usd' ? 'USD' : 'CNY'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>可用资产</Text>
        {TOKENS.map((t) => (
          <TouchableOpacity
            key={t.symbol}
            style={[styles.tokenRow, selectedToken === t.symbol && styles.tokenRowActive]}
            onPress={() => setSelectedToken(t.symbol)}
          >
            <View style={styles.tokenLeft}>
              <Text style={styles.tokenSymbol}>{t.symbol}</Text>
              <Text style={styles.tokenName}>{t.name}</Text>
            </View>
            <View style={styles.tokenRight}>
              <Text style={styles.tokenBalance}>{balances[t.symbol] || '0'}</Text>
              <Text style={styles.tokenValue}>
                {currency === 'usd' ? '$' : '¥'}
                {((parseFloat(balances[t.symbol] || '0')) * (prices[t.symbol]?.[currency] || 0)).toFixed(2)}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>生息</Text>
        <View style={styles.apyRow}>
          <Text style={styles.apyLabel}>昨日 APY</Text>
          <Text style={styles.apyValue}>{kaminoApy.toFixed(2)}%</Text>
        </View>
        <View style={styles.apyRow}>
          <Text style={styles.apyLabel}>已存入</Text>
          <Text style={styles.apyValue}>{kaminoDeposit} USDT</Text>
        </View>
        {showDeposit ? (
          <View>
            <TextInput
              style={styles.input}
              placeholder="存入金额 (USDT)"
              placeholderTextColor="#666"
              value={depositAmount}
              onChangeText={setDepositAmount}
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.button} onPress={handleDeposit}>
              <Text style={styles.buttonText}>确认存入</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.buttonSecondary} onPress={() => setShowDeposit(false)}>
              <Text style={styles.buttonText}>取消</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <TouchableOpacity style={styles.button} onPress={() => setShowDeposit(true)}>
              <Text style={styles.buttonText}>存入生息</Text>
            </TouchableOpacity>
            {parseFloat(kaminoDeposit) > 0 && (
              <TouchableOpacity style={styles.buttonSecondary} onPress={handleWithdraw}>
                <Text style={styles.buttonText}>全部取出</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>转账</Text>
        <TextInput
          style={styles.input}
          placeholder="接收地址"
          placeholderTextColor="#666"
          value={to}
          onChangeText={setTo}
        />
        <TextInput
          style={styles.input}
          placeholder={`金额 (${selectedToken})`}
          placeholderTextColor="#666"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
        />
        <TouchableOpacity style={styles.button} onPress={handleSend}>
          <Text style={styles.buttonText}>发送 {selectedToken}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>最近账单</Text>
        {bills.length === 0 ? (
          <Text style={styles.emptyText}>暂无记录</Text>
        ) : (
          bills.slice(0, 20).map((b) => (
            <View key={b.id} style={styles.billRow}>
              <View style={styles.billIconBox}>
                <Text style={styles.billIcon}>{billIcon(b.type)}</Text>
              </View>
              <View style={styles.billMid}>
                <Text style={styles.billType}>
                  {billLabel(b.type)} {b.token}
                </Text>
                <Text style={styles.billDetail}>{b.detail}</Text>
              </View>
              <View style={styles.billRight}>
                <Text style={[styles.billAmount, b.type === 'interest' && styles.interestAmount]}>
                  {b.type === 'send' || b.type === 'deposit' || b.type === 'withdraw' ? '-' : '+'}
                  {b.amount}
                </Text>
                <Text style={styles.billTime}>{formatTime(b.timestamp)}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>地址</Text>
        <Text style={styles.address} selectable>{address}</Text>
      </View>

      {status ? <Text style={styles.status}>{status}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0B0F' },
  content: { padding: 16, paddingTop: 60, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#0B0B0F', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#888', marginTop: 12 },
  welcomeContainer: { flex: 1, backgroundColor: '#0B0B0F', justifyContent: 'center', alignItems: 'center', padding: 32 },
  welcomeTitle: { color: '#fff', fontSize: 32, fontWeight: '700' },
  welcomeSubtitle: { color: '#888', fontSize: 15, marginTop: 8, marginBottom: 48 },
  bigButton: { backgroundColor: '#9945FF', borderRadius: 14, paddingVertical: 18, paddingHorizontal: 48, alignItems: 'center', width: '100%' },
  bigButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  mnemonicContainer: { padding: 24, paddingTop: 80 },
  warnTitle: { color: '#FF6B6B', fontSize: 20, fontWeight: '700', marginBottom: 12 },
  warnText: { color: '#AAA', fontSize: 14, lineHeight: 22, marginBottom: 24 },
  mnemonicBox: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 32 },
  wordChip: { backgroundColor: '#1A1A22', borderRadius: 10, padding: 12, width: '31%', marginBottom: 10, alignItems: 'center' },
  wordIndex: { color: '#666', fontSize: 10, marginBottom: 4 },
  wordText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  header: { alignItems: 'center', marginBottom: 24 },
  totalLabel: { color: '#888', fontSize: 14 },
  totalValue: { color: '#fff', fontSize: 36, fontWeight: '700', marginTop: 4 },
  currencyToggle: { marginTop: 8, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1A1A22' },
  currencyText: { color: '#9945FF', fontSize: 13, fontWeight: '600' },
  card: { backgroundColor: '#14141A', borderRadius: 16, padding: 16, marginBottom: 16 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  tokenRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1F1F28' },
  tokenRowActive: { backgroundColor: '#1A1A22', borderRadius: 8, paddingHorizontal: 8 },
  tokenLeft: { flex: 1 },
  tokenSymbol: { color: '#fff', fontSize: 15, fontWeight: '600' },
  tokenName: { color: '#666', fontSize: 12, marginTop: 2 },
  tokenRight: { alignItems: 'flex-end' },
  tokenBalance: { color: '#fff', fontSize: 15 },
  tokenValue: { color: '#888', fontSize: 12, marginTop: 2 },
  apyRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  apyLabel: { color: '#888', fontSize: 14 },
  apyValue: { color: '#4ADE80', fontSize: 16, fontWeight: '700' },
  input: { backgroundColor: '#1A1A22', borderRadius: 12, padding: 14, color: '#fff', marginBottom: 12, fontSize: 15 },
  button: { backgroundColor: '#9945FF', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 10 },
  buttonSecondary: { backgroundColor: '#1A1A22', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 10 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  address: { color: '#9945FF', fontSize: 13, fontFamily: 'monospace' },
  emptyText: { color: '#555', fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  billRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1F1F28' },
  billIconBox: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1A1A22', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  billIcon: { color: '#9945FF', fontSize: 16, fontWeight: '700' },
  billMid: { flex: 1 },
  billType: { color: '#fff', fontSize: 14, fontWeight: '600' },
  billDetail: { color: '#666', fontSize: 11, marginTop: 2 },
  billRight: { alignItems: 'flex-end' },
  billAmount: { color: '#fff', fontSize: 14, fontWeight: '600' },
  interestAmount: { color: '#4ADE80' },
  billTime: { color: '#555', fontSize: 11, marginTop: 2 },
  status: { color: '#555', fontSize: 12, textAlign: 'center', marginTop: 8 },
});
