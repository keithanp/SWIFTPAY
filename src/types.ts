export interface DailyRevenue {
  date: string;
  revenue: number;
  projected: boolean;
}

export type TransactionType = 'advance' | 'payout' | 'sales' | 'fee';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  date: string;
  status: 'completed' | 'pending' | 'failed';
  description: string;
}

export interface FinancialState {
  pendingAppleRevenue: number;
  availableAdvance: number;
  cashInBank: number;
  totalAdvanced: number;
}
