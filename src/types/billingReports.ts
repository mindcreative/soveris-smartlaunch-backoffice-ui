// Exact decimal/count strings are deliberately separate from safe page-size integers.
export type ReportKind = 'credit' | 'expense'
export type ReportGrain = 'day' | 'week' | 'month'
export const REPORT_DIMENSIONS = ['currency', 'provider', 'model', 'status', 'source'] as const
export const REPORT_STATUSES = ['unresolved', 'estimated', 'reconciled'] as const
export const REPORT_SOURCES = ['provider_response', 'calculated_from_provider_pricing', 'provider_billing_api', 'manual_reconciliation', 'unknown'] as const
export type ReportDimension = typeof REPORT_DIMENSIONS[number]
export interface ReportFilters {
  from: string; to: string; groupBy: ReportGrain; pageSize: number
  dimensions?: readonly ReportDimension[]
  currency?: string | null; provider?: string | null; model?: string | null
  status?: string | null; source?: string | null
}
export interface ExpenseFilters extends ReportFilters {
  dimensions: readonly ReportDimension[]
  currency: string | null; provider: string | null; model: string | null
  status: string | null; source: string | null
}
export const CREDIT_FIELDS = ['grants','consumption','postedConsumption','adjustments','reversals','netActivity','holdsCreated','holdsClosed','holdNetActivity','releasedWithoutConsumption','unusedOnCommit','releases','usagePostingDifference'] as const
export type CreditField = typeof CREDIT_FIELDS[number]
export type CreditMetrics = Record<CreditField,string> & { consumptionToGrantRatio: string | null; ratioStatus: 'defined' | 'zero_grants' }
export const EXPENSE_COUNTS = ['observationCount','unresolvedCount','estimatedCount','reconciledCount','withoutUsageCount','withInvoiceCount','missingAmountCount','retainedEstimateCount'] as const
export const EXPENSE_AMOUNTS = ['retainedEstimatedExpense','unreconciledEstimatedExpense','reconciledProviderExpense','effectiveExpense'] as const
export interface SourceTotal { source: string; observationCount: string; amount: string }
export type ExpenseMetrics = Record<typeof EXPENSE_COUNTS[number],string> & Record<typeof EXPENSE_AMOUNTS[number],string|null> & {estimateSources: SourceTotal[]; actualSources: SourceTotal[]}
export interface Period { bucketStart: string; periodStart: string; periodEnd: string }
export interface ExpenseKey { currencyCode: string | null; provider: string | null; model: string | null; status: string | null; source: string | null }
export interface CreditBucket extends Period {metrics: CreditMetrics}
export interface ExpenseBucket extends Period {key: ExpenseKey; metrics: ExpenseMetrics}
interface ReportBase {schemaVersion:1; clientId:string; timeZone:'UTC'; asOf:string; nextCursor:string|null}
export interface CreditPage extends ReportBase {
  unit:'abstract_credits'; from:string; to:string; groupBy:ReportGrain
  provenance:{source:'immutable_ledger_and_usage';ledgerDateBasis:'created_at';usageDateBasis:'created_at';membership:'committed_first_page_snapshot';netBasis:'posted_owned_ledger_effects';consumptionBasis:'usage_records';ledgerEntryCount:string;usageRecordCount:string;unsettledUsageCount:string;unsettledUsageCredits:string}
  totals:CreditMetrics; items:CreditBucket[]
}
export interface ExpensePage extends ReportBase {
  unit:'provider_money';filters:ExpenseFilters
  provenance:{source:'provider_cost_records';accountingDateBasis:'captured_at';membership:'committed_first_page_revisions';sourceGroupingBasis:'actual_else_estimated';observationCount:string;unknownCurrencyCount:string;missingAmountCount:string}
  totals:{currencyCode:string|null;metrics:ExpenseMetrics}[];items:ExpenseBucket[]
}
export type ReportPage = CreditPage | ExpensePage
