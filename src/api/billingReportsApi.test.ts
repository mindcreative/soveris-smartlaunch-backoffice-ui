import { describe, expect, it, vi } from 'vitest'
import { creditFixture, expenseFixture, REPORT_CLIENT, REPORT_RANGE } from '../test/billingReportsFixture'
import { buildReportQuery, normalizeReportFilters, parseCreditActivity, parseProviderExpense, readBillingReport, utcInstant, ReportContractError } from './billingReportsApi'
import { apiClient } from './apiClient'
const expenseFilters = { ...REPORT_RANGE, dimensions: ['currency','provider','model','status','source'] }
describe('delivered report adapters', () => {
  it('uses canonical report routes, raw text, signal and cursor-only continuation', async () => {
    const get = vi.spyOn(apiClient, 'getApiRoot').mockResolvedValue({ status: 200, data: creditFixture() })
    const signal = new AbortController().signal
    await readBillingReport('credit', REPORT_CLIENT, REPORT_RANGE, undefined, signal)
    expect(get).toHaveBeenCalledWith('/api/billing/reports/credit-activity', expect.objectContaining({responseType:'text', signal, retryOnUnauthorized:false}))
    expect([...buildReportQuery('credit', REPORT_CLIENT, {cursor:'opaque +&=🧭'})]).toEqual([['clientId',REPORT_CLIENT],['cursor','opaque +&=🧭']])
    expect(() => buildReportQuery('credit',REPORT_CLIENT,{cursor:'a',pageSize:1} as never)).toThrow()
    get.mockRestore()
  })
  it('preserves exact aggregates beyond wallet and JS ranges and 64-bit counts', () => {
    const raw = creditFixture().split('10.0000').join('9007199254740993.0001').split('6.0000').join('9007199254740989.0001').replace('"ledgerEntryCount":4','"ledgerEntryCount":9223372036854775807')
    const page = parseCreditActivity(raw, REPORT_CLIENT, REPORT_RANGE)
    expect(page.totals.grants).toBe('9007199254740993.0001')
    expect(page.provenance.ledgerEntryCount).toBe('9223372036854775807')
    expect(page.asOf).toBe('2026-10-09T14:00:00.123456Z')
  })
  it('keeps retained estimates separate and permits historical Unicode/control keys', () => {
    const result = parseProviderExpense(expenseFixture(REPORT_CLIENT,null,'  🧭\t<script>  '),REPORT_CLIENT,expenseFilters as never)
    expect(result.totals[0].metrics.effectiveExpense).toBe('5.0000')
    expect(result.totals[0].metrics.retainedEstimatedExpense).toBe('6.0000')
    expect(result.items[0].key.provider).toBe('  🧭\t<script>  ')
  })
  it.each(['"schemaVersion":2','"unit":"money"','"timeZone":"Europe/Belgrade"'])('rejects wrong schema/domain %s', replacement => {
    const raw = creditFixture().replace(/"schemaVersion":1|"unit":"abstract_credits"|"timeZone":"UTC"/, replacement)
    expect(()=>parseCreditActivity(raw,REPORT_CLIENT,REPORT_RANGE)).toThrow(ReportContractError)
  })
  it('rejects wrong Client, duplicate fields, numeric strings, invalid count and overflows', () => {
    for (const raw of [creditFixture('ffffffff-1111-4222-8333-444444444444'),creditFixture().replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'),creditFixture().replace('10.0000','"10.0000"'),creditFixture().replace('"ledgerEntryCount":4','"ledgerEntryCount":9223372036854775808'),creditFixture().replace('10.0000','79228162514264337593543950336')])
      expect(()=>parseCreditActivity(raw,REPORT_CLIENT,REPORT_RANGE)).toThrow(ReportContractError)
  })
  it('normalizes UTC offsets without discarding microseconds and rejects invalid boundaries', () => {
    expect(utcInstant('2024-02-29T01:00:00.000001+01:00')).toBe('2024-02-29T00:00:00.000001Z')
    for (const value of ['2025-02-29T00:00:00Z','2026-01-01T00:00:00','2026-01-01T00:00:00.1234567Z','2026-01-01T24:00:00Z']) expect(()=>utcInstant(value)).toThrow()
    expect(()=>normalizeReportFilters('credit',{...REPORT_RANGE,to:REPORT_RANGE.from})).toThrow()
    expect(()=>normalizeReportFilters('credit',{...REPORT_RANGE,to:'2027-09-03T00:00:00Z'})).toThrow()
  })
  it('validates exact filters and canonical dimensions without altering input text', () => {
    const normalized=normalizeReportFilters('expense',{...expenseFilters,dimensions:['model','currency'],provider:'🧭&=provider'})
    expect(normalized.dimensions).toEqual(['currency','model'])
    expect(buildReportQuery('expense',REPORT_CLIENT,normalized).get('provider')).toBe('🧭&=provider')
    for (const extra of [{currency:'usd'},{status:'actual'},{source:'invoice'},{provider:' padded'},{model:'x\n'},{dimensions:['provider']},{dimensions:['currency','currency']},{pageSize:101},{timezone:'UTC'}]) expect(()=>normalizeReportFilters('expense',{...expenseFilters,...extra} as never)).toThrow()
  })
  it('distinguishes null money from measured zero and rejects disabled grouped keys',()=>{
    const raw=expenseFixture().split('5.0000').join('0.0000').split('2.0000').join('0.0000').split('3.0000').join('0.0000')
    expect(parseProviderExpense(raw,REPORT_CLIENT,expenseFilters as never).totals[0].metrics.effectiveExpense).toBe('0.0000')
    const reduced=expenseFixture().split('["currency","provider","model","status","source"]').join('["currency"]')
    expect(()=>parseProviderExpense(reduced,REPORT_CLIENT,{...REPORT_RANGE,dimensions:['currency']})).toThrow()
  })
  it('rejects zero Client and non-integer page-size echoes',()=>{
    expect(()=>buildReportQuery('credit','00000000-0000-0000-0000-000000000000',REPORT_RANGE)).toThrow()
    expect(()=>parseProviderExpense(expenseFixture().replace('"pageSize":1','"pageSize":1.0'),REPORT_CLIENT,REPORT_RANGE)).toThrow()
  })
  it('rejects missing nonempty pages, unrelated currency totals and contradictory count provenance',()=>{
    const empty=expenseFixture().replace(/"items":\[.*\],"nextCursor"/, '"items":[],"nextCursor"')
    expect(()=>parseProviderExpense(empty,REPORT_CLIENT,REPORT_RANGE)).toThrow()
    expect(()=>parseProviderExpense(expenseFixture().replace('"currency":null','"currency":"EUR"'),REPORT_CLIENT,{...REPORT_RANGE,currency:'EUR'})).toThrow()
    expect(()=>parseProviderExpense(expenseFixture().split('"withInvoiceCount":1').join('"withInvoiceCount":2').split('"reconciledCount":1').join('"reconciledCount":0'),REPORT_CLIENT,REPORT_RANGE)).toThrow()
  })

  it('rejects grouped keys that contradict exact applied filters',()=>{
    const raw=expenseFixture().replace('"provider":null','"provider":"expected-provider"')
    expect(()=>parseProviderExpense(raw,REPORT_CLIENT,{...REPORT_RANGE,provider:'expected-provider'})).toThrow()
  })

})
